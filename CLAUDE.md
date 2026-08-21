# CLAUDE.md

Guidance for AI coding agents working in this repository. Read this before touching code.

## What this repo is

A **multi-tool set of Chrome extensions for GoHighLevel (HighLevel) sub-accounts** — one focused, standalone extension per facet of an account (workflows today; pipelines, calendars, custom values, etc. as the set grows). It is deliberately **not** a single bulk tool that migrates or dumps everything from a sub-account. Never propose merging tools or adding "modes" to an existing tool; a new facet means a new tool folder.

The first tool is [`ghl-workflow-exporter/`](ghl-workflow-exporter/). The direction: a tool for every facet of the account that can be read through the app's own session.

**Positioning:** the project is published for **R&D purposes only** — it rides on undocumented, internal HighLevel endpoints and is not affiliated with HighLevel. Keep that framing in user-facing docs; never imply production support or endorsement.

## Commands

```bash
node scripts/validate-manifests.mjs   # the entire local gate + CI check
```

That is the only command. There is **no package.json, no dependency install, no build step, no lockfile** — every tool is plain ES modules loaded directly by Chrome from its folder. Do not introduce npm dependencies or a bundler without an explicit decision; the whole extension set is meant to stay auditable in one sitting.

Manual verification loop: `chrome://extensions` → Developer mode → Load unpacked → the tool's folder → run it against a real (test) sub-account. Reload the tool's card after every edit.

## Tool anatomy

Every tool follows the same shape (the contract is also documented in the root README, which is the source of truth for the shared rules):

```
ghl-<facet>-<verb>/
  manifest.json   # MV3; permissions: activeTab, scripting, downloads — nothing else
  popup.html/.css # UI shell
  popup.js        # orchestration: probes tab, drives export loop, builds files, downloads
  agent.js        # functions injected into the page's MAIN world
  zip.js          # dependency-free ZIP writer (STORE method, fixed 1980-01-01 timestamp)
  icons/
  README.md       # the tool's own docs
```

## Hard rules (violations are release blockers)

1. **Injected functions must be entirely self-contained.** `agent.js` exports are passed to `chrome.scripting.executeScript({ world: 'MAIN', func })`, which serializes and re-parses them in the page. No imports, no closure variables, no references to module scope. Duplicating a helper (e.g. `findJwt`) inside an injected function is correct here; "DRYing it up" breaks the tool at runtime.

2. **Never read, store, or transmit credentials.** Authentication is borrowed: prefer `window.SHELL_STORE.$http` (the app's axios instance whose interceptor attaches the session token). Fallback: locate the session JWT inside the page's Vuex auth state and use it *only within the page*, never exfiltrate it. This is the design promise of the whole toolset.

3. **Read-only.** Every request a tool makes is a GET. Never add POST/PUT/DELETE calls to a sub-account.

4. **Minimal permissions.** `activeTab`, `scripting`, `downloads` only. No `host_permissions`, no background service worker, no remote code.

5. **Never hardcode a GHL host.** Tools run on white-labelled domains; the app origin is whatever tab is active. API endpoints point at `backend.leadconnectorhq.com`, which is host-agnostic.

6. **Deterministic output.** Serialize with `stableJson` (recursively sorted keys) from `zip.js`, write ZIPs with the fixed DOS timestamp, and strip volatile fields before serialization. Known examples in workflow exports: `workflowData.fileUrl` (a *signed* Firebase URL carrying an access token — must never land in a repo; keep `filePath`), and `permissionMeta` (per-user access rights, not content). When exporting a new facet, identify its equivalent volatile/secret fields and strip them.

7. **No secrets in any diff.** No tokens, session JWTs, signed URLs, or `.env` values ever get committed. `.gitignore` excludes `*.pem` (that would be a Web Store upload key) and `*.zip`.

## GHL API facts (learned, currently load-bearing)

- List workflows: `GET backend.leadconnectorhq.com/workflow/{locationId}/list` with `limit`/`skip` pagination (`limit: 200` per page; stop when `rows.length >= count`).
- Full workflow definition: `GET backend.leadconnectorhq.com/workflow/{locationId}/{workflowId}?includeTriggers=true` — `includeTriggers=true` is what swaps bare metadata for the `{ workflowData, triggers, dependentAssets }` shape the workflow builder's JSON import accepts.
- Raw-fetch fallback headers (when not using `$http`): `Authorization: Bearer <token>`, `channel: APP`, `source: WEB_USER`, `Version: 2021-07-28`.
- Detecting the sub-account: `window.SHELL_STORE.state.locations.currentLocation` (`.id`/`._id`, `.name`), with the URL path `/location/<id>` as a secondary source.
- HighLevel rate-limits bursts per location. Keep the courtesy pause between per-item requests (~120ms) and the retry-with-backoff pattern (3 attempts, 400ms·n) when adding new export loops.
- These are undocumented internal endpoints; they can change without notice. If an export starts failing, suspect the endpoint shape first.

## Adding a new tool

1. Create `ghl-<facet>-<verb>/` at the repo root with the anatomy above (copy `ghl-workflow-exporter` as the starting skeleton).
2. Give it its own `manifest.json`, icons, and README following the existing tool's README structure (Install / Use / What comes out / How it works / Design notes / Limits).
3. Add a row to the tool table in the root `README.md` (move the facet out of the roadmap list).
4. `scripts/validate-manifests.mjs` picks up any `*/manifest.json` automatically — no registration needed.
5. Follow every hard rule above; new endpoints discovered go into the GHL API facts section here.

## Documentation system

`library/` is the structured docs tree (Library Schema v2 — see `library/README.md` and `library/knowledge/private/standards/documentation-framework.md`). Plans for new tools go in `library/requirements/` as PRDs; ADRs go in `library/knowledge/private/architecture/`. `library/notes/` is human-only — never read or write it.

## Git conventions

- Conventional Commits (`feat:`, `fix:`, `docs:`, …), enforced socially not by tooling.
- Branches off `main`, named `feat/<short-description>` / `fix/<short-description>`.
- Releases: bump the tool's `manifest.json` version, update `CHANGELOG.md` (Keep a Changelog format), tag `v<x.y.z>`.

## License

AGPL-3.0 (see `LICENSE`). Keep tool READMEs and the repo consistent with it.
