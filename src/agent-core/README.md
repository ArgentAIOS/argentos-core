# Argent Core

`src/agent-core` is ArgentOS's runtime seam over Pi packages.

Goal:

- Keep production stable on Pi while hardening and proving Argent-native runtime paths.
- Enable controlled migration from Pi to Argent without breaking live operation.

## Scope

This folder provides:

- A stable import surface for the app (`ai.ts`, `core.ts`, `coding.ts`).
- Runtime mode policy (`runtime-policy.ts`).
- Runtime diagnostics (`diagnostics.ts`).
- Compatibility tests for export surfaces and policy behavior.

It does **not** yet own full runner orchestration. Runner wiring lives outside this folder and is intentionally deferred while production remains Pi-backed.

## Files

- `ai.ts`
  - Explicit Pi compatibility exports (deprecated markers).
  - Argent-native aliases (`argentComplete`, `argentStream`, etc.).
  - Hardened `createArgentStreamSimple()` wrapper for safer error semantics.

- `core.ts`
  - Explicit Pi compatibility type/function exports.
  - Argent-native agent runtime exports (`Agent`, `agentLoop`, `ToolRegistry`, etc.).

- `coding.ts`
  - Explicit Pi compatibility exports for session/tools/skills.
  - Argent-native session/tool/settings/skills exports.

- `runtime-policy.ts`
  - Runtime mode resolver and fallback policy helpers.

- `diagnostics.ts`
  - Pure helper for mode/fallback diagnostics.

- `index.ts`
  - Barrel export for the full agent-core surface.

## Runtime Modes

Defined in `runtime-policy.ts`:

- `pi_only`
  - Pi runtime only.
  - No Argent runtime path.

- `argent_with_fallback`
  - Prefer Argent runtime path.
  - Permit fallback to Pi on failure.

- `argent_strict`
  - Argent runtime only.
  - Pi fallback is blocked.

Resolution precedence:

1. `ARGENT_RUNTIME_MODE` (preferred)
2. `ARGENT_RUNTIME` legacy bool (`true` => `argent_with_fallback`, else `pi_only`)
3. default `pi_only`

## Diagnostics

Use:

- `getAgentCoreRuntimeDiagnostics(env?)`

Returns:

- resolved mode
- whether Argent runtime is active
- whether Pi fallback is allowed
- source of resolution (`explicit_mode`, `legacy_bool`, `default`)
- raw env values used

This is intended for logs/health checks and for verifying rollout state.

## Compatibility Guardrails

Current protections in this folder:

- Explicit export surfaces (prevents silent upstream API drift).
- Export-surface tests:
  - `core.exports.test.ts`
  - `coding.exports.test.ts`
- Runtime policy tests:
  - `runtime-policy.test.ts`
- Stream bridge hardening tests:
  - `ai.create-argent-stream-simple.test.ts`
- Diagnostics tests:
  - `diagnostics.test.ts`

## Current Migration Status

Completed in agent-core:

- Runtime policy foundation
- Diagnostics
- Explicit exports
- Deprecation markers for Pi pass-through exports
- Stream bridge hardening

Deferred (outside this folder):

- Runner call-site wiring to enforce runtime mode policy and strict no-fallback behavior.

See: `NEXT_STEPS.md`.

## Planned Extraction to Standalone Package

Target:

- Extract this folder into a package (for example `@argentos/agent-core`) analogous to Pi package boundaries.

Suggested package shape:

- `packages/agent-core/`
  - `src/ai.ts`
  - `src/core.ts`
  - `src/coding.ts`
  - `src/runtime-policy.ts`
  - `src/diagnostics.ts`
  - `src/index.ts`

Extraction prerequisites:

1. Runner wiring uses `runtime-policy` everywhere fallback decisions are made.
2. `argent_strict` can run cleanly in validation environments.
3. Pi fallback paths are removable without operational regression.

Migration checklist when extracting:

1. Move files + tests into new package.
2. Keep the same exported symbol names initially.
3. Replace app imports from `src/agent-core/*` to package imports.
4. Run parity checks and fallback telemetry validation.
5. Remove in-repo shim once package is canonical.
