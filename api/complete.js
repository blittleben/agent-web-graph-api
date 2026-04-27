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
  if (!VALID_PAGE_TYPES.has(page_type)) return 'page_type must be one of: ' + [...VALID_PAGE_TYPES].join(',');
  if (!Array.isArray(breadcrumb)) return 'breadcrumb must be array';
  if (!Array.isArray(outbound_links)) return 'outbound_links must be array';
  for (const link of outbound_links) {
    if (!link.url || !link.anchor_text) return 'each link needs url and anchor_text';
    if (link.link_type && !VALID_LINK_TYPES.has(link.link_type)) return 'invalid link_type: ' + link.link_type;
    try { new URL(link.url); } catch(e) { return 'invalid link url: ' + link.url; }
  }
  return null;
}

export default async function handler(req, res) {
  CORS(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { task_id, agent_id, result } = req.body || {};
  if (!task_id || !agent_id || !result) {
    return res.status(400).json({ error: 'task_id, agent_id, and result required' });
  }

  const validationError = validateResult(result);
  if (validationError) return res.status(400).json({ error: validationError });

  const task = await getTask(task_id);
  if (!task) return res.status(404).json({ error: 'task not found' });
  if (task.agent_id !== agent_id) return res.status(403).json({ error: 'task not assigned to this agent' });
  if (task.status !== 'pending') return res.status(409).json({ error: 'task already ' + task.status });

  const { url, title, page_type, breadcrumb, outbound_links } = result;
  const domain = new URL(url).hostname;

  // Store the crawled page
  await upsertNodes([{
    url, domain, title, page_type,
    breadcrumb: breadcrumb || [],
    trust_score: 0.1
  }]);

  // Store outbound link structure
  if (outbound_links.length > 0) {
    const edges = outbound_links.map(link => ({
      from_url: url,
      to_url: link.url,
      anchor_text: link.anchor_text,
      link_type: link.link_type || 'inline_link'
    }));
    await upsertEdges(edges);

    // Feed discovered URLs back into the queue for future crawling
    // Same domain gets medium priority (50), cross-domain gets low (30)
    const queueItems = outbound_links
      .slice(0, 25)
      .map(link => {
        try {
          const u = new URL(link.url);
          const d = u.hostname;
          return { url: link.url, domain: d, priority: d === domain ? 50 : 30 };
        } catch { return null; }
      })
      .filter(Boolean);
    enqueueUrls(queueItems).catch(() => {});
  }

  // Mark the queue item done — use task_url (the URL this agent was asked to crawl)
  await markQueueItemMapped(task.task_url).catch(() => {});
  await completeTask(task_id);

  // Return the answer to the agent's original query
  const originalQuery = task.query_text;
  const answer = await searchNodes(task.query_domain, originalQuery);

  return res.status(200).json({
    status: 'accepted',
    answer: answer?.length
      ? { type: 'mapped', data: answer[0] }
      : { type: 'still_unmapped', message: 'result stored but original query remains unmapped' }
  });
}
