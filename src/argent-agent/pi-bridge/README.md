# `pi-bridge` — single import point for pi-ai / pi-coding-agent / pi-agent-core

**Tracking issue:** [#286](https://github.com/ArgentAIOS/argentos-core/issues/286)
**Origin / proof:** [#182 breakage catalog](https://github.com/ArgentAIOS/argentos-core/issues/182), [PR #275 (forwarded-type pattern)](https://github.com/ArgentAIOS/argentos-core/pull/275)

## Why this exists

Every pi-ai bump (e.g. #182) costs multi-day effort because argent imports
pi's _internal types_ at ~30 sites instead of going through a stable surface.
Each internal pi refactor — private constructors, removed methods, the
typebox 0.34 → 1.x switch, `BashExecutionMessage.content` removal, etc. —
breaks every cast in argent.

`pi-bridge` is the **single import point** for everything argent uses from
`@mariozechner/pi-ai`, `@mariozechner/pi-coding-agent`, and
`@mariozechner/pi-agent-core`. When pi changes, only this module needs to
adapt — not 30+ call sites.

PR #275 (pi-types unify) was a partial start: forwarded `AgentMessage`,
`StreamFn`, `CustomAgentMessages` directly from pi-agent-core. The result —
baseline 267 → 249 TS errors, 18 retired entries stayed retired — proves the
pattern works. The bridge generalizes it across the rest of the surface.

## Migration policy

**Hard rule for new code:**

> Any code that needs a type or value from `@mariozechner/pi-ai`,
> `@mariozechner/pi-coding-agent`, or `@mariozechner/pi-agent-core` MUST
> import it from `argent-agent/pi-bridge`. If the bridge doesn't expose what
> you need, add the re-export here (see below) — don't reach into pi directly.

**Legacy direct imports** (the ~30 sites surveyed in #182) are tracked as
sub-issues to #286 for incremental migration. As each cluster migrates, the
follow-up issue is closed and the bridge gains one more proven export.

This file is the **foundation**: it implements the pattern end-to-end with
the small set of re-exports already proven by PR #275 plus
`AuthStorage` / `ModelRegistry` factories that hide the pi 0.73+
private-constructor drift.

## Adding a new re-export

When you need a pi symbol that isn't already exposed:

1. **Pick the right file.** Use `./types.ts` for pure type re-exports.
   Use a sibling module (`./auth-storage.ts`, etc.) when the export needs a
   value wrapper, a factory helper, or any drift-absorbing logic.
2. **Re-export, don't re-define.** Prefer `export type { Foo } from
"@mariozechner/pi-agent-core"` over copying the type. Local copies drift.
3. **Wrap factories, not constructors.** If pi exposes a public constructor
   today that may go private tomorrow, expose a `createFoo(...)` helper here
   so call sites are forward-compatible.
4. **Surface in `./index.ts`.** Add the re-export to `index.ts` with a brief
   comment explaining the drift it absorbs.
5. **Document the migration.** If you're migrating an existing site, note it
   in the relevant #286 sub-issue so we can track the surface coverage.

## Currently exported

- **Types:** `AgentMessage`, `StreamFn`, `CustomAgentMessages` (proved by
  PR #275 — see `./types.ts`); `Transport` (#306 — see `./transport.ts`).
- **Values + factories:** `AuthStorage` + `createAuthStorage(path)`,
  `ModelRegistry` + `createModelRegistry(authStorage, path)`,
  `supportsXhigh(model)` wrapper (#306 — see `./supports-xhigh.ts`).
- **Mappers:** `mapSessionCompactionResult` (#303), `bridgeToolParameters`
  - `Type`, `TSchema`, `Static`, `Tool`, `Context` typebox identities (#305).

## What's not here yet (tracked follow-ups under #286)

- `AgentSession` structural type for call sites that cast `as AgentSession`
  (4+ sites today — affected by pi 0.73's 78-new-private-members drift).
- `Agent.replaceMessages` callers (4 sites; method removed in pi 0.73+).
- `BashExecutionMessage.content` callers (7 sites; field removed).

These are the clusters that block #182. Each will become a sub-issue under
#286 and migrate to this module as the bridge expands.
