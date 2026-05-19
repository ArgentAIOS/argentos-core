import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RuntimeEnv } from "../runtime.js";
import type { WizardPrompter } from "../wizard/prompts.js";
import { applyAuthChoice } from "./auth-choice.js";

const noopAsync = async () => {};
const noop = () => {};
const authProfilePathFor = (agentDir: string) => path.join(agentDir, "auth-profiles.json");
const requireAgentDir = () => {
  const agentDir = process.env.ARGENT_AGENT_DIR;
  if (!agentDir) {
    throw new Error("ARGENT_AGENT_DIR not set");
  }
  return agentDir;
};

function buildPrompter(opts: {
  text?: ReturnType<typeof vi.fn>;
  confirm?: ReturnType<typeof vi.fn>;
}): WizardPrompter {
  return {
    intro: vi.fn(noopAsync),
    outro: vi.fn(noopAsync),
    note: vi.fn(noopAsync),
    select: vi.fn(async () => "" as never),
    multiselect: vi.fn(async () => []),
    text: opts.text ?? vi.fn(async () => ""),
    confirm: opts.confirm ?? vi.fn(async () => false),
    progress: vi.fn(() => ({ update: noop, stop: noop })),
  };
}

function buildRuntime(): RuntimeEnv {
  return {
    log: vi.fn(),
    error: vi.fn(),
    exit: vi.fn((code: number) => {
      throw new Error(`exit:${code}`);
    }),
  };
}

describe("applyAuthChoice (xai-api-key, closes #380)", () => {
  const previousStateDir = process.env.ARGENT_STATE_DIR;
  const previousAgentDir = process.env.ARGENT_AGENT_DIR;
  const previousPiAgentDir = process.env.PI_CODING_AGENT_DIR;
  const previousXaiKey = process.env.XAI_API_KEY;
  let tempStateDir: string | null = null;

  afterEach(async () => {
    if (tempStateDir) {
      await fs.rm(tempStateDir, { recursive: true, force: true });
      tempStateDir = null;
    }
    if (previousStateDir === undefined) {
      delete process.env.ARGENT_STATE_DIR;
    } else {
      process.env.ARGENT_STATE_DIR = previousStateDir;
    }
    if (previousAgentDir === undefined) {
      delete process.env.ARGENT_AGENT_DIR;
    } else {
      process.env.ARGENT_AGENT_DIR = previousAgentDir;
    }
    if (previousPiAgentDir === undefined) {
      delete process.env.PI_CODING_AGENT_DIR;
    } else {
      process.env.PI_CODING_AGENT_DIR = previousPiAgentDir;
    }
    if (previousXaiKey === undefined) {
      delete process.env.XAI_API_KEY;
    } else {
      process.env.XAI_API_KEY = previousXaiKey;
    }
  });

  it("prompts for the key, persists it to xai:default, and sets the Grok default model", async () => {
    tempStateDir = await fs.mkdtemp(path.join(os.tmpdir(), "argent-auth-"));
    process.env.ARGENT_STATE_DIR = tempStateDir;
    process.env.ARGENT_AGENT_DIR = path.join(tempStateDir, "agent");
    process.env.PI_CODING_AGENT_DIR = process.env.ARGENT_AGENT_DIR;
    delete process.env.XAI_API_KEY;

    const text = vi.fn().mockResolvedValue("xai-test-key");
    const prompter = buildPrompter({ text });

    const result = await applyAuthChoice({
      authChoice: "xai-api-key",
      config: {},
      prompter,
      runtime: buildRuntime(),
      setDefaultModel: true,
    });

    expect(text).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Enter xAI API key (Grok)" }),
    );
    expect(result.config.agents?.defaults?.model?.primary).toBe("xai/grok-4-fast");
    expect(result.config.agents?.defaults?.models?.["xai/grok-4-fast"]?.alias).toBe("Grok");
    expect(result.config.auth?.profiles?.["xai:default"]).toEqual(
      expect.objectContaining({ provider: "xai", mode: "api_key" }),
    );

    const raw = await fs.readFile(authProfilePathFor(requireAgentDir()), "utf8");
    const parsed = JSON.parse(raw) as {
      profiles?: Record<string, { key?: string; provider?: string }>;
    };
    expect(parsed.profiles?.["xai:default"]?.key).toBe("xai-test-key");
    expect(parsed.profiles?.["xai:default"]?.provider).toBe("xai");
  });

  it("preserves existing primary model when setDefaultModel is false", async () => {
    tempStateDir = await fs.mkdtemp(path.join(os.tmpdir(), "argent-auth-"));
    process.env.ARGENT_STATE_DIR = tempStateDir;
    process.env.ARGENT_AGENT_DIR = path.join(tempStateDir, "agent");
    process.env.PI_CODING_AGENT_DIR = process.env.ARGENT_AGENT_DIR;
    delete process.env.XAI_API_KEY;

    const text = vi.fn().mockResolvedValue("xai-test-key");
    const prompter = buildPrompter({ text });

    const result = await applyAuthChoice({
      authChoice: "xai-api-key",
      config: {
        agents: {
          defaults: {
            model: { primary: "anthropic/claude-opus-4-5" },
          },
        },
      },
      prompter,
      runtime: buildRuntime(),
      setDefaultModel: false,
    });

    expect(result.config.agents?.defaults?.model?.primary).toBe("anthropic/claude-opus-4-5");
    expect(result.agentModelOverride).toBe("xai/grok-4-fast");

    const raw = await fs.readFile(authProfilePathFor(requireAgentDir()), "utf8");
    const parsed = JSON.parse(raw) as {
      profiles?: Record<string, { key?: string }>;
    };
    expect(parsed.profiles?.["xai:default"]?.key).toBe("xai-test-key");
  });
});

