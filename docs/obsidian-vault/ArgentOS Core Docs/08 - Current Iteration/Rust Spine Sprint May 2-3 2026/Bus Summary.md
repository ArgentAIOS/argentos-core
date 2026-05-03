# Bus Summary

This is a human summary of the Threadmaster bus.

It is not a raw bus log.

## Latest contained checkpoints

### `2026.5.3-dev.3`

Kernel semantic guard contained.

Proof:

- focused TypeScript tests passed
- Rust tests passed
- Rust build passed
- format and lint passed
- repo-lane passed
- restart plus `kernelShadow` smoke passed locally

### `2026.5.3-dev.2`

Kernel shadow runtime contained.

Proof:

- `kernelShadow` appears in status contract
- Rust restart recovery works
- Node remains live authority
- Rust remains shadow-only

### `2026.5.3-dev.1`

Gateway rehearsal and Workflows lease boundary contained.

Proof:

- local rehearsal passed
- rollback boundary reported
- scheduler and workflow ownership stayed with Node

### `2026.5.3-dev.0`

Gateway disposable loopback smoke contained.

Proof:

- local operator smoke passed
- denial receipts present
- duplicate-prevention receipts present
- redaction verified
- no production traffic
- no authority switch

## Latest bus decisions

- AOS kernel semantic guard was accepted and contained.
- Agent Persona semantic contract was marked blocked stale.
- AppForge TableForge keep-moving task was marked blocked stale.
- Workflows is standing by for the next concrete runtime task.

## Update rule

When Master contains a new Rust spine checkpoint, update this file with:

- package version
- commit
- what changed
- what proof passed
- what is still blocked
