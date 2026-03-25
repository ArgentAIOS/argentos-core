import { describe, expect, it, vi } from "vitest";
import type { RuntimeEnv } from "../runtime.js";
import type { WizardPrompter } from "../wizard/prompts.js";
import { setupSkills } from "./onboard-skills.js";

const buildWorkspaceSkillStatus = vi.hoisted(() => vi.fn());
const detectBinary = vi.hoisted(() => vi.fn(async () => false));

vi.mock("../agents/skills-status.js", () => ({
  buildWorkspaceSkillStatus,
}));

vi.mock("../agents/skills-install.js", () => ({
  installSkill: vi.fn(),
}));

vi.mock("./onboard-helpers.js", () => ({
  detectBinary,
}));

const noopAsync = async () => {};
const noop = () => {};

function createRuntime(): RuntimeEnv {
  return {
    log: vi.fn(),
    error: vi.fn(),
    exit: vi.fn(),
  };
}

function createBasePrompter(): WizardPrompter {
  return {
    intro: vi.fn(noopAsync),
    outro: vi.fn(noopAsync),
    note: vi.fn(noopAsync),
    select: vi.fn(),
    multiselect: vi.fn(async () => []),
    text: vi.fn(async () => ""),
    confirm: vi.fn(async () => false),
    progress: vi.fn(() => ({ update: noop, stop: noop })),
  };
}

describe("setupSkills", () => {
  it("frames the step as marketplace skills and does not prompt for a node manager when skipped", async () => {
    buildWorkspaceSkillStatus.mockReturnValue({
      skills: [
        {
          eligible: true,
          disabled: false,
          blockedByAllowlist: false,
          install: [],
          missing: { bins: [], env: [] },
        },
      ],
    });

    const prompter = createBasePrompter();
    const select = vi.fn(async (params: { message: string }) => {
      expect(params.message).toBe("Skills setup");
      return "skip";
    });
    prompter.select = select as WizardPrompter["select"];

    const next = await setupSkills({}, "/tmp/workspace", createRuntime(), prompter);

    expect(next).toEqual({});
    expect(prompter.note).toHaveBeenCalledWith(
      expect.stringContaining("Skills are installed from the Argent marketplace."),
      "Marketplace skills",
    );
    expect(select).toHaveBeenCalledTimes(1);
  });

  it("auto-selects an available node manager when installing bundled skill dependencies", async () => {
    buildWorkspaceSkillStatus.mockReturnValue({
      skills: [],
    });
    detectBinary.mockImplementation(async (name: string) => name === "pnpm");

    const prompter = createBasePrompter();
    prompter.select = vi.fn(async () => "install-local") as WizardPrompter["select"];

    const next = await setupSkills({}, "/tmp/workspace", createRuntime(), prompter);

    expect(next.skills?.install?.nodeManager).toBe("pnpm");
  });
});
