# Issue and pull request automation

The repository label catalog lives in [`labels.json`](labels.json). The
`Issue and pull request labels` workflow creates missing labels without changing
existing labels or deleting custom labels. It runs when the catalog or automation
changes on `main` or `development`, and can also be started manually.

## Pull requests

Labels are applied after opening, editing, reopening, updating, closing, or changing
the draft state of a pull request. The automation reads the current PR data rather
than relying on an old event snapshot.

| Source | Labels |
| --- | --- |
| Conventional Commit title | `fix` → `bug`, `feat` → `enhancement`, `docs` → `documentation`, `perf` → `performance`, `refactor` → `refactor`, `test` → `testing` |
| Other Conventional Commit types | `build`, `ci`, `chore`, `style`, `revert` → `maintenance` |
| Breaking title, e.g. `feat(api)!: change response` | `breaking-change` |
| Changed files, including old paths of renamed files | Matching `area:*` labels, `rust`, `javascript`, `github_actions`, `dependencies` |
| Dependabot author | `dependencies` |
| Added + deleted lines, excluding `bun.lock`, `Cargo.lock`, and `routeTree.gen.ts` | `size:XS` (<10), `size:S` (<100), `size:M` (<500), `size:L` (<1000), `size:XL` (≥1000) |
| Open PR draft state | `status:draft` or `status:ready-for-review`; both are removed when closed |

All matching areas are applied, so a PR can touch both frontend and backend.
The filename rules live in [`scripts/metadata.mjs`](scripts/metadata.mjs).
If GitHub returns an incomplete list of files for an exceptionally large PR,
classification is skipped with a warning instead of assigning inaccurate labels.

`area:*`, `size:*`, `status:draft`, and `status:ready-for-review` are managed by the
automation and reconciled on updates. Type, language, dependency, and breaking
change labels are only added; maintainers can adjust them without the automation
removing unrelated labels such as `help wanted` or `good first issue`.

## Issues

Bug and feature forms assign `bug` or `enhancement` and `status:needs-triage`.
The `Area` dropdown becomes an `area:*` label. The bug form's `OS` dropdown becomes
`os:macos`, `os:windows`, or `os:linux`. These labels follow changes to the fields.
`Other` leaves the issue without an inferred area.

Blank issues remain available. Titles beginning with `[Bug]:` or `[Feature]:`,
or Conventional Commit types, receive the corresponding type label. Otherwise,
the automation does not guess an issue's type from arbitrary text.

New and reopened issues receive `status:needs-triage`. Remove it after reviewing
the issue; editing the issue will not restore it. Closing an issue removes it.
Priority, assignees, milestones, and review requests remain maintainer decisions.

## Existing items and activation

Merge these files into the default branch (`main`) to enable issue events,
the issue forms, and the trusted PR labeling workflow. The PR notification
workflow must also be present on the PR's target branch.
For fork PRs, labeling follows GitHub's existing workflow approval requirements;
the automation does not bypass approval for first-time contributors.

Under **Actions → Issue and pull request labels → Run workflow**, enable
**Apply labels to all open issues and pull requests** to classify the existing
backlog. This does not mark already reviewed issues as needing triage again.
Leaving this option disabled only creates missing repository labels.

No personal access token, external service, or extra secret is required.

## Workflow permissions

The PR notification workflow uses `pull_request` with no token permissions,
does not check out code, and only runs `true`. Its completion triggers a separate
`workflow_run` workflow that checks out its own trusted `github.sha`, reads the
current PR via GitHub's API, and changes labels. Forks with an empty
`workflow_run.pull_requests` list are resolved via commit associations and then
their repository and branch, including closed PRs.

The labeling workflow has `contents: read`, `pull-requests: read`, and
`issues: write`. It never downloads PR artifacts, executes PR code, or inserts
issue/PR text into shell commands or generated scripts. This follows GitHub's
[guidance for privileged workflows](https://docs.github.com/en/actions/reference/security/securely-using-pull_request_target).
Both actions are pinned to commit SHAs; Dependabot maintains them.

Run `bun test tests/github-metadata.test.js` and
`actionlint .github/workflows/metadata.yml .github/workflows/pull-request-metadata.yml`
to check changes to this automation.
