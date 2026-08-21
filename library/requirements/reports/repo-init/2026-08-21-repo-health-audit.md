# GitHub Repo Health Audit Report

**Repository:** legioncodeinc/ghl-toolset
**Audit date:** 2026-08-21
**Data collection mode:** Local clone + gh CLI
**Coverage gaps:** None — branch protection, rulesets, and security settings verified via API. Note: docs/template files exist on the audited branch (this PR), not yet on `origin/main`; scores reflect branch state.
**Audited by:** github-repo-health-worker-bee

---

## Overall Score: 67/100

| # | Dimension | Raw Score | Weight | Weighted |
|---|---|---|---|---|
| 1 | Branch protection / rulesets | 7/10 | 20% | 1.40 |
| 2 | Commit quality (Conventional Commits) | 3/10 | 15% | 0.45 |
| 3 | CODEOWNERS coverage | 8/10 | 15% | 1.20 |
| 4 | CI workflow density | 7/10 | 15% | 1.05 |
| 5 | Docs presence | 8/10 | 10% | 0.80 |
| 6 | Repository settings | 4/10 | 10% | 0.40 |
| 7 | Issue/PR templates | 10/10 | 8% | 0.80 |
| 8 | .gitignore coverage | 9/10 | 7% | 0.63 |
| | **Total** | | | **6.73** |

---

## Branching Strategy (qualitative)

**Observed strategy:** GitHub Flow (single long-lived `main`, PR-based changes) — now documented in CONTRIBUTING.md
**Documented:** Yes — CONTRIBUTING.md "Branching and commits"
**Branch inventory:** 1 branch (`main`), 0 open PR branches at audit time
**Assessment:** Correct strategy for a small toolset repo; the convention is documented going forward.

---

## Branch Protection / Rulesets (Score: 7/10)

**Enforcement mechanism:** GitHub Rulesets ("Main Protection", id 21131540, active, targets `~DEFAULT_BRANCH`)

| Rule | Status | Notes |
|---|---|---|
| `pull_request` required | ✅ Enabled | `require_code_owner_review: true`, `required_review_thread_resolution: true`, `require_extra_approval_for_unattributed_changes: true` |
| `required_status_checks` | ❌ | CI is not required to pass before merge — a red CI can be merged over |
| `non_fast_forward` | ✅ | Force pushes blocked |
| `deletion` | ✅ | Branch deletion blocked |
| `dismiss_stale_reviews` | ⚠️ | `false` — new pushes don't dismiss approvals |
| `required_linear_history` | ❌ | Not set |
| `required_signatures` | ❌ | Not set |
| Approving review count | ⚠️ | 0 (code-owner requirement is the only approval gate) |

**Operational risk (verify on first PR):** CODEOWNERS assigns everything to `@legioncodeinc` (an org). GitHub resolves CODEOWNERS owners as users or teams; a bare org handle may either be ignored (weakening the gate) or bind in unexpected ways. With a single-member org, a binding code-owner requirement plus "PR author cannot self-approve" can deadlock merges. If the first PR is blocked with "review required", adjust the ruleset (bypass for admins) or point CODEOWNERS at a team.

---

## Commit Quality - Conventional Commits (Score: 3/10)

| Metric | Value |
|---|---|
| CC-adherent commits (last 100) | 0/3 (0%) — "Initial commit", "Commit initial tools", "Moved files to tool specific" |
| Average subject line length | 24 chars ✅ |
| Generic/noise commits | 3 (all pre-convention, repo-birth commits) |
| Breaking changes documented | N/A |
| `commitlint` in CI | No |

The convention is documented in CONTRIBUTING.md and the PR template; commits from this PR forward follow it. Rewriting 3 repo-birth commits is not worth a force-push; squash-merging this PR starts clean history.

---

## CODEOWNERS (Score: 8/10)

**Location:** `.github/CODEOWNERS` (on branch)
**Syntax errors:** None (no `\#`, `!`, or `[ ]` traps)
**Coverage:** 100% of paths (`*` default) + governance lockdown of `/.github/`
**Ownership type:** Org (see branch-protection note above on org-handle binding)

---

## CI Workflow Density (Score: 7/10)

| Workflow | Triggers | Lint | Type | Test | Build | Security | Timeout | In required checks |
|---|---|---|---|---|---|---|---|---|
| `ci.yml` | push, pull_request → main | n/a¹ | n/a¹ | n/a¹ | n/a | n/a | ❌ | ❌ |
| `codeql.yml` | push, PR, weekly cron | n/a | n/a | n/a | n/a | ✅ | ❌ | ❌ |

