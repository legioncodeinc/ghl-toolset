// Functions in this file are injected into the HighLevel page's MAIN world by
// chrome.scripting.executeScript. They are serialized and re-parsed there, so
// each one must be entirely self-contained: no imports, no closure variables,
// which is why the small request helper is repeated rather than shared.
//
// Why the MAIN world: the app keeps its authenticated HTTP client on
// window.SHELL_STORE.$http, whose interceptor attaches the session token. By
// borrowing that client we never read, store, or transmit a credential
// ourselves -- requests go out exactly as the app's own requests do.
//
// Endpoint map, lifted from the app's own workflow service class:
//   GET    {base}/{loc}/list                 list workflows and folders
//   GET    {base}/{loc}/{id}?includeTriggers=true   full definition
//   POST   {base}/{loc}                      create            -> { id, assetWarnings }
//   PUT    {base}/{loc}/{id}                 update / restore
//   GET    {base}/{loc}/trigger?workflowId=  triggers for a workflow
//   POST   {base}/{loc}/trigger              create trigger
//   DELETE {base}/{loc}/trigger/{id}         remove trigger
// where {base} is https://backend.leadconnectorhq.com/workflow

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
  if (!store) return { ok: false, reason: 'not-highlevel' };

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
    if (store && store.$http) return (await store.$http.get(url, { params })).data;
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
      headers: { Authorization: 'Bearer ' + token, channel: 'APP', source: 'WEB_USER', Version: '2021-07-28' }
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  };

  const base = 'https://backend.leadconnectorhq.com/workflow/' + locationId + '/list';
  const rows = [];
  const seen = new Set();
  let expected = null;

  // The service reads this endpoint with limit/offset, not limit/skip. Using
  // the wrong name silently re-serves page one, so paging must be verified by
  // watching for ids we have already collected rather than trusted blindly.
  for (let page = 0; page < 50; page++) {
    const data = await request(base, { limit: 200, offset: rows.length });
    const batch = (data && data.rows) || [];
    if (expected === null) expected = typeof data.count === 'number' ? data.count : batch.length;

    let added = 0;
    for (const row of batch) {
      const id = row.id || row._id;
      if (seen.has(id)) continue;
      seen.add(id);
      rows.push(row);
      added++;
    }
    if (!batch.length || !added || rows.length >= expected) break;
  }

  return { count: expected === null ? rows.length : expected, rows };
}

/**
 * Full definition for one workflow. includeTriggers=true is the key: it swaps
 * the plain metadata response for { workflowData, triggers, dependentAssets },
 * which is the same shape the app's own restore path writes back.
 */
