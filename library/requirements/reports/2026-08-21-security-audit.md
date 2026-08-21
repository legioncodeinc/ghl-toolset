# Security audit - 2026-08-21 - repo-init baseline (pre-first-PR)

## Executive summary

- Scope: full working tree at commit `ae90a0e` + uncommitted init files — `ghl-workflow-exporter/` (all JS/HTML/JSON), `scripts/validate-manifests.mjs`, `.github/` (both workflows, dependabot, CODEOWNERS, templates), all root docs, and full git history secret scan.
- Coverage: **reduced** — this skill's researched stack (SvelteKit/Neon/Drizzle/WorkOS/Stripe/Vercel/Doppler/GHL-webhook surfaces) is absent from this repo. The audited surface is a Chrome MV3 extension toolset. Secrets, HTML-sink, eval, storage, supply-chain, git-history, and GitHub-workflow checks were run per the skill's sweeps and are grounded; **Chrome-extension platform rules** (MV3 remote-code prohibitions, permission scoping) were checked from first principles, not from this skill's research archive.
- Findings: 0 Critical, 0 High, 0 Medium, 1 Low
- Ship Gate status: **cleared to proceed to quality-stinger**

## Surface coverage checklist

### Chrome extension attack surface (maps to skill's "SvelteKit attack surface")
None detected. `manifest.json` requests exactly `activeTab, scripting, downloads` — no `host_permissions`, `externally_connectable`, `web_accessible_resources`, or CSP overrides. All `chrome.scripting.executeScript` calls inject locally defined functions (`agent.js` exports), never remote strings. No `eval`/`new Function`, no `innerHTML`/`document.write` sinks (popup uses `textContent` exclusively). No `localStorage`/`sessionStorage`/`indexedDB` — nothing persists. Download filename is built through `slug()` (`popup.js:20-28`) which reduces to `[a-z0-9-]` — no path traversal via sub-account name.

### Credential handling (maps to authorization/tenancy — the AI-dominant failure class)
None detected. `window.SHELL_STORE.$http` borrowing path never touches a token (`agent.js:53-56`). The fallback JWT locator (`agent.js:57-69,116-128`) finds the session token in page state and uses it only inside a page-context `fetch` to `backend.leadconnectorhq.com`; it never crosses the extension boundary, is never logged, never stored. `sanitize()` (`popup.js:160-165`) strips `workflowData.fileUrl` (signed Firebase URL with access token) and `permissionMeta` before serialization — verified in code, matching the documented claim.

### Secrets and environment
None detected. No placeholder-shaped or real secret literals (LLM-common values swept). No `.env` file tracked now or anywhere in git history. `.env.example` contains only explanatory comments. Zero secret-shaped strings (`sk-`, `ghp_`, `AKIA`, `AIza`, JWT patterns) across all history (`git log --all -p` scan: 0 hits).

### Webhooks and third-party intake
N/A — no webhook handlers exist in this repo.

### Dependencies and supply chain
None detected. No `package.json`, no lockfile, no dependencies at all — supply chain is closed by construction. CI runs no package installation (only `node scripts/validate-manifests.mjs`).

### CI / GitHub workflows
None detected. All `uses:` actions pinned to full commit SHAs (checkout v7.0.1, setup-node v7.0.0, codeql-action v3.30.1). No `pull_request_target` trigger (eliminates the secrets-exposure-to-fork-code class). No `run:` step interpolates untrusted `github.*` context into a shell. Both workflows declare least-privilege `permissions: contents: read` at workflow and job level (CodeQL analyze job adds only `security-events: write`, `actions: read`). Dependabot covers `github-actions` so pinned SHAs stay current.

### PII and logging hygiene
None detected. Zero `console.*` calls in tool code — nothing is logged, sensitive or otherwise. Exported data stays on the user's disk.

### AI-generated code patterns
None detected. No hardcoded credentials. No dependency names to slopsquat (zero deps). Documented security claims (README, CLAUDE.md, tool README) were verified against actual code rather than assumed — the `fileUrl`/`permissionMeta` stripping and read-only-GET claims all match implementation (`agent.js` exports are GET-only; no POST/PUT/DELETE exists).

## Findings detail

### [LOW] Personal email address published in SECURITY.md

- **Location:** `SECURITY.md:27`
- **Surface:** Secrets and environment / public-doc hygiene
- **Description:** `marioaldayuz315@gmail.com` is the vulnerability-report fallback contact. Not a secret (already public in commit metadata), but publishing it in a SECURITY.md invites spam harvesting.
- **Evidence:** `If private vulnerability reporting is unavailable or unusable for your report, email the maintainers at marioaldayuz315@gmail.com.`
- **Remediation:** Optional: replace with a filtered alias (e.g. security@ on a owned domain) when one exists. GitHub private vulnerability reporting is already the primary channel.
- **Status:** documented for follow-up (human decision — no alias known to exist)

## Remediation summary

| Severity | Count | Fixed this session | Documented only |
|---|---|---|---|
| Critical | 0 | 0 | 0 |
| High | 0 | 0 | 0 |
| Medium | 0 | 0 | 0 |
| Low | 1 | 0 | 1 |

## Re-evaluation

N/A — no Medium-or-above findings required fixes.

## Next step

Cleared to invoke quality-stinger.
