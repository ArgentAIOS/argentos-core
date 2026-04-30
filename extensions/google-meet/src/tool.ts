import { Type } from "@sinclair/typebox";
import type { BrowserStatus, BrowserTab } from "../../../src/browser/client.js";
import type { ArgentPluginApi } from "../../../src/plugins/types.js";
import { resolveGoogleMeetSetupStatus, type GoogleMeetConfig } from "./setup.js";

const GoogleMeetToolSchema = Type.Object({
  action: Type.Union([
    Type.Literal("setup"),
    Type.Literal("status"),
    Type.Literal("create"),
    Type.Literal("join"),
    Type.Literal("leave"),
    Type.Literal("recover_current_tab"),
  ]),
  meetingUrl: Type.Optional(
    Type.String({ description: "Google Meet URL for join/recover actions." }),
  ),
  summary: Type.Optional(Type.String({ description: "Optional meeting summary for create." })),
});

function asGoogleMeetConfig(value: unknown): GoogleMeetConfig {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as GoogleMeetConfig)
    : {};
}

export type GoogleMeetBrowserRuntime = {
  status: (profile?: string) => Promise<BrowserStatus>;
  tabs: (profile?: string) => Promise<BrowserTab[]>;
  focusTab: (targetId: string, profile?: string) => Promise<void>;
};

export type GoogleMeetToolDeps = {
  browser?: GoogleMeetBrowserRuntime;
};

function json(payload: unknown) {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    details: payload,
  };
}

function createDefaultBrowserRuntime(): GoogleMeetBrowserRuntime {
  return {
    status: async (profile) => {
      const { browserStatus } = await import("../../../src/browser/client.js");
      return await browserStatus(undefined, { profile });
    },
    tabs: async (profile) => {
      const { browserTabs } = await import("../../../src/browser/client.js");
      return await browserTabs(undefined, { profile });
    },
    focusTab: async (targetId, profile) => {
      const { browserFocusTab } = await import("../../../src/browser/client.js");
      return await browserFocusTab(undefined, targetId, { profile });
    },
  };
}

function isMeetUrl(raw: string | undefined): boolean {
  if (!raw) {
    return false;
  }
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && url.hostname === "meet.google.com";
  } catch {
    return false;
  }
}

function normalizeMeetUrl(raw: unknown): string | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }
  const trimmed = raw.trim();
  return isMeetUrl(trimmed) ? trimmed : undefined;
}

function findMeetTabs(tabs: BrowserTab[], meetingUrl?: string): BrowserTab[] {
  const meetTabs = tabs.filter((tab) => isMeetUrl(tab.url));
  if (!meetingUrl) {
    return meetTabs;
  }
  return meetTabs.filter((tab) => tab.url === meetingUrl || tab.url.startsWith(`${meetingUrl}?`));
}

async function buildBrowserStatus(params: {
  config: GoogleMeetConfig;
  browser: GoogleMeetBrowserRuntime;
  meetingUrl?: string;
}) {
  const setup = resolveGoogleMeetSetupStatus(params.config);
  const profile = setup.browserProfileName;
  if (!profile) {
    return {
      setup,
      browser: {
        ok: false,
        status: "not_ready",
        reason: "browser_profile_missing",
      },
      capabilityStatus: setup.readiness,
    };
  }

  try {
    const status = await params.browser.status(profile);
    const tabs = status.cdpReady ? await params.browser.tabs(profile) : [];
    const meetTabs = findMeetTabs(tabs, params.meetingUrl);
    const currentMeetTab = meetTabs.length === 1 ? meetTabs[0] : undefined;
    return {
      setup,
      browser: {
        ok: true,
        profile,
        running: status.running,
        cdpReady: status.cdpReady === true,
        cdpHttp: status.cdpHttp === true,
        tabCount: tabs.length,
        meetTabCount: meetTabs.length,
        ...(currentMeetTab
          ? {
              currentMeetTab: {
                targetId: currentMeetTab.targetId,
                title: currentMeetTab.title,
                url: currentMeetTab.url,
              },
            }
          : {}),
      },
      capabilityStatus: status.cdpReady === true ? "browser-runtime-ready" : setup.readiness,
    };
  } catch (err) {
    return {
      setup,
      browser: {
        ok: false,
        profile,
        status: "not_ready",
        reason: "browser_unreachable",
        error: err instanceof Error ? err.message : String(err),
      },
      capabilityStatus: setup.readiness,
    };
  }
}

