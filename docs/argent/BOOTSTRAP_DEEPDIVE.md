# BOOTSTRAP Continuity Deep-Dive

**Mode:** read-only investigation (no code, no workspace, no service changes).
**Commit status:** uncommitted — for operator review only.
**Investigator:** `bootstrap-investigator` (team `argent-deepdive`), 2026-04-23.

Operator context: workspace at `/Users/sem/.argentos/workspace/` currently
contains a populated `IDENTITY.md`, `USER.md`, `SOUL.md`, etc., PLUS a
`BOOTSTRAP.md` that still says "delete me when you're done." MemU holds ~34K
observations and ~1.2K entities. The suspicion: BOOTSTRAP.md is a continuity
hook, not just onboarding copy. Findings below say _mostly no_ — it's
onboarding copy plus one trivial system-prompt side-effect — but the real
continuity story lives elsewhere and is worth documenting.

---

## Q1. What does `resolveBootstrapContextForRun()` inject, per source?

**Entry point:** `src/agents/bootstrap-files.ts:1184-1207`.

It calls `resolveBootstrapFilesForRun()` (`:1077-1173`), then feeds the result
through `buildBootstrapContextFiles()` (`src/agents/pi-embedded-helpers/bootstrap.ts:162-191`),
which trims each file to `resolveBootstrapMaxChars()` (default 20 000 chars
per file — more on this in Q4).

The bootstrap file set is built in two layers:

### Layer 1 — Workspace files read verbatim from disk

Loaded by `loadWorkspaceBootstrapFiles(dir)` at
`src/agents/workspace.ts:394-456`. These are raw `fs.readFile` reads; any file
that doesn't exist becomes a `{ missing: true }` stub:

| File                      | Source on disk                                                                                   |
| ------------------------- | ------------------------------------------------------------------------------------------------ |
| `AGENTS.md`               | `<workspace>/AGENTS.md` (workspace.ts:402-404)                                                   |
| `SOUL.md`                 | `<workspace>/SOUL.md` (workspace.ts:406-408)                                                     |
| `TOOLS.md`                | `<workspace>/TOOLS.md` (workspace.ts:410-412)                                                    |
| `IDENTITY.md`             | `<workspace>/IDENTITY.md` (workspace.ts:414-416)                                                 |
| `USER.md`                 | `<workspace>/USER.md` (workspace.ts:418-420)                                                     |
| `HEARTBEAT.md`            | `<workspace>/HEARTBEAT.md` (workspace.ts:422-424)                                                |
| `CONTEMPLATION.md`        | `<workspace>/CONTEMPLATION.md` (workspace.ts:426-428)                                            |
| `BOOTSTRAP.md`            | `<workspace>/BOOTSTRAP.md` (workspace.ts:430-432)                                                |
| `WORKFLOWS.md`            | `<workspace>/WORKFLOWS.md` (workspace.ts:434-436)                                                |
| `MEMORY.md` / `memory.md` | `<workspace>/MEMORY.md` or lowercase (workspace.ts:439 → resolveMemoryBootstrapEntries :357-392) |

After load, results are filtered through:

- `filterBootstrapFilesForSession()` (`workspace.ts:458-468`) — for subagent
  session keys, only `AGENTS.md` and `TOOLS.md` survive
  (`SUBAGENT_BOOTSTRAP_ALLOWLIST` at :458). Regular chat sees everything.
- `applyBootstrapHookOverrides()` (`bootstrap-files.ts:1096-1103`) —
  user-installed hooks from `bootstrap-hooks.ts` may transform entries.

### Layer 2 — Synthesised files appended after workspace load

All appended in `resolveBootstrapFilesForRun()` at
`bootstrap-files.ts:1105-1170`, in this order:

