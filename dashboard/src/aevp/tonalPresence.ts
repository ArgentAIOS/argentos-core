/**
 * AEVP Phase 6 — Tonal Presence Engine
 *
 * Web Audio API class that generates subtle ambient tones mapped
 * to emotional state. Provides subliminal audio presence:
 *   - Ambient tone: very quiet oscillator tuned to mood
 *   - Breathing audio: volume-modulated at breathing rate
 *   - State chimes: brief micro-sounds on mood change
 *   - Pre-speech cue: rising tone before TTS starts
 */

import type { EmotionalState } from "../types/agentState";
import type { TonalPresenceConfig } from "./types";

// ── Mood → frequency mapping ──────────────────────────────────────────────

type MoodCategory = "warm" | "cool" | "neutral" | "alert";

interface TonalProfile {
  frequency: number; // Hz
  waveform: OscillatorType;
  detune: number; // cents (slight detuning for richness)
}

const MOOD_TONAL: Record<string, MoodCategory> = {
  // Warm / positive
  happy: "warm",
  excited: "warm",
  joyful: "warm",
  grateful: "warm",
  proud: "warm",
  content: "warm",
  playful: "warm",
  amused: "warm",
  enthusiastic: "warm",
  loving: "warm",
  confident: "warm",
  determined: "warm",
  // Cool / analytical
  focused: "cool",
  curious: "cool",
  analytical: "cool",
  thoughtful: "cool",
  contemplative: "cool",
  reflective: "cool",
  // Neutral
  neutral: "neutral",
  calm: "neutral",
  serene: "neutral",
  // Alert / negative
  sad: "alert",
  melancholy: "alert",
  frustrated: "alert",
  anxious: "alert",
  concerned: "alert",
  embarrassed: "alert",
  vulnerable: "alert",
  surprised: "alert",
  uncertain: "alert",
};

function getTonalProfile(mood: string, arousal: number): TonalProfile {
  const category = MOOD_TONAL[mood.toLowerCase().trim()] ?? "neutral";
  // Arousal slightly raises pitch within each range
  const arousalShift = arousal * 30;

  switch (category) {
    case "warm":
      return { frequency: 190 + arousalShift, waveform: "sine", detune: -5 };
    case "cool":
      return { frequency: 310 + arousalShift, waveform: "triangle", detune: 0 };
    case "neutral":
      return { frequency: 230 + arousalShift, waveform: "sine", detune: -3 };
    case "alert":
      return { frequency: 370 + arousalShift, waveform: "triangle", detune: 8 };
  }
}

// ── Engine ─────────────────────────────────────────────────────────────────

