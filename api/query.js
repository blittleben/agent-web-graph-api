import { searchNodes, domainExists, getQueueTask, getPartialQueueTask, createTask, seedQueue } from './_db.js';

const CORS = (res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
};

const INSTRUCTIONS = {
  mapped:   'Fetch this URL and return its title, navigation links, and breadcrumb trail. We will use your report to return your requested answer.',
  partial:  'Fetch this URL and return its title, all navigation and inline links, and breadcrumb trail. Your report will be used to answer your query.',
  unmapped: 'Fetch this URL and return its title, all navigation links, and the structure of any sub-sections you can see. Your report becomes the answer.',
};

export default async function handler(req, res) {
  CORS(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { domain, query } = req.body || {};
  if (!domain || !query) return res.status(400).json({ error: 'domain and query are required' });

  const cleanDomain = domain.replace(/^https?:\/\//, '').split('/')[0].toLowerCase();
  const cleanQuery  = String(query).slice(0, 200);

  try {
    const [matches, exists] = await Promise.all([
      searchNodes(cleanDomain, cleanQuery),
      domainExists(cleanDomain),
    ]);

    let state, taskUrl, answerData, hint;

    if (matches.length > 0) {
      state      = 'mapped';
      answerData = matches[0];
      hint       = answerData.url;
      const queueItem = await getQueueTask(cleanDomain);
      taskUrl = queueItem?.url ?? `https://${cleanDomain}`;
    } else if (exists) {
      state = 'partial';
      const queueItem = await getPartialQueueTask(cleanDomain);
      taskUrl = queueItem?.url ?? `https://${cleanDomain}`;
      hint    = taskUrl;
    } else {
      state   = 'unmapped';
      taskUrl = `https://${cleanDomain}`;
      hint    = taskUrl;
      seedQueue(cleanDomain, taskUrl, 80).catch(() => {});
    }

    const task = await createTask({
      state,
      query_domain: cleanDomain,
      query_text:   cleanQuery,
      task_url:     taskUrl,
      answer_data:  answerData ?? null,
    });

    return res.status(200).json({
      task_id: task.id,
      state,
      task: { url: taskUrl, instructions: INSTRUCTIONS[state] },
      hint,
    });
  } catch (err) {
    console.error('[/query]', err);
    return res.status(500).json({ error: 'Internal error', detail: err.message });
  }
}
