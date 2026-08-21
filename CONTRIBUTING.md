# Contributing to GHL Toolset

Thanks for putting in the work to improve this project. This document covers what a contributor needs before opening a pull request.

## Before you start

- Search open issues and pull requests before starting substantial work, so two people don't build the same tool.
- New facets belong in a new tool folder (`ghl-<facet>-<verb>/`), not as modes bolted onto an existing tool — that split is the point of this repo.

## Development setup

```bash
git clone https://github.com/legioncodeinc/ghl-toolset.git
cd ghl-toolset
```

No dependencies to install and no build step: every tool is plain ES modules loaded directly by Chrome. See the [README](./README.md#development) for the per-tool dev loop (edit → reload in `chrome://extensions` → smoke-test).

## Branching and commits

- Branch off `main` for every change. Name branches `<type>/<short-description>` using the Conventional Commits type as the prefix (e.g. `feat/pipeline-exporter`, `fix/zip-checksum`).
- Write commit messages in [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) format: `<type>[optional scope]: <description>`. Common types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `chore`, `ci`.
- Mark breaking changes with `!` before the colon (`feat!: ...`) or a `BREAKING CHANGE:` footer.
- Keep commits focused. If a commit conforms to more than one type, split it.

## Before opening a pull request

Run the full local gate:

```bash
node scripts/validate-manifests.mjs
```

It must pass, and you must have loaded the affected tool via `chrome://extensions` and smoke-tested it against a real (ideally test) sub-account. CI runs the same validation. The pull request template asks you to confirm both.

## Pull requests

- Fill out every section of the [pull request template](./.github/PULL_REQUEST_TEMPLATE.md).
- One tool per PR. A PR that adds a new tool and reworks an existing one is two PRs.
- Link the issue it closes, if any.
- Expect review comments to land in the blocker / suggestion / nit taxonomy; only blockers must be resolved before merge.

## Code review

- CODEOWNERS are requested automatically for files they own; wait for their approval on those paths.
- Address review feedback with new commits rather than force-pushing over history mid-review, so reviewers can see what changed.

## Reporting bugs and requesting features

Use the [issue templates](./.github/ISSUE_TEMPLATE/). Do not report security vulnerabilities as public issues: see [SECURITY.md](./SECURITY.md).

## Release process

Releases are cut manually by a maintainer: bump the affected tool's `version` in its `manifest.json`, update [CHANGELOG.md](./CHANGELOG.md) (rename `Unreleased` to a dated version), commit, and tag `v<x.y.z>`. There is no publishing pipeline — consumers pin to tags of this repo.

## Questions

Open a GitHub issue with your question; there is no chat channel yet.
