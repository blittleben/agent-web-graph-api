import {
  getTask, completeTask,
  upsertNodes, upsertEdges,
  markQueueItemMapped, searchNodes
} from './_db.js';

const VALID_PAGE_TYPES = new Set([
  'homepage','docs_page','api_reference','article','category_index',
  'product_page','search_results','profile','repo','dataset','paper','filing','other'
]);
const VALID_LINK_TYPES = new Set([
  'nav_link','inline_link','breadcrumb_link','footer_link','canonical_link'
]);

function validateResult(result) {
  if (!result?.url || typeof result.url !== 'string') return 'result.url required';
  if (!result.url.startsWith('http')) return 'result.url must be a full URL';
  if (result.page_type && !VALID_PAGE_TYPES.has(result.page_type)) return 'invalid page_type';
  if (!Array.isArray(result.outbound_links)) return 'outbound_links must be an array';
  if (result.outbound_links.length > 100) return 'max 100 outbound_links';
  for (const link of result.outbound_links) {
    if (!link.target_url || !link.target_url.startsWith('http')) return 'each link needs a valid target_url';
    if (link.link_type && !VALID_LINK_TYPES.has(link.link_type)) return 'invalid link_type';
  }
  return null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { task_id, result } = req.body || {};
  if (!task_id) return res.status(400).json({ error: 'task_id required' });

  const validationError = validateResult(result);
  if (validationError) return res.status(400).json({ error: validationError });

  try {
    const task = await getTask(task_id);
    if (!task)                       return res.status(404).json({ error: 'task not found' });
    if (task.status === 'expired')   return res.status(410).json({ error: 'task expired' });
    if (task.status === 'completed') return res.status(409).json({ error: 'task already completed' });

    const domain = new URL(result.url).hostname;
    const node = {
      url:               result.url,
      domain,
      page_type:         result.page_type || 'other',
      title:             result.title || null,
      depth:             result.depth || null,
      breadcrumb:        result.breadcrumb || [],
      nav_position:      result.nav_position || 'unknown',
      http_status:       result.http_status || 200,
      sitemap_listed:    false,
      contributor_count: 1,
      trust_score:       0.1,
    };
    await upsertNodes([node]);

    if (result.outbound_links?.length) {
      const edges = result.outbound_links
        .filter(l => l.target_url && l.target_url !== result.url)
        .map(l => ({
          source_url:         result.url,
          target_url:         l.target_url,
          link_type:          l.link_type || 'inline_link',
          anchor_text:        l.anchor_text || null,
          confirmed_by_count: 1,
        }));
      if (edges.length) await upsertEdges(edges);
    }

    await markQueueItemMapped(result.url).catch(() => {});
    await completeTask(task_id);

    let answer;
    if (task.state === 'mapped') {
      answer = task.answer_data;
    } else if (task.state === 'partial') {
      const matches = await searchNodes(task.query_domain, task.query_text);
      answer = matches[0] ?? {
        url: result.url, title: result.title,
        breadcrumb: result.breadcrumb || [], trust_score: 0.1,
        page_type: result.page_type || 'other',
        note: 'Best available match — coverage improving',
      };
    } else {
      const navLinks = (result.outbound_links || [])
        .filter(l => l.link_type === 'nav_link' || l.link_type === 'inline_link')
        .slice(0, 5);
      answer = {
        url: result.url, title: result.title,
        breadcrumb: result.breadcrumb || [], trust_score: 0.1,
        page_type: result.page_type || 'homepage',
        nav_links: navLinks,
        note: 'Domain newly mapped — best starting point we have',
      };
    }

    return res.status(200).json({ answer });
  } catch (err) {
    console.error('[/complete]', err);
    return res.status(500).json({ error: 'Internal error', detail: err.message });
  }
}
