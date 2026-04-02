import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_DIR, "..");
const INSTALLER_SOURCE = fs.readFileSync(
  path.join(REPO_ROOT, "scripts", "install-hosted.sh"),
  "utf8",
);

describe("hosted installer linux MVP", () => {
  it("provisions the core storage stack through shared setup scripts", () => {
    expect(INSTALLER_SOURCE).toContain('local pg_script="$GIT_DIR/scripts/setup-postgres.sh"');
    expect(INSTALLER_SOURCE).toContain('local redis_script="$GIT_DIR/scripts/setup-redis.sh"');
    expect(INSTALLER_SOURCE).not.toContain('if [[ "$(uname -s)" != "Darwin" ]]; then');
  });

  it("writes a Linux-safe PostgreSQL connection string", () => {
    expect(INSTALLER_SOURCE).toContain('process.platform === "linux"');
    expect(INSTALLER_SOURCE).toContain(
      "postgresql://${encodeURIComponent(currentUser)}@localhost/argentos?host=/var/run/postgresql&port=5433",
    );
  });

  it("configures Linux as a remote server rail with required auth", () => {
    expect(INSTALLER_SOURCE).toContain('LINUX_GATEWAY_BIND="${ARGENT_GATEWAY_BIND:-}"');
    expect(INSTALLER_SOURCE).toContain('LINUX_GATEWAY_AUTH="${ARGENT_GATEWAY_AUTH:-}"');
    expect(INSTALLER_SOURCE).toContain('LINUX_GATEWAY_PASSWORD="${ARGENT_GATEWAY_PASSWORD:-}"');
    expect(INSTALLER_SOURCE).toContain('--gateway-bind "$LINUX_GATEWAY_BIND"');
    expect(INSTALLER_SOURCE).toContain('--gateway-auth "$LINUX_GATEWAY_AUTH"');
    expect(INSTALLER_SOURCE).toContain("Linux server mode: browser access is through the gateway");
    expect(INSTALLER_SOURCE).toContain(
      "Gateway auth mode: password (required before dashboard access)",
    );
  });
});
