import fs from "node:fs";

export type GoogleMeetConfig = {
  enabled?: boolean;
  oauth?: {
    tokenPath?: string;
  };
  browser?: {
    profile?: string;
  };
  defaultTransport?: "chrome-node" | "local-chrome" | "websocket";
  audioBridge?: {
    recordCommand?: string;
    playCommand?: string;
  };
  realtime?: {
    provider?: string;
    model?: string;
    voice?: string;
    toolPolicy?: "off" | "read-only" | "allow-configured";
  };
};

export type GoogleMeetSetupCheckStatus = "pass" | "warn" | "fail";

export type GoogleMeetSetupCheck = {
  id: string;
  label: string;
  status: GoogleMeetSetupCheckStatus;
  message: string;
};

export type GoogleMeetSetupStatus = {
  enabled: boolean;
  readyForLiveActions: boolean;
  defaultTransport: "chrome-node" | "local-chrome" | "websocket";
  checks: GoogleMeetSetupCheck[];
};

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function checkTokenPath(tokenPath: string | undefined): GoogleMeetSetupCheck {
  if (!hasText(tokenPath)) {
    return {
      id: "oauth-token",
      label: "Google OAuth token path",
      status: "warn",
      message: "OAuth token path is not configured; create/join actions stay disabled.",
    };
  }
  if (!fs.existsSync(tokenPath)) {
    return {
      id: "oauth-token",
      label: "Google OAuth token path",
      status: "fail",
      message: "OAuth token path is configured but the file does not exist.",
    };
  }
  return {
    id: "oauth-token",
    label: "Google OAuth token path",
    status: "pass",
    message: "OAuth token file is present.",
  };
}

function checkBrowserProfile(profile: string | undefined): GoogleMeetSetupCheck {
  if (!hasText(profile)) {
    return {
      id: "browser-profile",
      label: "Browser profile",
      status: "warn",
      message: "Browser profile is not configured; the default browser profile will be used later.",
    };
  }
  return {
    id: "browser-profile",
    label: "Browser profile",
    status: "pass",
    message: `Browser profile "${profile.trim()}" is configured.`,
  };
}

function checkAudioBridge(config: GoogleMeetConfig["audioBridge"]): GoogleMeetSetupCheck {
  if (!hasText(config?.recordCommand) || !hasText(config?.playCommand)) {
    return {
      id: "audio-bridge",
      label: "Audio bridge",
      status: "warn",
      message: "Record/play audio bridge commands are not fully configured.",
    };
  }
  return {
    id: "audio-bridge",
    label: "Audio bridge",
    status: "pass",
    message: "Record/play audio bridge commands are configured.",
  };
}

export function resolveGoogleMeetSetupStatus(config: GoogleMeetConfig = {}): GoogleMeetSetupStatus {
  const defaultTransport = config.defaultTransport ?? "chrome-node";
  const checks = [
    checkTokenPath(config.oauth?.tokenPath),
    checkBrowserProfile(config.browser?.profile),
    checkAudioBridge(config.audioBridge),
  ];
  const readyForLiveActions = checks.every((check) => check.status === "pass");

  return {
    enabled: config.enabled === true,
    readyForLiveActions,
    defaultTransport,
    checks,
  };
}
