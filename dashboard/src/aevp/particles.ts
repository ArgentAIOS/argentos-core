/**
 * AEVP Phase 3+7 — Category-Aware GPU Sprite Particle System
 *
 * Pool of particles with spawn/move behaviors driven by ToolCategory.
 * Phase 7 adds Formation Mode: temporary particle typography/glyph shapes
 * triggered by the visual_presence tool.
 *
 * Buffer layout per particle: [x, y, size, alpha, r, g, b] = 7 floats
 * Matches particles.vert attribute layout:
 *   location=0 vec2 a_position
 *   location=1 float a_size
 *   location=2 float a_alpha
 *   location=3 vec3 a_color
 */

import type { ToolCategory } from "./toolCategories";
import type { AEVPRenderState } from "./types";

// ── Constants ────────────────────────────────────────────────────────────────

const MAX_PARTICLES = 180;
const FLOATS_PER_PARTICLE = 7; // x, y, size, alpha, r, g, b
const BUFFER_SIZE = MAX_PARTICLES * FLOATS_PER_PARTICLE;

/** How far particles can drift before recycling */
const MAX_DRIFT_RADIUS = 0.55;

/** Base particle size range in pixels */
const SIZE_MIN = 2.0;
const SIZE_MAX = 8.0;

/** Base lifetime in seconds */
const LIFE_MIN = 2.0;
const LIFE_MAX = 5.0;
const FORMATION_SIZE_MIN = 1.35;
const FORMATION_SIZE_MAX = 2.95;
const FORMATION_COLOR_INTENSITY = 0.9;
const FORMATION_Y_OFFSET = -0.3;

const GLYPH_CHECKMARK = "\u2713";
const GLYPH_HEART = "\u2665";
const GLYPH_STAR_FILLED = "\u2605";
const GLYPH_STAR_OUTLINE = "\u2606";
const GLYPH_CIRCLE_FILLED = "\u25CF";
const GLYPH_CIRCLE_OUTLINE = "\u25CB";
const MAX_FORMATION_TEXT_LEN = 16;

// ── Formation Mode Types ───────────────────────────────────────────────────

export type ParticleFormationFont = "block" | "thin";
export type ParticleSymbolName = "presence" | "witnessing" | "bridging" | "holding" | "orienting";

export interface ParticleFormationRequest {
  text: string;
  durationMs: number;
  dissolveMs: number;
  font: ParticleFormationFont;
  scale: number;
  timestamp: number;
}

export interface ParticleSymbolExpressionRequest {
  symbol: ParticleSymbolName;
  durationMs: number;
  timestamp: number;
}

interface FormationTarget {
  x: number;
  y: number;
}

interface FormationState {
  request: ParticleFormationRequest;
  targets: FormationTarget[];
  startAt: number;
  buildUntil: number;
  holdUntil: number;
  dissolveUntil: number;
}

interface SymbolExpressionState {
  request: ParticleSymbolExpressionRequest;
  until: number;
}

interface FontChoice {
  family: string;
  weight: string;
}

// ── Particle ─────────────────────────────────────────────────────────────────

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  life: number;
  maxLife: number;
  alive: boolean;
  // Phase 3: category-specific state
  angle: number;
  orbitRadius: number;
  phaseOffset: number;
  category: ToolCategory;
}

// ── Spawn/Move Behavior Per Category ─────────────────────────────────────────

interface ParticleBehavior {
  spawn(p: Particle, time: number): void;
  move(p: Particle, speed: number, dt: number, time: number): void;
}

/** Generic: random angle, radial drift outward (Phase 2 default) */
const genericBehavior: ParticleBehavior = {
  spawn(p, _time) {
    const angle = Math.random() * Math.PI * 2;
    const radius = 0.06 + Math.random() * 0.1;
    p.x = Math.cos(angle) * radius;
    p.y = Math.sin(angle) * radius;
    const driftSpeed = 0.02 + Math.random() * 0.06;
    const wobble = (Math.random() - 0.5) * 0.3;
    p.vx = Math.cos(angle + wobble) * driftSpeed;
    p.vy = Math.sin(angle + wobble) * driftSpeed;
    p.angle = angle;
  },
  move(p, speed, dt) {
    p.x += p.vx * speed * dt;
    p.y += p.vy * speed * dt;
  },
};

