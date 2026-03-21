# AEVP (Agent Expressive Visual Presence) — Implementation Status

> Last updated: 2026-02-27
> Spec: `/Users/sem/code/project-avatar/AEVP_Specification_v0.2.md`
> Plan: `/Users/sem/code/project-avatar/AEVP_IMPLEMENTATION_PLAN.md`

## What Is AEVP

AEVP is ArgentOS's visual presence system — a full replacement for Live2D that renders
the agent's cognitive/emotional state as a luminous, translucent presence. Instead of
pre-rigged anime models with trigger-based expressions, AEVP uses procedural WebGL2
shaders driven by continuous SIS emotional state.

The orb IS the agent's face. Gestures are her chosen form of expression — like smiling
or gasping for a human, except expressed through light, color, shape, and motion.

## Operational Note (2026-02-27)

- Dashboard default renderer is now `aevp` (particles/orb). Live2D is opt-in via Avatar settings toggle.
- One-time client migration (`aevp-renderer-migration-2026-02-27-force-aevp`) force-switches legacy saved `live2d` preference to `aevp`.
- If users turn particles off, dashboard falls back to Live2D for preview/customization paths.
- Live2D asset revisions are intentionally deferred; keep them off by default during PG-17 cutover and DocPane/RAG stabilization.

## External Files (project-avatar/)

All spec and planning docs live at `/Users/sem/code/project-avatar/`:

| File                              | Description                                                                            |
| --------------------------------- | -------------------------------------------------------------------------------------- |
| `AEVP_Specification_v0.1.md`      | Original spec (30KB)                                                                   |
| `AEVP_Specification_v0.2.md`      | Current spec (62KB) — full design with rendering stack, identity params, accessibility |
| `AEVP_IMPLEMENTATION_PLAN.md`     | 7-phase implementation plan with timelines                                             |
| `AEVP_Medium_Substack_Article.md` | Article draft for publication                                                          |
| `AEVP_White_Paper_v1.0.docx`      | White paper                                                                            |

## Phase Summary

| Phase | Name                           | Status      | Completed  |
| ----- | ------------------------------ | ----------- | ---------- |
| 1     | State Aggregator + Voice Feed  | ✅ Complete | 2026-02-14 |
| 2     | Ambient Mode                   | ✅ Complete | 2026-02-14 |
| 3     | Activity Mode                  | ✅ Complete | 2026-02-14 |
| 4     | Luminous Conversational Mode   | ✅ Complete | 2026-02-15 |
| 5     | Identity Parameterization      | ✅ Complete | 2026-02-15 |
| 6     | Tonal Presence + Accessibility | ✅ Complete | 2026-02-15 |
| 7     | Agent Visual Self-Expression   | ✅ Complete | 2026-02-15 |

---

## Phase 1: State Aggregator + Voice Feed — COMPLETE

**Completed: 2026-02-14**

Phase 1 built the data foundation that normalizes SIS emotional state, activity state,
and voice feed into a unified `NormalizedAgentState` consumed by any renderer.

### Problem Solved

Before Phase 1, the dashboard got mood from fragile `[MOOD:name]` text markers parsed
from streamed responses. SIS episodes (containing real emotional data — mood, valence,
arousal) were stored in SQLite but never broadcast to the dashboard. Activity state was
local UI guesswork. No unified state pipeline existed.

### Files Created

| File                                   | Purpose                                                                                             |
| -------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `src/infra/aevp-types.ts`              | Backend-side types: `NormalizedAgentState`, `EpisodeEvent`, `MoodTransitionEvent`, `ActivityEvent`  |
| `dashboard/src/types/agentState.ts`    | Dashboard-side type mirror (no backend imports): `EmotionalState`, `DEFAULT_EMOTIONAL`, event types |
| `dashboard/src/hooks/useAgentState.ts` | Unified state hook consuming WebSocket events                                                       |

### Files Modified

| File                                     | Changes                                                                                                                     |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `src/infra/contemplation-runner.ts`      | Added `setEpisodeBroadcast()` callback pattern + `onEpisodeBroadcast?.()` call after MemU episode storage                   |
| `src/gateway/agent-state-broadcaster.ts` | Added `markActivity(state, tool?)` method broadcasting `aevp_activity` events; idle emission on `markDone()`                |
| `src/gateway/server-chat.ts`             | Emits `aevp_activity` events for tool start (`"working"`) and tool end (`"thinking"`)                                       |
| `src/gateway/server.impl.ts`             | Wires `setEpisodeBroadcast()` to gateway broadcast                                                                          |
| `dashboard/src/App.tsx`                  | Imports `useAgentState()`, syncs SIS mood → `avatarMood`, syncs activity → `avatarState`, wires `applyTextMood` as fallback |

