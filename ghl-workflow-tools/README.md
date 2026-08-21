# GHL Workflow Backup

A Chrome extension that exports every workflow in the HighLevel sub-account you
are viewing as re-importable JSON, and restores them from a backup file.

Built for white-labelled HighLevel instances as well as `app.gohighlevel.com` —
it works on whatever domain the tab is already on, because it never hardcodes a
host.

## Install

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. **Load unpacked** → select this folder.

## Export

1. Open a HighLevel sub-account tab and sign in as normal.
2. Click the extension icon → **Export** → **Export workflows**.
3. Choose where to save the ZIP.

```
legendary-academy-<locationId>/
├── index.json         # one entry per workflow: name, status, version, counts
├── snapshot.json      # everything in one file, for diffing a release as a unit
├── README.md          # provenance note, written into every export
└── workflows/
    ├── grant-free-community-access-6c749f21.json
    └── …
```

Each workflow file is `{ workflowData, triggers, dependentAssets }`.

## Import

**Import** tab → choose a `.zip` export or individual `workflows/*.json` files.
Every workflow found is listed with its action and trigger counts, and a mode:

- **Create new copy (draft)** — the default, and always safe. Makes a fresh
  workflow, never touches an existing one.
- **Overwrite "…"** — offered only when a workflow in this sub-account matches
  by id, or failing that by name. Replaces that workflow's actions and triggers
  in place.

Overwriting a **published** workflow requires ticking an extra acknowledgement,
because the workflow keeps its published status and will carry on running with
the imported content the moment the write lands. New copies are always drafts,
and nothing is ever published for you.

Importing into a different sub-account is allowed. The create call returns the
server's own `assetWarnings`, which are surfaced per row: those flag references
to custom fields, tags, calendars or pipelines that do not exist in the target.

## How it works

Read and write both go through calls the app itself makes:

| Purpose | Request |
|---|---|
| List workflows and folders | `GET backend.leadconnectorhq.com/workflow/{locationId}/list` |
| Full definition | `GET .../workflow/{locationId}/{workflowId}?includeTriggers=true` |
| Create | `POST .../workflow/{locationId}` → `{ id, assetWarnings }` |
| Restore contents | `PUT .../workflow/{locationId}/{workflowId}` |
| Triggers | `GET`/`POST`/`DELETE .../workflow/{locationId}/trigger` |

`includeTriggers=true` is what makes the export complete. Without it the
endpoint returns bare metadata plus a `fileUrl` pointing at Firebase Storage;
with it the server inlines the action graph and the trigger definitions.

Import mirrors the app's own restore-from-nodes flow, in this order:

1. Create the workflow (or take the existing one, when overwriting).
2. Delete whatever triggers are attached to it.
3. Create the incoming triggers, with `id` / `_id` / `predeterminedId` stripped
   and `workflowId` plus every `actions[].workflow_id` rewired to the target.
4. Read the created triggers back.
5. `PUT` the action graph with **`isRestoreRequest: true`** — a first-class
   restore flag in their API — and `newTriggers` set to what step 4 returned.

Two details that are easy to get wrong and fail loudly:

- The `PUT` carries the **target's current `version`**, not the version recorded
  in the backup. It is an optimistic-concurrency check; a stale number is
  rejected with *"Your version is outdated"*.
- `timezone` is an enum. Exported workflows carry values like `"account"`;
  inventing an IANA name such as `America/New_York` fails validation.

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

Re-exporting an unchanged workflow produces a byte-identical file, so
`git status` stays quiet and a real diff means a real change.

**No third-party code.** The ZIP writer and reader are in `zip.js` and
`unzip.js`; decompression uses the browser's own `DecompressionStream`.

## Limits

- One sub-account per run — whichever the tab is on.
- Deleted workflows and folders are listed in `index.json` but not exported, and
  folder placement is recorded but not recreated on import.
- Import replaces a workflow's triggers wholesale rather than diffing them.
- These are undocumented internal endpoints. They can change without notice; if
  an export or import starts failing, that is the first place to look.

## Changelog

### 1.1.0
- Import: restore workflows from a backup, create-new or overwrite.
- Reads `.zip` exports directly, or loose `.json` files from a repo.
- **Fixed a paging bug in export.** The list endpoint takes `limit`/`offset`,
  not `limit`/`skip`. `skip` is silently ignored, so a sub-account with more
  than 200 workflows would have re-fetched page one and produced a duplicated,
  truncated export. Paging now also guards against repeated ids.

### 1.0.0
- Export every workflow in the current sub-account as a ZIP.

---

By [Legion Code Inc.](https://github.com/legioncodeinc) · part of the [GHL Toolset](https://github.com/legioncodeinc/ghl-toolset) · AGPL-3.0
