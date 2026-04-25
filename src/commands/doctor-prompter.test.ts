import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type RuntimeEnv } from "../runtime.js";
import { createDoctorPrompter } from "./doctor-prompter.js";

const runtime: RuntimeEnv = {
  log: () => {},
  error: () => {},
  exit: (code: number) => {
    throw new Error(`exit ${code}`);
  },
};

let originalIsTTY: boolean | undefined;

function setStdinTty(value: boolean | undefined) {
  Object.defineProperty(process.stdin, "isTTY", {
    value,
    configurable: true,
  });
}

beforeEach(() => {
  originalIsTTY = process.stdin.isTTY;
});

afterEach(() => {
  setStdinTty(originalIsTTY);
});

describe("createDoctorPrompter", () => {
  it("applies repair prompts when --repair is combined with --non-interactive", async () => {
    setStdinTty(false);

    const prompter = createDoctorPrompter({
      runtime,
      options: { nonInteractive: true, repair: true },
    });

    await expect(
      prompter.confirmSkipInNonInteractive({
        message: "Create OAuth dir?",
        initialValue: true,
      }),
    ).resolves.toBe(true);
    await expect(
      prompter.confirmRepair({
        message: "Apply recommended repair?",
        initialValue: true,
      }),
    ).resolves.toBe(true);
  });

  it("keeps aggressive repairs gated unless --force is also set", async () => {
    setStdinTty(false);

    const repairOnly = createDoctorPrompter({
      runtime,
      options: { nonInteractive: true, repair: true },
    });
    await expect(
      repairOnly.confirmAggressive({
        message: "Overwrite service config?",
        initialValue: true,
      }),
    ).resolves.toBe(false);

    const forced = createDoctorPrompter({
      runtime,
      options: { nonInteractive: true, repair: true, force: true },
    });
    await expect(
      forced.confirmAggressive({
        message: "Overwrite service config?",
        initialValue: false,
      }),
    ).resolves.toBe(true);
  });
});
