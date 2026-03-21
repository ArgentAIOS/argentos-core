# ARGENT — Consciousness Kernel Integration Plan

> Integration plan for adding a continuous executive layer to the current ArgentOS runtime.
>
> Part of **ArgentOS** — https://argentos.ai

**Date:** 2026-03-19
**Status:** Draft

---

## Purpose

This plan integrates the Consciousness Kernel into the current ArgentOS stack centered on [server.impl.ts](/Users/sem/code/argentos/src/gateway/server.impl.ts), [contemplation-runner.ts](/Users/sem/code/argentos/src/infra/contemplation-runner.ts), [sis-runner.ts](/Users/sem/code/argentos/src/infra/sis-runner.ts), [heartbeat-runner.ts](/Users/sem/code/argentos/src/infra/heartbeat-runner.ts), [ConfigPanel.tsx](/Users/sem/code/argentos/dashboard/src/components/ConfigPanel.tsx), and the browser-side state surfaces in [useAgentState.ts](/Users/sem/code/argentos/dashboard/src/hooks/useAgentState.ts).

The goal is not to replace the gateway. The goal is to add one persistent executive that owns autonomy for the main agent while reusing the existing memory, delivery, routing, tooling, and observability systems.

## Architectural End State

The intended steady-state architecture is:

- `gateway`: control plane, tools, channels, storage, models, sessions, delivery
- `kernel service`: continuous executive for Argent only
- `Swift app`: lifecycle container and local device host
- `embedded browser host`: mic, camera, and browser TTS sidecar

This split avoids two common failure modes:

- putting the mind inside the UI lifecycle
- leaving multiple background schedulers competing for the same agent

## Non-Negotiable Rules

- kernel is for the default main agent only
- when kernel is enabled, it is the only autonomous scheduler
- contemplation and SIS must not remain co-equal autonomous timers
- kernel survives loss of UI or hardware host
- host loss triggers blind mode, not kernel death
- observability and testability ship with the runtime
- browser TTS remains the voice-output path

## Current Brownfield Anchors

The integration should explicitly build on existing runtime surfaces.

### Existing Runtime Services

- [server.impl.ts](/Users/sem/code/argentos/src/gateway/server.impl.ts) already starts gateway background systems
- [contemplation-runner.ts](/Users/sem/code/argentos/src/infra/contemplation-runner.ts) provides reflective autonomy and episode capture
- [sis-runner.ts](/Users/sem/code/argentos/src/infra/sis-runner.ts) provides consolidation and lesson extraction
- [heartbeat-runner.ts](/Users/sem/code/argentos/src/infra/heartbeat-runner.ts) provides periodic monitoring and operational review
- [execution-worker-runner.ts](/Users/sem/code/argentos/src/infra/execution-worker-runner.ts) provides background task execution

### Existing State and Observability

- [redis-agent-state.ts](/Users/sem/code/argentos/src/data/redis-agent-state.ts) mirrors live state for dashboard use
- [diagnostic-events.ts](/Users/sem/code/argentos/src/infra/diagnostic-events.ts) already provides a structured diagnostic event bus
- [health.ts](/Users/sem/code/argentos/src/commands/health.ts) and [server-health-checks.ts](/Users/sem/code/argentos/src/gateway/server-health-checks.ts) already define health-reporting patterns
- the existing Observability tab in [ConfigPanel.tsx](/Users/sem/code/argentos/dashboard/src/components/ConfigPanel.tsx) is the correct operator surface for kernel health and alerts

### Existing Hardware and Voice Surfaces

- [AudioDeviceSelector.tsx](/Users/sem/code/argentos/dashboard/src/components/AudioDeviceSelector.tsx) and [App.tsx](/Users/sem/code/argentos/dashboard/src/App.tsx) already manage browser-side audio devices
- browser TTS already exists in [useTTS.ts](/Users/sem/code/argentos/dashboard/src/hooks/useTTS.ts)
- the macOS app already acts as a host and should remain the lifecycle container rather than becoming the kernel itself

## Phase 0 — Define Contracts

Before implementation, define the contracts that make the runtime governable.

Required deliverables:

- kernel config block under agent defaults
- durable self-state schema
- kernel wakefulness and transition contract
- hardware-host contract for embedded browser host communication
- kernel event taxonomy
- kernel health snapshot shape
- operator alert model

Questions to resolve in this phase:

- where durable self-state is persisted
- what is mirrored into Redis versus kept durable only
- how kernel decisions are journaled for replay and inspection
- how host attachment and permissions are represented

Exit criteria:

- all interfaces documented
- ownership boundaries clear
- no unresolved ambiguity about who owns autonomy when the kernel is enabled

## Phase 1 — Add Kernel Config and Main-Agent-Only Guardrails

