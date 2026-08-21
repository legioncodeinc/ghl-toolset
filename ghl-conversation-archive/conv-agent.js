// Injected into the HighLevel page's MAIN world, same contract as agent.js:
// each function is serialized and re-parsed there, so nothing may reference
// module scope. The helper is repeated in each function for that reason.
//
// Conversation endpoints, all verified against a live sub-account:
//   GET {svc}/conversations/search?locationId=&limit=&startAfterDate=
//        -> { conversations: [...], total }
//        Paging is a cursor, NOT an offset. `offset` and `page` are accepted
//        and silently ignored; the cursor is the previous page's last
//        conversation's `sort[0]` value, passed as startAfterDate.
//   GET {svc}/conversations/{id}/messages?limit=&lastMessageId=
//        -> { messages: { messages: [...], lastMessageId, nextPage } }
//   GET {svc}/contacts/{id}  -> full contact record
//
// There is also GET {svc}/conversations/messages/export, which is the
// purpose-built bulk endpoint, but it rejects a browser session with
// "Can not fetch messages from non-OAuth channel". It needs a Private
// Integration or OAuth token, so this module does not use it.

const SVC = 'https://services.leadconnectorhq.com';

/** One page of the conversation list, plus the cursor for the next page. */
export async function fetchConversationsPage(locationId, startAfterDate, limit) {
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
    for (const [k, v] of Object.entries(params || {})) {
      if (v !== undefined && v !== null) target.searchParams.set(k, String(v));
    }
    const res = await fetch(target.toString(), {
      headers: { Authorization: 'Bearer ' + token, channel: 'APP', source: 'WEB_USER', Version: '2021-04-15' }
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  };

  try {
    const params = { locationId, limit: limit || 100 };
    if (startAfterDate) params.startAfterDate = startAfterDate;
    const data = await request('https://services.leadconnectorhq.com/conversations/search', params);
    const list = (data && data.conversations) || [];
    const last = list[list.length - 1];
    return {
      ok: true,
      total: data && data.total,
      conversations: list,
      cursor: last && Array.isArray(last.sort) ? last.sort[0] : null
    };
  } catch (err) {
    const status = err && err.response && err.response.status;
    return { ok: false, error: status ? 'HTTP ' + status : String((err && err.message) || err) };
  }
}

/**
 * Every message in one conversation, walking the lastMessageId cursor.
 * Looping inside the page rather than round-tripping per page matters: a
 * 580-message thread is 6 pages, and each executeScript hop costs more than
 * the request it carries.
 */
export async function fetchAllMessages(conversationId, maxPages) {
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
    for (const [k, v] of Object.entries(params || {})) {
      if (v !== undefined && v !== null) target.searchParams.set(k, String(v));
    }
    const res = await fetch(target.toString(), {
      headers: { Authorization: 'Bearer ' + token, channel: 'APP', source: 'WEB_USER', Version: '2021-04-15' }
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  };

  const cap = maxPages || 200;
  const url = 'https://services.leadconnectorhq.com/conversations/' + conversationId + '/messages';
  const all = [];
  let cursor = null;
  let pages = 0;
  let truncated = false;

  try {
    for (; pages < cap; pages++) {
      const params = { limit: 100 };
      if (cursor) params.lastMessageId = cursor;
      const data = await request(url, params);
      const block = (data && data.messages) || {};
      const batch = block.messages || [];
      all.push(...batch);
      cursor = block.lastMessageId;
      if (!block.nextPage || !batch.length || !cursor) { pages++; break; }
      await new Promise((r) => setTimeout(r, 60));
    }
    if (pages >= cap) truncated = true;
    return { ok: true, messages: all, pages, truncated };
  } catch (err) {
    const status = err && err.response && err.response.status;
    return { ok: false, error: status ? 'HTTP ' + status : String((err && err.message) || err), messages: all, pages };
  }
}

/** Full contact record. Only the identity fields a later migration would map on. */
export async function fetchContact(contactId) {
  const request = async (url) => {
    const store = window.SHELL_STORE;
    if (store && store.$http) return (await store.$http.get(url, { headers: { Version: '2021-07-28' } })).data;
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
    const res = await fetch(url, {
      headers: { Authorization: 'Bearer ' + token, channel: 'APP', source: 'WEB_USER', Version: '2021-07-28' }
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  };

  try {
    const data = await request('https://services.leadconnectorhq.com/contacts/' + contactId);
    const c = (data && data.contact) || data || {};
    return {
      ok: true,
      contact: {
        id: c.id || contactId,
        firstName: c.firstName || null,
        lastName: c.lastName || null,
        email: c.email || null,
        phone: c.phone || null,
        dateAdded: c.dateAdded || null,
        tags: c.tags || []
      }
    };
  } catch (err) {
    const status = err && err.response && err.response.status;
    return { ok: false, error: status ? 'HTTP ' + status : String((err && err.message) || err) };
  }
}
