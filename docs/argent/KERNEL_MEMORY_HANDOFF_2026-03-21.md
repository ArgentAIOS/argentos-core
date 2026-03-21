# Kernel Memory Handoff

Date: 2026-03-21
Branch at pause: `codex/core-business-boundary-audit`

## Why This Lane Is Paused

Kernel-memory continuity work is paused on purpose.

The limiting factor is no longer just kernel behavior. The bigger product blocker is that
development, packaging, and the live installed runtime are still coupled on the same machine.
That makes it too easy for packaging work to damage the running gateway, blur install/update
behavior, and confuse what is "product" versus "development state."

The current priority is therefore:

1. separate public Core from Business/admin surfaces
2. lock a clean install path
3. validate that install on a fresh machine
4. lock a trustworthy update path

Kernel-memory work should resume only after that path is stable enough that runtime behavior can
be tested without contaminating the active install.

## Core Goal At Pause

The active goal of this lane remains:

> One continuous, truthful, self-directed mind.

Expanded:

- carry state across turns and restarts
- keep working on real problems between interactions
- produce artifact-backed progress instead of reflective theater
- re-enter conversation from the same carried state
- grow in identity and relationship through durable experience without losing coherence

## What Was Accomplished Before Pause

The lane produced real progress. Important recent work included:

- stricter semantic progress validation to reduce reflective theater
- suspicious-progress detection for rephrase / planning-only / no-meaningful-change cycles
- executive pressure away from empty `plan_note` / `synthesis_note` churn
- operator-attention parking for evidence-backed threads that need explicit operator decision
- monitor surfacing for budget exhaustion and suspicious-progress context
- inner-state provenance separation:
  - `carried-task`
  - `agenda-derived`
  - `reflection-derived`
  - `conversation-derived`
- prompt/runtime hardening so conversation residue is less likely to masquerade as private carried
  state
- session-surface fixes so operator chat is less contaminated by background/internal sessions
- Swift-side session filtering so the native app stops showing mixed-agent session buckets in the
  normal operator chat surface

## What Is True Now

The system is no longer at the stage where "nothing is real."

What is now defensible:

- carried threads survive restart
- off-turn work can produce real artifacts
- weak progress is often caught instead of silently credited
- operator decision boundaries can be surfaced
- conversation-derived claims are more separable from carried-task claims

What is not yet solved:

- seamlessness
- consistently rich off-turn work
- clean operator visibility into all relevant internal state
- reliable self-resolution judgment
- clean isolation between dev packaging actions and the live installed runtime

## Known Open Seams In This Lane

These are the main unresolved kernel-memory seams to resume later:

1. parked thread hydration

- queue state and top-level self-state can still drift or hydrate unevenly

2. operator-visible auditability

- "what were you doing?" is better than before, but still not reliable enough on demand

3. response-time provenance policy

- provenance is tracked, but reply-generation policy still needs stronger enforcement in edge cases

4. stronger consequences for hollow cycles

- repeated planning-only / no-meaningful-change loops should escalate harder

5. chat/off-time integration quality

- same-thread re-entry has improved, but still needs smoother end-to-end behavior

## Important Runtime Lesson From This Pause

During Swift app packaging on this machine, `scripts/package-mac-app.sh` mutated the shared repo
install state strongly enough to break gateway startup.

Observed failure chain:

1. packaging ran `pnpm install --config.node-linker=hoisted`
2. that changed the effective `node_modules` layout in the shared dev/runtime workspace
3. the gateway LaunchAgent still pointed at a different workspace entrypoint
4. Baileys `p-queue` then resolved the wrong `eventemitter3`
5. gateway crashed on restart

That is the clearest proof that kernel-memory work is currently downstream of a larger product and
installation problem.

## Resume Criteria

Resume this lane only after all of the following are true:

1. the installed app/runtime path is separate from the active dev workspace
2. packaging the Swift app cannot break the live gateway
3. the public Core vs Business boundary is explicit enough that the install surface is stable
4. there is a clean test loop on a second Mac
5. the update rail for both runtime and app is documented and testable

## First Resume Task

When this lane resumes, start here:

1. validate end-to-end operator thread parking + decision writeback on a clean runtime
2. inspect whether the session/operator surface still leaks background context under normal use
3. continue on truthful off-time activity reporting, not just artifact generation

## Notes

- Treat this document as a pause marker and handoff, not a claim that kernel-memory work is done.
- Do not use the live dev machine as the proof environment for continuity quality until the install
  path is separated from development.
