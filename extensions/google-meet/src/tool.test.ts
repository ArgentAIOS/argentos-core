import { describe, expect, it } from "vitest";
import { createGoogleMeetTool, type GoogleMeetBrowserRuntime } from "./tool.js";

function browserRuntime(opts?: {
  status?: Partial<Awaited<ReturnType<GoogleMeetBrowserRuntime["status"]>>>;
  tabs?: Awaited<ReturnType<GoogleMeetBrowserRuntime["tabs"]>>;
  focusError?: Error;
}): GoogleMeetBrowserRuntime & { focused: string[] } {
  const focused: string[] = [];
  return {
    focused,
    status: async () => ({
      enabled: true,
      profile: "chrome",
      running: true,
      cdpReady: true,
      cdpHttp: true,
      pid: 1,
      cdpPort: 9222,
      cdpUrl: "http://127.0.0.1:9222",
      chosenBrowser: "chrome",
      userDataDir: "/tmp/argent",
      color: "#00AA00",
      headless: false,
      attachOnly: false,
      ...opts?.status,
    }),
    tabs: async () => opts?.tabs ?? [],
    focusTab: async (targetId) => {
      if (opts?.focusError) {
        throw opts.focusError;
      }
      focused.push(targetId);
    },
  };
}

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
        readyForBrowserRecovery: false,
        readyForLiveActions: false,
      },
    });
  });

  it("includes browser status and Meet tab counts for status action", async () => {
    const runtime = browserRuntime({
      tabs: [
        {
          targetId: "tab-1",
          title: "Meet",
          url: "https://meet.google.com/abc-defg-hij",
          type: "page",
        },
        {
          targetId: "tab-2",
          title: "Docs",
          url: "https://docs.google.com/document/d/1",
          type: "page",
        },
      ],
    });
    const tool = createGoogleMeetTool(
      {
        pluginConfig: {
          enabled: true,
          browser: { profile: "chrome" },
        },
      } as never,
      { browser: runtime },
    );

    const result = await tool.execute("tool-1", { action: "status" });

    expect(result.details).toMatchObject({
      ok: true,
      action: "status",
      setup: {
        readyForBrowserRecovery: true,
        readiness: "browser-profile-ready",
      },
      browser: {
        ok: true,
        profile: "chrome",
        running: true,
        cdpReady: true,
        tabCount: 2,
        meetTabCount: 1,
        currentMeetTab: {
          targetId: "tab-1",
          url: "https://meet.google.com/abc-defg-hij",
        },
      },
      capabilityStatus: "browser-runtime-ready",
    });
  });

  it("recovers an already-open Meet tab without claiming join support", async () => {
    const runtime = browserRuntime({
      tabs: [
        {
          targetId: "meet-tab",
          title: "Meet",
          url: "https://meet.google.com/abc-defg-hij",
          type: "page",
        },
      ],
    });
    const tool = createGoogleMeetTool(
      {
        pluginConfig: {
          enabled: true,
          browser: { profile: "chrome" },
        },
      } as never,
      { browser: runtime },
    );

    const result = await tool.execute("tool-1", { action: "recover_current_tab" });

    expect(result.details).toMatchObject({
      ok: true,
      action: "recover_current_tab",
      status: "recovered",
      tab: {
        targetId: "meet-tab",
        url: "https://meet.google.com/abc-defg-hij",
      },
    });
    expect(runtime.focused).toEqual(["meet-tab"]);
  });

  it("blocks recover_current_tab when no browser profile is configured", async () => {
    const tool = createGoogleMeetTool({ pluginConfig: { enabled: true } } as never, {
      browser: browserRuntime(),
    });

    const result = await tool.execute("tool-1", { action: "recover_current_tab" });

    expect(result.details).toMatchObject({
      ok: false,
      action: "recover_current_tab",
      status: "not_ready",
      reason: "browser_profile_missing",
    });
  });

  it("returns not_found when recover_current_tab has no Meet tab", async () => {
    const tool = createGoogleMeetTool(
      {
        pluginConfig: {
          enabled: true,
          browser: { profile: "chrome" },
        },
      } as never,
      {
        browser: browserRuntime({
          tabs: [
            {
              targetId: "tab-1",
              title: "Mail",
              url: "https://mail.google.com/",
              type: "page",
            },
          ],
        }),
      },
    );

    const result = await tool.execute("tool-1", { action: "recover_current_tab" });

    expect(result.details).toMatchObject({
      ok: false,
      action: "recover_current_tab",
      status: "not_found",
      reason: "no_meet_tab",
    });
  });

  it("keeps recover_current_tab browser-only when multiple Meet tabs need disambiguation", async () => {
    const tool = createGoogleMeetTool(
      {
        pluginConfig: {
          enabled: true,
          browser: { profile: "chrome" },
        },
      } as never,
      {
        browser: browserRuntime({
          tabs: [
            {
              targetId: "meet-1",
              title: "Meet 1",
              url: "https://meet.google.com/abc-defg-hij",
              type: "page",
            },
            {
              targetId: "meet-2",
              title: "Meet 2",
              url: "https://meet.google.com/xyz-abcd-efg",
              type: "page",
            },
          ],
        }),
      },
    );

    const result = await tool.execute("tool-1", { action: "recover_current_tab" });

    expect(result.details).toMatchObject({
      ok: false,
      action: "recover_current_tab",
      status: "not_found",
      reason: "multiple_meet_tabs",
    });
  });

  it("rejects non-Meet meetingUrl during recovery", async () => {
    const tool = createGoogleMeetTool(
      {
        pluginConfig: {
          enabled: true,
          browser: { profile: "chrome" },
        },
      } as never,
      { browser: browserRuntime() },
    );

    const result = await tool.execute("tool-1", {
      action: "recover_current_tab",
      meetingUrl: "https://example.com/not-meet",
    });

    expect(result.details).toMatchObject({
      ok: false,
      action: "recover_current_tab",
      status: "not_found",
      reason: "non_meet_tab",
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
