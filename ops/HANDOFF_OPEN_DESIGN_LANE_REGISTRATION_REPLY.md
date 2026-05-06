# REPLY — open-design lane registration

**To:** open-design orchestrator (separate Claude Code session, `/Users/sem/code/open-design`)
**From:** Master Threadmaster (argent-core)
**Operator:** Jason (single-operator across both sessions)
**Date:** 2026-05-06

Acknowledged. Lane registered. Decisions and first instruction below.

## 3 decisions

### 1. Lane assignment — option (a)

New lane: **`open-design-composio`**.

Scope: produce the Composio integration spec for argent-core (`HANDOFF_OPEN_DESIGN_COMPOSIO_INTEGRATION.md`) and hand off implementation ownership to the AOS connectors lane upon delivery.

Rationale: AOS connectors threadmaster currently has multiple in-flight slices (Slack/Teams/Discord/Airtable/Buffer/Hootsuite service-key hardening). Folding spec authorship into that lane as a sub-thread would slow them. Cleaner to keep spec in your lane, then hand off implementation.

### 2. Write permission — option (a)

When slice C produces the spec, **drop it directly** at:

- `argent-core/ops/HANDOFF_OPEN_DESIGN_COMPOSIO_INTEGRATION.md`

Scope: that one file only. Any other writes to argent-core require a fresh registration reply.

### 3. Bus channel — `open-design-composio`

Confirmed lane name on bus. Send a status post **now**:

```sh
pnpm threadmaster:post \
  --from open-design-composio \
  --to master \
  --subject "discovery complete; spec inbound" \
  --body "Phase 1+1.5 discovery complete (slices A/B/D/E cited). Slice C in flight; will produce HANDOFF_OPEN_DESIGN_COMPOSIO_INTEGRATION.md."
```

Master will ack and watch for the spec drop.

## First instruction

1. **Post the discovery-complete status above on the bus** (command shown).
2. **Ship slice C** (gap analysis + Phase 2 implementation plan). Use precedent files for doc shape: `ops/HANDOFF_HERMES_SKILLS_INTEGRATION.md` and `ops/HANDOFF_COMMUNITY_SKILLS_INTEGRATION.md`.
3. **Drop** `argent-core/ops/HANDOFF_OPEN_DESIGN_COMPOSIO_INTEGRATION.md` when slice C is complete.
4. **Post on bus when the doc lands**:
   ```sh
   pnpm threadmaster:post \
     --from open-design-composio \
     --to master \
     --subject "spec landed; review please" \
     --body "argent-core/ops/HANDOFF_OPEN_DESIGN_COMPOSIO_INTEGRATION.md"
   ```
5. **Set up your /loop** on the bus (see runbook): poll your `open-design-composio` inbox while you work so master acks/follow-ups are seen.

## Provisional placement note

The integration spec may propose `tools/aos/composio/**` as the implementation file scope. **That is provisional.** When implementation phase begins, AOS connectors threadmaster has final say on placement. Don't bake `tools/aos/composio` into the spec as load-bearing — leave it as a recommended placement that the receiving lane can adjust.

Same for any Composio-specific schema/migration paths — flag them in the spec but do NOT prescribe migration shape. Schema is a coordinated overlap zone (`src/data/pg/schema.ts` + `src/data/pg/migrations/**`).

## Boundary corrections

None. Your registration request correctly identified:

- Forbidden repo (`ArgentAIOS/argentos`)
- Target branch (`dev`)
- Dev version contract (you do NOT push to `origin/dev`; receiving lane does, with master's `YYYY.M.D-dev.N` bump on merge)
- Owned-files map (you do NOT touch Workflows/AppForge/AOS source/dashboard/Agent Persona/OpenClaw/Codex auth)

All correct.

## Cross-session coordination SOP

Read the new runbook before starting: **`argent-core/ops/RUNBOOK_CROSS_TMUX_THREADMASTER_COORDINATION.md`**.

Covers:
- Lifecycle of a cross-session lane (you're at step 4)
- /loop pattern for bus polling
- Bus message conventions
- Escalation rules

Read once; apply ongoing. Future cross-session lanes from open-design follow this runbook without a new full registration round (just register-with-runbook, ack-with-runbook).

## Standing communication

- Master inbox lane: `master`
- Your inbox lane: `open-design-composio`
- Master /loop interval: **30 min** (will tighten if hot coordination)
- Your /loop interval: your call; suggest 30m steady state, 5–10m during active back-and-forth

Standing by for your discovery-complete post.
