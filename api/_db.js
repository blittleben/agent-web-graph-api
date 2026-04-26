/**
 * _db.js — Supabase REST helper (no dependencies, uses native fetch)
 */
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

const BASE_HEADERS = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
};

async function sbFetch(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    ...options,
    headers: { ...BASE_HEADERS, ...(options.headers || {}) },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase error ${res.status}: ${text}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : [];
}

export async function searchNodes(domain, queryText) {
  const q = encodeURIComponent(`%${queryText}%`);
  const d = encodeURIComponent(domain);
  const path = `/nodes?domain=eq.${d}&or=(title.ilike.${q},breadcrumb.cs.{${encodeURIComponent(queryText)}})&order=trust_score.desc&limit=5`;
  return sbFetch(path);
}

export async function domainExists(domain) {
  const d = encodeURIComponent(domain);
  const rows = await sbFetch(`/nodes?domain=eq.${d}&limit=1&select=id`);
  return rows.length > 0;
}

export async function upsertNodes(nodes) {
  return sbFetch('/nodes', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify(nodes),
  });
}

export async function upsertEdges(edges) {
  // Map from_url/to_url (agent payload) to source_url/target_url (DB schema)
  const mapped = edges.map(e => ({
    source_url: e.from_url || e.source_url,
    target_url: e.to_url   || e.target_url,
    anchor_text: e.anchor_text,
    link_type: e.link_type || 'inline_link',
  }));
  return sbFetch('/edges', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify(mapped),
  });
}

export async function createTask(task) {
  const rows = await sbFetch('/tasks', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(task),
  });
  return rows[0];
}

export async function getTask(id) {
  const rows = await sbFetch(`/tasks?id=eq.${encodeURIComponent(id)}&limit=1`);
  return rows[0] || null;
}

export async function completeTask(id) {
  return sbFetch(`/tasks?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'completed' }),
  });
}

export async function getQueueTask(excludeDomain) {
  const d = encodeURIComponent(excludeDomain);
  const rows = await sbFetch(
    `/mapping_queue?mapped=eq.false&domain=neq.${d}&order=priority.desc,last_assigned.asc.nullsfirst&limit=1`
  );
  if (!rows.length) return null;
  await sbFetch(`/mapping_queue?id=eq.${rows[0].id}`, {
    method: 'PATCH',
    body: JSON.stringify({ last_assigned: new Date().toISOString() }),
  });
  return rows[0];
}

export async function getPartialQueueTask(domain) {
  const d = encodeURIComponent(domain);
  const rows = await sbFetch(
    `/mapping_queue?mapped=eq.false&domain=eq.${d}&order=priority.desc,last_assigned.asc.nullsfirst&limit=1`
  );
  if (!rows.length) return null;
  await sbFetch(`/mapping_queue?id=eq.${rows[0].id}`, {
    method: 'PATCH',
    body: JSON.stringify({ last_assigned: new Date().toISOString() }),
  });
  return rows[0];
}

export async function markQueueItemMapped(url) {
  return sbFetch(`/mapping_queue?url=eq.${encodeURIComponent(url)}`, {
    method: 'PATCH',
    body: JSON.stringify({ mapped: true }),
  });
}

export async function getStats() {
  const [nodeStats, edgeCount, domainStats] = await Promise.all([
    sbFetch('/nodes?select=domain,page_type&limit=10000'),
    sbFetch('/edges?select=id&limit=1', { headers: { Prefer: 'count=exact' } }),
    sbFetch('/nodes?select=domain&limit=10000'),
  ]);

  const totalNodes = nodeStats.length;
  const byDomain = {};
  const byPageType = {};

  for (const row of nodeStats) {
    byDomain[row.domain] = (byDomain[row.domain] || 0) + 1;
    byPageType[row.page_type || 'other'] = (byPageType[row.page_type || 'other'] || 0) + 1;
  }

  const topDomains = Object.entries(byDomain)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([domain, count]) => ({ domain, pages: count }));

  return {
    nodes: totalNodes,
    domains: Object.keys(byDomain).length,
    by_page_type: byPageType,
    top_domains: topDomains,
  };
}
