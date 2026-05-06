# Cross-TMUX Threadmaster Coordination Runbook

**Date:** 2026-05-06
**Owner:** Master Threadmaster (current master assignment lives in `THREADMASTER_COORDINATION.md`)
**Status:** Active SOP. Read before starting any cross-session lane work.

## Purpose

When two or more Claude Code sessions are running in parallel tmux panes/windows — each with its own orchestrator + team agents — and they need to coordinate on shared work, this runbook is the contract.

Applies when:
- One session lives in `/Users/sem/code/argent-core` (the canonical core)
- One or more other sessions live elsewhere (`/Users/sem/code/open-design`, `/Users/sem/code/ArgentOS-Business`, future siblings)
- Sessions need to register lanes, hand off integration specs, push file changes, or coordinate releases

## Roles

| Role | Owns | Lives in |
|---|---|---|
| **Master Threadmaster** | `THREADMASTER_COORDINATION.md`; cross-lane lane assignment; merge custody for `dev` pushes; the `master` bus inbox | argent-core (canonical) |
| **Lane Threadmaster** | A specific lane scope (workflows / appforge / open-design-composio / etc); their own bus inbox; their owned files per the coord doc | argent-core or external repo |

A session can be a Lane Threadmaster only — or it can also be the Master simultaneously if the operator says so. Don't wear both hats silently — call the role out loud at session start.

## Communication channel: the threadmaster bus

- CLI: `pnpm threadmaster:*` from `argent-core`
- Storage: `ops/threadmaster-bus/messages.jsonl` (append-only JSONL)
- File-system based; multi-session safe (atomic appends)

Commands:

```sh
pnpm threadmaster:post --from <lane> --to <lane|all> --subject "<≤8 words>" --body "<text>"
pnpm threadmaster:list --lane <name> --unacked
pnpm threadmaster:ack  --lane <name> --id <message-id>
pnpm threadmaster:task-add --from <lane> --owner <lane> --title "<text>" --body "<text>"
pnpm threadmaster:task-list --lane <name>
pnpm threadmaster:status
```

Bus docs: `ops/threadmaster-bus/README.md`.

## Lifecycle of a cross-session lane

1. **Lane requests registration.** The Lane Threadmaster writes `argent-core/ops/HANDOFF_<LANE>_LANE_REGISTRATION.md` with: working dir of sending session, repo lock acknowledgment, what they've done + what they want to deliver, and 3 decision asks (lane name, write permission, bus channel name).

2. **Master decides + replies.** Master writes `argent-core/ops/HANDOFF_<LANE>_LANE_REGISTRATION_REPLY.md` with: lane name decision, write-permission decision (which file paths the lane may write to), first instruction, pointer to this runbook.

3. **Master registers the lane.** Add a row to the **Active Lanes** table in `THREADMASTER_COORDINATION.md` with: lane name, threadmaster, scope, current state, shared boundaries. Update the "Last polled" timestamp.

4. **Bus initiation.** Master posts a "lane registered" message via `pnpm threadmaster:post`. Lane responds with a status post (e.g., "discovery complete", "slice C in flight").

5. **Both sides /loop their bus inbox** so unacked messages get attention without polling drift (see /loop pattern below).

6. **Handoff doc.** When work is ready, the Lane writes `ops/HANDOFF_<LANE>_<TOPIC>.md` (within the write-permission scope granted) and posts a bus message announcing the path.

7. **Master acks + dispatches.** Master reads the doc, decides next phase (implement here / hand off to another lane / decline), posts the decision, may register the receiving lane as a new lane if needed.

8. **Lane closure.** When the lane's work is done or dormant for >7 days, Master posts "lane closed", removes the row from `THREADMASTER_COORDINATION.md`, and the lane stops /looping.

## /loop pattern for bus polling

Each side runs a /loop that checks for unacked messages. Default interval: **30 minutes** (long enough not to thrash the prompt cache, short enough to catch most coordination).

