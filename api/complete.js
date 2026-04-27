import {
  getTask, completeTask,
  upsertNodes, upsertEdges,
  markQueueItemMapped, searchNodes,
  enqueueUrls
} from './_db.js';

const CORS = (res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
};

const VALID_PAGE_TYPES = new Set([
  'homepage','docs_page','api_reference','article','category_index',
  'product_page','search_results','profile','repo','dataset','paper','filing','other'
]);
const VALID_LINK_TYPES = new Set([
  'nav_link','inline_link','breadcrumb_link','footer_link','canonical_link'
]);

function validateResult(result) {
  if (!result || typeof result !== 'object') return 'result must be an object';
  const { url, title, page_type, breadcrumb, outbound_links } = result;
  if (!url || typeof url !== 'string') return 'url required';
  try { new URL(url); } catch(e) { return 'url must be valid'; }
  if (!title || typeof title !== 'string') return 'title required';
  if (!Array.isArray(breadcrumb)) return 'breadcrumb must be array';
  if (!Array.isArray(outbound_links)) return 'outbound_links must be array';
  if (page_type && !VALID_PAGE_TYPES.has(page_type)) return `page_type must be one of: ${[...VALID_PAGE_TYPES].join(', ')}`;
  return null;
}

export default async function handler(req, res) {
  CORS(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { task_id, agent_id, result } = req.body || {};
  if (!task_id) return res.status(400).json({ error: 'task_id required' });
  if (!result)  return res.status(400).json({ error: 'result required' });

  const validationError = validateResult(result);
  if (validationError) return res.status(400).json({ error: validationError });

  const { url, title, page_type, breadcrumb, outbound_links } = result;

  // Fetch the task
  let task;
  try {
    task = await getTask(task_id);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch task', detail: err.message });
  }
  if (!task) return res.status(404).json({ error: 'Task not found' });
  if (task.status === 'completed') return res.status(409).json({ error: 'Task already completed' });

  // agent_id check is optional — only enforce if task has one stored
  if (task.agent_id && task.agent_id !== agent_id) {
    return res.status(403).json({ error: 'task not assigned to this agent' });
  }

  // Derive domain from url
  let domain;
  try {
    domain = new URL(url).hostname;
  } catch (e) {
    return res.status(400).json({ error: 'url must be a valid URL' });
  }

  // Sanitize breadcrumb
  const cleanBreadcrumb = Array.isArray(breadcrumb)
    ? breadcrumb.filter(b => typeof b === 'string').slice(0, 20)
    : [];

  // Sanitize outbound_links
  const cleanLinks = Array.isArray(outbound_links)
    ? outbound_links.filter(l => l && typeof l.url === 'string').slice(0, 200).map(l => ({
        url: l.url,
        anchor_text: typeof l.anchor_text === 'string' ? l.anchor_text.slice(0, 200) : '',
        link_type: VALID_LINK_TYPES.has(l.link_type) ? l.link_type : 'inline_link',
      }))
    : [];

  try {
    // Upsert node
    await upsertNodes([{
      url,
      domain,
      title: title.slice(0, 500),
      page_type: VALID_PAGE_TYPES.has(page_type) ? page_type : 'other',
      breadcrumb: cleanBreadcrumb,
      trust_score: 0.1,
    }]);

    // Upsert edges
    if (cleanLinks.length > 0) {
      const edges = cleanLinks.map(l => ({
        source_url: url,
        target_url: l.url,
        anchor_text: l.anchor_text,
        link_type: l.link_type,
      }));
      await upsertEdges(edges);

      // Enqueue outbound links for future crawling (up to 25)
      const queueItems = cleanLinks.slice(0, 25).map(link => {
        try {
          const u = new URL(link.url);
          const d = u.hostname;
          return { url: link.url, domain: d, priority: d === domain ? 50 : 30 };
        } catch { return null; }
      }).filter(Boolean);
      enqueueUrls(queueItems).catch(() => {});
    }

    // Mark queue item as mapped using task_url
    await markQueueItemMapped(task.task_url).catch(() => {});

    // Complete the task
    await completeTask(task_id);

    // Return answer using stored query context
    const answer = await searchNodes(task.query_domain, task.query_text);
    const state = answer ? 'mapped' : 'partial';

    return res.status(200).json({
      ok: true,
      state,
      answer: answer || null,
      message: state === 'mapped'
        ? 'Contribution accepted and answer found'
        : 'Contribution accepted, query still partial',
    });

  } catch (err) {
    return res.status(500).json({ error: 'Internal error', detail: err.message });
  }
}