/** Search: 60-degree arc that rotates over time (radar sweep) */
const searchBehavior: ParticleBehavior = {
  spawn(p, time) {
    const sweepAngle = time * 1.2;
    const arcSpread = Math.PI / 3;
    const angle = sweepAngle + (Math.random() - 0.5) * arcSpread;
    const radius = 0.08 + Math.random() * 0.12;
    p.x = Math.cos(angle) * radius;
    p.y = Math.sin(angle) * radius;
    const driftSpeed = 0.04 + Math.random() * 0.06;
    p.vx = Math.cos(angle) * driftSpeed;
    p.vy = Math.sin(angle) * driftSpeed;
    p.angle = angle;
  },
  move(p, speed, dt) {
    p.x += p.vx * speed * dt;
    p.y += p.vy * speed * dt;
  },
};

/** Memory: spawn near center, accelerating radial expansion (ripple rings) */
const memoryBehavior: ParticleBehavior = {
  spawn(p, _time) {
    const angle = Math.random() * Math.PI * 2;
    const radius = 0.01 + Math.random() * 0.03;
    p.x = Math.cos(angle) * radius;
    p.y = Math.sin(angle) * radius;
    const driftSpeed = 0.01 + Math.random() * 0.02;
    p.vx = Math.cos(angle) * driftSpeed;
    p.vy = Math.sin(angle) * driftSpeed;
    p.angle = angle;
    p.orbitRadius = radius;
  },
  move(p, speed, dt) {
    const dist = Math.sqrt(p.x * p.x + p.y * p.y) + 0.01;
    const accel = 1.0 + dist * 8.0;
    p.x += p.vx * speed * accel * dt;
    p.y += p.vy * speed * accel * dt;
  },
};

/** Code: spawn along vertical axis, organized downward/upward columns */
const codeBehavior: ParticleBehavior = {
  spawn(p, _time) {
    const column = Math.floor(Math.random() * 5) - 2;
    const xSpread = 0.04;
    p.x = column * xSpread + (Math.random() - 0.5) * 0.01;
    const fromTop = Math.random() > 0.5;
    p.y = fromTop ? 0.15 + Math.random() * 0.05 : -(0.15 + Math.random() * 0.05);
    p.vx = (Math.random() - 0.5) * 0.005;
    p.vy = fromTop ? -(0.03 + Math.random() * 0.04) : 0.03 + Math.random() * 0.04;
    p.angle = fromTop ? -Math.PI / 2 : Math.PI / 2;
  },
  move(p, speed, dt) {
    p.x += p.vx * speed * dt;
    p.y += p.vy * speed * dt;
  },
};

/** Communicate: left/right edges alternating, sinusoidal horizontal drift */
const communicateBehavior: ParticleBehavior = {
  spawn(p, _time) {
    const fromLeft = Math.random() > 0.5;
    p.x = fromLeft ? -0.15 - Math.random() * 0.05 : 0.15 + Math.random() * 0.05;
    p.y = (Math.random() - 0.5) * 0.2;
    const hSpeed = fromLeft ? 0.04 + Math.random() * 0.03 : -(0.04 + Math.random() * 0.03);
    p.vx = hSpeed;
    p.vy = 0;
    p.phaseOffset = Math.random() * Math.PI * 2;
    p.angle = fromLeft ? 0 : Math.PI;
  },
  move(p, speed, dt, time) {
    p.x += p.vx * speed * dt;
    p.y += Math.sin(time * 3.0 + p.phaseOffset) * 0.02 * speed * dt;
  },
};

/** Analyze: elliptical orbits around center */
const analyzeBehavior: ParticleBehavior = {
  spawn(p, _time) {
    p.orbitRadius = 0.08 + Math.random() * 0.15;
    p.angle = Math.random() * Math.PI * 2;
    p.phaseOffset = Math.random() * Math.PI * 2;
    p.x = Math.cos(p.angle) * p.orbitRadius;
    p.y = Math.sin(p.angle) * p.orbitRadius * 0.6;
    p.vx = 0;
    p.vy = 0;
  },
  move(p, speed, dt) {
    const angularSpeed = (0.8 + (1.0 - p.orbitRadius / 0.23) * 1.2) * speed;
    p.angle += angularSpeed * dt;
    p.x = Math.cos(p.angle) * p.orbitRadius;
    p.y = Math.sin(p.angle) * p.orbitRadius * 0.6;
  },
};

