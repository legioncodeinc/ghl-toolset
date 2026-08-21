import { probePage } from './agent.js';
import { fetchConversationsPage, fetchAllMessages, fetchContact } from './conv-agent.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);

const state = {
  tabId: Number(params.get('tabId')) || null,
  origin: params.get('origin') || null,
  locationId: null,
  locationName: null,
  dir: null,
  writers: {},
  contacts: new Map(),
  done: new Set(),
  cursor: null,
  total: null,
  counts: { conversations: 0, messages: 0, bytes: 0 },
  options: { files: true, jsonl: true, pretty: false, contacts: true },
  errors: [],
  running: false,
  paused: false,
  startedAt: 0,
  startedFrom: 0
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function say(node, message, kind) {
  node.textContent = message;
  node.className = 'state' + (kind ? ' ' + kind : '');
}

function slug(name, fallback) {
  const base = String(name || '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
  return base || fallback;
}

function openStep(n) {
  $('s' + n).classList.remove('is-off');
}

/* ------------------------------------------------------------ page setup --- */

async function init() {
  if (!state.tabId) {
    $('sub').textContent = 'Open this page from the extension popup so it knows which tab to read.';
    return;
  }
  try {
    const tab = await chrome.tabs.get(state.tabId);
    // tab.url is only populated when the extension holds permission for it, so
    // the popup passes the origin along rather than us asking for "tabs".
    if (!state.origin && tab.url) state.origin = new URL(tab.url).origin;
  } catch (e) {
    $('sub').textContent = 'That HighLevel tab is gone. Reopen this page from the popup.';
    return;
  }
  if (!state.origin) {
    $('sub').textContent = 'Missing origin. Reopen this page from the popup.';
    return;
  }
  $('sub').textContent = state.origin;
  const granted = await chrome.permissions.contains({ origins: [state.origin + '/*'] });
  if (granted) await afterGrant();
}

async function grant() {
  try {
    const ok = await chrome.permissions.request({ origins: [state.origin + '/*'] });
    if (!ok) return say($('grantState'), 'Permission declined.', 'err');
    await afterGrant();
  } catch (err) {
    say($('grantState'), String(err.message || err), 'err');
  }
}

async function afterGrant() {
  const probe = await inTab(probePage);
  if (!probe || !probe.ok) {
    return say($('grantState'), 'Could not read the sub-account from that tab. Reload it and try again.', 'err');
  }
  state.locationId = probe.locationId;
  state.locationName = probe.locationName;
  $('sub').textContent = (probe.locationName || probe.locationId) + ' · ' + state.origin;
  say($('grantState'), 'Access granted.', 'ok');
  $('s1').classList.add('is-done');
  openStep(2);
}

async function inTab(func, args) {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId: state.tabId }, world: 'MAIN', func, args: args || []
  });
  return result ? result.result : undefined;
}

/* --------------------------------------------------------------- folder --- */

async function pickFolder() {
  try {
    state.dir = await window.showDirectoryPicker({ mode: 'readwrite', id: 'ghl-conversation-archive' });
  } catch (e) {
    return; // user cancelled
  }
  try {
    const resumed = await loadManifest();
    say($('pickState'),
      resumed
        ? 'Resuming: ' + state.done.size + ' conversation(s) already archived here.'
        : 'Folder ready.',
      'ok');
    $('s2').classList.add('is-done');
    openStep(3);
    if (resumed) $('start').textContent = 'Resume';
    paint();
  } catch (err) {
    say($('pickState'), String(err.message || err), 'err');
  }
}

async function readJson(name) {
  try {
    const handle = await state.dir.getFileHandle(name);
    const text = await (await handle.getFile()).text();
    return JSON.parse(text);
  } catch (e) {
    return null;
  }
}

async function loadManifest() {
  const manifest = await readJson('manifest.json');
  if (!manifest) return false;
  state.cursor = manifest.cursor || null;
  state.total = manifest.total || null;
  state.counts = manifest.counts || state.counts;
  state.done = new Set(manifest.doneConversationIds || []);
  state.errors = manifest.errors || [];
  const contacts = await readJson('contacts.json');
  if (contacts) for (const [id, c] of Object.entries(contacts)) state.contacts.set(id, c);
  return state.done.size > 0;
}

