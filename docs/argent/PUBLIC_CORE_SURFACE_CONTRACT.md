# Public Core Surface Contract

Date: 2026-03-15

This file turns the Core vs Business discussion into a concrete packaging contract.

Primary machine-readable source:

- `docs/argent/public-core-surface-contract.json`

## Purpose

Use this contract to answer three questions before anything is made public:

1. Is this part of the first public Core product surface?
2. Is this safe but non-essential, and therefore better held for a later Core cut?
3. Is this Business or still too mixed to expose publicly?

## Tool Boundary

### Core default

These are the tools that most directly support the ArgentOS wow moment and single-operator value:

- chat/session flow
- presence and TTS
- memory
- tasks
- docs/canvas
- browser/web
- terminal/code editing
- basic knowledge lookup

Representative tools:

- `browser`
- `memory_recall`
- `memory_timeline`
- `tasks`
- `doc_panel`
- `sessions_send`
- `sessions_spawn`
- `tts`
- `visual_presence`
- `web_search`
- `web_fetch`
- `terminal`

### Core power-user optional

These are still public-safe candidates, but they are not required for the first Core launch:

- `image_generate`
- `video_generate`
- `audio_generate`
- `meeting_record`
- `plugin_builder`
- `family`
- `widgets`

### Operator add-ons on hold

These are not the moat, but they add operational complexity or infrastructure exposure that is not needed for the first public cut:

- deploy/infrastructure tools
- telephony/email ops tools
- service-key administration tool
- signal monitoring / alerting utilities

### Business blocked

These stay private until there is a deliberate paid boundary:

- `intent_tool`
- `jobs_tool`
- `workforce_setup_tool`
- `copilot_system_tool`
- `specforge`
- `onboarding_pack`
- `marketplace`

## Dashboard Boundary

### Core default files

The public Core experience should preserve:

- chat
- avatar / AEVP / Live2D presence
- task and project interaction
- session drawer
- canvas/doc panel
- widgets
- memory console

### Core slices trapped in mixed files

Two files still need extraction work before the public boundary is clean:

- `dashboard/src/App.tsx`
- `dashboard/src/components/ConfigPanel.tsx`

Those files contain both Core value and Business/admin logic.

### Business blocked files

These should not ship in the public Core repo:

- `dashboard/src/components/WorkforceBoard.tsx`
- `dashboard/src/components/worker-wizard/**`
- `dashboard/src/components/LicensePanel.tsx`

## Dashboard API Boundary

### Core runtime routes

Keep the runtime routes that power the Core experience:

- tasks
- projects
- memory
- canvas
- apps
- widgets
- knowledge ingest/library
- gateway tool invoke
- TTS/search/fetch proxy routes
- weather/calendar/news/score support routes

### Core operator settings routes

Keep only the settings needed for a self-hosted Core user to configure and run the product:

- agent settings
- alignment docs
- auth profiles
- channels
- models/providers
- basic service-key CRUD
- TTS settings
- read-only knowledge collections list

### Business blocked routes

Do not ship these publicly in the first Core release:

- `/api/license/**`
- `/api/org/**`
- `/api/settings/intent/**`
- service-key policy/grant/revoke/audit routes
- knowledge collection grant route

### Mixed admin routes on hold

These are not necessarily Business, but they are too sensitive or too admin-heavy for the first public cut:

- gateway restart / token management
- database management
- filesystem and CORS allowlists
- raw config editing
- pairing/device admin
- lockscreen/system open
- service-key migration
- systems registry / connector builder surfaces

## Practical Rule

When in doubt:

1. If it makes people fall in love with Argent, keep it in Core consideration.
2. If a business would pay to avoid rebuilding it, keep it private.
3. If it is powerful but not needed for first adoption, hold it for a later Core release.
4. If it is mixed inside a hotspot file, block it until extracted.

## Immediate Use

Use this contract together with:

- `docs/argent/public-core-denylist.json`
- `docs/argent/public-core.manifest.example.json`
- `scripts/export-public-core.ts`

That gives you:

- deny what must not ship
- define what should ship
- keep the staged Core repo reviewable before any public flip
- automatically exclude `deferredReview` paths from the staged mirror until they are explicitly cleared

Example dry-run against the eventual staging repo:

```bash
cd /Users/sem/code/argentos
node --import tsx scripts/export-public-core.ts --target-repo-root /Users/sem/code/argentos-core
```

Apply when ready:

```bash
cd /Users/sem/code/argentos
node --import tsx scripts/export-public-core.ts --target-repo-root /Users/sem/code/argentos-core --apply
```

## Runtime Activation

The built-in tool registry now supports a config-backed public Core profile.

Example:

```json
{
  "distribution": {
    "surfaceProfile": "public-core",
    "publicCore": {
      "includePowerUserTools": false
    }
  }
}
```

Optional overrides:

- `publicCore.includePowerUserTools`
- `publicCore.alsoAllowTools`
- `publicCore.denyTools`
- `publicCore.allowPlugins`
- `publicCore.denyPlugins`

Important:

- `alsoAllowTools` can add held operator tools like `service_keys`
- it cannot punch through the Business-blocked boundary
- plugin and channel-injected agent tools are blocked by default in `public-core`
- plugin agent tools require explicit `allowPlugins` opt-in
- `denyTools` now applies to allowed plugin tools as well

## First Dashboard Split

The dashboard now has a first-pass `public-core` settings filter:

- Business/admin tabs such as `intent`, `gateway`, `database`, `devices`, `observability`,
  `marketplace`, `license`, and `logs` are hidden in `public-core`
- `capabilities` is hidden in `public-core` because it edits live tool-governance policy rather
  than first-cut Core operator settings
- the advanced raw `argent.json` editor is hidden in `public-core`
- `knowledge` remains visible, but library maintenance actions like reindex/delete are hidden so
  the first public Core cut stays read-only for RAG administration

This is intentionally a first cut, not a full extraction. `ConfigPanel.tsx` still contains mixed
agent/admin sections that need a later split.
