import { buildZip, stableJson } from './zip.js';
import { readZip } from './unzip.js';
import { probePage, fetchWorkflowList, fetchWorkflowDetail, importWorkflow } from './agent.js';

const $ = (id) => document.getElementById(id);
const els = {
  target: $('target'),
  tabExport: $('tab-export'), tabImport: $('tab-import'),
  panelExport: $('panel-export'), panelImport: $('panel-import'),
  run: $('run'), progress: $('progress'), fill: $('fill'), step: $('step'), status: $('status'),
  files: $('files'), picked: $('picked'), list: $('list'), all: $('all'), count: $('count'),
  liveWarn: $('livewarn'), ack: $('ack'), liveCount: $('livecount'),
  importBtn: $('import'), iProgress: $('iprogress'), iFill: $('ifill'), iStep: $('istep'), iStatus: $('istatus')
};

let context = null;
let candidates = [];
let targets = [];

function say(node, message, kind) {
  node.textContent = message;
  node.className = kind || '';
}

function slug(name, fallback) {
  const base = String(name || '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  return base || fallback;
}

async function inMainWorld(tabId, func, args) {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId }, world: 'MAIN', func, args: args || []
  });
  return result ? result.result : undefined;
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

/* ---------------------------------------------------------------- setup --- */

const REASONS = {
  'not-highlevel': 'Open a HighLevel sub-account tab, then reopen this popup.',
  'no-location': 'No sub-account detected. Navigate into a location first.',
  'no-auth': 'Could not reach the app session. Reload the page and try again.'
};

async function init() {
  try {
    const tab = await activeTab();
    const probe = await inMainWorld(tab.id, probePage);
    if (!probe || !probe.ok) {
      els.target.textContent = REASONS[probe && probe.reason] || 'This tab is not a HighLevel app page.';
      return;
    }
    context = { tabId: tab.id, ...probe };
    els.target.textContent = probe.locationName || ('Sub-account ' + probe.locationId);
    els.run.disabled = false;
  } catch (err) {
    els.target.textContent = 'Cannot read this tab.';
    say(els.status, String(err.message || err), 'err');
  }
}

function showTab(which) {
  const exporting = which === 'export';
  els.tabExport.classList.toggle('is-active', exporting);
  els.tabImport.classList.toggle('is-active', !exporting);
  els.tabExport.setAttribute('aria-selected', String(exporting));
  els.tabImport.setAttribute('aria-selected', String(!exporting));
  els.panelExport.hidden = !exporting;
  els.panelImport.hidden = exporting;
}

/* --------------------------------------------------------------- export --- */

async function runExport() {
  els.run.disabled = true;
  els.progress.hidden = false;
  say(els.status, '');

  try {
    els.step.textContent = 'Listing workflows…';
    const list = await inMainWorld(context.tabId, fetchWorkflowList, [context.locationId]);
    const rows = (list.rows || []).filter((row) => row.type !== 'folder' && !row.deleted);
    const folders = (list.rows || []).filter((row) => row.type === 'folder');
    if (!rows.length) throw new Error('This sub-account has no workflows to export.');

    const folderNames = new Map(folders.map((f) => [f.id || f._id, f.name]));
    const entries = [];
    const failures = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const id = row.id || row._id;
      els.step.textContent = 'Exporting ' + (i + 1) + ' of ' + rows.length + ': ' + row.name;
      els.fill.style.width = Math.round((i / rows.length) * 100) + '%';

      const detail = await retry(() => inMainWorld(context.tabId, fetchWorkflowDetail, [context.locationId, id]));
      if (!detail.ok) {
        failures.push({ id, name: row.name, error: detail.error });
        continue;
      }
      const payload = sanitize(detail.data);
      entries.push({
        id, name: row.name, status: row.status,
        parentId: row.parentId || null,
        folder: row.parentId ? folderNames.get(row.parentId) || null : null,
        version: payload.workflowData && payload.workflowData.version,
        dataVersion: row.dataVersion,
        updatedAt: row.updatedAt, updatedBy: row.updatedBy,
        actionCount: countActions(payload),
        triggerCount: Array.isArray(payload.triggers) ? payload.triggers.length : 0,
        file: 'workflows/' + slug(row.name, 'workflow') + '-' + String(id).slice(0, 8) + '.json',
        payload
      });
      await pause(120); // HighLevel rate-limits bursts per location
    }

    els.fill.style.width = '100%';
    els.step.textContent = 'Packaging…';
    const root = slug(context.locationName, 'sub-account') + '-' + context.locationId;
    const blob = buildZip(buildFiles(root, entries, failures));
    await download(blob, root);

    const note = failures.length ? ' (' + failures.length + ' failed, see index.json)' : '';
    say(els.status, 'Exported ' + entries.length + ' workflow' + (entries.length === 1 ? '' : 's') + note + '.', 'ok');
    els.step.textContent = '';
  } catch (err) {
    say(els.status, String(err.message || err), 'err');
    els.step.textContent = '';
  } finally {
    els.run.disabled = false;
  }
}

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function retry(fn, attempts = 3) {
  let last = null;
  for (let i = 0; i < attempts; i++) {
    last = await fn();
    if (last && last.ok) return last;
    await pause(400 * (i + 1));
  }
  return last || { ok: false, error: 'unknown error' };
}

