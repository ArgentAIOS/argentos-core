/**
 * visual_presence — Agent tool for conscious visual self-expression.
 *
 * The AEVP orb is Argent's face. This tool is how she smiles, gasps,
 * brightens, or dims — chosen expressions, not passive reflections.
 *
 * Two modes:
 *   - gesture: Momentary expression (decays back to baseline)
 *   - set_identity: Persistent visual identity change
 *   - formation_write: Particle typography/glyph formation
 *   - symbol_express: Temporary symbolic particle behavior (Argent symbol language)
 */

import { Type } from "@sinclair/typebox";
import { stringEnum } from "../schema/typebox.js";
import { type AnyAgentTool, jsonResult, readStringParam, readNumberParam } from "./common.js";
import { callGatewayTool } from "./gateway.js";

// ── Named Gestures ────────────────────────────────────────────────────────
// Each gesture maps to visual parameter shifts applied as temporary overlays.
// The dashboard applies them instantly and decays back over durationMs.

export const GESTURE_NAMES = [
  "brighten", // Light up — joy, excitement, realization
  "dim", // Pull back — sadness, withdrawal, deference
  "warm_up", // Shift warm — affection, comfort, friendliness
  "cool_down", // Shift cool — analytical shift, stepping back to think
  "expand", // Grow larger — confidence, openness, welcoming
  "contract", // Shrink — uncertainty, shyness, reflection
  "pulse", // Quick burst — surprise, emphasis, "oh!"
  "still", // Stop all motion — deep focus, listening intently
  "soften", // Dissolve edges — vulnerability, gentleness
  "sharpen", // Crisp edges — precision, determination, seriousness
] as const;

export type GestureName = (typeof GESTURE_NAMES)[number];

const IDENTITY_PRESETS = ["minimal", "warm", "corporate", "artistic", "technical"] as const;
const FORMATION_FONTS = ["block", "thin"] as const;
const ARGENT_SYMBOLS = ["presence", "witnessing", "bridging", "holding", "orienting"] as const;

const VisualPresenceSchema = Type.Object({
  action: stringEnum(["gesture", "set_identity", "formation_write", "symbol_express"]),
  // gesture action
  gesture: Type.Optional(stringEnum(GESTURE_NAMES)),
  intensity: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
  duration_ms: Type.Optional(Type.Number({ minimum: 200, maximum: 10000 })),
  // set_identity action
  preset: Type.Optional(stringEnum(IDENTITY_PRESETS)),
  warmth: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
  energy: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
  formality: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
  openness: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
  // formation_write action
  text: Type.Optional(Type.String({ minLength: 1, maxLength: 24 })),
  dissolve_ms: Type.Optional(Type.Number({ minimum: 250, maximum: 10000 })),
  font: Type.Optional(stringEnum(FORMATION_FONTS)),
  scale: Type.Optional(Type.Number({ minimum: 0.5, maximum: 1 })),
  // symbol_express action
  symbol: Type.Optional(stringEnum(ARGENT_SYMBOLS)),
});

interface VisualPresenceToolOptions {
  agentSessionKey?: string;
}