describe("applyAuthChoice (groq-api-key, closes #380)", () => {
  const previousStateDir = process.env.ARGENT_STATE_DIR;
  const previousAgentDir = process.env.ARGENT_AGENT_DIR;
  const previousPiAgentDir = process.env.PI_CODING_AGENT_DIR;
  const previousGroqKey = process.env.GROQ_API_KEY;
  let tempStateDir: string | null = null;

  afterEach(async () => {
    if (tempStateDir) {
      await fs.rm(tempStateDir, { recursive: true, force: true });
      tempStateDir = null;
    }
    if (previousStateDir === undefined) {
      delete process.env.ARGENT_STATE_DIR;
    } else {
      process.env.ARGENT_STATE_DIR = previousStateDir;
    }
    if (previousAgentDir === undefined) {
      delete process.env.ARGENT_AGENT_DIR;
    } else {
      process.env.ARGENT_AGENT_DIR = previousAgentDir;
    }
    if (previousPiAgentDir === undefined) {
      delete process.env.PI_CODING_AGENT_DIR;
    } else {
      process.env.PI_CODING_AGENT_DIR = previousPiAgentDir;
    }
    if (previousGroqKey === undefined) {
      delete process.env.GROQ_API_KEY;
    } else {
      process.env.GROQ_API_KEY = previousGroqKey;
    }
  });

  it("prompts for the key, persists it to groq:default, and sets the Llama 3.3 70B default model", async () => {
    tempStateDir = await fs.mkdtemp(path.join(os.tmpdir(), "argent-auth-"));
    process.env.ARGENT_STATE_DIR = tempStateDir;
    process.env.ARGENT_AGENT_DIR = path.join(tempStateDir, "agent");
    process.env.PI_CODING_AGENT_DIR = process.env.ARGENT_AGENT_DIR;
    delete process.env.GROQ_API_KEY;

    const text = vi.fn().mockResolvedValue("gsk-test-key");
    const prompter = buildPrompter({ text });

    const result = await applyAuthChoice({
      authChoice: "groq-api-key",
      config: {},
      prompter,
      runtime: buildRuntime(),
      setDefaultModel: true,
    });

    expect(text).toHaveBeenCalledWith(expect.objectContaining({ message: "Enter Groq API key" }));
    expect(result.config.agents?.defaults?.model?.primary).toBe("groq/llama-3.3-70b-versatile");
    expect(result.config.agents?.defaults?.models?.["groq/llama-3.3-70b-versatile"]?.alias).toBe(
      "Llama 3.3 70B (Groq)",
    );
    expect(result.config.auth?.profiles?.["groq:default"]).toEqual(
      expect.objectContaining({ provider: "groq", mode: "api_key" }),
    );

    const raw = await fs.readFile(authProfilePathFor(requireAgentDir()), "utf8");
    const parsed = JSON.parse(raw) as {
      profiles?: Record<string, { key?: string; provider?: string }>;
    };
    expect(parsed.profiles?.["groq:default"]?.key).toBe("gsk-test-key");
    expect(parsed.profiles?.["groq:default"]?.provider).toBe("groq");
  });

  it("reuses GROQ_API_KEY from env when the operator confirms", async () => {
    tempStateDir = await fs.mkdtemp(path.join(os.tmpdir(), "argent-auth-"));
    process.env.ARGENT_STATE_DIR = tempStateDir;
    process.env.ARGENT_AGENT_DIR = path.join(tempStateDir, "agent");
    process.env.PI_CODING_AGENT_DIR = process.env.ARGENT_AGENT_DIR;
    process.env.GROQ_API_KEY = "gsk-from-env";

    const text = vi.fn();
    const confirm = vi.fn().mockResolvedValue(true);
    const prompter = buildPrompter({ text, confirm });

    const result = await applyAuthChoice({
      authChoice: "groq-api-key",
      config: {},
      prompter,
      runtime: buildRuntime(),
      setDefaultModel: true,
    });

    // Confirm-only — operator accepted the env key, no text prompt fired.
    expect(text).not.toHaveBeenCalled();
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("Use existing GROQ_API_KEY"),
      }),
    );
    expect(result.config.auth?.profiles?.["groq:default"]).toEqual(
      expect.objectContaining({ provider: "groq", mode: "api_key" }),
    );

    const raw = await fs.readFile(authProfilePathFor(requireAgentDir()), "utf8");
    const parsed = JSON.parse(raw) as {
      profiles?: Record<string, { key?: string }>;
    };
    expect(parsed.profiles?.["groq:default"]?.key).toBe("gsk-from-env");
  });
});
