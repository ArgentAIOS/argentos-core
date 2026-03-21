# Agent Core Next Steps

## Completed (2026-02-18)

1. Runtime policy foundation

- Added `runtime-policy.ts` with explicit modes:
  - `pi_only`
  - `argent_with_fallback`
  - `argent_strict`
- Added strict helper: `assertPiFallbackAllowed()`.
- Added tests: `runtime-policy.test.ts`.

2. Safer Argent stream bridge surface

- Hardened `createArgentStreamSimple()` in `ai.ts` so stream iterator failures are converted into structured assistant `error` outcomes.
- Added normalization for malformed tool-call arguments.
- Added tests: `ai.create-argent-stream-simple.test.ts`.

3. Explicit export surfaces (no wildcard passthroughs)

- Replaced wildcard exports in:
  - `ai.ts`
  - `core.ts`
  - `coding.ts`
- Added compatibility tests:
  - `core.exports.test.ts`
  - `coding.exports.test.ts`

4. Pi-pass-through deprecation markers

- Added `@deprecated` guidance on Pi compatibility exports in `ai.ts`, `core.ts`, and `coding.ts`.
- Runtime behavior intentionally unchanged.

5. Runtime diagnostics helper

- Added `diagnostics.ts` and `diagnostics.test.ts`.
- Exposed via `index.ts`.
- `getAgentCoreRuntimeDiagnostics()` reports:
  - resolved mode
  - whether Argent runtime is active
  - whether Pi fallback is allowed
  - resolution source (`explicit_mode`, `legacy_bool`, `default`)

## Deferred (Requires Runner-Side Edits)

Status: deferred intentionally to keep live Pi runtime stable.

Task:

- Wire `resolveAgentCoreRuntimeMode()` and `assertPiFallbackAllowed()` into runner fallback call sites.
- Replace ad-hoc boolean checks with policy resolver results.
- Enforce `argent_strict` as "no silent Pi fallback".

Why deferred:

- Runner integration touches files outside `src/agent-core`.
- Current production requirement is uninterrupted Pi-backed operation.

Safe rollout order when resumed:

1. Enable policy in runner with `argent_with_fallback` only.
2. Observe fallback/error metrics and parity tests.
3. Switch selected paths to `argent_strict`.
4. Remove Pi fallback paths.
5. Remove Pi dependencies.
6. Split `src/agent-core` into a standalone package.

Owner intent:

- Do not cut over abruptly.
- Keep Pi as active safety net until strict mode is proven clean.