### Architecture

```
SIS Episode (contemplation-runner)
    │
    ├─► MemU storage (SQLite)
    │
    └─► setEpisodeBroadcast callback
            │
            └─► gateway broadcast("aevp_episode", ...)
                    │
                    └─► Dashboard WebSocket
                            │
                            └─► useAgentState() hook
                                    │
                                    ├─► emotional state (valence, arousal, mood)
                                    ├─► avatarState (Live2D compat)
                                    ├─► moodName (Live2D compat via mapSISMoodToMoodName)
                                    └─► hasSISData flag (SIS takes priority over text markers)

Tool Events (server-chat.ts)
    │
    └─► broadcast("aevp_activity", { state: "working"/"thinking" })
            │
            └─► useAgentState() → activityState → avatarState

Agent State (agent-state-broadcaster.ts)
    │
    ├─► markProcessing() → "processing" state
    ├─► markDone() → "idle" + aevp_activity idle event
    └─► markActivity(state, tool) → aevp_activity event
```

### Key Design Decisions

1. **SIS data takes priority** over `[MOOD:name]` text markers — `hasSISData` flag tracks this
2. **Text markers kept as fallback** — still work for direct chat before next contemplation cycle
3. **Mood mapping uses existing MOOD_ALIASES** from `moodSystem.ts` — single source of truth
4. **Module-level callback pattern** for episode broadcast (same as `setBroadcastHealthUpdate`)
5. **Identity resonance** calculated from episode identity_links (subject=0.4, collaborator=0.3 weight)
6. **Activity events are best-effort** (`dropIfSlow: true`) — never block the main pipeline

---

## Phase 2+3: Ambient Mode + Activity Mode — COMPLETE

**Completed: 2026-02-14**

### What Was Built

The WebGL2 renderer (`AEVPRenderer`) that draws the agent as a luminous, breathing orb
with emotional color mapping, particle systems, and environmental influence.

### Files Created

| File                                        | Purpose                                                   |
| ------------------------------------------- | --------------------------------------------------------- |
| `dashboard/src/aevp/renderer.ts`            | WebGL2 renderer — handles canvas, shaders, animation loop |
| `dashboard/src/aevp/shaders/ambient.frag`   | Fragment shader — orb shape, glow, breathing, particles   |
| `dashboard/src/aevp/colorMapping.ts`        | Emotional state → render parameters (color, size, speed)  |
| `dashboard/src/aevp/types.ts`               | Core AEVP types: `AEVPRenderState`, `AgentVisualIdentity` |
| `dashboard/src/aevp/environment.ts`         | Dashboard climate CSS vars + element resonance system     |
| `dashboard/src/components/AEVPPresence.tsx` | React wrapper bridging useAgentState → renderer           |

### Rendering Pipeline

```
EmotionalState + ActivityState + Identity
        │
        └─► computeRenderState()
                │
                ├─► Mood profile (per-mood color/size/speed overrides)
                ├─► Tool category overrides (search=cyan, code=green, etc.)
                ├─► Speech amplitude → squash/wobble
                ├─► Personality modulation (Phase 5)
                └─► Reduced motion overrides (Phase 6)
                        │
                        └─► AEVPRenderState
                                │
                                ├─► AEVPRenderer.updateState() → WebGL2 uniforms
                                ├─► updateDashboardClimate() → CSS custom properties
                                └─► updateElementResonance() → panel glow effects
```

### Visual Parameters Driven by Emotional State

| Parameter       | Driven By              | Range        |
| --------------- | ---------------------- | ------------ |
| Core color      | Mood profile + valence | RGB [0,1]    |
| Glow color      | Mood profile           | RGB [0,1]    |
| Glow intensity  | Arousal                | 0.2–0.9      |
| Form expansion  | Arousal + openness     | 0.3–0.85     |
| Breathing rate  | Arousal                | 0.04–0.14 Hz |
| Pulse intensity | Arousal × uncertainty  | 0–0.6        |
| Particle count  | Activity + energy      | 0–60         |
| Particle speed  | Arousal                | 0.2–1.5      |
| Edge coherence  | Formality + mood       | 0.3–0.9      |
| Wobble          | Uncertainty + arousal  | 0–0.5        |