export async function fetchWorkflowDetail(locationId, workflowId) {
  const url = 'https://backend.leadconnectorhq.com/workflow/' + locationId + '/' + workflowId;

  try {
    const store = window.SHELL_STORE;
    if (store && store.$http) {
      const res = await store.$http.get(url, { params: { includeTriggers: true } });
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
      headers: { Authorization: 'Bearer ' + token, channel: 'APP', source: 'WEB_USER', Version: '2021-07-28' }
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return { ok: true, data: await res.json() };
  } catch (err) {
    const status = err && err.response && err.response.status;
    return { ok: false, error: status ? 'HTTP ' + status : String((err && err.message) || err) };
  }
}

/**
 * Writes one workflow back into a sub-account.
 *
 * spec = { mode: 'create' | 'overwrite', targetId?, name, status?, payload }
 * where payload is a { workflowData, triggers } object from a backup file.
 *
 * The sequence mirrors the app's own restore-from-nodes flow exactly:
 *   1. create the workflow (or take the existing one)
 *   2. delete whatever triggers are attached
 *   3. create the incoming triggers, rewired to the target workflow id
 *   4. read the created triggers back
 *   5. PUT the action graph with isRestoreRequest: true
 *
 * Step 5 must send the *target's* current version, not the version recorded in
 * the backup: the endpoint uses it for optimistic concurrency and rejects a
 * stale number with "Your version is outdated".
 */
export async function importWorkflow(locationId, spec) {
  const BASE = 'https://backend.leadconnectorhq.com/workflow';
  const store = window.SHELL_STORE;

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

  const req = async (method, url, body, params) => {
    if (store && store.$http) {
      const res = await store.$http.request({ method, url, data: body, params });
      return res.data;
    }
    const token = findJwt(store && store.state && store.state.auth, 0);
    const target = new URL(url);
    for (const [k, v] of Object.entries(params || {})) target.searchParams.set(k, String(v));
    const res = await fetch(target.toString(), {
      method: method.toUpperCase(),
      headers: {
        Authorization: 'Bearer ' + token,
        channel: 'APP',
        source: 'WEB_USER',
        Version: '2021-07-28',
        'Content-Type': 'application/json'
      },
      body: body ? JSON.stringify(body) : undefined
    });
    if (!res.ok) {
      let detail = '';
      try { detail = (await res.json()).errorMessage || ''; } catch (e) { /* body not json */ }
      throw new Error('HTTP ' + res.status + (detail ? ': ' + detail : ''));
    }
    return res.json();
  };

  const fail = (err) => {
    const body = err && err.response && err.response.data;
    const detail = body && (body.errorMessage || body.msg || body.message);
    const status = err && err.response && err.response.status;
    return {
      ok: false,
      error: detail || String((err && err.message) || err),
      status: status || null
    };
  };

  try {
    const record = (spec.payload && spec.payload.workflowData) || {};
    const templates = (record.workflowData && record.workflowData.templates) || [];
    const triggers = (spec.payload && spec.payload.triggers) || [];

    let company = null;
    let userId;
    try { company = store.state.company.company || store.state.company.originalCompany; } catch (e) { /* optional */ }
    try { userId = store.state.user.user.id || store.state.user.user._id; } catch (e) { /* optional */ }

    const settings = {
      timezone: record.timezone,
      allowMultiple: record.allowMultiple,
      allowMultipleOpportunity: record.allowMultipleOpportunity,
      autoMarkAsRead: record.autoMarkAsRead,
      stopOnResponse: record.stopOnResponse,
      removeContactFromLastStep: record.removeContactFromLastStep,
      window: record.window,
      eventStartDate: record.eventStartDate
    };

    let workflowId = spec.targetId;
    let assetWarnings = [];

    if (spec.mode === 'create') {
      const created = await req('post', BASE + '/' + locationId, {
        name: spec.name,
        status: 'draft',
        type: 'workflow',
        location_id: locationId,
        company_id: company && (company.id || company._id),
        company_age: company && company.age,
        ...settings,
        workflowData: { templates: [] }
      });
      workflowId = created && (created.id || created._id);
      assetWarnings = (created && created.assetWarnings) || [];
      if (!workflowId) throw new Error('Create returned no workflow id');
    }

    // Triggers are replaced wholesale rather than diffed. On a fresh create
    // there is nothing to remove; on an overwrite this is what makes the
    // imported trigger set authoritative instead of additive.
    let removed = 0;
    const existing = await req('get', BASE + '/' + locationId + '/trigger', null, { workflowId });
    for (const trigger of (existing || [])) {
      await req('delete', BASE + '/' + locationId + '/trigger/' + (trigger.id || trigger._id), null, { userId });
      removed++;
    }

    let added = 0;
    for (const trigger of triggers) {
      const body = JSON.parse(JSON.stringify(trigger));
      // Server-assigned identity and bookkeeping must not be carried over, or
      // the new trigger collides with the one in the source workflow.
      delete body.id;
      delete body._id;
      delete body.predeterminedId;
      delete body.date_added;
      delete body.date_updated;
      delete body.deleted;
      body.location_id = locationId;
      body.workflow_id = workflowId;
      body.workflowId = workflowId;
      if (Array.isArray(body.actions)) {
        body.actions = body.actions.map((action) => ({ ...action, workflow_id: workflowId }));
      }
      await req('post', BASE + '/' + locationId + '/trigger', body);
      added++;
    }

    const current = await req('get', BASE + '/' + locationId + '/' + workflowId);
    const live = await req('get', BASE + '/' + locationId + '/trigger', null, { workflowId });

    await req('put', BASE + '/' + locationId + '/' + workflowId, {
      name: spec.name,
      isRestoreRequest: true,
      status: spec.status || 'draft',
      ...settings,
      workflowData: { templates },
      updatedBy: userId,
      version: current.version,
      oldTriggers: [],
      newTriggers: live || [],
      triggersChanged: true,
      modifiedSteps: [],
      deletedSteps: [],
      createdSteps: [],
      meta: record.meta || {}
    });

    return {
      ok: true,
      id: workflowId,
      actions: templates.length,
      triggersAdded: added,
      triggersRemoved: removed,
      assetWarnings
    };
  } catch (err) {
    return fail(err);
  }
}