/**
 * Strips two fields that would poison a git history:
 *  - workflowData.fileUrl is a *signed* Firebase URL. It carries an access
 *    token, changes on every fetch, and has no business in a repo.
 *  - permissionMeta describes the exporting user's access rights, not the
 *    workflow, so it churns per operator without adding backup value.
 * filePath is kept: it is the stable storage path the signed URL points at.
 */
function sanitize(payload) {
  const clone = JSON.parse(JSON.stringify(payload || {}));
  delete clone.permissionMeta;
  if (clone.workflowData) delete clone.workflowData.fileUrl;
  return clone;
}

function countActions(payload) {
  const inner = payload && payload.workflowData && payload.workflowData.workflowData;
  return inner && Array.isArray(inner.templates) ? inner.templates.length : 0;
}

function buildFiles(root, entries, failures) {
  const sorted = [...entries].sort((a, b) => a.name.localeCompare(b.name));
  const index = {
    locationId: context.locationId,
    locationName: context.locationName || null,
    workflowCount: sorted.length,
    workflows: sorted.map(({ payload, ...meta }) => meta),
    failures
  };
  const snapshot = {
    locationId: context.locationId,
    locationName: context.locationName || null,
    workflows: [...entries]
      .sort((a, b) => String(a.id).localeCompare(String(b.id)))
      .map((entry) => ({ id: entry.id, name: entry.name, ...entry.payload }))
  };
  const files = [
    { name: root + '/index.json', text: stableJson(index) },
    { name: root + '/snapshot.json', text: stableJson(snapshot) },
    { name: root + '/README.md', text: readme(index) }
  ];
  for (const entry of sorted) files.push({ name: root + '/' + entry.file, text: stableJson(entry.payload) });
  return files;
}

function readme(index) {
  return [
    '# Workflow backup — ' + (index.locationName || index.locationId),
    '',
    'Sub-account: `' + index.locationId + '`  ',
    'Workflows: ' + index.workflowCount,
    '',
    '## Layout',
    '',
    '- `index.json` — one line per workflow: name, status, version, action and trigger counts.',
    '- `workflows/*.json` — one file per workflow, each `{ workflowData, triggers, dependentAssets }`.',
    '- `snapshot.json` — every workflow in a single file, for diffing a release as one unit.',
    '',
    '## Provenance',
    '',
    'Each workflow file is the response of',
    '`GET backend.leadconnectorhq.com/workflow/{locationId}/{workflowId}?includeTriggers=true`,',
    'taken through the signed-in session in the browser. Keys are sorted and files are',
    'written with a fixed archive timestamp, so an unchanged workflow re-exports byte for byte',
    'and git shows no diff.',
    '',
    '## Restoring',
    '',
    'Load any of these files back through the extension\'s Import tab. It recreates the',
    'action graph and the triggers, using the same restore call the workflow builder uses.',
    'Imports arrive as drafts. Check one in the builder before you publish it.',
    ''
  ].join('\n');
}