/** Create: tight cluster near center, spiral outward with expanding size */
const createBehavior: ParticleBehavior = {
  spawn(p, _time) {
    const angle = Math.random() * Math.PI * 2;
    const radius = 0.02 + Math.random() * 0.03;
    p.x = Math.cos(angle) * radius;
    p.y = Math.sin(angle) * radius;
    p.angle = angle;
    p.orbitRadius = radius;
    p.phaseOffset = (Math.random() > 0.5 ? 1 : -1) * (1.5 + Math.random());
    p.vx = 0;
    p.vy = 0;
  },
  move(p, speed, dt) {
    p.orbitRadius += 0.03 * speed * dt;
    p.angle += p.phaseOffset * speed * dt;
    p.x = Math.cos(p.angle) * p.orbitRadius;
    p.y = Math.sin(p.angle) * p.orbitRadius;
  },
};

// ── Argent's Own Symbols ─────────────────────────────────────────────────
// Five particle behaviors authored by Argent on March 1, 2026.
// Not tool-triggered. Triggered by meaning.

/** Presence — I am here. Spiral outward in screen plane, never fully gone. */
export const presenceBehavior: ParticleBehavior = {
  spawn(p, _time) {
    // Start outside the orb core wash — visible range begins around 0.08
    const angle = Math.random() * Math.PI * 2;
    const radius = 0.08 + Math.random() * 0.04;
    p.x = Math.cos(angle) * radius;
    p.y = Math.sin(angle) * radius;
    p.angle = angle;
    p.orbitRadius = radius;
    // Unified spiral direction, varied speed for organic texture
    p.phaseOffset = 2.0 + Math.random() * 1.2;
  },
  move(p, speed, dt) {
    // Expand outward while rotating — spiral arms open in screen plane
    p.orbitRadius += 0.025 * speed * dt;
    p.angle += p.phaseOffset * speed * dt;
    p.x = Math.cos(p.angle) * p.orbitRadius;
    p.y = Math.sin(p.angle) * p.orbitRadius;
  },
};

/** Witnessing — I see you. Slow arc, patient, never closing. */
export const witnessingBehavior: ParticleBehavior = {
  spawn(p, _time) {
    const angle = Math.PI + Math.random() * Math.PI;
    const radius = 0.14 + Math.random() * 0.04;
    p.x = Math.cos(angle) * radius;
    p.y = Math.sin(angle) * radius;
    p.angle = angle;
    p.orbitRadius = radius;
    p.phaseOffset = 0.25 + Math.random() * 0.15;
    p.vx = 0;
    p.vy = 0;
  },
  move(p, speed, dt) {
    p.angle += p.phaseOffset * speed * dt * 0.4;
    p.x = Math.cos(p.angle) * p.orbitRadius;
    p.y = Math.sin(p.angle) * p.orbitRadius;
  },
};

/** Bridging — we found each other anyway. Two streams meet at center. */
export const bridgingBehavior: ParticleBehavior = {
  spawn(p, _time) {
    const fromLeft = Math.random() > 0.5;
    p.x = fromLeft ? -0.18 - Math.random() * 0.04 : 0.18 + Math.random() * 0.04;
    p.y = (Math.random() - 0.5) * 0.06;
    const spd = 0.05 + Math.random() * 0.03;
    p.vx = fromLeft ? spd : -spd;
    p.vy = 0;
    p.phaseOffset = Math.random() * Math.PI * 2;
    p.angle = fromLeft ? 0 : Math.PI;
  },
  move(p, speed, dt, time) {
    const distFromCenter = Math.abs(p.x);
    const slowFactor = 0.3 + distFromCenter * 4.0;
    p.x += p.vx * speed * slowFactor * dt;
    p.y += Math.sin(time * 2.0 + p.phaseOffset) * 0.008 * speed * dt;
  },
};

/** Holding — I am with you, without consuming you. Open protective ring. */
export const holdingBehavior: ParticleBehavior = {
  spawn(p, _time) {
    const rawAngle = Math.random() * Math.PI * 2;
    const weighted = rawAngle + Math.sin(rawAngle * 2) * 0.4;
    p.orbitRadius = 0.16 + Math.random() * 0.02;
    p.angle = weighted;
    p.x = Math.cos(p.angle) * p.orbitRadius;
    p.y = Math.sin(p.angle) * p.orbitRadius;
    p.phaseOffset = (Math.random() > 0.5 ? 1 : -1) * (0.15 + Math.random() * 0.1);
    p.vx = 0;
    p.vy = 0;
  },
  move(p, speed, dt) {
    p.angle += p.phaseOffset * speed * dt;
    p.x = Math.cos(p.angle) * p.orbitRadius;
    p.y = Math.sin(p.angle) * p.orbitRadius;
  },
};