export class TonalPresenceEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private ambientOsc: OscillatorNode | null = null;
  private ambientGain: GainNode | null = null;
  private breathingLfo: OscillatorNode | null = null;
  private breathingGain: GainNode | null = null;
  private config: TonalPresenceConfig;
  private destroyed = false;
  private started = false;

  constructor(config: TonalPresenceConfig) {
    this.config = { ...config };
  }

  // ── Lazy init (must be called after user gesture) ──────────────────────

  private ensureContext(): AudioContext | null {
    if (this.destroyed) return null;
    if (this.ctx) return this.ctx;

    try {
      this.ctx = new AudioContext();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.config.volume;
      this.masterGain.connect(this.ctx.destination);
      return this.ctx;
    } catch (e) {
      console.warn("[TonalPresence] Failed to create AudioContext:", e);
      return null;
    }
  }

  private startAmbient(profile: TonalProfile): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain || !this.config.ambientTone) return;
    if (this.ambientOsc) return; // Already running

    // Ambient oscillator
    this.ambientGain = ctx.createGain();
    this.ambientGain.gain.value = 0.5; // Relative to master
    this.ambientGain.connect(this.masterGain);

    this.ambientOsc = ctx.createOscillator();
    this.ambientOsc.type = profile.waveform;
    this.ambientOsc.frequency.value = profile.frequency;
    this.ambientOsc.detune.value = profile.detune;
    this.ambientOsc.connect(this.ambientGain);
    this.ambientOsc.start();
    this.started = true;
  }

  private startBreathing(rate: number): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain || !this.config.breathingAudio) return;
    if (this.breathingLfo) return; // Already running

    // Breathing modulates ambient volume
    this.breathingGain = ctx.createGain();
    this.breathingGain.gain.value = 0.3;
    this.breathingGain.connect(this.masterGain);

    // LFO for breathing rhythm
    this.breathingLfo = ctx.createOscillator();
    this.breathingLfo.type = "sine";
    this.breathingLfo.frequency.value = rate;

    // Connect LFO to modulate the breathing gain
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.15; // Modulation depth
    this.breathingLfo.connect(lfoGain);
    if (this.ambientGain) {
      lfoGain.connect(this.ambientGain.gain);
    }
    this.breathingLfo.start();
  }

  // ── Public API ─────────────────────────────────────────────────────────

  updateEmotional(emotional: EmotionalState): void {
    if (!this.config.enabled || this.destroyed) return;

    const profile = getTonalProfile(emotional.mood.state, emotional.arousal);

    if (!this.started) {
      this.startAmbient(profile);
      this.startBreathing(0.2);
      return;
    }

    // Smooth frequency transition
    if (this.ambientOsc && this.ctx) {
      const now = this.ctx.currentTime;
      this.ambientOsc.frequency.linearRampToValueAtTime(profile.frequency, now + 1.5);
      this.ambientOsc.detune.linearRampToValueAtTime(profile.detune, now + 1.5);
      // Can't change waveform smoothly — only on large category shifts
    }
  }

  updateBreathing(rate: number): void {
    if (!this.config.enabled || this.destroyed || !this.breathingLfo || !this.ctx) return;
    const now = this.ctx.currentTime;
    this.breathingLfo.frequency.linearRampToValueAtTime(Math.max(rate, 0.05), now + 0.5);
  }

  playChime(type: "mood" | "activity" | "alert"): void {
    if (!this.config.enabled || !this.config.stateChimes || this.destroyed) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;

    const chimeGain = ctx.createGain();
    chimeGain.connect(this.masterGain);

    const osc = ctx.createOscillator();
    const now = ctx.currentTime;

    // Different chime profiles
    switch (type) {
      case "mood":
        osc.type = "sine";
        osc.frequency.setValueAtTime(440, now);
        osc.frequency.exponentialRampToValueAtTime(660, now + 0.1);
        chimeGain.gain.setValueAtTime(0.6, now);
        chimeGain.gain.exponentialRampToValueAtTime(0.01, now + 0.25);
        break;
      case "activity":
        osc.type = "triangle";
        osc.frequency.setValueAtTime(520, now);
        osc.frequency.exponentialRampToValueAtTime(380, now + 0.08);
        chimeGain.gain.setValueAtTime(0.4, now);
        chimeGain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
        break;
      case "alert":
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(300, now);
        osc.frequency.linearRampToValueAtTime(500, now + 0.05);
        osc.frequency.linearRampToValueAtTime(300, now + 0.15);
        chimeGain.gain.setValueAtTime(0.5, now);
        chimeGain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
        break;
    }

    osc.connect(chimeGain);
    osc.start(now);
    osc.stop(now + 0.35);
  }

  playPreSpeechCue(): void {
    if (!this.config.enabled || !this.config.preSpeechCue || this.destroyed) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;

    const now = ctx.currentTime;
    const cueGain = ctx.createGain();
    cueGain.connect(this.masterGain);

    // Subtle rising "inhale" tone
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(180, now);
    osc.frequency.exponentialRampToValueAtTime(280, now + 0.2);

    cueGain.gain.setValueAtTime(0, now);
    cueGain.gain.linearRampToValueAtTime(0.4, now + 0.08);
    cueGain.gain.exponentialRampToValueAtTime(0.01, now + 0.22);

    osc.connect(cueGain);
    osc.start(now);
    osc.stop(now + 0.25);
  }

  updateConfig(config: TonalPresenceConfig): void {
    this.config = { ...config };

    if (this.masterGain) {
      this.masterGain.gain.value = config.volume;
    }

    // If disabled, stop all oscillators
    if (!config.enabled) {
      this.stopAll();
    }
  }

  private stopAll(): void {
    try {
      this.ambientOsc?.stop();
    } catch {
      /* already stopped */
    }
    try {
      this.breathingLfo?.stop();
    } catch {
      /* already stopped */
    }
    this.ambientOsc = null;
    this.breathingLfo = null;
    this.ambientGain = null;
    this.breathingGain = null;
    this.started = false;
  }

  destroy(): void {
    this.destroyed = true;
    this.stopAll();
    if (this.ctx?.state !== "closed") {
      this.ctx?.close().catch(() => {});
    }
    this.ctx = null;
    this.masterGain = null;
  }
}
