import { describe, expect, it } from "vitest";
import type { AuthProfileStore } from "../agents/auth-profiles.js";
import { buildAuthChoiceGroups, buildAuthChoiceOptions } from "./auth-choice-options.js";

describe("buildAuthChoiceOptions", () => {
  it("includes GitHub Copilot", () => {
    const store: AuthProfileStore = { version: 1, profiles: {} };
    const options = buildAuthChoiceOptions({
      store,
      includeSkip: false,
    });

    expect(options.find((opt) => opt.value === "github-copilot")).toBeDefined();
  });

  it("includes local runtime choices", () => {
    const store: AuthProfileStore = { version: 1, profiles: {} };
    const options = buildAuthChoiceOptions({
      store,
      includeSkip: false,
    });

    expect(options.some((opt) => opt.value === "lmstudio")).toBe(true);
    expect(options.some((opt) => opt.value === "ollama")).toBe(true);
  });

  it("includes setup-token option for Anthropic", () => {
    const store: AuthProfileStore = { version: 1, profiles: {} };
    const options = buildAuthChoiceOptions({
      store,
      includeSkip: false,
    });

    expect(options.some((opt) => opt.value === "token")).toBe(true);
  });

  it("includes Z.AI (GLM) auth choice", () => {
    const store: AuthProfileStore = { version: 1, profiles: {} };
    const options = buildAuthChoiceOptions({
      store,
      includeSkip: false,
    });

    expect(options.some((opt) => opt.value === "zai-api-key")).toBe(true);
    expect(options.some((opt) => opt.value === "zai-coding-api-key")).toBe(true);
  });

  it("includes Xiaomi auth choice", () => {
    const store: AuthProfileStore = { version: 1, profiles: {} };
    const options = buildAuthChoiceOptions({
      store,
      includeSkip: false,
    });

    expect(options.some((opt) => opt.value === "xiaomi-api-key")).toBe(true);
  });

  it("includes Mistral auth choice", () => {
    const store: AuthProfileStore = { version: 1, profiles: {} };
    const options = buildAuthChoiceOptions({
      store,
      includeSkip: false,
    });

    expect(options.some((opt) => opt.value === "mistral-api-key")).toBe(true);
  });

  it("includes MiniMax auth choice", () => {
    const store: AuthProfileStore = { version: 1, profiles: {} };
    const options = buildAuthChoiceOptions({
      store,
      includeSkip: false,
    });

    expect(options.some((opt) => opt.value === "minimax-api-m27")).toBe(true);
    expect(options.some((opt) => opt.value === "minimax-api-m27-highspeed")).toBe(true);
    expect(options.some((opt) => opt.value === "minimax-api")).toBe(true);
    expect(options.some((opt) => opt.value === "minimax-api-lightning")).toBe(false);
  });

  it("includes Moonshot auth choice", () => {
    const store: AuthProfileStore = { version: 1, profiles: {} };
    const options = buildAuthChoiceOptions({
      store,
      includeSkip: false,
    });

    expect(options.some((opt) => opt.value === "moonshot-api-key")).toBe(true);
    expect(options.some((opt) => opt.value === "moonshot-api-key-cn")).toBe(true);
    expect(options.some((opt) => opt.value === "kimi-code-api-key")).toBe(true);
  });

  it("includes Vercel AI Gateway auth choice", () => {
    const store: AuthProfileStore = { version: 1, profiles: {} };
    const options = buildAuthChoiceOptions({
      store,
      includeSkip: false,
    });

    expect(options.some((opt) => opt.value === "ai-gateway-api-key")).toBe(true);
  });

  it("includes Cloudflare AI Gateway auth choice", () => {
    const store: AuthProfileStore = { version: 1, profiles: {} };
    const options = buildAuthChoiceOptions({
      store,
      includeSkip: false,
    });

    expect(options.some((opt) => opt.value === "cloudflare-ai-gateway-api-key")).toBe(true);
  });

  it("includes Synthetic auth choice", () => {
    const store: AuthProfileStore = { version: 1, profiles: {} };
    const options = buildAuthChoiceOptions({
      store,
      includeSkip: false,
    });

    expect(options.some((opt) => opt.value === "synthetic-api-key")).toBe(true);
  });

  it("includes Chutes OAuth auth choice", () => {
    const store: AuthProfileStore = { version: 1, profiles: {} };
    const options = buildAuthChoiceOptions({
      store,
      includeSkip: false,
    });

    expect(options.some((opt) => opt.value === "chutes")).toBe(true);
  });

  it("includes Qwen auth choice", () => {
    const store: AuthProfileStore = { version: 1, profiles: {} };
    const options = buildAuthChoiceOptions({
      store,
      includeSkip: false,
    });

    expect(options.some((opt) => opt.value === "qwen-portal")).toBe(true);
  });

  it("includes xAI (Grok) auth choice (issue #296)", () => {
    const store: AuthProfileStore = { version: 1, profiles: {} };
    const options = buildAuthChoiceOptions({
      store,
      includeSkip: false,
    });

    expect(options.some((opt) => opt.value === ("xai-api-key" as string))).toBe(true);
  });

  it("includes Groq auth choice (issue #297, Option A)", () => {
    const store: AuthProfileStore = { version: 1, profiles: {} };
    const options = buildAuthChoiceOptions({
      store,
      includeSkip: false,
    });

    expect(options.some((opt) => opt.value === ("groq-api-key" as string))).toBe(true);
  });
});

describe("buildAuthChoiceGroups", () => {
  it("surfaces an xai group with the xai-api-key choice (issue #296)", () => {
    const store: AuthProfileStore = { version: 1, profiles: {} };
    const { groups } = buildAuthChoiceGroups({ store, includeSkip: false });

    const xaiGroup = groups.find((g) => g.value === "xai");
    expect(xaiGroup).toBeDefined();
    expect(xaiGroup?.options.some((opt) => opt.value === ("xai-api-key" as string))).toBe(true);
  });

  it("surfaces a groq group with the groq-api-key choice (issue #297)", () => {
    const store: AuthProfileStore = { version: 1, profiles: {} };
    const { groups } = buildAuthChoiceGroups({ store, includeSkip: false });

    const groqGroup = groups.find((g) => g.value === "groq");
    expect(groqGroup).toBeDefined();
    expect(groqGroup?.options.some((opt) => opt.value === ("groq-api-key" as string))).toBe(true);
  });

  it("does NOT surface an 'inception' group (issue #297, Option B — post-install-only)", () => {
    const store: AuthProfileStore = { version: 1, profiles: {} };
    const { groups } = buildAuthChoiceGroups({ store, includeSkip: false });

    expect(groups.find((g) => g.value === ("inception" as never))).toBeUndefined();
  });
});
