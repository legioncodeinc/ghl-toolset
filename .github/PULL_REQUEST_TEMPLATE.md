<!--
Fill every section. Delete this comment block before opening the PR.
Reference: raw/get-started--repo-health--community-profiles-official-docs.md,
raw/get-started--commits--conventional-commits-1.0.0-official.md
-->

## What

{One or two sentences describing the change. Not the how, the what.}

## Why

{The problem this solves or the request it satisfies. Link the issue: Closes #{issue_number}}

## How

{Notable implementation decisions a reviewer needs to know before reading the diff. Skip this section if the diff speaks for itself.}

## Type of change

- [ ] `feat`: new feature
- [ ] `fix`: bug fix
- [ ] `docs`: documentation only
- [ ] `refactor`: no behavior change
- [ ] `test`: test-only change
- [ ] `chore` / `ci`: tooling, build, or CI change
- [ ] Breaking change (see Conventional Commits `!` / `BREAKING CHANGE:` footer)

## Testing

{How this was verified: `node scripts/validate-manifests.mjs` output, the sub-account scenario exercised, screenshots for popup UI changes.}

## Checklist

- [ ] I ran `node scripts/validate-manifests.mjs` locally and it passes
- [ ] I loaded the affected tool via `chrome://extensions` and smoke-tested it against a real sub-account
- [ ] I updated `CHANGELOG.md` under `Unreleased` if this is a notable change
- [ ] I updated documentation (README, tool READMEs, guides) if behavior or setup changed
- [ ] Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/)
- [ ] No secrets, credentials, signed URLs, or `.env` values are included in this diff
