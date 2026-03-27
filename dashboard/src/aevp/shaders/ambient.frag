#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform float u_time;
uniform vec2  u_resolution;
uniform vec3  u_coreColor;
uniform vec3  u_glowColor;
uniform float u_glowIntensity;
uniform float u_breathingRate;
uniform float u_breathingDepth;
uniform float u_edgeCoherence;
uniform float u_formExpansion;
uniform float u_pulseIntensity;
uniform vec2  u_orbCenter;
uniform vec2  u_presenceOffset;
uniform float u_presenceScale;

// Phase 4: Shape morphing uniforms
uniform float u_squash;           // -1..1 aspect deformation
uniform float u_wobble;           // 0..1 organic blob movement
uniform float u_speechAmplitude;  // 0..1 voice-driven pulse

// ── Simplex-style noise (2D) ──────────────────────────────────────────────

vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec3 permute(vec3 x) { return mod289(((x * 34.0) + 10.0) * x); }

float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                      -0.577350269189626, 0.024390243902439);
  vec2 i  = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod289(i);
  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m;
  m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

// ── Hash for starfield ───────────────────────────────────────────────────

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// ── Starfield layer ──────────────────────────────────────────────────────

float starfield(vec2 uv, float scale, float threshold) {
  vec2 grid = floor(uv * scale);
  vec2 frac_uv = fract(uv * scale);

  float h = hash(grid);
  // Only some cells have stars
  if (h < threshold) return 0.0;

  // Star position within cell (jittered from center)
  vec2 starPos = vec2(hash(grid + 1.0), hash(grid + 2.0)) * 0.6 + 0.2;
  float d = length(frac_uv - starPos);

  // Star brightness: sharp point
  float brightness = smoothstep(0.06, 0.0, d);

  // Twinkle: each star has its own phase
  float phase = hash(grid + 5.0) * 6.28;
  float speed = 0.3 + hash(grid + 7.0) * 0.7;
  float twinkle = 0.6 + 0.4 * sin(u_time * speed + phase);

  return brightness * twinkle * (h - threshold) / (1.0 - threshold);
}

// ── Nebula wisps ─────────────────────────────────────────────────────────

float nebula(vec2 uv) {
  float n1 = snoise(uv * 3.0 + u_time * 0.02) * 0.5 + 0.5;
  float n2 = snoise(uv * 5.0 - u_time * 0.015 + 50.0) * 0.5 + 0.5;
  float n3 = snoise(uv * 8.0 + u_time * 0.01 + 100.0) * 0.5 + 0.5;
  return n1 * 0.5 + n2 * 0.3 + n3 * 0.2;
}

// ── Main ──────────────────────────────────────────────────────────────────