### Tool Category Color Shifts

When the agent uses a tool, the orb shifts to indicate activity:

| Category      | Color Shift      | Example Tools               |
| ------------- | ---------------- | --------------------------- |
| search        | Cyan/teal tint   | web_search, argent_search   |
| code          | Green tint       | terminal, edit_line_range   |
| communication | Warm gold        | message, discord            |
| media         | Magenta/pink     | image_generation, tts       |
| memory        | Deep blue/indigo | memory_recall, memory_store |
| system        | Orange/amber     | gateway, argent_config      |

### Dashboard Climate

The orb's mood radiates into the dashboard UI through CSS custom properties:

- `--climate-temp`: Color temperature (warm/cool)
- `--climate-intensity`: Strength of influence
- `--climate-hue`: Dominant hue from mood

Panels near the orb can show resonance glow effects when the agent is working
on related content.

---

## Phase 4: Luminous Conversational Mode — COMPLETE

**Completed: 2026-02-15**

### What Was Built

Speech-reactive visual behavior. When TTS is playing, the orb responds to audio
amplitude with squash/stretch deformation and increased wobble, creating the
impression of "speaking through light."

### Key Addition

| File                                   | Changes                                                     |
| -------------------------------------- | ----------------------------------------------------------- |
| `dashboard/src/aevp/speechAnalyser.ts` | Audio analyser bridge for ElevenLabs TTS amplitude          |
| `dashboard/src/hooks/useAgentState.ts` | Added `speechAmplitude`, `setSpeechAmplitude`, `isSpeaking` |
| `dashboard/src/aevp/colorMapping.ts`   | Speech amplitude → squash (0.85–1.0) + wobble boost         |

---

## Phase 5: Identity Parameterization — COMPLETE

**Completed: 2026-02-15**

### What Was Built

Configurable visual identity system with style presets and personality parameters.
Instead of a hardcoded look, the orb can switch between distinct visual styles.

### Files Created

| File                                    | Purpose                                        |
| --------------------------------------- | ---------------------------------------------- |
| `dashboard/src/aevp/identityPresets.ts` | 5 named presets + personality modulation logic |

### Files Modified

| File                                       | Changes                                                                                 |
| ------------------------------------------ | --------------------------------------------------------------------------------------- |
| `dashboard/src/aevp/types.ts`              | Added `IdentityStyle`, `IdentityPersonality` to `AgentVisualIdentity`                   |
| `dashboard/src/aevp/colorMapping.ts`       | Personality modulation: warmth→color temp, energy→speed, formality→edges, openness→size |
| `dashboard/src/components/ConfigPanel.tsx` | "Visual Identity" tab with preset cards + personality sliders                           |
| `dashboard/src/App.tsx`                    | Stateful identity from localStorage, dynamic preset switching                           |

### Identity Presets

| Preset    | Colors                               | Character                 |
| --------- | ------------------------------------ | ------------------------- |
| Minimal   | Silver/monochrome                    | Clean, quiet, understated |
| Warm      | Amber/gold/coral                     | Friendly, approachable    |
| Corporate | Steel blue/slate                     | Professional, precise     |
| Artistic  | Purple/magenta/teal (Argent default) | Expressive, vivid         |
| Technical | Cyan/green/electric blue             | Sharp, responsive         |

### Personality Parameters

Each parameter is a subtle ±15-25% multiplier on the render state:

| Parameter | What It Affects            | 0 =                    | 1 =                  |
| --------- | -------------------------- | ---------------------- | -------------------- |
| Warmth    | Color temperature          | Cool blue tint         | Warm amber tint      |
| Energy    | Animation speed, particles | Slow, fewer particles  | Fast, more particles |
| Formality | Edge crispness             | Soft, dissolving edges | Sharp, defined edges |
| Openness  | Form expansion             | Compact resting size   | Expanded presence    |

---

## Phase 6: Tonal Presence + Accessibility — COMPLETE

**Completed: 2026-02-15**

### What Was Built

Non-visual accessibility layer using Web Audio API. Subtle audio tones convey
presence and mood shifts through sound — opt-in, extremely quiet.

### Files Created

| File                                  | Purpose                                     |
| ------------------------------------- | ------------------------------------------- |
| `dashboard/src/aevp/tonalPresence.ts` | `TonalPresenceEngine` class (Web Audio API) |

### Files Modified

