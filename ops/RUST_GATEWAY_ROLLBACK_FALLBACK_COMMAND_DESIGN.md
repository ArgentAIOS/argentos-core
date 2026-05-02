# Rust Gateway Rollback And Fallback Command Design

LANE LOCK:
Repo: ArgentAIOS/argentos-core
Local path: /Users/sem/code/argent-core-rust-spine
Target branch: dev
Forbidden repo for this task: ArgentAIOS/argentos
Reason: core gateway/kernel/Rust foundation work

## Scope

This is a design-only packet for rollback/fallback commands. The current implementation is read-only through:

```sh
argent gateway authority status
argent gateway authority status --json
```

No command in this slice mutates live gateway authority.

## Command Shape

Planned command family:

```sh
argent gateway authority status
argent gateway authority prepare-rust --shadow-report <path>
argent gateway authority promote-rust --canary --duration <duration>
argent gateway authority rollback-node --dry-run --reason <reason>
argent gateway authority rollback-node --reason <reason>
```

## Read-Only First

Implemented now:

- `status`
  - reports Node as live gateway/scheduler/workflow/channel authority,
  - reports Rust as shadow-only,
  - reports latest parity report freshness,
  - reports scheduler authority and cron/workflow timer counts,
  - reports rollback command as planned but not implemented.

Recommended next:

- `rollback-node --dry-run`
  - validates whether a rollback could be performed,
  - prints live authority fields that would change,
  - lists in-flight jobs/runs/timers that need operator attention,
  - exits non-zero if duplicate authority is detected,
  - does not stop services or write authority state.

## Future Mutating Rollback Requirements

A mutating rollback must not exist until there is a durable authority record. When it exists, it must:

- set live gateway authority to Node,
- set scheduler/workflow/channel authority to Node,
- stop Rust live timer loops,
- re-arm Node cron/workflow wait loops,
- report ambiguous in-flight Rust-owned work,
- refuse success if Rust still claims live authority,
- write an audit event with reason, timestamp, operator, and previous authority epoch.

## Non-Negotiable Safety Checks

- No silent data loss.
- No duplicate workflow runs.
- No duplicate cron/timer fires.
- No duplicate channel sends.
- No hidden fallback that makes Rust appear live while Node is actually handling the request.
- No dashboard or Swift client should need to guess which gateway is authoritative.