async function recoverCurrentMeetTab(params: {
  config: GoogleMeetConfig;
  browser: GoogleMeetBrowserRuntime;
  meetingUrl?: string;
}) {
  const status = await buildBrowserStatus(params);
  const setup = status.setup;
  const profile = setup.browserProfileName;
  if (!profile) {
    return json({
      ok: false,
      action: "recover_current_tab",
      status: "not_ready",
      reason: "browser_profile_missing",
      setup,
    });
  }
  if (!status.browser.ok) {
    return json({
      ok: false,
      action: "recover_current_tab",
      status: "not_ready",
      reason: status.browser.reason,
      setup,
      browser: status.browser,
    });
  }
  if (!status.browser.cdpReady) {
    return json({
      ok: false,
      action: "recover_current_tab",
      status: "not_ready",
      reason: "browser_not_running",
      setup,
      browser: status.browser,
    });
  }
  if (status.browser.meetTabCount === 0) {
    return json({
      ok: false,
      action: "recover_current_tab",
      status: "not_found",
      reason: "no_meet_tab",
      setup,
      browser: status.browser,
    });
  }
  if (!status.browser.currentMeetTab) {
    return json({
      ok: false,
      action: "recover_current_tab",
      status: "not_found",
      reason: "multiple_meet_tabs",
      setup,
      browser: status.browser,
    });
  }

  try {
    await params.browser.focusTab(status.browser.currentMeetTab.targetId, profile);
  } catch (err) {
    return json({
      ok: false,
      action: "recover_current_tab",
      status: "not_ready",
      reason: "target_tab_not_found",
      setup,
      browser: status.browser,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return json({
    ok: true,
    action: "recover_current_tab",
    status: "recovered",
    setup,
    browser: status.browser,
    tab: status.browser.currentMeetTab,
  });
}

function liveActionDeferred(action: string, config: GoogleMeetConfig) {
  const setup = resolveGoogleMeetSetupStatus(config);
  return json({
    ok: false,
    action,
    status: "not_implemented",
    reason:
      "Google Meet live actions are gated until browser harness and realtime voice integration land.",
    setup,
  });
}

export function createGoogleMeetTool(api: ArgentPluginApi, deps: GoogleMeetToolDeps = {}) {
  const browser = deps.browser ?? createDefaultBrowserRuntime();
  return {
    name: "google_meet",
    label: "Google Meet",
    description:
      "Inspect Google Meet setup/status. Live join/create actions are planned behind browser and realtime voice integration.",
    parameters: GoogleMeetToolSchema,
    async execute(_toolCallId: string, params: Record<string, unknown>) {
      const config = asGoogleMeetConfig(api.pluginConfig);
      const action = typeof params.action === "string" ? params.action : "";

      switch (action) {
        case "setup":
          return json({ ok: true, action, setup: resolveGoogleMeetSetupStatus(config) });
        case "status": {
          const meetingUrl = normalizeMeetUrl(params.meetingUrl);
          return json({
            ok: true,
            action,
            ...(await buildBrowserStatus({ config, browser, meetingUrl })),
          });
        }
        case "recover_current_tab": {
          const rawMeetingUrl = typeof params.meetingUrl === "string" ? params.meetingUrl : "";
          const meetingUrl = normalizeMeetUrl(rawMeetingUrl);
          if (rawMeetingUrl.trim() && !meetingUrl) {
            return json({
              ok: false,
              action,
              status: "not_found",
              reason: "non_meet_tab",
              setup: resolveGoogleMeetSetupStatus(config),
            });
          }
          return await recoverCurrentMeetTab({ config, browser, meetingUrl });
        }
        case "create":
        case "join":
        case "leave":
          return liveActionDeferred(action, config);
        default:
          throw new Error("unsupported google_meet action");
      }
    },
  };
}