/**
 * Append-mode writer for the two JSONL streams. Opening with keepExistingData
 * and seeking to the current end is what makes a resumed run add to the file
 * instead of truncating everything the last run wrote.
 */
async function openWriter(name) {
  const handle = await state.dir.getFileHandle(name, { create: true });
  const size = (await handle.getFile()).size;
  const stream = await handle.createWritable({ keepExistingData: true });
  await stream.seek(size);
  return stream;
}

async function openWriters() {
  if (state.options.jsonl) state.writers.messages = await openWriter('messages.jsonl');
  state.writers.conversations = await openWriter('conversations.jsonl');
}

async function closeWriters() {
  for (const key of Object.keys(state.writers)) {
    try { await state.writers[key].close(); } catch (e) { /* already closed */ }
    delete state.writers[key];
  }
}

async function writeJson(name, value) {
  const handle = await state.dir.getFileHandle(name, { create: true });
  const stream = await handle.createWritable(); // truncates: these are rewritten whole
  await stream.write(JSON.stringify(value, null, 2) + '\n');
  await stream.close();
}

async function checkpoint() {
  await writeJson('manifest.json', {
    locationId: state.locationId,
    locationName: state.locationName,
    options: state.options,
    total: state.total,
    counts: state.counts,
    cursor: state.cursor,
    complete: !state.running && state.total !== null && state.counts.conversations >= (state.total || 0),
    errors: state.errors,
    doneConversationIds: [...state.done]
  });
  await writeJson('contacts.json', Object.fromEntries(state.contacts));
}

/* ------------------------------------------------------------------ run --- */

async function start() {
  state.options = {
    files: $('optFiles').checked,
    jsonl: $('optJsonl').checked,
    pretty: $('optPretty').checked,
    contacts: $('withContacts').checked
  };
  if (!state.options.files && !state.options.jsonl) {
    return say($('runState'), 'Pick at least one output format.', 'err');
  }
  state.running = true;
  state.paused = false;
  state.startedAt = Date.now();
  state.startedFrom = state.counts.conversations;
  $('start').hidden = true;
  $('pause').hidden = false;
  $('stop').hidden = false;
  $('stats').hidden = false;
  $('barWrap').hidden = false;
  say($('runState'), '');

  try {
    await openWriters();
    await crawl();
  } catch (err) {
    say($('runState'), String(err.message || err), 'err');
  } finally {
    await closeWriters();
    await checkpoint();
    state.running = false;
    $('pause').hidden = true;
    $('stop').hidden = true;
    $('start').hidden = false;
    $('start').textContent = 'Resume';
    paint();
  }
}

async function crawl() {
  let queue = [];

  while (state.running) {
    if (state.paused) { await sleep(300); continue; }

    if (!queue.length) {
      $('now').textContent = 'Fetching the next page of conversations…';
      const page = await inTab(fetchConversationsPage, [state.locationId, state.cursor, 100]);
      if (!page || !page.ok) throw new Error('Conversation list failed: ' + ((page && page.error) || 'unknown'));
      if (typeof page.total === 'number') state.total = page.total;
      if (!page.conversations.length) {
        say($('runState'), 'Done. Every conversation in this sub-account is archived.', 'ok');
        state.running = false;
        break;
      }
      queue = page.conversations;
      state.cursor = page.cursor;
    }

    const conversation = queue.shift();
    const id = conversation.id;
    if (state.done.has(id)) continue;

    $('now').textContent = 'Archiving ' + (conversation.contactName || conversation.fullName || id);

    const result = await inTab(fetchAllMessages, [id, 200]);
    if (!result || !result.ok) {
      state.errors.push({ id, name: conversation.contactName || null, error: (result && result.error) || 'unknown' });
      renderErrors();
      state.done.add(id); // recorded as failed; a rerun should not stall here forever
      continue;
    }

    if (state.options.contacts && conversation.contactId && !state.contacts.has(conversation.contactId)) {
      const c = await inTab(fetchContact, [conversation.contactId]);
      if (c && c.ok) state.contacts.set(conversation.contactId, c.contact);
      await sleep(40);
    } else if (conversation.contactId && !state.contacts.has(conversation.contactId)) {
      state.contacts.set(conversation.contactId, {
        id: conversation.contactId,
        name: conversation.contactName || conversation.fullName || null,
        email: conversation.email || null,
        phone: null
      });
    }

    await writeConversation(conversation, result);

    state.counts.conversations++;
    state.counts.messages += result.messages.length;
    state.done.add(id);

    if (state.counts.conversations % 10 === 0) await checkpoint();
    paint();
    await sleep(90); // deliberate throttle; a 20-request burst was fine but this runs for thousands
  }
}

