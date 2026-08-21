# GHL Workflow Exporter

A Chrome extension that exports every workflow in the HighLevel sub-account you
are currently viewing as re-importable JSON, packaged as a ZIP you can unzip
straight into a git repo.

Built for white-labelled HighLevel instances as well as `app.gohighlevel.com` —
it works on whatever domain the tab is already on, because it never hardcodes a
host.

## Install

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. **Load unpacked** → select this folder.

## Use

1. Open a HighLevel sub-account tab and sign in as normal.
2. Click the extension icon. It shows the sub-account it detected.
3. **Export workflows** → choose where to save the ZIP.

## What comes out

```
legendary-academy-<locationId>/
├── index.json         # one entry per workflow: name, status, version, counts
├── snapshot.json      # everything in one file, for diffing a release as a unit
├── README.md          # provenance note, written into every export
└── workflows/
    ├── grant-free-community-access-6c749f21.json
    └── …
```

Each workflow file is `{ workflowData, triggers, dependentAssets }` — the same
shape the workflow builder's JSON import accepts, so the backup doubles as a
restore path.

## How it works

Two authenticated calls, both ones the app itself makes:

| Purpose | Request |
|---|---|
| List workflows and folders | `GET backend.leadconnectorhq.com/workflow/{locationId}/list` |
| Full definition, one workflow | `GET backend.leadconnectorhq.com/workflow/{locationId}/{workflowId}?includeTriggers=true` |

`includeTriggers=true` is the whole trick. Without it the endpoint returns bare
metadata; with it you get the action graph and the trigger definitions together.

## Design notes

**No credential handling.** The extension injects a function into the page's
MAIN world and borrows `window.SHELL_STORE.$http` — the app's own axios
instance, whose interceptor attaches the session token. The token is never read,
copied, stored, or sent anywhere. If that client is ever unavailable the code
falls back to locating the session JWT in the Vuex auth state, and still keeps
it inside the page.

**Minimal permissions.** `activeTab`, `scripting`, `downloads`. No
`host_permissions`, no background service worker, no remote code. The API calls
originate from the page, so they are the page's own same-session requests.

**Deterministic output.** Object keys are sorted recursively, files are written
with a fixed archive timestamp, and two fields are stripped before serialization:

- `workflowData.fileUrl` — a *signed* Firebase Storage URL. It carries an access
  token and must not land in a repo. `filePath`, the stable path it points at,
  is kept.
- `permissionMeta` — the exporting user's access rights, not workflow content.

The result: re-exporting an unchanged workflow produces a byte-identical file,
so `git status` stays quiet and a real diff means a real change.

**Read-only.** Every request is a GET. Nothing in the sub-account is modified.

## Limits

- One sub-account per run — whichever the tab is on.
- Deleted workflows and folders are listed in `index.json` but not exported.
- Restore is manual. Verify in a test sub-account before importing anywhere real.
- These are undocumented internal endpoints. They can change without notice;
  if an export starts failing, that is the first place to look.
