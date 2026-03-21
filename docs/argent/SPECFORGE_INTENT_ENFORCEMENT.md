# SpecForge + Intent Enforcement

## Purpose

This document defines how SpecForge and Intent currently work in ArgentOS, what is enforced today, what is advisory, and how to operate it in strict mode without ambiguity.

## Scope

This is the runtime behavior for:

- SpecForge workflow orchestration
- Intent hierarchy validation
- Intent runtime/simulation gating
- Chat-time routing into SpecForge
- Tool visibility/policy interactions

## Core Components

- SpecForge state machine:
  - `src/infra/specforge-conductor.ts`
- SpecForge session persistence (PG):
  - `src/infra/specforge-session-store.ts`
- SpecForge tool:
  - `src/agents/tools/specforge-tool.ts`
- Tool registration:
  - `src/agents/argent-tools.ts`
- Tool policy/filtering:
  - `src/agents/pi-tools.policy.ts`
  - `src/agents/tool-policy.ts`
- Chat routing directive:
  - `src/gateway/server-methods/chat.ts`
- Intent resolution + monotonic inheritance validation:
  - `src/agents/intent.ts`
- Intent simulation/runtime gate:
  - `src/agents/intent-runtime-gate.ts`
  - `src/agents/pi-embedded-runner/run/attempt.ts`

## What Intent Enforces vs Does Not Enforce

### Enforced by Intent

- Hierarchy monotonicity (parent/child constraints) when `intent.validationMode=enforce`
- Simulation gate blocking when `intent.simulationGate.mode=enforce` and thresholds fail
- Runtime prompt policy injection when `intent.runtimeMode` is not `off`

### Not Enforced by Intent (Current)

- Mandatory selection of a specific tool (for example, forcing `specforge` before any response)
- Hard fail-closed behavior if a model ignores tool-use guidance

Intent is a policy/validation layer. Tool-selection hard guarantees require deterministic routing logic outside the current intent checker.

## SpecForge Runtime Behavior

## Tool Contract

Tool name: `specforge`

Actions:

- `handle`:
  - Input: user message
  - Effect: advances/starts strict workflow state machine
- `status`:
  - Effect: returns current stage and whether a session is active
- `exit`:
  - Effect: clears current SpecForge guide session state

## Trigger + Routing

When chat receives a development-intent message, the gateway appends a directive instructing the model to call `specforge` with:

```json
{ "action": "handle", "message": "<exact user message>" }
```

This routing is generated in `chat.send` and passed via `BodyForAgent`/`BodyForCommands`.

## Stage Machine (Strict Order)

Stages:

1. `project_type_gate`
2. `intake_interview`
3. `draft_review`
4. `awaiting_approval`
5. `approved_execution`

The workflow blocks forward progress when prerequisites are missing (for example, incomplete intake, missing explicit approval).

## Methodology Doc Binding

At kickoff/resume, SpecForge attempts to bind/open these canonical methodology docs in DocPane:

- `47d651f8-d28e-4a1f-8e59-ad3fb7392d71`
- `1f07086c-6293-4ea1-a889-86b881975021`
- `a24b27e0-374f-4a03-827b-18984ccfcf30`

These are treated as workflow contract references for the interview/execution flow.

## Configuration and Flags

## Intent Config (argentos config)

```json
{
  "intent": {
    "enabled": true,
    "validationMode": "enforce",
    "runtimeMode": "enforce",
    "simulationGate": {
      "enabled": true,
      "mode": "enforce"
    }
  }
}
```

## SpecForge Environment Flags

- `ARGENT_SPECFORGE_AUTOSCAFFOLD`
  - `1`: enables autoscaffold path
  - unset/`0`: strict guide mode path
- `ARGENT_DASHBOARD_API`
  - dashboard endpoint used for doc binding/open actions

## Tool Policy Considerations

Even if `specforge` is registered, it may disappear from an agent's effective toolbelt due to policy/profile filtering:

- global tool policy
- agent-specific tool policy
- provider-specific tool policy
- group policy
- subagent policy
- sandbox policy

If missing in runtime, inspect effective policy chain first.

## Operational Guidance (Current Best Practice)

For maximum reliability now:

1. Set Intent to strict:

- `validationMode=enforce`
- `runtimeMode=enforce`
- `simulationGate.mode=enforce` (if gate thresholds are configured)

2. Keep `specforge` allowed in effective tool policy.
3. Start project requests with explicit development intent language (`I need to build...`, `We need to add feature...`) to guarantee trigger detection.
4. Confirm first response includes/reflects stage `project_type_gate` and asks greenfield vs brownfield.

## Verification Commands

Gateway HTTP tool checks (requires valid gateway auth token):

```bash
curl -X POST http://127.0.0.1:18789/tools/invoke \
  -H "content-type: application/json" \
  -H "authorization: Bearer <TOKEN>" \
  --data '{"tool":"specforge","action":"status","sessionKey":"main"}'
```

```bash
curl -X POST http://127.0.0.1:18789/tools/invoke \
  -H "content-type: application/json" \
  -H "authorization: Bearer <TOKEN>" \
  --data '{"tool":"specforge","action":"handle","sessionKey":"main","args":{"message":"I need to build a new coding project"}}'
```

## Known Limitation

Current architecture is still directive-driven at chat layer for tool invocation. It is not yet hard fail-closed on "model replied without calling `specforge`".

To achieve true hard guarantee, add deterministic gateway pre-dispatch execution (`specforge.handle`) for matched dev-intent messages and fail request if pre-dispatch step fails.

## Status

- First-class `specforge` tool: implemented
- Strict stage machine + PG session persistence: implemented
- Intent validation/runtime/simulation enforcement: implemented
- Hard fail-closed mandatory tool invocation: not yet implemented
