// Functions in this file are injected into the HighLevel page's MAIN world by
// chrome.scripting.executeScript. They are serialized and re-parsed there, so
// each one must be entirely self-contained: no imports, no closure variables.
//
// Why the MAIN world: the app keeps its authenticated HTTP client on
// window.SHELL_STORE.$http, whose interceptor attaches the session token. By
// borrowing that client we never read, store, or transmit a credential
// ourselves -- the request goes out exactly as the app's own requests do.

export const BACKEND = 'https://backend.leadconnectorhq.com/workflow';

/** Confirms we are on a HighLevel app page and reports the location in view. */
export function probePage() {
  const findJwt = (node, depth) => {
    if (!node || depth > 4) return null;
    if (typeof node === 'string') {
      return /^ey[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\./.test(node) ? node : null;
    }
    if (typeof node !== 'object') return null;
    for (const key of Object.keys(node)) {
      const hit = findJwt(node[key], depth + 1);
      if (hit) return hit;
    }
    return null;
  };

  const store = window.SHELL_STORE;
  if (!store) {
    return { ok: false, reason: 'not-highlevel' };
  }

  const fromUrl = location.pathname.match(/\/location\/([A-Za-z0-9]+)/);
  let locationId = fromUrl ? fromUrl[1] : null;
  let locationName = null;
  try {
    const current = store.state.locations.currentLocation;
    locationId = locationId || current.id || current._id;
    locationName = current.name || null;
  } catch (e) { /* location name is cosmetic */ }

  if (!locationId) return { ok: false, reason: 'no-location' };

  const mode = store.$http ? 'client' : (findJwt(store.state && store.state.auth, 0) ? 'token' : null);
  if (!mode) return { ok: false, reason: 'no-auth' };

  return { ok: true, locationId, locationName, mode, origin: location.origin };
}

/** Pages through the workflow list for one sub-account. */
export async function fetchWorkflowList(locationId) {
  const request = async (url, params) => {
    const store = window.SHELL_STORE;
    if (store && store.$http) {
      const res = await store.$http.get(url, { params });
      return res.data;
    }
    const findJwt = (node, depth) => {
      if (!node || depth > 4) return null;
      if (typeof node === 'string') {
        return /^ey[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\./.test(node) ? node : null;
      }
      if (typeof node !== 'object') return null;
      for (const key of Object.keys(node)) {
        const hit = findJwt(node[key], depth + 1);
        if (hit) return hit;
      }
      return null;
    };
    const token = findJwt(store && store.state && store.state.auth, 0);
    const target = new URL(url);
    for (const [k, v] of Object.entries(params || {})) target.searchParams.set(k, String(v));
    const res = await fetch(target.toString(), {
      headers: {
        Authorization: 'Bearer ' + token,
        channel: 'APP',
        source: 'WEB_USER',
        Version: '2021-07-28'
      }
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  };

  const base = 'https://backend.leadconnectorhq.com/workflow/' + locationId + '/list';
  const rows = [];
  let expected = null;
  let skip = 0;

  for (let page = 0; page < 50; page++) {
    const data = await request(base, { limit: 200, skip });
    const batch = (data && data.rows) || [];
    if (expected === null) expected = typeof data.count === 'number' ? data.count : batch.length;
    rows.push(...batch);
    skip += batch.length;
    if (!batch.length || rows.length >= expected) break;
  }

  return { count: expected === null ? rows.length : expected, rows };
}

/**
 * Full definition for one workflow. includeTriggers=true is the key: it swaps
 * the plain metadata response for { workflowData, triggers, dependentAssets },
 * which is the same shape HighLevel's own importer accepts.
 */
export async function fetchWorkflowDetail(locationId, workflowId) {
  const url = 'https://backend.leadconnectorhq.com/workflow/' + locationId + '/' + workflowId;
  const params = { includeTriggers: true };

  try {
    const store = window.SHELL_STORE;
    if (store && store.$http) {
      const res = await store.$http.get(url, { params });
      return { ok: true, data: res.data };
    }
    const findJwt = (node, depth) => {
      if (!node || depth > 4) return null;
      if (typeof node === 'string') {
        return /^ey[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\./.test(node) ? node : null;
      }
      if (typeof node !== 'object') return null;
      for (const key of Object.keys(node)) {
        const hit = findJwt(node[key], depth + 1);
        if (hit) return hit;
      }
      return null;
    };
    const token = findJwt(store && store.state && store.state.auth, 0);
    const target = new URL(url);
    target.searchParams.set('includeTriggers', 'true');
    const res = await fetch(target.toString(), {
      headers: {
        Authorization: 'Bearer ' + token,
        channel: 'APP',
        source: 'WEB_USER',
        Version: '2021-07-28'
      }
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return { ok: true, data: await res.json() };
  } catch (err) {
    const status = err && err.response && err.response.status;
    return { ok: false, error: status ? 'HTTP ' + status : String((err && err.message) || err) };
  }
}