void main() {
  vec2 uv = v_uv;
  float aspect = u_resolution.x / u_resolution.y;

  // Background field remains anchored to the panel, not the orb transform.
  vec2 bgCentered = (uv - vec2(0.5, 0.5)) * vec2(aspect, 1.0);
  // Orb + particle composition can move independently over the anchored field.
  vec2 centered = ((uv - (u_orbCenter + u_presenceOffset)) * vec2(aspect, 1.0)) / u_presenceScale;

  // ── Background: starfield + nebula ────────────────────────────────────

  // Deep space background — very dark
  vec3 bgColor = vec3(0.01, 0.01, 0.02);

  // Nebula wisps tinted by the mood color (very subtle)
  float neb = nebula(bgCentered);
  vec3 nebColor = mix(u_glowColor * 0.08, u_coreColor * 0.06, neb);
  // Fade nebula near orb center so it doesn't compete
  float nebFade = smoothstep(0.05, 0.25, length(centered));
  bgColor += nebColor * neb * nebFade;

  // Stars — three layers at different scales for depth
  float stars = 0.0;
  stars += starfield(uv, 40.0, 0.85) * 0.7;  // Sparse bright stars
  stars += starfield(uv, 80.0, 0.80) * 0.4;  // Medium density
  stars += starfield(uv, 150.0, 0.75) * 0.2; // Dense dim stars

  // Stars tinted slightly cool white, dimmed near the orb
  float starDim = smoothstep(0.05, 0.20, length(centered)); // Stars fade near orb
  vec3 starColor = vec3(0.8, 0.85, 1.0) * stars * starDim;
  bgColor += starColor;

  float bgAlpha = max(0.95, stars * 0.5); // Nearly opaque background

  // ── Orb: breathing animation ──────────────────────────────────────────

  // Speech modulates breathing — the orb breathes WITH its words
  float amp = u_speechAmplitude;
  float speechBreathSync = 1.0 + amp * 0.3; // Speech accelerates breathing slightly
  float breathCycle = sin(u_time * u_breathingRate * speechBreathSync * 6.2831853) * 0.5 + 0.5;
  float breathMod = 1.0 + breathCycle * u_breathingDepth * 0.25;

  // Speech: voice shapes the orb
  float speechExpand = amp * 0.15;            // Slight size boost while speaking
  float speechStretch = amp * -0.2;           // Elongate upward while speaking
  float speechWobbleBoost = amp * 0.3;        // Voice vibrates the surface

  // Base radius — SCALED for the canvas.
  float baseRadius = mix(0.15, 0.32, u_formExpansion) * breathMod * (1.0 + speechExpand);

  // ── Squash/stretch: mood shape + speech elongation ────────────────────

  float totalSquash = clamp(u_squash + speechStretch, -1.0, 1.0);
  float sqFactor = totalSquash * 0.35;
  vec2 deformed = centered;
  deformed.x /= (1.0 + sqFactor);  // positive = wider
  deformed.y *= (1.0 + sqFactor);  // positive = shorter
  float distDeformed = length(deformed);

  // ── Wobble: organic blob distortion + speech vibration ────────────────

  float totalWobble = u_wobble + speechWobbleBoost;
  float angle = atan(deformed.y, deformed.x);
  float wobbleOffset = totalWobble * baseRadius * 0.08 * (
    sin(angle * 3.0 + u_time * 1.5)
    + sin(angle * 5.0 - u_time * 2.3) * 0.5
    + sin(angle * 2.0 + u_time * 0.7) * 0.3
  );
  // Speech adds higher-frequency ripple (like a speaker cone vibrating)
  wobbleOffset += amp * baseRadius * 0.04 * sin(angle * 7.0 + u_time * 12.0);

  // Edge noise for dissolution effect
  float noiseVal = snoise(vec2(angle * 2.0, u_time * 0.3)) * 0.5 + 0.5;
  float noiseVal2 = snoise(vec2(angle * 4.0 + 100.0, u_time * 0.5)) * 0.5 + 0.5;
  float edgeNoise = mix((noiseVal * 0.6 + noiseVal2 * 0.4) * 0.15, 0.0, u_edgeCoherence);

  // SDF: deformed soft circle with wobble + noisy edge
  float sdf = distDeformed - baseRadius + edgeNoise + wobbleOffset;

  // Inner core: bright center falloff (follows deformed shape)
  float coreFalloff = 1.0 - smoothstep(0.0, baseRadius * 0.65, distDeformed);
  float coreAlpha = coreFalloff * coreFalloff * coreFalloff;

  // Outer glow: extends ~2.5x the base radius (follows deformed shape)
  float glowFalloff = 1.0 - smoothstep(baseRadius * 0.3, baseRadius * 2.5, distDeformed);
  float glowAlpha = glowFalloff * glowFalloff * u_glowIntensity;

  // Edge: smooth anti-aliased edge — speech softens edges (thought escaping boundary)
  float speechEdgeSoften = amp * 0.03;
  float edgeWidth = mix(0.03, 0.10, 1.0 - u_edgeCoherence) + speechEdgeSoften;
  float edgeMask = 1.0 - smoothstep(-edgeWidth, edgeWidth, sdf);

  // Pulse effect
  float pulseCycle = sin(u_time * 3.0) * 0.5 + 0.5;
  float pulse = 1.0 + pulseCycle * u_pulseIntensity * 0.4;

  // Secondary slow pulse for organic feel
  float slowPulse = sin(u_time * 0.7) * 0.5 + 0.5;
  pulse *= 1.0 + slowPulse * 0.12;

  // ── Combine orb colors ────────────────────────────────────────────────

  vec3 orbColor = u_coreColor * coreAlpha * 2.5 * pulse;
  orbColor += u_glowColor * glowAlpha * 1.2;

  // Outer glow (softer, more contained)
  float outerGlow = glowFalloff * glowFalloff * u_glowIntensity * 0.5;

  // Inner pattern: concentric rings (subtle)
  float rings = sin(distDeformed * 35.0 - u_time * 1.5) * 0.5 + 0.5;
  orbColor += u_glowColor * rings * 0.08 * edgeMask;

  // Color fringe at edge
  float edgeDist = abs(sdf) < edgeWidth * 2.0 ? 1.0 - abs(sdf) / (edgeWidth * 2.0) : 0.0;
  orbColor += u_glowColor * edgeDist * 0.4 * pulse;

  // Orb alpha (core + glow + outer glow)
  float orbAlpha = max(max(coreAlpha, glowAlpha) * edgeMask, outerGlow);

  // ── Final composite: background + orb ─────────────────────────────────

  // Additive blend: orb light adds on top of the dark background
  vec3 finalColor = bgColor + orbColor * orbAlpha;

  // Alpha: opaque background, orb adds brightness
  float finalAlpha = max(bgAlpha, orbAlpha);

  fragColor = vec4(finalColor, finalAlpha);
}