| Virtual file                      | Generator                                                                                                                                                       | Source of content                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FIRST_RUN.md`                    | `buildFirstRunBootstrapFile()` `:37-244`                                                                                                                        | **Hardcoded string** (the 232-line "awakening / discovery / imprint / naming / connection" script starting at :74). Only injected when MemU `getStats().items === 0` AND `listEntities()` is empty AND `~/.argentos/first-run-complete` marker is missing (:44-63). Once either condition fails, a sentinel file `~/.argentos/first-run-complete` is written so it stays suppressed. Operator's marker is present → this file is **never** injected in practice. |
| `RECENT_CONTEXT.md`               | `buildRecentMemoryFile()` `:251-287`                                                                                                                            | **MemU**. `store.listItems({ limit: 15 })` — last 15 rows from the memory adapter (effectively `~/.argentos/memory.db`).                                                                                                                                                                                                                                                                                                                                         |
| `IDENTITY_CONTEXT.md`             | `buildIdentityContextBootstrapFile()` `:294-306` → `buildIdentityContextFile` in `src/memory/identity/self-model.ts:181-205` → `buildDynamicIdentity` `:87-169` | **MemU**, not workspace. Pulls top 10 `memoryType='self'` items by significance/recency (:91-99), top 5 entities by bond strength (:112-123), up to 10 recent lessons from self-memories + reflections (:126-146), and the latest reflection (:157-166). Workspace `IDENTITY.md` is _never_ consulted by this generator.                                                                                                                                         |
| `ACCOUNTABILITY_STATUS.md`        | `buildAccountabilityContextFile()` `:701-823`                                                                                                                   | `<workspace>/memory/heartbeat-score.json` + optional `heartbeat-last-feedback.json` (:703-805). Disk-only, no MemU.                                                                                                                                                                                                                                                                                                                                              |
| `RECENT_CONTEMPLATION.md`         | `buildRecentContemplationFile()` `:522-635`                                                                                                                     | `<workspace>/memory/contemplation/*.jsonl` — tail-reads the latest 5 episode entries from the most recent contemplation journal files (:528-564).                                                                                                                                                                                                                                                                                                                |
| `SIS_CONTEXT.md`                  | `buildSisContextFile()` `:642-694`                                                                                                                              | `<workspace>/memory/sis/<YYYY-MM-DD>.md` — today's, falls back to yesterday's (:646-672). Takes the last 3 `---`-separated blocks.                                                                                                                                                                                                                                                                                                                               |
| `RECENT_CHANNEL_CONVERSATIONS.md` | `buildRecentChannelConversationsFile()` `:356-515`                                                                                                              | **`~/.argentos/agents/main/sessions/*.jsonl`** — not workspace. Scans the last 24 h of session transcripts (non-contemplation, non-SIS, non-cron), tail-reads large files (:404-409), filters out heartbeat/nudge/system lines (:444-451), dedupes, keeps last 20 user/assistant exchanges. `operatorName` is pulled from workspace `USER.md` via a regex list (:337-346).                                                                                       |
| `LIVE_INBOX_LEDGER.md`            | `buildLiveInboxLedgerFile()` `:995-1013`                                                                                                                        | **MemU** via `buildLiveInboxLedger({ store, maxItems: 20 })` from `src/memory/live-inbox/ledger.ts` — "promoted truths" for compaction-safe grounding.                                                                                                                                                                                                                                                                                                           |
| `KERNEL_CONTINUITY.md`            | `buildKernelContinuityFile()` `:874-988`                                                                                                                        | Consciousness-kernel persisted state at `resolveConsciousnessKernelPaths().statePath` (on disk under `~/.argentos/…/kernel/state.json`). Only emitted for the default agent (:879-881). Bulk of the ~45 labelled lines come from `selfState.conversation.*`, `selfState.agency.*`, `selfState.agenda.*`, `selfState.activeWork.*`, `selfState.backgroundWork.*`.                                                                                                 |
| `SESSION_SNAPSHOT.md`             | `buildSessionSnapshotFile(agentId)` `:829-867`                                                                                                                  | `~/.argentos/agents/<agentId>/session-snapshot.json`, loaded via `loadSessionSnapshot()` (`src/agents/session-snapshot.ts:55-68`). Dropped if older than 24 h (:836).                                                                                                                                                                                                                                                                                            |
| `TTS_POLICY.md`                   | `buildTtsPolicyFile()` `:1029-1075`                                                                                                                             | **Hardcoded string** — the "[TTS:...]" rules. Injected unconditionally with `path: "<system-enforced>"` so the model can't overwrite it.                                                                                                                                                                                                                                                                                                                         |

Every appended file is wrapped as `WorkspaceBootstrapFile` with `path: "<auto-generated>"` (or `<system-enforced>`) so downstream tooling knows it isn't on disk.

**Bootstrap cache:** results are memoised for 60 s per `workspaceDir + sessionKey` (`bootstrap-files.ts:1181-1207`). That means two chat turns inside the same minute share the same injection blob. `clearBootstrapContextCache()` exists (`:1210-1212`) but no current code seems to call it proactively — alignment doc edits will be visible up to 60 s late.

### Call sites

- Main chat: `src/agents/pi-embedded-runner/run/attempt.ts:582-588` (with `makeBootstrapWarn` telemetry).
- Compaction restart: `src/agents/pi-embedded-runner/compact.ts:219-225`.
- CLI: `src/agents/cli-runner.ts:76-82`.
- Context report: `src/auto-reply/reply/commands-context-report.ts:61-67` (diagnostic, no chat).

---

## Q2. Is there a chat-to-chat continuity mechanism wired through the workspace files?

**Short answer:** There is continuity, but `BOOTSTRAP.md` is not the carrier.
The workspace file `BOOTSTRAP.md` has _no_ state-machine semantics. It is
onboarding copy that happens to get injected if present.

### All places that reference `BOOTSTRAP.md` across the codebase

```
src/agents/workspace.ts:32                DEFAULT_BOOTSTRAP_FILENAME constant
src/agents/workspace.ts:296,322,336       ensureAgentWorkspace() writes template
                                          (only when isBrandNewWorkspace === true — :335-336)
src/agents/workspace.ts:430-432           loadWorkspaceBootstrapFiles() — reads it
src/agents/pi-embedded-runner/run/attempt.ts:677-681
                                          ONLY live-runtime consumer.
                                          If BOOTSTRAP.md present & not-missing:
                                            workspaceNotes = ["Reminder: commit
                                              your changes in this workspace
                                              after edits."]
                                          Else: workspaceNotes = undefined.
                                          (Fed into the system prompt at
                                          src/agents/system-prompt.ts:733 after
                                          plumbing through :867.)
src/agents/bootstrap-files.ts:75          Mentioned in FIRST_RUN.md text only
src/agents/sandbox/workspace.ts:29        Copied into sandbox workspace if present
src/gateway/server-methods/agents.ts:12,45  Exposed to dashboard as a workspace file
src/commands/status.agent-local.ts:49     Status readout checks existence
src/commands/status-all/agents.ts:31      Status readout checks existence
src/wizard/onboarding.finalize.ts:400-437 Wizard writes the template and tells
                                          the user the first-run ritual starts
                                          from BOOTSTRAP.md
src/wizard/onboarding.test.ts:177,225,232 Tests for the wizard behaviour
src/cli/gateway-cli/run.ts:335             --dev flag doc: "no BOOTSTRAP.md"
src/config/types.agent-defaults.ts:184    agents.defaults.skipBootstrap comment
```

There is no reader/writer that treats BOOTSTRAP.md as a first-run signal at
runtime — the first-run signal is the **MemU-empty + marker-missing** check at
`bootstrap-files.ts:37-73`. BOOTSTRAP.md is just a piece of prose to inject.

### Actual chat-to-chat continuity carriers (workspace-relative)

1. **`SESSION_SNAPSHOT.md`** — the compaction/restart bridge.
   - Written by `saveSessionSnapshot()` in `src/agents/session-snapshot.ts:23-49` to `~/.argentos/agents/<agentId>/session-snapshot.json` atomically (tmp + rename).
   - Emergency writer `saveEmergencySnapshot()` (:173-211) extracts the last ~30 user/assistant messages directly from the raw JSONL transcript when compaction fails.
   - Invoked from `src/agents/pi-embedded-runner/compact.ts:496`, `src/auto-reply/reply/commands-compact.ts:126`, and `src/auto-reply/reply/agent-runner.ts` (for emergency extraction).
   - Loaded by `loadSessionSnapshot()` (:55-68). 24-h TTL in the bootstrap consumer (`bootstrap-files.ts:834-836`).

2. **`KERNEL_CONTINUITY.md`** — the "what I was thinking between messages" bridge.
   - Consciousness-kernel persisted state, hydrated every turn from `selfState` (bootstrap-files.ts:914-977). The prose explicitly frames this as _durable state, not proof of a fully narrated stream_.
   - Includes last user/assistant message, last reflection timestamp, current focus, open questions, agenda — a structured dump the agent can honestly answer "what persisted across the gap" from.

3. **`RECENT_CHANNEL_CONVERSATIONS.md`** — cross-session transcript recall from `~/.argentos/agents/main/sessions/*.jsonl` (not workspace). Only reads last 24 h.

4. **`LIVE_INBOX_LEDGER.md`** — MemU "promoted truths" ledger: compaction-safe facts that survive ctx resets.

5. **`RECENT_CONTEMPLATION.md`** — what the contemplation runner did autonomously between turns. Bridges autonomous activity into chat.

6. **`SIS_CONTEXT.md`** — Session Intelligence Store: behavioural patterns extracted from episode capture.

7. **`RECENT_CONTEXT.md` + `IDENTITY_CONTEXT.md`** — short-range MemU recall (last 15 items) + long-range identity recall (top self-memories + entities).

8. **`ACCOUNTABILITY_STATUS.md`** — heartbeat score state so chat knows what the scoring lane is saying.

There is no "rolling pointer" file. The closest thing is `KERNEL_CONTINUITY.md`'s `selfState.conversation.lastUserMessageAt / lastAssistantReplyAt / lastAssistantConclusion`, but that is not written through the workspace — it comes from the consciousness-kernel store.

### The one BOOTSTRAP.md side-effect worth knowing

`attempt.ts:677-681` is the only runtime consumer. When BOOTSTRAP.md is present and non-missing, the system prompt gets this single extra line in the `## Workspace` section (`system-prompt.ts:730-733`):

> Reminder: commit your changes in this workspace after edits.

That's it. No behaviour flag, no state transition, no FIRST_RUN trigger, no continuity carrier.

---

## Q3. Does the bootstrap injector ever bridge into MemU?

Yes — multiple generators read from MemU via `getMemoryAdapter()` (the StorageAdapter seam in `src/data/storage-factory.ts`). Specifically:

| Generator                                                                             | MemU calls                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `buildFirstRunBootstrapFile()` `:45-54`                                               | `store.getStats()`, `store.listEntities({ limit: 1 })` — gate only, no content pulled.                                                                                                                                                                                       |
| `buildRecentMemoryFile()` `:254-256`                                                  | `store.listItems({ limit: 15 })` — content of `RECENT_CONTEXT.md`.                                                                                                                                                                                                           |
| `buildIdentityContextBootstrapFile()` `:297-301` → `buildDynamicIdentity()` `:87-169` | `store.listItems({ memoryType: 'self', limit: 50 })` (:91); `store.listEntities({ limit: 5 })` (:112); `store.listItems({ memoryType: 'self', limit: 100 })` again for lessons (:130); `store.getRecentReflections(5)` (:140). All of `IDENTITY_CONTEXT.md` is MemU-sourced. |
| `buildLiveInboxLedgerFile()` `:998-1001`                                              | `buildLiveInboxLedger({ store, maxItems: 20 })` — MemU-backed.                                                                                                                                                                                                               |

Other context files are file-system reads (contemplation journals, SIS markdown, session JSONL, heartbeat-score.json, kernel state.json). Hardcoded files (FIRST_RUN body, TTS_POLICY) touch neither.

### The asymmetry the operator noticed

The operator asked: "if MemU isn't consulted for `IDENTITY_CONTEXT.md` but is for `RECENT_MEMORY.md`, why?"

Good news: it **is** consulted for both. `IDENTITY_CONTEXT.md` is fully MemU-backed.

The real asymmetry is different and more interesting:

- **Workspace `IDENTITY.md`** is read verbatim from disk with zero MemU
  awareness. If it's a blank template, the blank template ships to the model.
- **Auto-generated `IDENTITY_CONTEXT.md`** is MemU-backed (Argent's actual
  self-model).

Both get injected **side-by-side** in the same turn. So if `IDENTITY.md` was
blank-template Chinese text (as the operator recalled before the hand-edit),
the model would have seen a blank Chinese template AND a fully populated
MemU-derived identity summary at once. That's exactly the kind of
context-mismatch that can make the agent's self-reports feel incoherent.

Fix candidates in Q6.

---

## Q4. Size caps — what does `buildBootstrapContextFiles()` + `resolveBootstrapMaxChars()` do?

**Primary knob:** `DEFAULT_BOOTSTRAP_MAX_CHARS = 20_000` at
`src/agents/pi-embedded-helpers/bootstrap.ts:84`.

**Configurable:** Yes, per-agent via `agents.defaults.bootstrapMaxChars` in
`~/.argentos/argent.json` (`src/config/types.agent-defaults.ts:186-187`;
schema at `src/config/zod-schema.agent-defaults.ts`). `resolveBootstrapMaxChars()`
at `bootstrap.ts:95-101` reads the numeric value, falls back to default.

**Scope:** Per-file, not aggregate. Each bootstrap/context file is trimmed
individually. There is no global budget across the ~11+ injected files. If
every file hit the cap, the theoretical worst case per turn is ~220 K chars
of bootstrap alone — before the chat history. The operator's observed ~38 K
baseline is comfortably under that, but the ceiling is much higher than the
current reality.

**Truncation mechanics:** `trimBootstrapContent()` (`bootstrap.ts:103-136`) is
a hard character slice:

- `BOOTSTRAP_HEAD_RATIO = 0.7` (:85)
- `BOOTSTRAP_TAIL_RATIO = 0.2` (:86)
- Keep first 70 % + last 20 %, splice in a literal
  `[...truncated, read <file> for full content...]` marker with character
  counts (:122-128).
- No semantic-boundary awareness — it can cut mid-sentence or mid-markdown.
- Emits an `opts.warn(...)` message (`buildBootstrapContextFiles` :180-184)
  which flows up through `makeBootstrapWarn()` (`bootstrap-files.ts:1015-1023`)
  to the run-level `log.warn` — this is what the diag prompt-budget auditor
  sees.

**Missing-file semantics:** When a file is `missing: true`
(`buildBootstrapContextFiles` :168-174), the injector does **not** drop it.
It emits:

```
[MISSING] Expected at: <absolute-path>
```

as the file content. That's a stable signal to the model that the file was
expected but absent. Relevant to Q5.

---

## Q5. Safe to delete `BOOTSTRAP.md` from the operator's workspace right now?

**Short answer:** Yes, with one small gotcha.

### What happens on deletion

1. **Next chat turn — `loadWorkspaceBootstrapFiles()` (`workspace.ts:442-454`).**
   `fs.readFile` fails, entry becomes `{ name: "BOOTSTRAP.md", path, missing: true }`.
2. **`buildBootstrapContextFiles()` (`bootstrap.ts:168-174`).** Missing path
   → injects a `{ path: "BOOTSTRAP.md", content: "[MISSING] Expected at: <path>" }`
   stub. **This is the gotcha** — deleting the file does not remove its slot
   from the injected context; it replaces the content with a MISSING marker.
   The marker is ~50 chars so the token cost is trivial, but it's noisy.
3. **`attempt.ts:677-681`.** `workspaceNotes` becomes `undefined` because
   `!file.missing` is false. The `Reminder: commit your changes…` prompt line
   disappears. Not a problem for a mature operator.
4. **`ensureAgentWorkspace()` (`workspace.ts:266-355`).** Called on every
   inbound reply via `auto-reply/reply/get-reply.ts:143`. `writeFileIfMissing`
   is called for the template set, **but** `bootstrapPath` is only re-written
   when `isBrandNewWorkspace === true` (:335-336). `isBrandNewWorkspace` is
   only true when every one of AGENTS, SOUL, TOOLS, IDENTITY, USER, HEARTBEAT
   is simultaneously absent (:300-313). Operator's workspace has all six →
   BOOTSTRAP.md **will not be recreated** after deletion.
5. **Status / UI surfaces.**
   - `src/commands/status.agent-local.ts:49` and `src/commands/status-all/agents.ts:31`
     will report `bootstrap: false` in CLI status output. Cosmetic.
   - `src/gateway/server-methods/agents.ts:45` exposes the workspace file
     list; dashboard will stop listing BOOTSTRAP.md. Cosmetic.
   - `src/agents/sandbox/workspace.ts:29` copies the file into sandbox
     workspaces only if it exists; missing is fine.
6. **Downstream continuity systems (contemplation, SIS, episode capture,
   heartbeat, kernel).** None of them reference BOOTSTRAP.md. Verified via
   `grep -rn BOOTSTRAP src/infra/` and `src/memory/` — no hits. Deletion has
   zero effect on these subsystems.
7. **Wizard / setup.** `src/wizard/onboarding.finalize.ts:400-437` only shows
   the "first-run ritual will start from BOOTSTRAP.md" note when the file
   already exists; if absent on next re-wizard it silently skips (:428).
   `src/wizard/onboarding.test.ts:232` explicitly covers the "TUI hatch
   without BOOTSTRAP.md" case.

### The one scenario that would re-inject it

If the operator's workspace were ever nuked to the point that ALL six files
(AGENTS/SOUL/TOOLS/IDENTITY/USER/HEARTBEAT) are missing simultaneously,
`ensureAgentWorkspace` would re-run the first-time path and recreate
BOOTSTRAP.md from the template at
`docs/reference/templates/BOOTSTRAP.md`. That's the only resurrection
vector. Unlikely in normal operation.

### Recommendation

Deletion is safe. The only thing to be aware of is the residual
`[MISSING] Expected at: …/BOOTSTRAP.md` injection (step 2). It's 50 chars of
noise, but clean behaviour would be either to (a) suppress the MISSING
placeholder for BOOTSTRAP.md specifically once IDENTITY.md is populated, or
(b) remove BOOTSTRAP.md from `loadWorkspaceBootstrapFiles()`'s hard list and
treat it as a purely-wizard-time artefact. Both are small code changes —
proposed in Q6.

---

## Q6. Best architectural fix for "workspace template empty but MemU has the answer"

Two candidates, ordered by impact + reversibility.

### Option A (top pick): drop BOOTSTRAP.md injection when the workspace is mature; replace blank-template alignment docs in-memory

**One-paragraph pitch:** Keep BOOTSTRAP.md as a wizard-time breadcrumb on
disk, but stop pretending it is a bootstrap context file at runtime. In the
same pass, teach `buildBootstrapContextFiles()` to detect "template-blank"
alignment docs and silently swap them for the corresponding MemU-derived
generator output. This keeps disk state honest (operator can still look at
workspace files, Git still backs them up) while making the LLM's context
reflect reality.

**Changes, by location:**

1. `src/agents/bootstrap-files.ts:1092-1103` — drop BOOTSTRAP.md from the
   workspace bootstrap set before `filterBootstrapFilesForSession`, or add
   an `IS_MATURE_WORKSPACE` gate: skip BOOTSTRAP.md when
   `first-run-complete` marker exists OR MemU has ≥ 1 entity.
2. Same file, around the IDENTITY / USER merge step: after
   `buildIdentityContextBootstrapFile()` runs, if the workspace `IDENTITY.md`
   content matches a "template signature" (only headers, only `- Name:`-style
   placeholder bullets, length < 200 chars), replace its `content` in-memory
   with the MemU identity summary (plus a single-line provenance note). Do
   **not** modify disk — this stays a view shim.
3. Same for `USER.md`: if blank-template, substitute with a summary derived
   from entities where `relationship === 'operator' || name === operator`
   and recent conversation ledger facts.

**Tradeoffs:**

- (+) Fixes the exact incoherence the operator noticed (blank IDENTITY.md
  shipping alongside full MemU IDENTITY_CONTEXT.md).
- (+) Makes BOOTSTRAP.md deletable without residual `[MISSING]` noise.
- (+) Cheap (< 80 LOC), per-file, behind a heuristic that's easy to unit-test
  against the existing test fixtures in `bootstrap-files.test.ts`.
- (–) "Template-blank" heuristic needs tuning; false positives would silently
  hide legitimate short notes. Mitigation: guard behind a hard length
  threshold + explicit header-only regex + a feature flag
  (`agents.defaults.autoHydrateAlignmentDocs: boolean`, default true).
- (–) Hides desync from operators who manually diff workspace files. Workaround:
  emit a `makeBootstrapWarn`-style telemetry line (`"IDENTITY.md appears
template-blank; hydrated from MemU for this turn"`) so the operator sees it
  in the diag/prompt-budget audit path they already built.

### Option B: write-through hydration — fill empty alignment docs on disk from MemU at boot

**Pitch:** Extend `ensureAgentWorkspace()` to, post-template-creation, detect
"template-blank" IDENTITY.md / USER.md and one-shot write the MemU-derived
content to disk with a `<!-- Auto-hydrated from MemU on <date> -->` header.
Subsequent edits by the operator stick (compare mtime or header presence to
avoid re-hydration).

**Tradeoffs:**

- (+) Makes workspace files the single source of truth again — no divergence
  between "what's injected" and "what's on disk."
- (+) Plays well with the alignment-integrity manifest
  (`.argent-alignment-integrity.json`) refresh already called at
  `workspace.ts:340`.
- (–) Writes to user files without explicit consent; surprising if the
  operator was deliberately keeping them blank.
- (–) Races with contemplation / SIS writers, which already touch the
  workspace `memory/` tree — need a mutex or a single-writer window.
- (–) Loses the dynamic nature — MemU evolves, the disk copy snapshots.
  Either you re-hydrate continuously (back to Option A in effect) or the
  disk goes stale.

**Recommendation:** Ship Option A. Option B is a wanted property (disk ==
injected) but should be a follow-up once Option A proves the hydration
heuristics are reliable. Do not implement either without operator sign-off.

---

## Appendix — Related continuity surfaces worth noting

- **Bootstrap cache (`bootstrap-files.ts:1181-1207`).** 60-second TTL keyed
  by `workspaceDir:sessionKey`. `clearBootstrapContextCache()` exists but is
  not wired to alignment-doc edits — there's a potential 60-second staleness
  window after editing IDENTITY.md that could confuse rapid iteration.
  Consider wiring it into `refreshAlignmentIntegrityManifest` callers.
- **Subagent filter (`workspace.ts:458-468`).** Subagent sessions only see
  AGENTS.md + TOOLS.md. None of the MemU-derived synthetic files are filtered
  here; they all pass through. That's probably a bug or at least an
  inconsistency — a subagent session shouldn't need RECENT_CHANNEL_CONVERSATIONS
  but does get it. Out of scope for this deep-dive; flag for later.
- **Gemini turn-ordering bootstrap (`bootstrap.ts:193-218`).** Separate
  mechanism entirely (synthetic `"(session bootstrap)"` user turn for Cloud
  Code Assist). Not related to workspace BOOTSTRAP.md despite the name.

---

_End of deep-dive. No code changes made. Report path:
`/Users/sem/code/argentos/docs/argent/BOOTSTRAP_DEEPDIVE.md`. Uncommitted._
