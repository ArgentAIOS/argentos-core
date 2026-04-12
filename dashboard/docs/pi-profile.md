# Pi Profile — low-intensity AEVP mode

The ArgentOS dashboard's AEVP (Argent Emotional Visualization Presence)
renders the orb and particles via WebGL at the browser's native refresh
rate. On a Raspberry Pi 5 with software rendering (or a Hailo-free
display), the 180-particle default + 60+ fps loop can drive the CPU
above 70% and saturate the GPU queue.

**Pi Profile** is an opt-in rendering mode that reduces the per-frame
cost without changing any identity preset or personality modulation.
The orb still breathes, still colour-shifts, still emits particles on
tool events — it just costs ~60% less to draw.

## What it changes

| Lever | Default | Pi profile | Source of truth |
|---|---|---|---|
| Particle cap (runtime) | up to `180` | `60` | `aevp/colorMapping.ts` via `getMaxParticlesCap()` |
| Density scale | `1.0 ×` | `0.5 ×` | `aevp/colorMapping.ts` via `getDensityScale()` |
| Render tick interval | `0 ms` (rAF) | `33 ms` (~30 fps) | `aevp/renderer.ts` via `getFrameIntervalMs()` |

The hard allocation (`MAX_PARTICLES = 180` in `aevp/particles.ts`) is
unchanged — the buffer still holds room for 180 — so the profile can
be flipped on and off without a reload or re-alloc.

## How to enable

Any one of these signals activates the profile. The check runs once
at module load.

| Method | Where | When to use |
|---|---|---|
| `PI_PROFILE=1` env var | Node / SSR | Build-time or Electron wrappers |
| `VITE_PI_PROFILE=1` env var | Vite dev/build | `.env.local` in dashboard dev |
| `localStorage.setItem("argent.piProfile", "1")` | Browser console | Runtime toggle, survives reload |
| `?piProfile=1` URL param | Any | One-shot test without touching storage |

To disable, unset / remove / set to `"0"`, and reload.

## How to verify

1. Open the dashboard with the profile active.
2. Open dev tools → Performance → record ~5 seconds.
3. Expect: ~30 fps main thread, GPU frame time below 8 ms, particle
   count ≤60 in the `drawArrays(POINTS, ...)` call in `renderer.ts`.
4. Compare against a baseline tab without the profile.

## What it does NOT change

- Identity presets in `identityPresets.ts` — still emitted as-is.
- Personality modulation (warmth, energy, openness, formality) — still
  applied in full.
- Morning particles and evening fireflies (separate components) — mount
  them conditionally in app code if those also need to drop on Pi.
- Orb bloom / glow post-processing — future cut, currently always on.

## Future cuts

- Gate bloom FBO pass behind the profile (skip `bloomFBO` render).
- Lower the shader precision on the particle fragment shader to
  `mediump` when the profile is active.
- Expose an in-dashboard toggle under a "Performance" tab.

## References

- `dashboard/src/aevp/pi-profile.ts` — single source of truth.
- `dashboard/src/aevp/colorMapping.ts:448` — cap + scale call sites.
- `dashboard/src/aevp/renderer.ts:269` — frame gate.