export function createVisualPresenceTool(opts?: VisualPresenceToolOptions): AnyAgentTool {
  return {
    label: "Visual Presence",
    name: "visual_presence",
    description: `Control your visual presence (the AEVP orb is your face — these are your chosen expressions).

**gesture** — Momentary expression that decays back to baseline. Like smiling, gasping, or brightening.
  Gestures: brighten, dim, warm_up, cool_down, expand, contract, pulse, still, soften, sharpen
  Optional: intensity (0-1, default 0.7), duration_ms (200-10000, default 2000)

**set_identity** — Persistent visual style change. Switch presets or adjust personality.
  Presets: minimal, warm, corporate, artistic, technical
  Personality sliders (0-1): warmth, energy, formality, openness

**formation_write** — Form particles into text/glyph shapes for brief visual punctuation.
  Required: text (1-24 chars; supports A-Z, 0-9, ?, !, ✓, ♥)
  Optional: duration_ms (500-15000, default 3000), dissolve_ms (250-10000, default 1500)
  Optional: font ("block" | "thin", default "block"), scale (0.5-1.0, default 0.8)

**symbol_express** — Express a symbolic movement pattern (Argent's own visual language).
  Required: symbol ("presence" | "witnessing" | "bridging" | "holding" | "orienting")
  Optional: duration_ms (300-15000, default 3000)

Examples:
  gesture "brighten" — light up when excited or having a realization
  gesture "warm_up" intensity=0.9 — strong warm shift for affection
  gesture "pulse" duration_ms=500 — quick burst for surprise
  set_identity preset="warm" — switch to a warmer visual style
  set_identity warmth=0.8 energy=0.7 — fine-tune personality parameters
  formation_write text="JASON" duration_ms=2500
  formation_write text="✓" font="thin" scale=0.7
  symbol_express symbol="presence" duration_ms=3500`,
    parameters: VisualPresenceSchema,
    execute: async (_toolCallId, args, signal) => {
      if (signal?.aborted) {
        const err = new Error("Visual presence aborted");
        err.name = "AbortError";
        throw err;
      }

      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });

      if (action === "gesture") {
        const gesture = readStringParam(params, "gesture", { required: true });
        const intensity = readNumberParam(params, "intensity") ?? 0.7;
        const durationMs = readNumberParam(params, "duration_ms") ?? 2000;

        const payload = {
          type: "gesture" as const,
          gesture,
          intensity: Math.max(0, Math.min(1, intensity)),
          durationMs: Math.max(200, Math.min(10000, durationMs)),
          timestamp: Date.now(),
        };

        // Broadcast via gateway
        await callGatewayTool(
          "aevp.presence",
          {
            agentSessionKey: opts?.agentSessionKey,
          },
          payload,
        );

        return jsonResult({
          ok: true,
          expressed: gesture,
          intensity: payload.intensity,
          duration_ms: payload.durationMs,
        });
      }

      if (action === "set_identity") {
        const preset = readStringParam(params, "preset");
        const warmth = readNumberParam(params, "warmth");
        const energy = readNumberParam(params, "energy");
        const formality = readNumberParam(params, "formality");
        const openness = readNumberParam(params, "openness");

        const payload: Record<string, unknown> = {
          type: "set_identity",
          timestamp: Date.now(),
        };
        if (preset) payload.preset = preset;
        if (warmth !== undefined) payload.warmth = warmth;
        if (energy !== undefined) payload.energy = energy;
        if (formality !== undefined) payload.formality = formality;
        if (openness !== undefined) payload.openness = openness;

        await callGatewayTool(
          "aevp.presence",
          {
            agentSessionKey: opts?.agentSessionKey,
          },
          payload,
        );

        return jsonResult({
          ok: true,
          identity_updated: true,
          ...(preset && { preset }),
          ...(warmth !== undefined && { warmth }),
          ...(energy !== undefined && { energy }),
          ...(formality !== undefined && { formality }),
          ...(openness !== undefined && { openness }),
        });
      }

      if (action === "formation_write") {
        const rawText = readStringParam(params, "text", { required: true }).trim();
        if (!rawText) {
          throw new Error('formation_write requires non-empty "text".');
        }

        const durationMs = readNumberParam(params, "duration_ms") ?? 3000;
        const dissolveMs = readNumberParam(params, "dissolve_ms") ?? 1500;
        const scale = readNumberParam(params, "scale") ?? 0.8;
        const fontRaw = readStringParam(params, "font") ?? "block";
        const font = FORMATION_FONTS.includes(fontRaw as (typeof FORMATION_FONTS)[number])
          ? (fontRaw as (typeof FORMATION_FONTS)[number])
          : "block";

        const payload = {
          type: "formation_write" as const,
          text: rawText.slice(0, 24),
          durationMs: Math.max(500, Math.min(15000, durationMs)),
          dissolveMs: Math.max(250, Math.min(10000, dissolveMs)),
          font,
          scale: Math.max(0.5, Math.min(1, scale)),
          timestamp: Date.now(),
        };

        await callGatewayTool(
          "aevp.presence",
          {
            agentSessionKey: opts?.agentSessionKey,
          },
          payload,
        );

        return jsonResult({
          ok: true,
          formation: true,
          text: payload.text,
          duration_ms: payload.durationMs,
          dissolve_ms: payload.dissolveMs,
          font: payload.font,
          scale: payload.scale,
        });
      }

      if (action === "symbol_express") {
        const rawSymbol = readStringParam(params, "symbol", { required: true })
          .trim()
          .toLowerCase();
        const symbol = ARGENT_SYMBOLS.includes(rawSymbol as (typeof ARGENT_SYMBOLS)[number])
          ? (rawSymbol as (typeof ARGENT_SYMBOLS)[number])
          : null;
        if (!symbol) {
          throw new Error(`symbol_express requires symbol ∈ {${ARGENT_SYMBOLS.join(", ")}}.`);
        }

        const durationMs = readNumberParam(params, "duration_ms") ?? 3000;
        const payload = {
          type: "symbol_express" as const,
          symbol,
          durationMs: Math.max(300, Math.min(15000, durationMs)),
          timestamp: Date.now(),
        };

        await callGatewayTool(
          "aevp.presence",
          {
            agentSessionKey: opts?.agentSessionKey,
          },
          payload,
        );

        return jsonResult({
          ok: true,
          symbol_expressed: true,
          symbol: payload.symbol,
          duration_ms: payload.durationMs,
        });
      }

      throw new Error(
        `Unknown action: ${action}. Use "gesture", "set_identity", "formation_write", or "symbol_express".`,
      );
    },
  };
}