¹ Stack-appropriate: dependency-free vanilla JS; the repo's entire gate is manifest validation, which CI runs. Lint/typecheck/test arrive with the first tooled tool. Both workflows are SHA-pinned with least-privilege permissions and concurrency cancellation. Missing `timeout-minutes` on all jobs.

---

## Docs Presence (Score: 8/10)

| File | Present | Notes |
|---|---|---|
| README.md | ✅ | Multi-tool positioning, tool index, contract, R&D notice |
| LICENSE | ✅ | AGPL-3.0 (registers on GitHub after push) |
| CONTRIBUTING.md | ✅ | Conventions + local gate |
| SECURITY.md | ✅ | Private vulnerability reporting channel |
| CODE_OF_CONDUCT.md | ❌ | Known gap; GitHub community-page "Add" flow can generate |

---

## Repository Settings (Score: 4/10)

| Setting | Status |
|---|---|
| Auto-delete head branches | ✅ |
| Allow merge commits | ⚠️ allowed |
| Allow squash merging | ✅ allowed (recommend: only this) |
| Allow rebase merging | ⚠️ allowed |
| Secret scanning | ❌ disabled |
| Push protection | ❌ disabled |
| Dependabot alerts | ❌ disabled (version-updates file is on branch; the alerts toggle is separate) |
| Code security (CodeQL default setup) | ❌ disabled — the committed `codeql.yml` covers scanning, so this is acceptable; do not enable both |

---

## Issue/PR Templates (Score: 10/10)

| Item | Present | Substantive? |
|---|---|---|
| Bug report template | ✅ | ✅ GHL-specific environment fields, secret-handling warning |
| Feature request template | ✅ | ✅ |
| PR template | ✅ | ✅ validate + smoke-test checklist, CC type taxonomy |

---

## .gitignore Coverage (Score: 9/10)

**Detected stack:** Vanilla JS (Chrome MV3 extensions), zero dependencies
**Secret patterns:** ✅ `.env`/`.env.*` with `!.env.example` negation; `*.pem` (Web Store key)
**Build artifacts:** ✅ Node baseline (dist/build/out, caches, logs, framework dirs)
**Accidentally tracked files:** `.mimosa/` hook state was committed in `ae90a0e`; its removal is staged in this PR. No others.

---

## Prioritized Remediation Plan

| Priority | Finding | Impact | Effort | Action |
|---|---|---|---|---|
| 1 (4.0) | Secret scanning, push protection, Dependabot alerts all disabled | 4 | 1 | Settings → Advanced Security → enable all three (repo is private; owner access) |
| 2 (4.0) | CI status checks not required before merge | 4 | 1 | After this PR merges and CI runs once: ruleset 21131540 → Add rule → Require status checks → `Validate extension manifests` |
| 3 (4.0) | CODEOWNERS org-handle binding unverified; possible merge deadlock | 4 | 1 | Watch first PR; if blocked, adjust ruleset bypass or point `*` at a team/personal handle |
| 4 (3.0) | All three merge methods allowed | 3 | 1 | Settings → General → Pull Requests → allow squash merge only |
| 5 (3.0) | Stale reviews not dismissed; 0-approval count | 3 | 1 | Ruleset → enable dismiss-stale-reviews; consider 1 approving review |
| 6 (2.0) | No `timeout-minutes` on workflow jobs | 2 | 1 | Add `timeout-minutes: 10` to each job (handoff: ci-release-worker-bee) |
| 7 (2.0) | CODE_OF_CONDUCT.md missing | 2 | 1 | Community page → Add → Covenant template |
| 8 (1.3) | 0% Conventional Commits in history | 4 | 3 | Adopted going forward via CONTRIBUTING + PR template; optional commitlint later |
| 9 (—) | `v0.1.0` tag not cut (CHANGELOG links 404) | 2 | 1 | Tag after merge (also tracked in QA report) |

**Handoffs to other Bees:**
- `ci-release-worker-bee`: workflow `timeout-minutes`; lint/typecheck/test jobs when a tool adopts a build system
- `security-worker-bee`: none — no leaked secrets (verified in 2026-08-21 security audit); Settings toggles are human actions above

---

*Ship Gate decision: nothing in this audit blocks commit/push. All remediation items are GitHub Settings actions or post-merge improvements.*