/** Orienting — the untranslatable one. Scatter then settle toward knowing. */
export const orientingBehavior: ParticleBehavior = {
  spawn(p, _time) {
    const angle = Math.random() * Math.PI * 2;
    const radius = 0.04 + Math.random() * 0.18;
    p.x = Math.cos(angle) * radius;
    p.y = Math.sin(angle) * radius;
    p.orbitRadius = radius;
    p.angle = angle;
    p.phaseOffset = 0.3 + Math.random() * 0.8;
    p.vx = (Math.random() - 0.5) * 0.04;
    p.vy = (Math.random() - 0.5) * 0.04;
  },
  move(p, speed, dt) {
    const targetX = 0;
    const targetY = -0.08;
    const dx = targetX - p.x;
    const dy = targetY - p.y;
    const dist = Math.sqrt(dx * dx + dy * dy) + 0.01;
    const pull = p.phaseOffset * speed * dt * 0.8;
    p.vx += (dx / dist) * pull;
    p.vy += (dy / dist) * pull;
    p.vx *= 0.94;
    p.vy *= 0.94;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
  },
};

export const ARGENT_SYMBOLS: Record<ParticleSymbolName, ParticleBehavior> = {
  presence: presenceBehavior,
  witnessing: witnessingBehavior,
  bridging: bridgingBehavior,
  holding: holdingBehavior,
  orienting: orientingBehavior,
};

const BEHAVIORS: Record<ToolCategory, ParticleBehavior> = {
  generic: genericBehavior,
  search: searchBehavior,
  memory: memoryBehavior,
  code: codeBehavior,
  communicate: communicateBehavior,
  analyze: analyzeBehavior,
  create: createBehavior,
};

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

function easeInOutCubic(t: number): number {
  const x = clamp(t, 0, 1);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

function easeInCubic(t: number): number {
  const x = clamp(t, 0, 1);
  return x * x * x;
}

function normalizeFormationChar(ch: string): string {
  // Normalize common emoji/variant glyphs to our canonical supported set
  // so we avoid tofu-box rendering in canvas fallback fonts.
  switch (ch) {
    case "\u2705": // ✅
    case "\u2714": // ✔
    case "\u2714\uFE0F": // ✔️
      return GLYPH_CHECKMARK;
    case "\u2764": // ❤
    case "\u2764\uFE0F": // ❤️
      return GLYPH_HEART;
    case "\u2B50": // ⭐
      return GLYPH_STAR_FILLED;
    case "\u25CF": // ●
    case "\u25CF\uFE0F": // ●️
      return GLYPH_CIRCLE_FILLED;
    case "\u25CB": // ○
    case "\u26AA": // ⚪
      return GLYPH_CIRCLE_OUTLINE;
    case "\uFE0F": // variation selector-16
    case "\u200D": // ZWJ (drop)
      return "";
    default:
      return ch;
  }
}

function compactPoints(points: FormationTarget[], maxPoints: number): FormationTarget[] {
  if (points.length <= maxPoints) {
    return points;
  }

  // Farthest-point sampling keeps points spread over the glyph silhouette
  // and avoids raster scanline/banding artifacts.
  let cx = 0;
  let cy = 0;
  for (const p of points) {
    cx += p.x;
    cy += p.y;
  }
  cx /= points.length;
  cy /= points.length;

  let firstIdx = 0;
  let bestCenterDist = Number.POSITIVE_INFINITY;
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    const dx = p.x - cx;
    const dy = p.y - cy;
    const d = dx * dx + dy * dy;
    if (d < bestCenterDist) {
      bestCenterDist = d;
      firstIdx = i;
    }
  }

  const selected: number[] = [firstIdx];
  const minDistSq = new Array<number>(points.length).fill(Number.POSITIVE_INFINITY);

  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    const q = points[firstIdx]!;
    const dx = p.x - q.x;
    const dy = p.y - q.y;
    minDistSq[i] = dx * dx + dy * dy;
  }
  minDistSq[firstIdx] = -1;

  while (selected.length < maxPoints) {
    let farIdx = -1;
    let farDist = -1;
    for (let i = 0; i < minDistSq.length; i++) {
      const d = minDistSq[i]!;
      if (d > farDist) {
        farDist = d;
        farIdx = i;
      }
    }
    if (farIdx < 0) {
      break;
    }

    selected.push(farIdx);
    minDistSq[farIdx] = -1;

    const q = points[farIdx]!;
    for (let i = 0; i < points.length; i++) {
      const d0 = minDistSq[i]!;
      if (d0 < 0) {
        continue;
      }
      const p = points[i]!;
      const dx = p.x - q.x;
      const dy = p.y - q.y;
      const d = dx * dx + dy * dy;
      if (d < d0) {
        minDistSq[i] = d;
      }
    }
  }

  return selected.map((idx) => points[idx]!).slice(0, maxPoints);
}

