import { describe, expect, it } from "vitest";
import { runGoogleMeetRecoverSmoke } from "./recover-smoke.js";

describe("google meet recover smoke runner", () => {
  it("exercises recover_current_tab through a simulated browser runtime", async () => {
    const result = await runGoogleMeetRecoverSmoke();

    expect(result).toMatchObject({
      ok: true,
      truthLabel: "simulated-browser-runtime",
      liveBrowserRuntime: false,
      mode: "single-meet-tab",
      focusedTabs: ["meet-smoke-tab"],
      recover: {
        ok: true,
        action: "recover_current_tab",
        status: "recovered",
      },
    });
  });

  it("keeps the no-tab path truth-labeled without claiming live Meet control", async () => {
    const result = await runGoogleMeetRecoverSmoke({ mode: "no-meet-tab" });

    expect(result).toMatchObject({
      ok: true,
      truthLabel: "simulated-browser-runtime",
      liveBrowserRuntime: false,
      mode: "no-meet-tab",
      focusedTabs: [],
      recover: {
        ok: false,
        action: "recover_current_tab",
        status: "not_found",
        reason: "no_meet_tab",
      },
    });
  });
});
