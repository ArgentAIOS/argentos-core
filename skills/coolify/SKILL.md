---
name: coolify
description: "Deploy applications to Coolify (self-hosted on Dell R750). Use the coolify_deploy tool for GitHub -> Coolify provisioning, PostgreSQL/app resources, semfreak.dev domains, and deploy/status operations."
metadata:
  {
    "argent": { "emoji": "🚀", "requires": { "bins": ["gh", "git"], "keys": ["COOLIFY_API_KEY"] } },
  }
---

# Coolify Skill

Use this skill whenever the user asks to deploy/manage apps on Coolify.

Primary path: call the `coolify_deploy` tool (runtime-integrated, key-safe).
Fallback path: raw API calls with `curl` only when debugging.

## Environment Assumptions

- Coolify URL: `https://coolify.semfreak.dev`
- API key variable: `COOLIFY_API_KEY`
- Server IP: `66.90.191.45`
- Wildcard domain: `*.semfreak.dev`
- GitHub org: `webdevtodayjason`

The key is stored encrypted in service keys and resolved by runtime at call-time.
Do not ask users to paste plaintext keys into chat.

## Tool Action Map

- `test_connection`:
  - Checks `GET /api/v1/version`.
- `list_servers`:
  - Lists server UUIDs/IDs available in Coolify.
- `list_projects`:
  - Lists projects and identifiers.
- `create_project`:
  - Creates a Coolify project.
- `create_database`:
  - Creates PostgreSQL resource in a project.
- `create_application`:
  - Creates app resource from GitHub repo + branch + domain.
- `trigger_deploy`:
  - Triggers deployment for application UUID.
- `deployment_status`:
  - Reads deployment state by deployment UUID or by app UUID.
- `deployment_logs`:
  - Reads logs for a deployment UUID (or latest deployment for an app UUID).
- `deploy_project`:
  - Full pipeline:
    - optional GitHub repo create (`gh`)
    - optional local scaffold + commit + push
    - Coolify project/db/app provisioning
    - optional deploy trigger
- `teardown_project`:
  - Deletes app/database resources for a project, then deletes the project.

## Canonical Flow

When user asks: "build and deploy <project>"

1. Validate access:
   - `coolify_deploy` with `action: test_connection`
2. Resolve server:
   - `action: list_servers` (or use `COOLIFY_DEFAULT_SERVER_ID` if already set)
3. Run full deploy:
   - `action: deploy_project`
4. Return evidence:
   - Project UUID
   - App UUID
   - Deployment UUID/status
   - Live URL (`https://<project>.semfreak.dev`)

## Minimal Full Deploy Input

```json
{
  "action": "deploy_project",
  "project_name": "invoicer",
  "project_description": "Node.js API with Postgres",
  "repo_org": "webdevtodayjason",
  "repo_name": "invoicer",
  "stack": "node",
  "domain": "invoicer.semfreak.dev",
  "deploy_now": true
}
```

## Granular Mode Examples

Create project:

```json
{
  "action": "create_project",
  "project_name": "invoicer",
  "project_description": "Node API"
}
```

Create database:

```json
{
  "action": "create_database",
  "project_uuid": "<PROJECT_UUID>",
  "project_name": "invoicer",
  "server_uuid": "<SERVER_UUID>",
  "environment_name": "production"
}
```

Create application:

```json
{
  "action": "create_application",
  "project_uuid": "<PROJECT_UUID>",
  "project_name": "invoicer",
  "server_uuid": "<SERVER_UUID>",
  "repo_org": "webdevtodayjason",
  "repo_name": "invoicer",
  "branch": "main",
  "domain": "invoicer.semfreak.dev",
  "app_port": 3000
}
```

Trigger deploy:

```json
{
  "action": "trigger_deploy",
  "application_uuid": "<APP_UUID>"
}
```

Status check:

```json
{
  "action": "deployment_status",
  "application_uuid": "<APP_UUID>",
  "limit": 1
}
```

## Operator Notes

- Prefer `deploy_project` unless troubleshooting.
- Keep project/repo/domain naming aligned (`<name>`, `<name>-app`, `<name>-db`, `<name>.semfreak.dev`).
- If `gh` auth is missing, stop and return exact remediation.
- If Coolify responds with schema/endpoint mismatch, capture status + response body and report for adapter update.