Introduce configuration and runtime rules before behavior.

### Config Surface

Add a dedicated kernel section to the agent defaults configuration, exposed through [types.agent-defaults.ts](/Users/sem/code/argentos/src/config/types.agent-defaults.ts) and surfaced in [ConfigPanel.tsx](/Users/sem/code/argentos/dashboard/src/components/ConfigPanel.tsx).

Suggested fields:

- `enabled`
- `mode` (`off`, `shadow`, `soft`, `full`)
- `localModel`
- `tickMs`
- `maxEscalationsPerHour`
- `dailyBudget`
- `hardwareHostRequired`
- `allowListening`
- `allowVision`

### Main-Agent Restriction

Enforce at runtime, not just in UI:

- resolve target agent through the default-agent path
- reject kernel startup for family agents
- hide or disable the kernel section outside the main-agent context

Exit criteria:

- the kernel can be configured only for Argent
- turning the kernel on changes runtime behavior only for the main agent

## Phase 2 — Implement Durable Self-State

Create a canonical self-state store.

This store should not be Redis-first. Redis remains useful for hot mirroring, but the durable self-state must survive restarts, service crashes, and UI detachment.

Suggested self-state domains:

- identity continuity metadata
- wakefulness state
- drives and last satisfaction times
- mood and arousal
- active concerns
- recent interaction summary
- budget and escalation counters
- perception state
- current hardware-host capability state
- recent decision summary
- last successful persistence timestamp

Exit criteria:

- kernel restart preserves meaningful continuity
- Redis reflects current state without becoming the source of truth

## Phase 3 — Build the Shadow Kernel In-Process

Prototype the kernel inside the gateway runtime first.

Behavior in shadow mode:

- continuous low-cost ticking
- self-state load and persist
- drive accumulation
- wakefulness transitions
- action selection
- model-escalation decisions
- decision logging

Behavior forbidden in shadow mode:

- no speech
- no outbound proactive delivery
- no execution worker dispatch
- no task mutation

Purpose:

- validate scheduling
- validate state persistence
- validate drive behavior
- validate cost profile
- validate decision quality before the kernel is allowed to act

Exit criteria:

- stable multi-day shadow operation
- coherent decision traces
- no runaway loops
- no duplicate autonomy alongside legacy timers

## Phase 4 — Invert Contemplation and SIS Under Kernel Authority

Once the kernel can tick and reason safely, remove co-equal scheduling.

### Contemplation

[contemplation-runner.ts](/Users/sem/code/argentos/src/infra/contemplation-runner.ts) should stop functioning as an independent timer when the kernel is enabled. It becomes a reflective service or mode invoked by kernel pressure.

### SIS

[sis-runner.ts](/Users/sem/code/argentos/src/infra/sis-runner.ts) should stop behaving as a parallel autonomous authority. It becomes a consolidation service selected by the kernel when knowledge-integration pressure justifies it.

### Heartbeat

[heartbeat-runner.ts](/Users/sem/code/argentos/src/infra/heartbeat-runner.ts) can remain semi-independent during transition, but long term it should also be subordinate or kernel-managed to avoid scheduler conflict.

Exit criteria:

- kernel becomes the only autonomous scheduler
- contemplation and SIS run only through kernel invocation when enabled
- disabling kernel restores current legacy behavior

## Phase 5 — Define the Hardware-Host Contract

Because browser TTS is the chosen output lane, the kernel should not talk directly to hardware. It should talk to an authorized hardware host.

### Hardware-Host Responsibilities

The embedded browser host should:

- enumerate mic and camera devices
- own browser permissions
- capture snapshots on request
- run allowed browser-side media collection flows
- provide browser TTS
- report host heartbeat and capability state to the kernel

### Kernel Responsibilities

The kernel should:

- know which host is attached
- know whether it is allowed to listen or see
- request perception metadata, not raw continuous media
- request browser TTS output when policy allows
- enter blind mode if the host is missing

### Hardware Profile

The hardware profile should be main-agent-only and include:

- selected microphone
- selected camera
- listening enabled
- vision enabled
- host attached or detached
- permission state
- last host heartbeat

Exit criteria:

- host attach and detach are explicit
- blind mode is automatic and observable
- no audible or perceptual actions occur without an authorized host

## Phase 6 — Add Wakefulness, Drives, and Action Arbitration

After authority and embodiment are in place, add the executive behavior that makes the kernel useful.

### Wakefulness

The kernel should own explicit states such as:

- dormant
- reflective
- attentive
- engaged

### Drives

Minimum drive set:

- continuity
- relational
- knowledge integration
- environmental awareness
- exploration
- self-care

### Initial Autonomous Actions

Initial actions should be conservative:

