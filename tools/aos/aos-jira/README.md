# aos-jira

Agent-native Jira connector for project management workflows.

Full read+write coverage across projects, issues, boards, and sprints:

- `project.list` and `project.get` expose project scope for workspace pickers.
- `issue.list`, `issue.get`, `issue.create`, `issue.update`, `issue.transition`, `issue.comment` for issue management.
- `board.list` and `board.get` for agile board visibility.
- `sprint.list`, `sprint.get`, `sprint.issues` for sprint tracking.
- `search.jql` for arbitrary JQL queries across the instance.

## Auth

The connector expects Jira Cloud authentication via three environment variables:

- `JIRA_BASE_URL` — Atlassian instance URL (e.g. `https://yourorg.atlassian.net`).
- `JIRA_EMAIL` — Email associated with the Atlassian account.
- `JIRA_API_TOKEN` — API token from https://id.atlassian.com/manage-profile/security/api-tokens.

Required scope hints:

- `JIRA_PROJECT_KEY` to pin the default project scope (e.g. `ARG`).

Optional scope hints:

- `JIRA_ISSUE_KEY` to preselect an issue scope (e.g. `ARG-123`).
- `JIRA_BOARD_ID` to preselect a board scope.
- `JIRA_SPRINT_ID` to preselect a sprint scope.

## Live Reads

The harness uses the Jira REST API v3 and Agile REST API for all read operations. If credentials are present but the API rejects requests, `health` and `doctor` report the failure transparently.

## Writes

Write commands (`issue.create`, `issue.update`, `issue.transition`, `issue.comment`) require appropriate project permissions. All writes hit the live Jira API.
