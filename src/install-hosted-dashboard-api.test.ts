import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildServiceEnvironment } from "./daemon/service-env.js";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_DIR, "..");
const INSTALLER_SOURCE = fs.readFileSync(
  path.join(REPO_ROOT, "scripts", "install-hosted.sh"),
  "utf8",
);

describe("hosted installer dashboard api bootstrap", () => {
  it("persists dashboard api sidecar suppression for hosted gateway installs", () => {
    const env = buildServiceEnvironment({
      env: {
        HOME: "/tmp/test-home",
        ARGENT_SKIP_DASHBOARD_API: "1",
      },
      port: 18789,
      dashboardApiToken: "dash-token",
    });

    expect(env.ARGENT_SKIP_DASHBOARD_API).toBe("1");
  });

  it("explicitly provisions the dashboard api service in the hosted installer", () => {
    expect(INSTALLER_SOURCE).toContain("start_dashboard_api_service()");
    expect(INSTALLER_SOURCE).toContain("ai.argent.dashboard-api");
    expect(INSTALLER_SOURCE).toContain("DASHBOARD_API_TOKEN");
    expect(INSTALLER_SOURCE).toContain("lsof -ti :9242 | xargs kill");
  });

  it("verifies the dashboard api contract before handing off to the user", () => {
    expect(INSTALLER_SOURCE).toContain("verify_dashboard_api_contract()");
    expect(INSTALLER_SOURCE).toContain('"/api/settings/dashboard/surface-profile"');
    expect(INSTALLER_SOURCE).toContain('"/api/settings/load-profile"');
    expect(INSTALLER_SOURCE).toContain('"/api/settings/auth-profiles"');
    expect(INSTALLER_SOURCE).toContain("Dashboard API route contract verified");
  });

  it("installs the hosted gateway with the dashboard api sidecar disabled", () => {
    expect(INSTALLER_SOURCE).toContain(
      'ARGENT_SKIP_DASHBOARD_API=1 PATH="$(dirname "$NODE_BIN"):$PATH"',
    );
    expect(INSTALLER_SOURCE).toContain('"$argent_bin" daemon install --force');
  });
});
