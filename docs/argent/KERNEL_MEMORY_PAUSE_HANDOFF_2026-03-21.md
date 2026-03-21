# Kernel Memory Pause Handoff

Date: 2026-03-21
Branch context: `codex/core-business-boundary-audit`

## Current Live Reality

The live gateway is currently running from:

- `/Users/sem/code/argentos/dist/index.js`

The consciousness-kernel runtime is not active in that build.

This is expected after the branch pivot back to core/business boundary and installability
work. The current repo contains the kernel thesis doc, but not the runtime implementation.

Reference:

- [CONSCIOUSNESS_KERNEL_THESIS.md](/Users/sem/code/argentos/docs/argent/CONSCIOUSNESS_KERNEL_THESIS.md)

## Where The Working Kernel Code Still Lives

The working kernel patchset remains in the separate autonomy workspace:

- `/Users/sem/code/argentos-main-autonomy-fixes-20260319`

Representative files there:

- `/Users/sem/code/argentos-main-autonomy-fixes-20260319/src/infra/consciousness-kernel.test.ts`
- `/Users/sem/code/argentos-main-autonomy-fixes-20260319/src/infra/consciousness-kernel-state.js`
- `/Users/sem/code/argentos-main-autonomy-fixes-20260319/scripts/curiosity-monitor-web.ts`

That workspace is now a source workspace for later porting, not the active runtime source of truth.

## Decision

Kernel-memory work is paused temporarily.

This is a sequencing decision, not a cancellation.

The active priority is:

1. finish the Core vs Business boundary cleanly
2. harden the install and onboarding path
3. validate fresh-machine installs
4. prove the update path

Only after those are stable should the kernel patchset be ported into the current branch.

## Why This Pause Is Necessary

The kernel patchset was developed in a separate workspace while the live app and gateway were
also being rebuilt and re-homed. Mixing those two efforts in the same runtime created ambiguity:

- the running gateway could silently switch workspaces
- operator chat and internal state could drift between builds
- packaging and local runtime fixes became harder to reason about
- the public Core boundary work could not be validated cleanly

Until the install/runtime path is stable, the kernel should not be merged opportunistically.

## Rule Going Forward

Do not treat the current `/Users/sem/code/argentos` runtime as kernel-enabled unless the kernel
patchset has been deliberately ported and validated in this repo.

Symptoms such as:

- no `consciousness-kernel` entries in gateway logs
- no curiosity-monitor activity tied to the current gateway
- no operator-decision kernel messages

should be interpreted as expected while this pause is in effect.

## Re-Entry Plan

When the installability and boundary work is stable, resume kernel work in this order:

1. inventory the old kernel patchset in `/Users/sem/code/argentos-main-autonomy-fixes-20260319`
2. identify which pieces belong in public Core, which are experimental, and which are Business-only
3. port the runtime code into `/Users/sem/code/argentos` as a deliberate branch merge
4. re-run live validation against the current gateway and app
5. only then re-enable the kernel in the active runtime

## Operational Boundary

Until re-entry:

- the main agent runtime is the standard Argent gateway
- kernel-memory experimentation remains out-of-band
- the Curiosity Queue Monitor is experimental tooling, not part of the installable product surface

Related docs:

- [INSTALLABLE_PRODUCT_PIVOT_2026-03-21.md](/Users/sem/code/argentos/docs/argent/INSTALLABLE_PRODUCT_PIVOT_2026-03-21.md)
- [LOCAL_RUNTIME_AND_INSTALL_WORKFLOW_2026-03-21.md](/Users/sem/code/argentos/docs/argent/LOCAL_RUNTIME_AND_INSTALL_WORKFLOW_2026-03-21.md)
- [EXPERIMENTAL_CURIOSITY_MONITOR.md](/Users/sem/code/argentos/docs/argent/EXPERIMENTAL_CURIOSITY_MONITOR.md)
