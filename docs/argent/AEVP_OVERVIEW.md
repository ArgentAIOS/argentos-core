---
summary: "AEVP system overview — what it is, why it exists, how the rendering pipeline works"
read_when:
  - You want to understand AEVP (Agent Expressive Visual Presence)
  - You need to modify the orb renderer or emotional state pipeline
  - You want to add new gestures or visual presets
title: "AEVP Overview"
---

# AEVP — Agent Expressive Visual Presence

AEVP is ArgentOS's visual presence system. It replaces pre-rigged anime models (Live2D)
with a procedural WebGL2 renderer driven by continuous emotional state from the
Self-Improving System (SIS).

The agent appears as a luminous, translucent orb. The orb IS the agent's face. Gestures
are her chosen form of expression — like smiling or gasping for a human, except expressed
through light, color, shape, and motion.

## Why AEVP Exists

Live2D models require pre-rigged expressions triggered by discrete mood tags. AEVP
replaces this with continuous emotional parameters (valence, arousal, mood, identity
resonance) that procedurally drive every visual attribute. The result is an agent that
looks alive — breathing, shifting, responding to her own cognitive state in real time.

## Architecture

```
SIS Episodes (contemplation-runner.ts)
    │
    └─► setEpisodeBroadcast callback
            │
            └─► Gateway broadcast("aevp_episode", ...)
                    │
                    └─► Dashboard WebSocket
                            │
                            └─► useAgentState() hook
                                    │
                                    ├─► EmotionalState (valence, arousal, mood)
                                    ├─► ActivityState (idle/thinking/working + tool)
                                    └─► SpeechAmplitude (TTS audio feed)

computeRenderState(emotional, activity, identity)
    │
    ├─► Mood profile (per-mood color/size/speed overrides)
    ├─► Tool category color shifts (search=cyan, code=green, etc.)
    ├─► Speech amplitude → squash/wobble
    ├─► Personality modulation (warmth, energy, formality, openness)
    └─► Reduced motion overrides
            │
            └─► AEVPRenderState → WebGL2 uniforms → GPU fragment shader
```

## Key Concepts

### Emotional State

Every render frame is driven by `EmotionalState`:

| Field               | Type    | Description                                              |
| ------------------- | ------- | -------------------------------------------------------- |
| `valence`           | -1 to 1 | Positive/negative emotional tone                         |
| `arousal`           | 0 to 1  | Activation energy level                                  |
| `mood`              | string  | Named mood (e.g., "contemplative", "excited", "curious") |
| `identityResonance` | 0 to 1  | How personally connected the agent feels                 |

Source: SIS episodes broadcast over WebSocket, with text `[MOOD:name]` markers as fallback.

### Render State

`AEVPRenderState` contains all parameters sent to the GPU each frame:

| Parameter       | Driven By             | Range        |
| --------------- | --------------------- | ------------ |
| Core color      | Mood + valence        | RGB [0,1]    |
| Glow intensity  | Arousal               | 0.2–0.9      |
| Form expansion  | Arousal + openness    | 0.3–0.85     |
| Breathing rate  | Arousal               | 0.04–0.14 Hz |
| Pulse intensity | Arousal x uncertainty | 0–0.6        |
| Particle count  | Activity + energy     | 0–60         |
| Edge coherence  | Formality + mood      | 0.3–0.9      |
| Wobble          | Uncertainty + arousal | 0–0.5        |

### Identity Presets

Five configurable visual identities:

| Preset    | Colors                        | Character                 |
| --------- | ----------------------------- | ------------------------- |
| Minimal   | Silver/monochrome             | Clean, quiet, understated |
| Warm      | Amber/gold/coral              | Friendly, approachable    |
| Corporate | Steel blue/slate              | Professional, precise     |
| Artistic  | Purple/magenta/teal (default) | Expressive, vivid         |
| Technical | Cyan/green/electric blue      | Sharp, responsive         |

Each preset includes personality parameters (warmth, energy, formality, openness) that
act as subtle multipliers on the render state.

### Gestures

The agent can perform 10 named gestures via the `visual_presence` tool:

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

Gestures are momentary overlays (200-10000ms) that decay back to the emotional baseline.

### Tool Category Colors

When the agent uses a tool, the orb shifts color to indicate activity:

