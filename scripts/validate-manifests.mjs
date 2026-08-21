#!/usr/bin/env node
// Validates every Chrome extension manifest in this repo. Zero dependencies:
// runs on plain Node so CI needs no install step. Exits non-zero if any
// tool's manifest is invalid or references a file that does not exist.

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';

const SKIP = new Set(['.git', 'node_modules', '.mimosa', 'library', '.github']);
let failed = false;

function findManifests(dir, found = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) findManifests(full, found);
    else if (entry.isFile() && entry.name === 'manifest.json') found.push(full);
  }
  return found;
}

function fail(path, message) {
  console.error('FAIL ' + path + ': ' + message);
  failed = true;
}

const manifests = findManifests(process.cwd());

if (!manifests.length) {
  console.error('FAIL no manifest.json found: every tool in this set must be a loadable Chrome extension');
  process.exit(1);
}

for (const path of manifests) {
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    fail(path, 'not valid JSON (' + err.message + ')');
    continue;
  }

  if (manifest.manifest_version !== 3) {
    fail(path, 'manifest_version must be 3, got ' + manifest.manifest_version);
  }
  if (!manifest.name || typeof manifest.name !== 'string') {
    fail(path, 'name is required');
  }
  if (!/^\d+\.\d+\.\d+/.test(String(manifest.version || ''))) {
    fail(path, 'version must look like x.y.z, got ' + manifest.version);
  }

  const popup = manifest.action && manifest.action.default_popup;
  if (popup && !existsSync(join(dirname(path), popup))) {
    fail(path, 'action.default_popup "' + popup + '" not found');
  }

  for (const icon of Object.values(manifest.icons || {})) {
    if (!existsSync(join(dirname(path), icon))) {
      fail(path, 'icon "' + icon + '" not found');
    }
  }

  if (!failed) console.log('ok   ' + path + ' (' + manifest.name + ' ' + manifest.version + ')');
}

process.exit(failed ? 1 : 0);
