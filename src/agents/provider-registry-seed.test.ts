import { describe, expect, it } from "vitest";
import {
  ONBOARDING_PROVIDER_CARD_SEEDS,
  SEED_VERSION,
  buildSeedRegistry,
} from "./provider-registry-seed.js";

describe("provider-registry seed — xAI/Grok entry (issue #296)", () => {
  it("includes an xai provider in the seed", () => {
    const seed = buildSeedRegistry();
    expect(seed.providers.xai).toBeDefined();
  });

  it("xai entry is wired for openai-completions over api.x.ai", () => {
    const seed = buildSeedRegistry();
    const xai = seed.providers.xai;
    expect(xai).toBeDefined();
    if (!xai) {
      return;
    }
    expect(xai.baseUrl).toBe("https://api.x.ai/v1");
    expect(xai.api).toBe("openai-completions");
    expect(xai.authType).toBe("api_key");
    expect(xai.envKeyVar).toBe("XAI_API_KEY");
  });

  it("seeds the three Grok models referenced elsewhere in the codebase", () => {
    const seed = buildSeedRegistry();
    const xai = seed.providers.xai;
    expect(xai).toBeDefined();
    if (!xai) {
      return;
    }
    const ids = xai.models.map((m) => m.id).toSorted();
    expect(ids).toEqual(["grok-4", "grok-4-fast", "grok-code-fast-1"].toSorted());
  });

  it("Grok-4 prefix is the live-model-filter modern-model anchor (grok-4*)", () => {
    const seed = buildSeedRegistry();
    const xai = seed.providers.xai;
    if (!xai) {
      return;
    }
    // live-model-filter.ts uses prefix "grok-4" to recognize modern xAI ids.
    // All Grok ids we seed must either equal or extend that prefix, OR be
    // tooling-specific (grok-code-fast-1 is intentional).
    const ids = xai.models.map((m) => m.id);
    expect(ids).toContain("grok-4");
    expect(ids.some((id) => id.startsWith("grok-4"))).toBe(true);
  });
});

describe("provider-registry seed — onboarding card surface (issues #296 + #297)", () => {
  it("surfaces xai in ONBOARDING_PROVIDER_CARD_SEEDS", () => {
    const ids = ONBOARDING_PROVIDER_CARD_SEEDS.map((c) => c.id);
    expect(ids).toContain("xai");
  });

  it("surfaces groq in ONBOARDING_PROVIDER_CARD_SEEDS", () => {
    const ids = ONBOARDING_PROVIDER_CARD_SEEDS.map((c) => c.id);
    expect(ids).toContain("groq");
  });

  it("does NOT surface inception in onboarding (Option B — post-install-only)", () => {
    const ids = ONBOARDING_PROVIDER_CARD_SEEDS.map((c) => c.id);
    expect(ids).not.toContain("inception");
  });

  it("inception remains in the registry seed (only the onboarding card is gated)", () => {
    const seed = buildSeedRegistry();
    expect(seed.providers.inception).toBeDefined();
  });

  it("each onboarding card carries the marker fields the wizard reads", () => {
    for (const card of ONBOARDING_PROVIDER_CARD_SEEDS) {
      expect(card.id).toBeTruthy();
      expect(card.label).toBeTruthy();
      expect(card.accent).toBeTruthy();
      expect(card.recommended).toBeTruthy();
      expect(card.description).toBeTruthy();
      expect(card.keyUrl).toMatch(/^https?:\/\//);
      expect(card.onboardingVisible).toBe(true);
    }
  });

  it("bumps SEED_VERSION (must be > 10 to force re-seed after #296/#297)", () => {
    expect(SEED_VERSION).toBeGreaterThanOrEqual(11);
  });
});

describe("provider-registry seed — groq registered (issue #297, Option A)", () => {
  it("groq entry is present with the Groq Cloud baseUrl", () => {
    const seed = buildSeedRegistry();
    const groq = seed.providers.groq;
    expect(groq).toBeDefined();
    if (!groq) {
      return;
    }
    expect(groq.baseUrl).toBe("https://api.groq.com/openai/v1");
    expect(groq.envKeyVar).toBe("GROQ_API_KEY");
  });
});