async function download(blob, root) {
  const url = URL.createObjectURL(blob);
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
  try {
    await chrome.downloads.download({ url, filename: root + '-' + stamp + '.zip', saveAs: true });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
}

/* --------------------------------------------------------------- import --- */

/** Pulls workflow payloads out of whatever the user picked. */
async function parseFiles(fileList) {
  const docs = [];
  for (const file of fileList) {
    if (/\.zip$/i.test(file.name)) {
      const entries = await readZip(await file.arrayBuffer());
      for (const entry of entries) {
        if (!/\.json$/i.test(entry.name)) continue;
        if (/\/index\.json$/i.test(entry.name)) continue; // manifest, not content
        docs.push({ source: entry.name, text: entry.text });
      }
    } else {
      docs.push({ source: file.name, text: await file.text() });
    }
  }

  const found = [];
  for (const doc of docs) {
    let parsed;
    try { parsed = JSON.parse(doc.text); } catch (e) { continue; }
    // snapshot.json holds many; a per-workflow file holds one.
    const many = Array.isArray(parsed.workflows) ? parsed.workflows : [parsed];
    for (const item of many) {
      if (!item || !item.workflowData) continue;
      const record = item.workflowData;
      const templates = (record.workflowData && record.workflowData.templates) || [];
      found.push({
        source: doc.source,
        sourceId: item.id || record.id || record._id || null,
        sourceLocationId: record.locationId || null,
        name: item.name || record.name || 'Untitled workflow',
        actions: templates.length,
        triggers: Array.isArray(item.triggers) ? item.triggers.length : 0,
        payload: { workflowData: record, triggers: item.triggers || [] }
      });
    }
  }

  // Picking both snapshot.json and the per-workflow files is an easy mistake;
  // collapse to one entry per source workflow rather than importing twice.
  const seen = new Set();
  const unique = [];
  for (const entry of found) {
    const key = entry.sourceId || (entry.name + '|' + entry.actions);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(entry);
  }
  return unique;
}

async function onFiles(event) {
  const files = [...(event.target.files || [])];
  if (!files.length) return;
  say(els.iStatus, '');
  els.picked.hidden = true;

  try {
    candidates = await parseFiles(files);
    if (!candidates.length) throw new Error('No workflow definitions found in those files.');

    const list = await inMainWorld(context.tabId, fetchWorkflowList, [context.locationId]);
    targets = (list.rows || []).filter((row) => row.type !== 'folder' && !row.deleted);

    renderCandidates();
    els.picked.hidden = false;
  } catch (err) {
    say(els.iStatus, String(err.message || err), 'err');
  }
}

function matchTarget(entry) {
  const byId = targets.find((row) => (row.id || row._id) === entry.sourceId);
  if (byId) return byId;
  return targets.find((row) => row.name === entry.name) || null;
}

function renderCandidates() {
  els.list.textContent = '';
  candidates.forEach((entry, index) => {
    const match = matchTarget(entry);
    entry.match = match;

    const item = document.createElement('div');
    item.className = 'item';

    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = true;
    box.dataset.index = String(index);
    box.addEventListener('change', refreshSelection);

    const body = document.createElement('div');
    body.className = 'body';

    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = entry.name;

    const meta = document.createElement('div');
    meta.className = 'muted';
    const foreign = entry.sourceLocationId && entry.sourceLocationId !== context.locationId;
    meta.textContent = entry.actions + ' action' + (entry.actions === 1 ? '' : 's') +
      ', ' + entry.triggers + ' trigger' + (entry.triggers === 1 ? '' : 's') +
      (foreign ? ' · from another sub-account' : '');

    const mode = document.createElement('select');
    mode.dataset.index = String(index);
    const createOpt = new Option('Create new copy (draft)', 'create');
    mode.add(createOpt);
    if (match) {
      const label = 'Overwrite “' + match.name + '”' + (match.status === 'published' ? ' — LIVE' : '');
      mode.add(new Option(label, 'overwrite'));
    }
    mode.addEventListener('change', refreshSelection);

    const result = document.createElement('div');
    result.className = 'result';
    result.dataset.index = String(index);

    body.append(name, meta, mode, result);
    item.append(box, body);
    els.list.append(item);
  });
  refreshSelection();
}

function selection() {
  const boxes = [...els.list.querySelectorAll('input[type=checkbox]')];
  const modes = [...els.list.querySelectorAll('select')];
  return candidates
    .map((entry, index) => ({ entry, index, on: boxes[index].checked, mode: modes[index].value }))
    .filter((row) => row.on);
}

function refreshSelection() {
  const chosen = selection();
  els.count.textContent = chosen.length + ' of ' + candidates.length + ' selected';

  const live = chosen.filter((row) => row.mode === 'overwrite' && row.entry.match && row.entry.match.status === 'published');
  els.liveWarn.hidden = live.length === 0;
  els.liveCount.textContent = String(live.length);
  if (!live.length) els.ack.checked = false;

  els.importBtn.disabled = !chosen.length || (live.length > 0 && !els.ack.checked);
  els.importBtn.textContent = chosen.length
    ? 'Import ' + chosen.length + ' workflow' + (chosen.length === 1 ? '' : 's')
    : 'Import';
}

async function runImport() {
  const chosen = selection();
  if (!chosen.length) return;

  els.importBtn.disabled = true;
  els.files.disabled = true;
  els.iProgress.hidden = false;
  say(els.iStatus, '');

  let done = 0;
  let failed = 0;

  for (let i = 0; i < chosen.length; i++) {
    const { entry, index, mode } = chosen[i];
    els.iStep.textContent = (mode === 'overwrite' ? 'Overwriting ' : 'Creating ') + (i + 1) + ' of ' + chosen.length + ': ' + entry.name;
    els.iFill.style.width = Math.round((i / chosen.length) * 100) + '%';

    const spec = {
      mode,
      targetId: mode === 'overwrite' && entry.match ? (entry.match.id || entry.match._id) : undefined,
      name: entry.name,
      // Overwriting keeps the target's current status, so replacing a live
      // workflow does not silently switch it off. New copies are always drafts.
      status: mode === 'overwrite' && entry.match ? entry.match.status : 'draft',
      payload: entry.payload
    };

    const result = await inMainWorld(context.tabId, importWorkflow, [context.locationId, spec]);
    const node = els.list.querySelector('.result[data-index="' + index + '"]');

    if (result && result.ok) {
      done++;
      const warn = (result.assetWarnings || []).length;
      node.className = 'result ok';
      node.textContent = (mode === 'overwrite' ? 'Replaced' : 'Created') +
        ' · ' + result.actions + ' actions, ' + result.triggersAdded + ' triggers' +
        (warn ? ' · ' + warn + ' asset warning' + (warn === 1 ? '' : 's') : '');
    } else {
      failed++;
      node.className = 'result err';
      node.textContent = 'Failed: ' + ((result && result.error) || 'unknown error');
    }
    await pause(200);
  }

  els.iFill.style.width = '100%';
  els.iStep.textContent = '';
  els.files.disabled = false;
  els.importBtn.disabled = false;

  if (failed) say(els.iStatus, done + ' imported, ' + failed + ' failed.', 'err');
  else say(els.iStatus, 'Imported ' + done + ' workflow' + (done === 1 ? '' : 's') + '. Open the builder to check before publishing.', 'ok');
}

/* --------------------------------------------------------------- wiring --- */

els.tabExport.addEventListener('click', () => showTab('export'));
els.tabImport.addEventListener('click', () => showTab('import'));
els.run.addEventListener('click', runExport);
els.files.addEventListener('change', onFiles);
els.ack.addEventListener('change', refreshSelection);
els.all.addEventListener('change', () => {
  els.list.querySelectorAll('input[type=checkbox]').forEach((box) => { box.checked = els.all.checked; });
  refreshSelection();
});
els.importBtn.addEventListener('click', runImport);
init();