async function writeConversation(conversation, result) {
  const name = 'conversations/' + slug(conversation.contactName || conversation.fullName, 'contact') +
    '-' + String(conversation.id).slice(0, 8) + '.json';
  let written = 0;

  if (state.options.files) {
    const record = {
      conversation,
      messageCount: result.messages.length,
      pages: result.pages,
      truncated: result.truncated || false,
      messages: result.messages
    };
    const folder = await state.dir.getDirectoryHandle('conversations', { create: true });
    const handle = await folder.getFileHandle(name.split('/')[1], { create: true });
    const stream = await handle.createWritable();
    const text = state.options.pretty
      ? JSON.stringify(record, null, 2) + '\n'
      : JSON.stringify(record) + '\n';
    await stream.write(text);
    await stream.close();
    written += text.length;
  }

  const convLine = JSON.stringify({
    ...conversation,
    messageCount: result.messages.length,
    file: state.options.files ? name : null
  }) + '\n';
  await state.writers.conversations.write(convLine);
  written += convLine.length;

  if (state.options.jsonl) {
    // Denormalised on purpose: each line carries the contact identity so the
    // file stands alone in SQLite without a join back to conversations.jsonl.
    for (const message of result.messages) {
      const line = JSON.stringify({
        ...message,
        conversationId: conversation.id,
        contactId: conversation.contactId,
        contactName: conversation.contactName || conversation.fullName || null
      }) + '\n';
      written += line.length;
      await state.writers.messages.write(line);
    }
  }

  state.counts.bytes += written;
}

/* ------------------------------------------------------------------- ui --- */

function paint() {
  $('nConv').textContent = state.counts.conversations.toLocaleString();
  $('nMsg').textContent = state.counts.messages.toLocaleString();
  $('nMb').textContent = (state.counts.bytes / 1048576).toFixed(1);

  if (state.total) {
    const pct = Math.min(100, (state.counts.conversations / state.total) * 100);
    $('bar').style.width = pct.toFixed(1) + '%';
  }

  if (state.total && state.counts.conversations > 3) {
    const projected = (state.counts.bytes / state.counts.conversations) * state.total;
    const gb = projected / 1073741824;
    $('proj').textContent = gb >= 1 ? gb.toFixed(2) + ' GB' : Math.round(projected / 1048576) + ' MB';
  }

  const doneThisRun = state.counts.conversations - state.startedFrom;
  if (state.running && doneThisRun > 5 && state.total) {
    const perItem = (Date.now() - state.startedAt) / doneThisRun;
    const left = Math.max(0, state.total - state.counts.conversations) * perItem;
    $('eta').textContent = humanize(left);
  }
}

function humanize(ms) {
  const mins = Math.round(ms / 60000);
  if (mins < 1) return '<1 min';
  if (mins < 60) return mins + ' min';
  return Math.floor(mins / 60) + 'h ' + (mins % 60) + 'm';
}

function renderErrors() {
  $('errBox').hidden = state.errors.length === 0;
  $('errCount').textContent = String(state.errors.length);
  $('errList').textContent = '';
  for (const e of state.errors.slice(-25)) {
    const li = document.createElement('li');
    li.textContent = (e.name || e.id) + ' — ' + e.error;
    $('errList').append(li);
  }
}

$('grant').addEventListener('click', grant);
$('pick').addEventListener('click', pickFolder);
$('start').addEventListener('click', start);
$('pause').addEventListener('click', () => {
  state.paused = !state.paused;
  $('pause').textContent = state.paused ? 'Continue' : 'Pause';
  say($('runState'), state.paused ? 'Paused. The folder is consistent; you can close this tab.' : '');
});
$('stop').addEventListener('click', () => { state.running = false; });
window.addEventListener('beforeunload', (e) => {
  if (state.running) { e.preventDefault(); e.returnValue = ''; }
});

init();
