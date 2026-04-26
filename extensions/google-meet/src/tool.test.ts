import { describe, expect, it } from "vitest";
import { createGoogleMeetTool } from "./tool.js";

describe("google_meet tool", () => {
  it("returns setup status for setup action", async () => {
    const tool = createGoogleMeetTool({
      pluginConfig: {
        browser: { profile: "chrome" },
      },
    } as never);

    const result = await tool.execute("tool-1", { action: "setup" });

    expect(result.details).toMatchObject({
      ok: true,
      action: "setup",
      setup: {
        readyForLiveActions: false,
      },
    });
  });

  it("does not claim live join implementation before runtime integration", async () => {
    const tool = createGoogleMeetTool({ pluginConfig: {} } as never);

    const result = await tool.execute("tool-1", {
      action: "join",
      meetingUrl: "https://meet.google.com/abc-defg-hij",
    });

    expect(result.details).toMatchObject({
      ok: false,
      action: "join",
      status: "not_implemented",
    });
  });
});
