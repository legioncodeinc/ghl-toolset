import { probePage } from './agent.js';
import { fetchConversationsPage } from './conv-agent.js';

const $ = (id) => document.getElementById(id);
let context = null;

const REASONS = {
  'not-highlevel': 'Open a HighLevel sub-account tab, then reopen this popup.',
  'no-location': 'No sub-account detected. Navigate into a location first.',
  'no-auth': 'Could not reach the app session. Reload the page and try again.'
};

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function inMainWorld(tabId, func, args) {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId }, world: 'MAIN', func, args: args || []
  });
  return result ? result.result : undefined;
}

async function init() {
  try {
    const tab = await activeTab();
    const probe = await inMainWorld(tab.id, probePage);
    if (!probe || !probe.ok) {
      $('target').textContent = REASONS[probe && probe.reason] || 'This tab is not a HighLevel app page.';
      return;
    }
    context = { tabId: tab.id, origin: new URL(tab.url).origin, ...probe };
    $('target').textContent = probe.locationName || ('Sub-account ' + probe.locationId);
    $('open').disabled = false;

    // One cheap call, purely so the size is not a surprise mid-run.
    const page = await inMainWorld(tab.id, fetchConversationsPage, [probe.locationId, null, 1]);
    $('scale').textContent = page && page.ok && typeof page.total === 'number'
      ? page.total.toLocaleString() + ' conversations to archive.'
      : '';
  } catch (err) {
    $('target').textContent = 'Cannot read this tab.';
    $('status').textContent = String(err.message || err);
    $('status').className = 'err';
  }
}

$('open').addEventListener('click', async () => {
  const url = chrome.runtime.getURL('archive.html') +
    '?tabId=' + encodeURIComponent(context.tabId) +
    '&origin=' + encodeURIComponent(context.origin);
  await chrome.tabs.create({ url });
  window.close();
});

init();
