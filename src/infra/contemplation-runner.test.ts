import { describe, expect, it } from "vitest";
import {
  buildContemplationPublicationPolicyPrompt,
  isAutonomousContemplationRelevantTask,
} from "./contemplation-runner.js";

describe("buildContemplationPublicationPolicyPrompt", () => {
  it("defaults contemplation cycles to internal continuity instead of forced publication", () => {
    const prompt = buildContemplationPublicationPolicyPrompt();

    expect(prompt).toContain("Do not force an external artifact every cycle");
    expect(prompt).toContain("Internal continuity is the default");
    expect(prompt).toContain("episode capture plus memory_store");
  });

  it("gates DocPanel publication to novel operator-relevant artifacts", () => {
    const prompt = buildContemplationPublicationPolicyPrompt();

    expect(prompt).toContain(
      "Use doc_panel only when the output is genuinely novel and operator-relevant",
    );
    expect(prompt).toContain(
      "update the existing document instead of creating a near-duplicate new one",
    );
    expect(prompt).toContain("Do not use DocPanel for repetitive reformulations");
  });

  it("only surfaces explicitly assigned non-project tasks to contemplation", () => {
    expect(
      isAutonomousContemplationRelevantTask(
        {
          type: "one-time",
          assignee: undefined,
        },
        "argent",
      ),
    ).toBe(false);

    expect(
      isAutonomousContemplationRelevantTask(
        {
          type: "project",
          assignee: "argent",
        },
        "argent",
      ),
    ).toBe(false);

    expect(
      isAutonomousContemplationRelevantTask(
        {
          type: "one-time",
          assignee: "argent",
        },
        "argent",
      ),
    ).toBe(true);
  });
});
