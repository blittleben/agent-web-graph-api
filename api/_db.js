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
  return sbFetch('/edges', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify(edges),
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
