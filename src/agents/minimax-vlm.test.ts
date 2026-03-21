import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../infra/service-keys.js", () => ({
  resolveServiceKey: vi.fn(),
}));

import { resolveServiceKey } from "../infra/service-keys.js";
import { resolveMinimaxApiKey } from "./minimax-vlm.js";

const ORIGINAL_ENV = {
  ARGENT_STATE_DIR: process.env.ARGENT_STATE_DIR,
  ARGENT_AGENT_ID: process.env.ARGENT_AGENT_ID,
  ARGENT_AGENT_DIR: process.env.ARGENT_AGENT_DIR,
  PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR,
  HOME: process.env.HOME,
  MINIMAX_API_KEY: process.env.MINIMAX_API_KEY,
};

function restoreEnv() {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value == null) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

describe("resolveMinimaxApiKey", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    restoreEnv();
    delete process.env.ARGENT_STATE_DIR;
    delete process.env.ARGENT_AGENT_ID;
    delete process.env.ARGENT_AGENT_DIR;
    delete process.env.PI_CODING_AGENT_DIR;
    delete process.env.MINIMAX_API_KEY;
  });

  afterEach(() => {
    restoreEnv();
  });

  it("prefers dashboard/service-key resolution over file fallback", () => {
    vi.mocked(resolveServiceKey).mockImplementation((name: string) =>
      name === "MINIMAX_CODE_PLAN_KEY" ? "sk-service-code" : undefined,
    );

    const resolved = resolveMinimaxApiKey();

    expect(resolved).toBe("sk-service-code");
    expect(resolveServiceKey).toHaveBeenCalledWith("MINIMAX_CODE_PLAN_KEY");
  });

  it("falls back to argent-models.json provider key when service key is missing", () => {
    vi.mocked(resolveServiceKey).mockReturnValue(undefined);

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "argent-minimax-vlm-"));
    const agentDir = path.join(tmp, "agent");
    fs.mkdirSync(agentDir, { recursive: true });
    fs.writeFileSync(
      path.join(agentDir, "argent-models.json"),
      JSON.stringify({
        providers: {
          minimax: {
            apiKey: "sk-from-models-json",
          },
        },
      }),
    );
    process.env.ARGENT_AGENT_DIR = agentDir;

    const resolved = resolveMinimaxApiKey();
    expect(resolved).toBe("sk-from-models-json");
  });

  it("resolves env var indirection stored in argent-models.json", () => {
    vi.mocked(resolveServiceKey).mockReturnValue(undefined);

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "argent-minimax-vlm-env-"));
    const agentDir = path.join(tmp, "agent");
    fs.mkdirSync(agentDir, { recursive: true });
    fs.writeFileSync(
      path.join(agentDir, "argent-models.json"),
      JSON.stringify({
        providers: {
          minimax: {
            apiKey: "MINIMAX_API_KEY",
          },
        },
      }),
    );
    process.env.ARGENT_AGENT_DIR = agentDir;
    process.env.MINIMAX_API_KEY = "sk-from-env-var-name";

    const resolved = resolveMinimaxApiKey();
    expect(resolved).toBe("sk-from-env-var-name");
  });
});