| File                                        | Changes                                                                     |
| ------------------------------------------- | --------------------------------------------------------------------------- |
| `dashboard/src/aevp/types.ts`               | Added `TonalPresenceConfig`, `AccessibilityConfig`, `DEFAULT_ACCESSIBILITY` |
| `dashboard/src/components/AEVPPresence.tsx` | Tonal engine lifecycle, mood change chimes, breathing audio sync            |
| `dashboard/src/components/ConfigPanel.tsx`  | "Accessibility" tab with tonal presence toggles + volume slider             |
| `dashboard/src/App.tsx`                     | Accessibility state persistence, pre-speech cue wiring                      |

### Tonal Features

| Feature         | Description                                                |
| --------------- | ---------------------------------------------------------- |
| Ambient tone    | Continuous sine wave at mood-mapped frequency (190-370 Hz) |
| Breathing audio | Volume modulated at breathing rate                         |
| State chimes    | Brief micro-sounds on mood changes (50-300ms)              |
| Pre-speech cue  | Rising tone before TTS starts speaking                     |

### Reduced Motion

When enabled (`prefers-reduced-motion` or manual toggle):

- Particles disabled
- Pulse and wobble zeroed
- Breathing rate capped
- Transitions slowed

---

## Phase 7: Agent Visual Self-Expression — COMPLETE

**Completed: 2026-02-15**

### What Was Built

The agent can control her own visual presence through a `visual_presence` tool.
The orb is her face — gestures are her chosen form of expression, just as a human
chooses to smile or gasp.

### Files Created

| File                                       | Purpose                                              |
| ------------------------------------------ | ---------------------------------------------------- |
| `src/agents/tools/visual-presence-tool.ts` | Agent tool with `gesture` and `set_identity` actions |
| `src/gateway/server-methods/aevp.ts`       | Gateway broadcast handler for `aevp_presence` events |

### Files Modified

| File                                        | Changes                                                                          |
| ------------------------------------------- | -------------------------------------------------------------------------------- |
| `dashboard/src/types/agentState.ts`         | Added `GestureName`, `GestureEvent`, `SetIdentityEvent`, `PresenceEvent` types   |
| `dashboard/src/hooks/useAgentState.ts`      | `aevp_presence` listener, gesture timer, pending identity changes                |
| `dashboard/src/components/AEVPPresence.tsx` | `applyGestureOverlay()` — temporary parameter shifts that decay back to baseline |
| `dashboard/src/App.tsx`                     | Consumes `pendingIdentityChange` to switch presets on agent request              |
| `src/agents/argent-tools.ts`                | Registered `createVisualPresenceTool`                                            |
| `src/agents/system-prompt.ts`               | Added tool summary to `coreToolSummaries`                                        |
| `src/gateway/server-methods.ts`             | Registered `aevpHandlers`                                                        |

### Gesture System

The agent can perform 10 named gestures, each modifying specific render parameters:

| Gesture   | Effect                          |
| --------- | ------------------------------- |
| brighten  | Glow up, expand, lighten colors |
| dim       | Fade, contract, fewer particles |
| warm_up   | Shift color temperature warmer  |
| cool_down | Shift color temperature cooler  |
| expand    | Grow larger, increase glow      |
| contract  | Shrink, slow particles          |
| pulse     | Energy burst + wobble           |
| still     | Stop all motion                 |
| soften    | Dissolve edges                  |
| sharpen   | Crisp edges                     |

Gestures are **momentary** — they overlay the current state for a duration (200-10000ms)
then decay back to the emotional baseline. Like a facial expression that fades.

### Identity Change

The agent can also request a persistent identity change (switching presets) via
`set_identity`. This is consumed by App.tsx and persisted to localStorage.

### Architecture

```
Agent: visual_presence tool call
    │
    └─► callGatewayTool("aevp.presence", payload)
            │
            └─► Gateway server-methods/aevp.ts
                    │
                    └─► broadcast("aevp_presence", payload)
                            │
                            └─► Dashboard useAgentState()
                                    │
                                    ├─► Gesture → applyGestureOverlay() → temporary visual shift
                                    │       └─► setTimeout → decay back to baseline
                                    │
                                    └─► Identity change → App.tsx effect → getPreset() + persist
```

---

## Performance

The renderer meets all budget targets:

- < 5% CPU in ambient mode (measured on M3 Ultra)
- 60fps rendering via `requestAnimationFrame`
- WebGL2 shader does all heavy lifting on GPU
- State updates are batched through React's scheduling
- Tonal presence uses minimal Web Audio resources (3 oscillators max)