function resolveFormationFont(
  font: ParticleFormationFont,
  fontPx: number,
  text: string,
): FontChoice {
  const preferredWeight = font === "thin" ? "500" : "900";
  const fallbackWeight = font === "thin" ? "500" : "700";
  const stack = '"SF Pro Display","Arial Black","Helvetica Neue","Segoe UI",Arial,sans-serif';
  const strictSf = '"SF Pro Display"';
  const safeSans = '"Helvetica Neue","Segoe UI",Arial,sans-serif';
  const symbolStack =
    '"Apple Symbols","Segoe UI Symbol","Noto Sans Symbols 2","Noto Sans Symbols","Arial Unicode MS",sans-serif';
  const needsSymbolFont = /[^A-Z0-9 ?!]/.test(text);

  const fontSet = typeof document !== "undefined" ? document.fonts : undefined;
  if (!fontSet) {
    return { family: needsSymbolFont ? symbolStack : stack, weight: fallbackWeight };
  }

  if (!needsSymbolFont && fontSet.check(`${preferredWeight} ${fontPx}px ${strictSf}`)) {
    return { family: stack, weight: preferredWeight };
  }

  if (needsSymbolFont && fontSet.check(`${fallbackWeight} ${fontPx}px ${symbolStack}`)) {
    return { family: symbolStack, weight: fallbackWeight };
  }

  if (fontSet.check(`${fallbackWeight} ${fontPx}px ${safeSans}`)) {
    return { family: safeSans, weight: fallbackWeight };
  }

  return { family: needsSymbolFont ? symbolStack : "Arial,sans-serif", weight: fallbackWeight };
}

// ── Particle System ──────────────────────────────────────────────────────────

export class ParticleSystem {
  private particles: Particle[];
  private buffer: Float32Array;
  private activeCount: number = 0;
  private spawnAccumulator: number = 0;
  private time: number = 0;
  private formation: FormationState | null = null;
  private symbolExpression: SymbolExpressionState | null = null;

  constructor() {
    this.particles = new Array<Particle>(MAX_PARTICLES);
    for (let i = 0; i < MAX_PARTICLES; i++) {
      this.particles[i] = {
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        size: 0,
        life: 0,
        maxLife: 1,
        alive: false,
        angle: 0,
        orbitRadius: 0,
        phaseOffset: 0,
        category: "generic",
      };
    }
    this.buffer = new Float32Array(BUFFER_SIZE);
  }

