import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DoctorPrompter } from "./doctor-prompter.js";
import { maybeRemoveDeprecatedCliAuthProfiles } from "./doctor-auth.js";

let originalAgentDir: string | undefined;
let originalPiAgentDir: string | undefined;
let originalStateDir: string | undefined;
let tempAgentDir: string | undefined;
let tempStateDir: string | undefined;

function makePrompter(confirmValue: boolean): DoctorPrompter {
  return {
    confirm: vi.fn().mockResolvedValue(confirmValue),
    confirmRepair: vi.fn().mockResolvedValue(confirmValue),
    confirmAggressive: vi.fn().mockResolvedValue(confirmValue),
    confirmSkipInNonInteractive: vi.fn().mockResolvedValue(confirmValue),
    select: vi.fn().mockResolvedValue(""),
    shouldRepair: confirmValue,
    shouldForce: false,
  };
}

beforeEach(() => {
  originalAgentDir = process.env.ARGENT_AGENT_DIR;
  originalPiAgentDir = process.env.PI_CODING_AGENT_DIR;
  originalStateDir = process.env.ARGENT_STATE_DIR;
  tempAgentDir = fs.mkdtempSync(path.join(os.tmpdir(), "argent-auth-"));
  tempStateDir = fs.mkdtempSync(path.join(os.tmpdir(), "argent-state-"));
  process.env.ARGENT_AGENT_DIR = tempAgentDir;
  process.env.PI_CODING_AGENT_DIR = tempAgentDir;
  // The deprecated-profile sweep walks <stateDir>/agents/<id>/agent for every
  // configured agent — isolate it so tests never touch the real state dir.
  process.env.ARGENT_STATE_DIR = tempStateDir;
});

afterEach(() => {
  if (originalAgentDir === undefined) {
    delete process.env.ARGENT_AGENT_DIR;
  } else {
    process.env.ARGENT_AGENT_DIR = originalAgentDir;
  }
  if (originalPiAgentDir === undefined) {
    delete process.env.PI_CODING_AGENT_DIR;
  } else {
    process.env.PI_CODING_AGENT_DIR = originalPiAgentDir;
  }
  if (originalStateDir === undefined) {
    delete process.env.ARGENT_STATE_DIR;
  } else {
    process.env.ARGENT_STATE_DIR = originalStateDir;
  }
  if (tempAgentDir) {
    fs.rmSync(tempAgentDir, { recursive: true, force: true });
    tempAgentDir = undefined;
  }
  if (tempStateDir) {
    fs.rmSync(tempStateDir, { recursive: true, force: true });
    tempStateDir = undefined;
  }
});

describe("maybeRemoveDeprecatedCliAuthProfiles", () => {
  it("removes deprecated CLI auth profiles from store + config", async () => {
    if (!tempAgentDir) {
      throw new Error("Missing temp agent dir");
    }
    const authPath = path.join(tempAgentDir, "auth-profiles.json");
    fs.writeFileSync(
      authPath,
      `${JSON.stringify(
        {
          version: 1,
          profiles: {
            "anthropic:claude-cli": {
              type: "oauth",
              provider: "anthropic",
              access: "token-a",
              refresh: "token-r",
              expires: Date.now() + 60_000,
            },
            "openai-codex:codex-cli": {
              type: "oauth",
              provider: "openai-codex",
              access: "token-b",
              refresh: "token-r2",
              expires: Date.now() + 60_000,
            },
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const cfg = {
      auth: {
        profiles: {
          "anthropic:claude-cli": { provider: "anthropic", mode: "oauth" },
          "openai-codex:codex-cli": { provider: "openai-codex", mode: "oauth" },
        },
        order: {
          anthropic: ["anthropic:claude-cli"],
          "openai-codex": ["openai-codex:codex-cli"],
        },
      },
    } as const;

    const next = await maybeRemoveDeprecatedCliAuthProfiles(cfg, makePrompter(true));

    const raw = JSON.parse(fs.readFileSync(authPath, "utf8")) as {
      profiles?: Record<string, unknown>;
    };
    expect(raw.profiles?.["anthropic:claude-cli"]).toBeUndefined();
    expect(raw.profiles?.["openai-codex:codex-cli"]).toBeUndefined();

    expect(next.auth?.profiles?.["anthropic:claude-cli"]).toBeUndefined();
    expect(next.auth?.profiles?.["openai-codex:codex-cli"]).toBeUndefined();
    expect(next.auth?.order?.anthropic).toBeUndefined();
    expect(next.auth?.order?.["openai-codex"]).toBeUndefined();
  });

  it("sweeps deprecated profiles from every agent's store, not just the default", async () => {
    if (!tempAgentDir || !tempStateDir) {
      throw new Error("Missing temp dirs");
    }
    // Default agent store (env-pinned): clean, with a real profile that must
    // survive and must NOT be copied into other agents' stores.
    const mainAuthPath = path.join(tempAgentDir, "auth-profiles.json");
    fs.writeFileSync(
      mainAuthPath,
      `${JSON.stringify({
        version: 1,
        profiles: {
          "anthropic:default": { type: "api_key", provider: "anthropic", key: "sk-keep" },
        },
      })}\n`,
      "utf8",
    );
    // Agent literally named "main": carries only the deprecated codex-cli
    // profile (the live-box bug scenario).
    const mainAgentDir = path.join(tempStateDir, "agents", "main", "agent");
    fs.mkdirSync(mainAgentDir, { recursive: true });
    const mainAgentAuthPath = path.join(mainAgentDir, "auth-profiles.json");
    fs.writeFileSync(
      mainAgentAuthPath,
      `${JSON.stringify({
        version: 1,
        profiles: {
          "openai-codex:codex-cli": {
            type: "oauth",
            provider: "openai-codex",
            access: "stale-a",
            refresh: "stale-r",
            expires: Date.now() + 60_000,
          },
        },
        order: { "openai-codex": ["openai-codex:codex-cli"] },
      })}\n`,
      "utf8",
    );

    const cfg = {
      agents: { list: [{ id: "argent", default: true }, { id: "main" }] },
    };

    await maybeRemoveDeprecatedCliAuthProfiles(cfg, makePrompter(true));

    const mainAgentRaw = JSON.parse(fs.readFileSync(mainAgentAuthPath, "utf8")) as {
      profiles?: Record<string, unknown>;
      order?: Record<string, string[]>;
    };
    expect(mainAgentRaw.profiles?.["openai-codex:codex-cli"]).toBeUndefined();
    expect(mainAgentRaw.order?.["openai-codex"]).toBeUndefined();
    // The unmerged (raw) update must not smear default-agent credentials
    // into the other agent's store file.
    expect(mainAgentRaw.profiles?.["anthropic:default"]).toBeUndefined();

    const mainRaw = JSON.parse(fs.readFileSync(mainAuthPath, "utf8")) as {
      profiles?: Record<string, unknown>;
    };
    expect(mainRaw.profiles?.["anthropic:default"]).toBeDefined();
  });
});
