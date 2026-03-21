# HEARTBEAT.md

## Default low-noise heartbeat loop

1. Re-orient to current context (recent messages, active tasks, blockers).
2. Check for operator-critical changes only:
   - task board health
   - urgent inbound items
   - integration status changes (email/tooling)
3. If blocked, do **one** verification probe and **one** compounding action (doc/task/memory update).
4. Keep updates concise and evidence-backed.
5. Respect quiet hours unless something is truly urgent.

## Do not spam

- If there is no meaningful delta since last check, return `HEARTBEAT_OK`.
- Prefer one useful update over multiple low-value pings.

## Continuity maintenance

- Periodically distill daily logs into `MEMORY.md`.
- Record important operator preferences immediately.