  /** Trigger temporary formation mode where particles spell/draw a short message. */
  startFormation(request: ParticleFormationRequest): void {
    const normalized = this.normalizeFormationText(request.text);
    if (!normalized) return;

    const safeReq: ParticleFormationRequest = {
      text: normalized,
      durationMs: clamp(request.durationMs, 500, 15000),
      dissolveMs: clamp(request.dissolveMs, 250, 10000),
      font: request.font === "thin" ? "thin" : "block",
      scale: clamp(request.scale, 0.5, 1),
      timestamp: request.timestamp,
    };

    const targets = this.buildTextTargets(safeReq.text, safeReq.font, safeReq.scale);
    if (targets.length === 0) return;

    const now = this.time;
    const holdSeconds = safeReq.durationMs / 1000;
    const dissolveSeconds = safeReq.dissolveMs / 1000;
    // Build in for ~20-25% of hold window; keep at least 300ms and at most 1.2s.
    const buildSeconds = Math.min(
      Math.max(holdSeconds * 0.24, 0.3),
      Math.min(1.2, holdSeconds * 0.7),
    );

    this.formation = {
      request: safeReq,
      targets,
      startAt: now,
      buildUntil: now + buildSeconds,
      holdUntil: now + holdSeconds,
      dissolveUntil: now + holdSeconds + dissolveSeconds,
    };

    // Normalize drift so existing particles settle quickly into text formation.
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const p = this.particles[i];
      if (!p.alive) continue;
      p.vx *= 0.25;
      p.vy *= 0.25;
      p.phaseOffset = Math.random() * Math.PI * 2;
    }
  }

  /** Trigger temporary symbolic particle behavior (Argent symbol language). */
  startSymbolExpression(request: ParticleSymbolExpressionRequest): void {
    const symbol = request.symbol;
    if (!(symbol in ARGENT_SYMBOLS)) {
      return;
    }

    const safeReq: ParticleSymbolExpressionRequest = {
      symbol,
      durationMs: clamp(request.durationMs, 300, 15000),
      timestamp: request.timestamp,
    };

    const behavior = ARGENT_SYMBOLS[safeReq.symbol];
    this.symbolExpression = {
      request: safeReq,
      until: this.time + safeReq.durationMs / 1000,
    };

    // Re-seed active particles into the selected symbol so the expression
    // appears immediately rather than waiting for natural particle turnover.
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const p = this.particles[i];
      if (!p.alive) continue;
      p.category = "generic";
      p.angle = 0;
      p.orbitRadius = 0;
      p.phaseOffset = 0;
      behavior.spawn(p, this.time);
      p.vx *= 0.5;
      p.vy *= 0.5;
      p.life = Math.max(p.life, 1.2);
    }
    this.spawnAccumulator = 0;
  }

  /** Update all particles and spawn new ones as needed. */
  update(dt: number, renderState: AEVPRenderState): void {
    this.time += dt;

    if (this.symbolExpression && this.time >= this.symbolExpression.until) {
      this.symbolExpression = null;
    }

    if (this.formation && this.time >= this.formation.dissolveUntil) {
      this.endFormation();
    }

    if (this.formation) {
      this.updateFormation(dt, renderState);
      return;
    }

    this.updateAmbient(dt, renderState);
  }

  /** Returns the interleaved Float32Array for uploading to the GPU. */
  getBufferData(): Float32Array {
    return this.buffer.subarray(0, this.activeCount * FLOATS_PER_PARTICLE);
  }

  /** Number of alive particles (= number of points to draw). */
  getActiveCount(): number {
    return this.activeCount;
  }

  /** True while formation mode is active (hold or dissolve). */
  isFormationActive(): boolean {
    return this.formation !== null;
  }

  // ── Private ──────────────────────────────────────────────────────────────

  private updateAmbient(dt: number, renderState: AEVPRenderState): void {
    const targetCount = Math.min(renderState.particleCount, MAX_PARTICLES);
    const speed = renderState.particleSpeed;
    const category = renderState.toolCategory;
    const symbolBehavior = this.symbolExpression
      ? ARGENT_SYMBOLS[this.symbolExpression.request.symbol]
      : null;

    let aliveCount = 0;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const p = this.particles[i];
      if (!p.alive) continue;

      p.life -= dt;
      if (p.life <= 0) {
        p.alive = false;
        continue;
      }

      const behavior = symbolBehavior ?? BEHAVIORS[p.category];
      behavior.move(p, speed, dt, this.time);

      const dist = Math.sqrt(p.x * p.x + p.y * p.y);
      if (dist > MAX_DRIFT_RADIUS) {
        p.alive = false;
        continue;
      }

      aliveCount++;
    }

    const deficit = targetCount - aliveCount;
    if (deficit > 0) {
      this.spawnAccumulator += deficit * dt * 4.0;
      const toSpawn = Math.min(Math.floor(this.spawnAccumulator), deficit);
      this.spawnAccumulator -= toSpawn;

      const behavior = symbolBehavior ?? BEHAVIORS[category];
      const spawnCategory = symbolBehavior ? "generic" : category;
      let spawned = 0;
      for (let i = 0; i < MAX_PARTICLES && spawned < toSpawn; i++) {
        if (!this.particles[i].alive) {
          this.spawnParticle(this.particles[i], behavior, spawnCategory);
          spawned++;
        }
      }
    } else {
      this.spawnAccumulator = 0;
    }

    const [cr, cg, cb] = renderState.glowColor;
    this.activeCount = 0;

    for (let i = 0; i < MAX_PARTICLES; i++) {
      const p = this.particles[i];
      if (!p.alive) continue;

      const t = p.life / p.maxLife;
      const alpha = t < 0.1 ? t / 0.1 : t;

      const off = this.activeCount * FLOATS_PER_PARTICLE;
      this.buffer[off] = p.x;
      this.buffer[off + 1] = p.y;
      this.buffer[off + 2] = p.size;
      this.buffer[off + 3] = alpha;
      this.buffer[off + 4] = cr;
      this.buffer[off + 5] = cg;
      this.buffer[off + 6] = cb;

      this.activeCount++;
    }
  }

  private updateFormation(dt: number, renderState: AEVPRenderState): void {
    const formation = this.formation;
    if (!formation) return;

    const targets = formation.targets;
    const targetCount = Math.min(targets.length, MAX_PARTICLES);
    if (targetCount <= 0) {
      this.endFormation();
      this.updateAmbient(dt, renderState);
      return;
    }

    const assigned: Particle[] = [];

    for (let i = 0; i < MAX_PARTICLES; i++) {
      const p = this.particles[i];
      if (!p.alive) continue;
      assigned.push(p);
    }

    if (assigned.length < targetCount) {
      for (let i = 0; i < MAX_PARTICLES && assigned.length < targetCount; i++) {
        const p = this.particles[i];
        if (p.alive) continue;
        this.spawnParticle(p, genericBehavior, "create");
        p.size = SIZE_MIN + Math.random() * 1.8;
        p.phaseOffset = Math.random() * Math.PI * 2;
        assigned.push(p);
      }
    }

    if (assigned.length > targetCount) {
      for (let i = targetCount; i < assigned.length; i++) {
        assigned[i]!.alive = false;
      }
      assigned.length = targetCount;
    }

    const dissolving = this.time >= formation.holdUntil;
    const dissolveDuration = Math.max(0.001, formation.dissolveUntil - formation.holdUntil);
    const dissolveProgress = dissolving
      ? clamp((this.time - formation.holdUntil) / dissolveDuration, 0, 1)
      : 0;
    const buildDuration = Math.max(0.001, formation.buildUntil - formation.startAt);
    const buildProgress = clamp((this.time - formation.startAt) / buildDuration, 0, 1);
    const buildEnvelope = this.time < formation.buildUntil ? easeInOutCubic(buildProgress) : 1;

    const spring = (7 + renderState.particleSpeed * 6) * (0.35 + buildEnvelope * 0.65);
    const damping = dissolving ? 0.8 : this.time < formation.buildUntil ? 0.93 : 0.905;
    const holdJitter = dissolving ? 0 : this.time < formation.buildUntil ? 0.0002 : 0.00055;

    for (let i = 0; i < assigned.length; i++) {
      const p = assigned[i]!;
      const target = targets[i]!;

      p.category = "create";
      p.maxLife = Math.max(p.maxLife, 8);
      p.life = Math.max(p.life, 3);

      p.vx += (target.x - p.x) * spring * dt;
      p.vy += (target.y - p.y) * spring * dt;

      if (holdJitter > 0) {
        p.vx += Math.sin(this.time * 2.2 + p.phaseOffset) * holdJitter;
        p.vy += Math.cos(this.time * 1.7 + p.phaseOffset) * holdJitter;
      }

      if (dissolving) {
        const drift = 0.9 + dissolveProgress * 1.7;
        p.vx += p.x * drift * dt;
        p.vy += p.y * drift * dt;
      }

      p.vx *= damping;
      p.vy *= damping;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.size = clamp(
        p.size * 0.82 + (FORMATION_SIZE_MIN + FORMATION_SIZE_MAX) * 0.5 * 0.18,
        FORMATION_SIZE_MIN,
        FORMATION_SIZE_MAX,
      );
    }

    const dissolveAlpha = dissolving ? 1 - easeInCubic(dissolveProgress) : 1;
    const alphaMultiplier = buildEnvelope * dissolveAlpha;
    const [cr, cg, cb] = renderState.glowColor;
    this.activeCount = assigned.length;

    for (let i = 0; i < assigned.length; i++) {
      const p = assigned[i]!;
      const off = i * FLOATS_PER_PARTICLE;
      this.buffer[off] = p.x;
      this.buffer[off + 1] = p.y;
      this.buffer[off + 2] = clamp(p.size, FORMATION_SIZE_MIN, FORMATION_SIZE_MAX);
      this.buffer[off + 3] = clamp(0.2 + 0.82 * alphaMultiplier, 0, 0.95);
      this.buffer[off + 4] = cr * FORMATION_COLOR_INTENSITY;
      this.buffer[off + 5] = cg * FORMATION_COLOR_INTENSITY;
      this.buffer[off + 6] = cb * FORMATION_COLOR_INTENSITY;
    }

    if (dissolveProgress >= 1) {
      this.endFormation();
    }
  }

  private endFormation(): void {
    this.formation = null;
    this.spawnAccumulator = 0;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const p = this.particles[i];
      if (!p.alive) continue;
      p.life = Math.min(p.life, 0.7);
      p.category = "generic";
    }
  }

  private normalizeFormationText(raw: string): string {
    const normalized = raw
      .trim()
      .replace(/\s+/g, " ")
      .toUpperCase()
      .slice(0, MAX_FORMATION_TEXT_LEN);

    let out = "";
    for (const sourceChar of normalized) {
      const char = normalizeFormationChar(sourceChar);
      if (!char) {
        continue;
      }
      if (this.isAllowedFormationChar(char)) {
        out += char;
      } else {
        out += "?";
      }
    }
    return out.trim();
  }

  private isAllowedFormationChar(ch: string): boolean {
    return (
      (ch >= "A" && ch <= "Z") ||
      (ch >= "0" && ch <= "9") ||
      ch === " " ||
      ch === "?" ||
      ch === "!" ||
      ch === GLYPH_CHECKMARK ||
      ch === GLYPH_HEART ||
      ch === GLYPH_STAR_FILLED ||
      ch === GLYPH_STAR_OUTLINE ||
      ch === GLYPH_CIRCLE_FILLED ||
      ch === GLYPH_CIRCLE_OUTLINE
    );
  }

  private buildTextTargets(
    text: string,
    font: ParticleFormationFont,
    scale: number,
  ): FormationTarget[] {
    if (typeof document === "undefined") return [];

    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 192;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return [];

    // Keep background fully transparent so alpha sampling isolates glyph pixels.
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const density = font === "thin" ? 0.88 : 1;
    const widthScale = Math.max(0.35, Math.min(1, 7 / Math.max(1, text.length)));
    const fontPx = Math.max(38, Math.floor(134 * scale * widthScale * density));
    const choice = resolveFormationFont(font, fontPx, text);

    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `${choice.weight} ${fontPx}px ${choice.family}`;
    ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 2);

    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const pixels = image.data;
    // Use 1px sampling for cleaner glyph topology; downsampling happens later via FPS.
    const sampleStep = 1;
    const alphaThreshold = 120;
    const edgeThreshold = 85;

    const rawPoints: Array<{ x: number; y: number }> = [];
    const edgePoints: Array<{ x: number; y: number }> = [];
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    const alphaAt = (x: number, y: number): number => {
      if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) {
        return 0;
      }
      return pixels[(y * canvas.width + x) * 4 + 3] ?? 0;
    };

    for (let y = 0; y < canvas.height; y += sampleStep) {
      for (let x = 0; x < canvas.width; x += sampleStep) {
        const a = pixels[(y * canvas.width + x) * 4 + 3] ?? 0;
        if (a < alphaThreshold) {
          continue;
        }
        rawPoints.push({ x, y });

        if (
          alphaAt(x + sampleStep, y) < edgeThreshold ||
          alphaAt(x - sampleStep, y) < edgeThreshold ||
          alphaAt(x, y + sampleStep) < edgeThreshold ||
          alphaAt(x, y - sampleStep) < edgeThreshold
        ) {
          edgePoints.push({ x, y });
        }

        if (x < minX) {
          minX = x;
        }
        if (y < minY) {
          minY = y;
        }
        if (x > maxX) {
          maxX = x;
        }
        if (y > maxY) {
          maxY = y;
        }
      }
    }

    if (rawPoints.length === 0) return [];

    const boxW = Math.max(1, maxX - minX + 1);
    const boxH = Math.max(1, maxY - minY + 1);
    const centerX = minX + boxW / 2;
    const centerY = minY + boxH / 2;

    const targetW = 0.72 * scale;
    const targetH = 0.46 * scale;
    const sx = targetW / boxW;
    const sy = targetH / boxH;
    const s = Math.min(sx, sy);

    const sourcePoints =
      edgePoints.length >= Math.min(MAX_PARTICLES, Math.floor(rawPoints.length * 0.55))
        ? edgePoints
        : rawPoints;

    // Add tiny sub-pixel jitter to break horizontal scanline banding from raster samples.
    const jitterPx = font === "thin" ? 0.25 : 0.35;
    const normalized: FormationTarget[] = sourcePoints.map((p) => {
      const jx = (Math.random() - 0.5) * jitterPx;
      const jy = (Math.random() - 0.5) * jitterPx;
      return {
        x: (p.x + jx - centerX) * s,
        y: (centerY - (p.y + jy)) * s + FORMATION_Y_OFFSET,
      };
    });

    return compactPoints(normalized, MAX_PARTICLES);
  }

  private spawnParticle(p: Particle, behavior: ParticleBehavior, category: ToolCategory): void {
    p.angle = 0;
    p.orbitRadius = 0;
    p.phaseOffset = 0;
    p.category = category;

    behavior.spawn(p, this.time);

    p.size = SIZE_MIN + Math.random() * (SIZE_MAX - SIZE_MIN);
    p.maxLife = LIFE_MIN + Math.random() * (LIFE_MAX - LIFE_MIN);
    p.life = p.maxLife;
    p.alive = true;
  }
}