- reflect
- consolidate
- research
- form a hypothesis
- draft a plan
- create or queue tasks
- request execution worker action
- request higher-tier reasoning

Exit criteria:

- action selection is explainable
- local reasoning is the default
- escalation is deliberate rather than frequent

## Phase 7 — Add Kernel Observability

The kernel should plug into the existing observability stack rather than create a shadow control plane.

### Required Surfaces

- health snapshot integration through [health.ts](/Users/sem/code/argentos/src/commands/health.ts)
- periodic checks through [server-health-checks.ts](/Users/sem/code/argentos/src/gateway/server-health-checks.ts)
- structured event output through [diagnostic-events.ts](/Users/sem/code/argentos/src/infra/diagnostic-events.ts)
- operator display through the Observability tab in [ConfigPanel.tsx](/Users/sem/code/argentos/dashboard/src/components/ConfigPanel.tsx)

### Required Metrics

- kernel enabled and mode
- current wakefulness
- last tick and tick lag
- last successful self-state persist
- state transitions per hour
- no-op ticks
- decision counts by type
- local versus escalated reasoning counts
- failed escalations
- blind mode status and reason
- host attachment status
- deferred or held deliveries
- critical alerts

### Decision Ledger

Add a durable append-only decision ledger for:

- tick summaries
- chosen action
- reason chain
- model escalation decision
- delivery routing decision
- blocked or suppressed actions

Exit criteria:

- operator can answer what the kernel is doing, why it chose it, and whether it is healthy

## Phase 8 — Add Testing and Failure Injection

The kernel should ship with test coverage appropriate to a continuous runtime.

### Required Test Categories

- state-machine tests with fake time
- self-state persistence and recovery tests
- config toggle tests
- main-agent-only enforcement tests
- hardware-host contract tests
- blind-mode tests
- decision-ledger contract tests
- shadow-mode replay tests
- overnight soak tests
- failure-injection tests for host loss, model failure, persistence failure, and budget exhaustion

### Existing Testing Anchors

Follow the style of:

- [heartbeat-runner.scheduler.test.ts](/Users/sem/code/argentos/src/infra/heartbeat-runner.scheduler.test.ts) for deterministic scheduling
- [sis-runner.test.ts](/Users/sem/code/argentos/src/infra/sis-runner.test.ts) for structured contract and metrics verification
- [critical-observability.test.ts](/Users/sem/code/argentos/src/commands/critical-observability.test.ts) for alert behavior

Exit criteria:

- kernel behavior is reproducible under replay
- degraded behavior is safe and explainable
- alerting has low false-positive rates

## Phase 9 — Extract to a Dedicated Local Service

Once the in-process prototype has proven its authority model and safety properties, extract the kernel into its own local service.

This is the preferred long-term architecture because:

- the kernel should not depend on dashboard lifecycle
- the kernel should not be disrupted by gateway reload churn
- the kernel should have one clear process and one clear owner

The gateway remains the platform runtime. The kernel becomes the continuous executive that consumes gateway services and host signals.

Exit criteria:

- kernel can be supervised independently
- gateway and kernel can restart independently without semantic corruption
- self-state remains durable across process boundaries

## Rollout Modes

Rollout should happen in four operator-visible modes.

### Mode 1 — Off

Legacy behavior only.

### Mode 2 — Shadow

Kernel thinks, tracks, and logs, but cannot act.

### Mode 3 — Soft Autonomy

Kernel may reflect, research, draft, and queue work, but cannot proactively speak or deliver outwardly.

### Mode 4 — Full Autonomy

Kernel may route through approved delivery channels and browser TTS under operator policy and hardware-host availability.

Promotion between modes should require soak validation and observability review.

## Suggested Implementation Sequence

### Weeks 1-2

- define contracts
- add config and main-agent-only guardrails
- define durable self-state

### Weeks 3-4

- build in-process shadow kernel
- add decision ledger
- add initial health and observability surfaces

### Weeks 5-6

- wire dashboard controls
- add host contract and hardware profile
- implement blind mode

### Weeks 7-8

- subordinate contemplation and SIS
- begin kernel-owned wakefulness and drive logic

### Weeks 9-10

- add action arbitration
- add model escalation policy
- enable soft-autonomy rollout

### Weeks 11-12

- expand monitoring
- run soak and failure-injection tests
- prepare dedicated service extraction

## Final Integration Standard

The integration is complete when enabling the kernel creates one continuously alive executive for Argent, disables competing autonomous schedulers, preserves continuity through durable self-state, uses the browser-hosted mic and camera safely, exposes clear health and reasoning telemetry, and allows the operator to trust both its behavior and its failure modes.

That is the standard that distinguishes a background-capable agent platform from a continuously present personal AI operating system.
