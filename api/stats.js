import { getStats } from './_db.js';

const CORS = (res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
};

export default async function handler(req, res) {
  CORS(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  try {
    const stats = await getStats();
    return res.status(200).json({
      ...stats,
      note: 'Page counts and domain coverage only - actual URLs and navigation paths are earned via the barter API.',
    });
  } catch (err) {
    return res.status(500).json({ error: 'Internal error', detail: err.message });
  }
}
