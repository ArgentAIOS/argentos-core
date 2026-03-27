# Tracking and Documentation Contract

This is the mandatory contract present in every ArgentOS repo's CLAUDE.md.

## The Contract

Linear is the operational source of truth for active work. Chat is not the source of truth.

Required defaults:

1. Before significant implementation, release, installer, CI, or incident work, locate the Linear issue or create one.
2. Record the active branch, target repo (`argentos` vs `argentos-core` vs website mirror), and acceptance criteria in Linear.
3. Update Linear as work progresses with the current blocker, the current commit/PR, and required review gates.
4. For release-facing work, explicitly track Blacksmith and CodeRabbit state in Linear until merge/release is complete.
5. If Linear is unavailable in the current session, say so immediately and do not pretend the work is documented there.

## Linear Workflow States

| State       | Key       | Use                           |
| ----------- | --------- | ----------------------------- |
| Backlog     | default   | Not yet prioritized           |
| Todo        | unstarted | Prioritized, ready to pick up |
| In Progress | started   | Actively being worked on      |
| In Review   | started   | PR open, awaiting review      |
| Done        | completed | Merged and verified           |
| Canceled    | canceled  | Will not be done              |

## Linear API Access

```
API Key: stored in Claude MCP config (~/.claude.json)
Endpoint: https://api.linear.app/graphql
Team ID: 160acc8b-b8ab-4a09-a0e0-23a49e6b4123
```

Create issues via GraphQL:

```graphql
mutation ($input: IssueCreateInput!) {
  issueCreate(input: $input) {
    success
    issue {
      identifier
      title
      url
    }
  }
}
```