| Category      | Color            | Tools                       |
| ------------- | ---------------- | --------------------------- |
| search        | Cyan/teal        | web_search, argent_search   |
| code          | Green            | terminal, edit_line_range   |
| communication | Warm gold        | message, discord            |
| media         | Magenta/pink     | image_generation, tts       |
| memory        | Deep blue/indigo | memory_recall, memory_store |
| system        | Orange/amber     | gateway, argent_config      |

### Tonal Presence (Accessibility)

Non-visual accessibility layer using Web Audio API — opt-in, extremely quiet:

| Feature         | Description                                     |
| --------------- | ----------------------------------------------- |
| Ambient tone    | Sine wave at mood-mapped frequency (190-370 Hz) |
| Breathing audio | Volume modulated at breathing rate              |
| State chimes    | Micro-sounds on mood changes (50-300ms)         |
| Pre-speech cue  | Rising tone before TTS speaks                   |

### Dashboard Climate

The orb's mood radiates into the dashboard UI through CSS custom properties:

- `--climate-temp`: Color temperature
- `--climate-intensity`: Influence strength
- `--climate-hue`: Dominant hue

Panels near the orb show resonance glow effects when the agent works on related content.

## File Map

### Backend (src/)

| File                                       | Purpose                                           |
| ------------------------------------------ | ------------------------------------------------- |
| `src/infra/aevp-types.ts`                  | NormalizedAgentState, EpisodeEvent, ActivityEvent |
| `src/agents/tools/visual-presence-tool.ts` | Agent tool: gesture + set_identity                |
| `src/gateway/server-methods/aevp.ts`       | Gateway broadcast for aevp_presence events        |
| `src/infra/contemplation-runner.ts`        | Episode broadcast via setEpisodeBroadcast()       |
| `src/gateway/agent-state-broadcaster.ts`   | markActivity() for fine-grained events            |
| `src/gateway/server-chat.ts`               | Tool event -> aevp_activity broadcasting          |

### Dashboard (dashboard/src/)

| File                          | Purpose                                                  |
| ----------------------------- | -------------------------------------------------------- |
| `aevp/renderer.ts`            | WebGL2 renderer — canvas, shaders, animation loop        |
| `aevp/shaders/ambient.frag`   | Fragment shader — orb shape, glow, breathing, particles  |
| `aevp/colorMapping.ts`        | EmotionalState -> AEVPRenderState (color, size, speed)   |
| `aevp/types.ts`               | Core types: AEVPRenderState, AgentVisualIdentity         |
| `aevp/speechAnalyser.ts`      | Audio analyser bridge for TTS amplitude                  |
| `aevp/tonalPresence.ts`       | TonalPresenceEngine (Web Audio API)                      |
| `aevp/identityPresets.ts`     | 5 visual presets + personality modulation                |
| `aevp/environment.ts`         | Dashboard climate CSS vars + element resonance           |
| `components/AEVPPresence.tsx` | React wrapper: useAgentState -> renderer                 |
| `hooks/useAgentState.ts`      | Unified state hook (emotional + activity + speech)       |
| `types/agentState.ts`         | Dashboard-side type mirror (EmotionalState, GestureName) |

## Performance

- < 5% CPU in ambient mode (measured on M3 Ultra)
- 60fps via requestAnimationFrame
- WebGL2 fragment shader does all heavy lifting on GPU
- State updates batched through React scheduling
- Tonal presence uses minimal Web Audio resources (3 oscillators max)

## Implementation Phases

All 7 phases are complete. See `docs/argent/AEVP_STATUS.md` for detailed per-phase
implementation notes with file tables and architecture diagrams.

| Phase | Name                           | What It Added                                |
| ----- | ------------------------------ | -------------------------------------------- |
| 1     | State Aggregator + Voice Feed  | Unified NormalizedAgentState pipeline        |
| 2     | Ambient Mode                   | WebGL2 renderer with emotional color mapping |
| 3     | Activity Mode                  | Tool category colors, particle system        |
| 4     | Luminous Conversational        | Speech-reactive squash/stretch               |
| 5     | Identity Parameterization      | 5 presets, personality sliders               |
| 6     | Tonal Presence + Accessibility | Web Audio tones, reduced motion              |
| 7     | Agent Visual Self-Expression   | visual_presence tool with 10 gestures        |
