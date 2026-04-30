import { pathToFileURL } from "node:url";
import { createGoogleMeetTool, type GoogleMeetBrowserRuntime } from "./tool.js";

export type GoogleMeetRecoverSmokeMode = "single-meet-tab" | "no-meet-tab";

export type GoogleMeetRecoverSmokeResult = {
  ok: boolean;
  truthLabel: "simulated-browser-runtime";
  mode: GoogleMeetRecoverSmokeMode;
  liveBrowserRuntime: false;
  focusedTabs: string[];
  setup: unknown;
  status: unknown;
  recover: unknown;
};

export type GoogleMeetRecoverSmokeOptions = {
  mode?: GoogleMeetRecoverSmokeMode;
};

function createSmokeBrowserRuntime(mode: GoogleMeetRecoverSmokeMode): GoogleMeetBrowserRuntime & {
  focusedTabs: string[];
} {
  const focusedTabs: string[] = [];
  return {
    focusedTabs,
    status: async () => ({
      enabled: true,
      profile: "chrome",
      running: true,
      cdpReady: true,
      cdpHttp: true,
      pid: 1,
      cdpPort: 18792,
      cdpUrl: "http://127.0.0.1:18792",
      chosenBrowser: "chrome",
      userDataDir: "/tmp/argent-google-meet-smoke",
      color: "#00AA00",
      headless: false,
      attachOnly: false,
    }),
    tabs: async () =>
      mode === "single-meet-tab"
        ? [
            {
              targetId: "meet-smoke-tab",
              title: "Meet smoke",
              url: "https://meet.google.com/abc-defg-hij",
              type: "page",
            },
          ]
        : [],
    focusTab: async (targetId) => {
      focusedTabs.push(targetId);
    },
  };
}

function readMode(value: string | undefined): GoogleMeetRecoverSmokeMode {
  return value === "no-meet-tab" ? "no-meet-tab" : "single-meet-tab";
}

export async function runGoogleMeetRecoverSmoke({
  mode = "single-meet-tab",
}: GoogleMeetRecoverSmokeOptions = {}): Promise<GoogleMeetRecoverSmokeResult> {
  const browser = createSmokeBrowserRuntime(mode);
  const tool = createGoogleMeetTool(
    {
      pluginConfig: {
        enabled: true,
        browser: { profile: "chrome" },
      },
    } as never,
    { browser },
  );

  const setup = await tool.execute("google-meet-smoke", { action: "setup" });
  const status = await tool.execute("google-meet-smoke", { action: "status" });
  const recover = await tool.execute("google-meet-smoke", { action: "recover_current_tab" });

  return {
    ok:
      mode === "single-meet-tab"
        ? recover.details &&
          typeof recover.details === "object" &&
          "status" in recover.details &&
          recover.details.status === "recovered"
        : recover.details &&
          typeof recover.details === "object" &&
          "reason" in recover.details &&
          recover.details.reason === "no_meet_tab",
    truthLabel: "simulated-browser-runtime",
    mode,
    liveBrowserRuntime: false,
    focusedTabs: browser.focusedTabs,
    setup: setup.details,
    status: status.details,
    recover: recover.details,
  };
}

async function main(): Promise<void> {
  const result = await runGoogleMeetRecoverSmoke({
    mode: readMode(process.env.ARGENT_GOOGLE_MEET_RECOVER_SMOKE_MODE),
  });
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
