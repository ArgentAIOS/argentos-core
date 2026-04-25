---
summary: "CLI reference for `argent agents` (list/add/delete/set identity)"
read_when:
  - You want multiple isolated agents (workspaces + routing + auth)
title: "agents"
---

# `argent agents`

Manage isolated agents (workspaces + auth + routing).

Related:

- Multi-agent routing: [Multi-Agent Routing](/concepts/multi-agent)
- Agent workspace: [Agent workspace](/concepts/agent-workspace)

## Examples

```bash
argent agents list
argent agents add work --workspace ~/.argentos/workspace-work
argent agents set-identity --workspace ~/.argentos/workspace --from-identity
argent agents set-identity --agent main --avatar avatars/argent.png
argent agents delete work
```

## Identity files

Each agent workspace can include an `IDENTITY.md` at the workspace root:

- Example path: `~/.argentos/workspace/IDENTITY.md`
- `set-identity --from-identity` reads from the workspace root (or an explicit `--identity-file`)

Avatar paths resolve relative to the workspace root.

## Set identity

`set-identity` writes fields into `agents.list[].identity`:

- `name`
- `theme`
- `emoji`
- `avatar` (workspace-relative path, http(s) URL, or data URI)

Load from `IDENTITY.md`:

```bash
argent agents set-identity --workspace ~/.argentos/workspace --from-identity
```

Override fields explicitly:

```bash
argent agents set-identity --agent main --name "ArgentOS" --emoji "🦞" --avatar avatars/argent.png
```

Config sample:

```json5
{
  agents: {
    list: [
      {
        id: "main",
        identity: {
          name: "ArgentOS",
          theme: "space lobster",
          emoji: "🦞",
          avatar: "avatars/argent.png",
        },
      },
    ],
  },
}
```
