# aos-github

Agent-native GitHub connector for developer workflows.

Full read+write coverage across repos, issues, PRs, branches, Actions, and releases:

- `repo.list` and `repo.get` expose repository scope for workspace pickers.
- `issue.list`, `issue.get`, `issue.create`, `issue.update`, `issue.comment` for issue management.
- `pr.list`, `pr.get`, `pr.create`, `pr.merge`, `pr.review` for pull request workflows.
- `branch.list` and `branch.create` for branch management.
- `actions.list_runs` and `actions.trigger` for CI/CD visibility and dispatch.
- `release.list` and `release.create` for release management.

## Auth

The connector expects a GitHub personal access token via `GITHUB_TOKEN`.

Required scope hints:

- `GITHUB_OWNER` to pin the default owner/org scope.
- `GITHUB_REPO` to pin the default repository scope.

Optional scope hints:

- `GITHUB_ISSUE_NUMBER` to preselect an issue scope.
- `GITHUB_PR_NUMBER` to preselect a PR scope.

## Live Reads

The harness uses the GitHub REST API for all read operations. If the token is present but the API rejects requests, `health` and `doctor` report the failure transparently.

## Writes

Write commands (`issue.create`, `issue.update`, `issue.comment`, `pr.create`, `pr.merge`, `pr.review`, `branch.create`, `actions.trigger`, `release.create`) require a token with appropriate write scopes. All writes hit the live GitHub API.
