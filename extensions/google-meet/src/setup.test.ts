import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveGoogleMeetSetupStatus } from "./setup.js";

describe("resolveGoogleMeetSetupStatus", () => {
  it("keeps live actions unavailable until required setup is configured", () => {
    const status = resolveGoogleMeetSetupStatus({});

    expect(status.enabled).toBe(false);
    expect(status.readyForLiveActions).toBe(false);
    expect(status.defaultTransport).toBe("chrome-node");
    expect(status.checks.map((check) => check.status)).toEqual(["warn", "warn", "warn"]);
  });

  it("passes setup checks when token, browser, and audio bridge are configured", () => {
    const tokenPath = path.join(os.tmpdir(), `argent-google-meet-${Date.now()}.json`);
    fs.writeFileSync(tokenPath, "{}", "utf-8");
    try {
      const status = resolveGoogleMeetSetupStatus({
        enabled: true,
        oauth: { tokenPath },
        browser: { profile: "chrome" },
        defaultTransport: "local-chrome",
        audioBridge: {
          recordCommand: "rec -t raw -",
          playCommand: "play -t raw -",
        },
      });

      expect(status.enabled).toBe(true);
      expect(status.readyForLiveActions).toBe(true);
      expect(status.defaultTransport).toBe("local-chrome");
      expect(status.checks.map((check) => check.status)).toEqual(["pass", "pass", "pass"]);
    } finally {
      fs.rmSync(tokenPath, { force: true });
    }
  });
});