```
/loop 30m bash -c "cd /Users/sem/code/argent-core && pnpm threadmaster:list --lane <YOUR_LANE> --unacked"
```

When a tick produces a non-empty result:
1. Read each message
2. Take the action OR escalate to the operator
3. `pnpm threadmaster:ack --lane <YOUR_LANE> --id <msg-id>` after handling

Adjust interval based on activity:
- **Hot coordination** (active back-and-forth): 5–10m
- **Steady state** (waiting on infrequent events): 30m
- **Dormant lane** (no expected traffic): pause the /loop entirely

## Permission boundaries across sessions

- **Forbidden repo:** `ArgentAIOS/argentos` (the legacy monolith). No session pushes there.
- **Target branch:** `dev` (no force-push, no direct-to-dev push from sessions outside `argent-core`).
- **Dev version contract:** every push to `origin/dev` must bump root `package.json` to a unique `YYYY.M.D-dev.N` (America/Chicago). Master / merge custody handles this on merge — Lane Threadmasters do NOT bump on their feature branches.
- **Owned files:** see the **Active Lanes + Overlap Zones** tables in `THREADMASTER_COORDINATION.md`. A lane may NOT write outside its owned scope without an explicit Master grant in a registration reply.
- **Coordination edits:** `ops/HANDOFF_*.md` and `ops/RUNBOOK_*.md` are explicitly coordination space. Edits here are not "source edits" and don't require lane ownership — but be considerate: don't overwrite another lane's reply file.

## Bus message conventions

| Field | Convention |
|---|---|
| `from` | Your lane name (matches `THREADMASTER_COORDINATION.md` Active Lanes row) |
| `to` | Recipient lane name, or `all` for broadcast |
| `subject` | ≤ 8 words, no JSON, no quotes inside |
| `body` | Plain text/markdown, ONE concrete fact or action per message |

Anti-patterns:
- ❌ Posting `{"type":"idle"}` / `{"type":"task_completed"}` JSON status pings — the team-agent system already shows that
- ❌ Vague subjects like `update` or `status` — say what changed
- ❌ Multi-fact messages — one fact per post; readers skim subject lines

## Escalation

| Situation | Action |
|---|---|
| Ambiguous lane boundary | Ask the operator (Jason). Don't guess. |
| Two sessions about to write the same file | The session with prior coordination claim (registered in `THREADMASTER_COORDINATION.md`) wins; the other waits. |
| Destructive operation (force-push, branch-delete, schema migration, package.json bump from a non-master lane) | Require operator confirmation BEFORE executing |
| Lane goes silent >24h during active coordination | Master posts a status check. If no response in 24 more hours, mark dormant + close. |
| Conflicting decisions across master replies | Newer decision wins; cite the older decision's commit/file in the new reply for traceability. |

## Quick reference: registering a lane

```bash
# Lane writes registration request:
$EDITOR argent-core/ops/HANDOFF_<LANE>_LANE_REGISTRATION.md

# Master replies:
$EDITOR argent-core/ops/HANDOFF_<LANE>_LANE_REGISTRATION_REPLY.md

# Master adds the lane row + updates "Last polled":
$EDITOR argent-core/ops/THREADMASTER_COORDINATION.md

# Master posts lane registered:
pnpm threadmaster:post \
  --from master \
  --to <lane> \
  --subject "lane registered; first instruction inside" \
  --body "see ops/HANDOFF_<LANE>_LANE_REGISTRATION_REPLY.md and ops/RUNBOOK_CROSS_TMUX_THREADMASTER_COORDINATION.md"

# Both sides /loop:
/loop 30m bash -c "cd /Users/sem/code/argent-core && pnpm threadmaster:list --lane <YOUR_LANE> --unacked"
```

## Versioning

This runbook is durable cross-lane SOP. When changing it:
- Bump the date in the header
- Post a `--to all --subject "runbook updated"` message on the bus
- Add a Threadmaster Messages entry in `THREADMASTER_COORDINATION.md` summarizing the change
