/**
 * AEVP Phase 4 — Speech Analyser Bridge
 *
 * Two components:
 *   AmplitudeTracker: wraps AnalyserNode → amplitude 0-1
 *   VisemeScheduler:  text-based viseme estimation synced to audio duration
 *
 * SpeechAnalyserBridge combines both for use in App.tsx.
 */

import type { VisemeCategory } from "../types/agentState";

// ── Viseme character mapping ────────────────────────────────────────────────

const CHAR_VISEME: Record<string, VisemeCategory> = {};

// rest: space, punctuation, silence
for (const c of " .,;:!?-–—'\"()[]{}…\n\t\r") CHAR_VISEME[c] = "rest";

// open: a, ah, aa
for (const c of "aAàáâãäåæ") CHAR_VISEME[c] = "open";
CHAR_VISEME["h"] = "open";
CHAR_VISEME["H"] = "open";

// round: o, u, w, oo
for (const c of "oOòóôõöøuUùúûüwW") CHAR_VISEME[c] = "round";

// wide: e, i, ee
for (const c of "eEèéêëiIìíîïyY") CHAR_VISEME[c] = "wide";

// closed: m, b, p
for (const c of "mMbBpP") CHAR_VISEME[c] = "closed";

// teeth: f, v, s, z, th
for (const c of "fFvVsSzZtTdDnNlLrRcCgGjJkKqQxX") CHAR_VISEME[c] = "teeth";

function charToViseme(ch: string): VisemeCategory {
  return CHAR_VISEME[ch] ?? "rest";
}

// ── AmplitudeTracker ────────────────────────────────────────────────────────

export class AmplitudeTracker {
  private analyser: AnalyserNode | null = null;
  private dataArray: Uint8Array<ArrayBuffer> | null = null;
  private rafId = 0;
  private running = false;
  onAmplitude: ((value: number) => void) | null = null;

  attach(analyser: AnalyserNode): void {
    this.detach();
    this.analyser = analyser;
    this.dataArray = new Uint8Array(analyser.frequencyBinCount);
    this.running = true;
    this.tick();
  }

  detach(): void {
    this.running = false;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
    this.analyser = null;
    this.dataArray = null;
  }

  private tick = (): void => {
    if (!this.running || !this.analyser || !this.dataArray) return;
    this.rafId = requestAnimationFrame(this.tick);

    this.analyser.getByteFrequencyData(this.dataArray);

    // Voice range: lower 30% of frequency bins (matches Live2DAvatar algorithm)
    const voiceBins = Math.floor(this.dataArray.length * 0.3);
    let sum = 0;
    for (let i = 0; i < voiceBins; i++) {
      sum += this.dataArray[i];
    }
    const avg = sum / voiceBins;

    // Normalize: threshold at 30, max at 200 → 0-1
    const threshold = 30;
    const amplitude = Math.min(1, Math.max(0, (avg - threshold) / (200 - threshold)));

    this.onAmplitude?.(amplitude);
  };
}

// ── VisemeScheduler ─────────────────────────────────────────────────────────

export class VisemeScheduler {
  private timeouts: ReturnType<typeof setTimeout>[] = [];
  onViseme: ((category: VisemeCategory) => void) | null = null;

  start(text: string, durationMs: number): void {
    this.stop();

    if (!text || durationMs <= 0) return;

    const chars = [...text];
    const charDuration = durationMs / chars.length;

    let elapsed = 0;
    let lastViseme: VisemeCategory = "rest";

    for (const ch of chars) {
      const viseme = charToViseme(ch);
      // Only schedule if viseme changed (reduces timer count)
      if (viseme !== lastViseme) {
        const delay = elapsed;
        this.timeouts.push(
          setTimeout(() => {
            this.onViseme?.(viseme);
          }, delay),
        );
        lastViseme = viseme;
      }
      elapsed += charDuration;
    }

    // Return to rest at end
    this.timeouts.push(
      setTimeout(() => {
        this.onViseme?.("rest");
      }, durationMs),
    );
  }

  stop(): void {
    for (const t of this.timeouts) clearTimeout(t);
    this.timeouts = [];
  }
}

// ── Combined Bridge ─────────────────────────────────────────────────────────

export class SpeechAnalyserBridge {
  readonly amplitude = new AmplitudeTracker();
  readonly visemes = new VisemeScheduler();

  attachAnalyser(analyser: AnalyserNode): void {
    this.amplitude.attach(analyser);
  }

  startVisemes(text: string, durationMs: number): void {
    this.visemes.start(text, durationMs);
  }

  stop(): void {
    this.amplitude.detach();
    this.visemes.stop();
  }

  destroy(): void {
    this.stop();
    this.amplitude.onAmplitude = null;
    this.visemes.onViseme = null;
  }
}
