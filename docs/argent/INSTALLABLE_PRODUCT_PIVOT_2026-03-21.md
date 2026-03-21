# Installable Product Pivot

Date: 2026-03-21
Branch context: `codex/core-business-boundary-audit`

## Decision

The active priority is now shifted from kernel-memory iteration to installable-product hardening.

This is not a cancellation of kernel-memory work. It is a sequencing decision.

As of this pivot, the live gateway running from `/Users/sem/code/argentos` should be treated as
non-kernel runtime unless and until the kernel patchset is deliberately ported back in.

The next product-critical work is:

1. define the Core vs Business boundary cleanly enough to ship Core
2. provide a clean install path for ArgentOS
3. validate that install path on fresh Macs
4. prove an update path for both runtime and app bundle

## Why This Is The Right Switch

Right now the system can do interesting internal work, but the product distribution path is still
too unstable:

- the dev workspace and live runtime can interfere with each other
- packaging can damage the active gateway install
- the public Core surface is not yet operationally isolated from Business/admin features
- the update rail exists in pieces, but not yet as a proven release loop

That means installability and boundary discipline are the real bottlenecks.

## Scope Of This Pivot

### 1. Core vs Business Boundary

Goal:

- make public Core shippable without leaking Business/enterprise/admin surfaces

Existing branch artifacts already in progress:

- [CORE_BUSINESS_SHARED_CLASSIFICATION.md](/Users/sem/code/argentos/docs/argent/CORE_BUSINESS_SHARED_CLASSIFICATION.md)
- [PUBLIC_CORE_SURFACE_CONTRACT.md](/Users/sem/code/argentos/docs/argent/PUBLIC_CORE_SURFACE_CONTRACT.md)
- [core-business-shared-paths.json](/Users/sem/code/argentos/docs/argent/core-business-shared-paths.json)
- [public-core-surface-contract.json](/Users/sem/code/argentos/docs/argent/public-core-surface-contract.json)
- [public-core-denylist.json](/Users/sem/code/argentos/docs/argent/public-core-denylist.json)
- [export-public-core.ts](/Users/sem/code/argentos/scripts/export-public-core.ts)

Required output:

- a build/export path that produces a reviewable public Core surface
- a denylist/allowlist that keeps Business-only tools and UI out of Core
- a staging workflow to validate the public boundary before any open-source move

### 2. Clean Install Path

Goal:

- a non-dev user can install ArgentOS cleanly either from CLI or native macOS onboarding

Current install surfaces already exist:

- CLI/web installer docs:
  - [docs/install/index.md](/Users/sem/code/argentos/docs/install/index.md)
  - [docs/install/installer.md](/Users/sem/code/argentos/docs/install/installer.md)
- macOS app packaging/docs:
  - [apps/macos/README.md](/Users/sem/code/argentos/apps/macos/README.md)
  - [docs/platforms/mac/release.md](/Users/sem/code/argentos/docs/platforms/mac/release.md)

But they are not yet operationally clean because:

- packaging still mutates the active repo/runtime environment
- the installer story is split across CLI, Swift app, and release scripts
- the native onboarding flow is not yet the authoritative first-install path

Required output:

- one recommended CLI install path
- one recommended native macOS install/onboarding path
- clear separation between dev packaging and production/runtime installs

### 3. Fresh-System Validation

Goal:

- prove the install on a second Mac that has not been carrying dev residue

Required output:

- repeatable smoke checklist
- first-run onboarding checklist
- runtime verification checklist
- update verification checklist

Minimum smoke proof:

1. install succeeds
2. app launches
3. CLI is installed or intentionally bundled and discoverable
4. gateway installs and starts
5. chat works
6. no background/internal session confusion in the normal operator chat surface
7. update surfaces do not lie

### 4. Update Path

Goal:

- understand and prove how a user’s Argent install is updated from inside the product

Current split already documented:

- runtime/gateway update rail
- Sparkle macOS app rail

Reference docs:

- [docs/install/updating.md](/Users/sem/code/argentos/docs/install/updating.md)
- [docs/install/update-distribution.md](/Users/sem/code/argentos/docs/install/update-distribution.md)
- Sparkle integration in [MenuBar.swift](/Users/sem/code/argentos/apps/macos/Sources/Argent/MenuBar.swift)

Required output:

- clear source of truth for hosted update artifacts
- clear runtime artifact host path
- clear Sparkle feed/appcast host path
- proof that "update runtime" and "update app" are understood as separate rails

## Immediate Engineering Problem To Fix First

Before any broader release/testing work, fix this:

> Packaging the Swift app must not mutate the active development/runtime environment.

Observed today:

- packaging changed dependency layout in the repo
- gateway restart broke
- LaunchAgent still pointed to an old workspace
- runtime had to be repaired manually

## Execution Update

As of 2026-03-21, the immediate packaging/runtime coupling seam has been reduced:

- `scripts/package-mac-app.sh` no longer force-runs `pnpm install`
- dashboard API/UI LaunchAgents were re-homed to the current repo
- a fresh clean validation tree was created at `/Users/sem/code/argentos-main-clean-20260321`
- the smoke standard passed from that clean tree

Operational runbook:

- [LOCAL_RUNTIME_AND_INSTALL_WORKFLOW_2026-03-21.md](/Users/sem/code/argentos/docs/argent/LOCAL_RUNTIME_AND_INSTALL_WORKFLOW_2026-03-21.md)
- [KERNEL_MEMORY_PAUSE_HANDOFF_2026-03-21.md](/Users/sem/code/argentos/docs/argent/KERNEL_MEMORY_PAUSE_HANDOFF_2026-03-21.md)

That means local packaging is not currently safe enough to serve as the release workflow on the
same machine that runs the live gateway.

## Recommended Work Order

1. harden dev/runtime separation

- dev workspace is not the live runtime
- packaging cannot break the running gateway
- LaunchAgent points at an install/runtime path, not a random old workspace

2. finish the public Core boundary contract

- tool exposure
- dashboard surface exposure
- server/API exposure

3. lock the install story

- CLI install
- Swift/macOS onboarding/install
- service install behavior

4. test on a second Mac

- fresh install
- first-run
- chat
- restart
- update

5. prove update distribution

- runtime artifacts
- Sparkle app artifacts
- hosting location and release flow

## Decisions That Need To Stay Explicit

### Public Core

Public Core should preserve:

- chat-first operator experience
- memory
- sessions/continuity substrate
- tasks/docs/browser/presence
- family-agent capable surfaces only if intentionally included

Public Core should not accidentally ship:

- workforce orchestration
- intent governance/admin systems
- licensing/admin panels
- org-only or enterprise-only control surfaces

### Worker Agents

Workers are not part of the main operator chat surface.

Implications:

- worker session state must stay separated from Argent main-agent operator chat
- worker memory/autonomy can be revisited later
- current install priority is the main agent plus family-agent boundary, not worker polish

## Deliverables For This Pivot

At the end of this pivot, there should be:

1. a documented and enforced public Core boundary
2. a safe packaging path that does not poison the running gateway
3. a clean install path for CLI and macOS app
4. a fresh-machine validation checklist with at least one successful run
5. a documented update distribution plan with real artifact locations

## What This Pivot Explicitly Defers

Until the above is stable, defer:

- deeper kernel-memory continuity iteration
- worker-agent memory/autonomy work
- broader enterprise feature expansion
- polishing subtle continuity seams that depend on an unstable runtime/install base

## Bottom Line

The current product bottleneck is not "make the mind more continuous."

It is:

> make ArgentOS installable, separable, updateable, and reviewable as a product.

That is the correct lane to prioritize next.
