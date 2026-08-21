import { buildZip, stableJson } from './zip.js';
import { probePage, fetchWorkflowList, fetchWorkflowDetail } from './agent.js';

const els = {
  target: document.getElementById('target'),
  run: document.getElementById('run'),
  progress: document.getElementById('progress'),
  fill: document.getElementById('fill'),
  step: document.getElementById('step'),
  status: document.getElementById('status')
};

let context = null;

function say(message, kind) {
  els.status.textContent = message;
  els.status.className = kind || '';
}

function slug(name, fallback) {
  const base = String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return base || fallback;
}

async function inMainWorld(tabId, func, args) {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func,
    args: args || []
  });
  return result ? result.result : undefined;
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

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
    els.target.textContent = probe.locationName
      ? probe.locationName
      : 'Sub-account ' + probe.locationId;
    els.run.disabled = false;
  } catch (err) {
    els.target.textContent = 'Cannot read this tab.';
    say(String(err.message || err), 'err');
  }
}

async function run() {
  els.run.disabled = true;
  els.progress.hidden = false;
  say('');

  try {
    els.step.textContent = 'Listing workflows…';
    const list = await inMainWorld(context.tabId, fetchWorkflowList, [context.locationId]);
    const rows = (list.rows || []).filter((row) => row.type !== 'folder' && !row.deleted);
    const folders = (list.rows || []).filter((row) => row.type === 'folder');

    if (!rows.length) {
      throw new Error('This sub-account has no workflows to export.');
    }

    const folderNames = new Map(folders.map((f) => [f.id || f._id, f.name]));
    const entries = [];
    const failures = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const id = row.id || row._id;
      els.step.textContent = 'Exporting ' + (i + 1) + ' of ' + rows.length + ': ' + row.name;
      els.fill.style.width = Math.round((i / rows.length) * 100) + '%';

      const detail = await fetchWithRetry(context.tabId, context.locationId, id);
      if (!detail.ok) {
        failures.push({ id, name: row.name, error: detail.error });
        continue;
      }

      const payload = sanitize(detail.data);
      entries.push({
        id,
        name: row.name,
        status: row.status,
        parentId: row.parentId || null,
        folder: row.parentId ? folderNames.get(row.parentId) || null : null,
        version: payload.workflowData && payload.workflowData.version,
        dataVersion: row.dataVersion,
        updatedAt: row.updatedAt,
        updatedBy: row.updatedBy,
        actionCount: countActions(payload),
        triggerCount: Array.isArray(payload.triggers) ? payload.triggers.length : 0,
        file: 'workflows/' + slug(row.name, 'workflow') + '-' + String(id).slice(0, 8) + '.json',
        payload
      });

      // A courteous pause: HighLevel rate-limits bursts per location.
      await new Promise((resolve) => setTimeout(resolve, 120));
    }

    els.fill.style.width = '100%';
    els.step.textContent = 'Packaging…';

    const root = slug(context.locationName, 'sub-account') + '-' + context.locationId;
    const files = buildFiles(root, entries, failures);
    const blob = buildZip(files);
    await download(blob, root);

    const note = failures.length ? ' (' + failures.length + ' failed, see index.json)' : '';
    say('Exported ' + entries.length + ' workflow' + (entries.length === 1 ? '' : 's') + note + '.', 'ok');
    els.step.textContent = '';
  } catch (err) {
    say(String(err.message || err), 'err');
    els.step.textContent = '';
  } finally {
    els.run.disabled = false;
  }
}

async function fetchWithRetry(tabId, locationId, workflowId) {
  let last = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    last = await inMainWorld(tabId, fetchWorkflowDetail, [locationId, workflowId]);
    if (last && last.ok) return last;
    await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
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
    { name: root + '/README.md', text: readme(root, index) }
  ];

  for (const entry of sorted) {
    files.push({ name: root + '/' + entry.file, text: stableJson(entry.payload) });
  }
  return files;
}

function readme(root, index) {
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
    'The `{ workflowData, triggers }` shape matches what the workflow builder’s JSON import',
    'accepts. Treat restore as manual and verify in a test sub-account first — this is a backup,',
    'not an automated round trip.',
    ''
  ].join('\n');
}

async function download(blob, root) {
  const url = URL.createObjectURL(blob);
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
  try {
    await chrome.downloads.download({
      url,
      filename: root + '-' + stamp + '.zip',
      saveAs: true
    });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
}

els.run.addEventListener('click', run);
init();
