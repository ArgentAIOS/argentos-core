import { beforeEach, describe, expect, it, vi } from "vitest";
import { dashboardCommand } from "./dashboard.js";

const mocks = vi.hoisted(() => ({
  readConfigFileSnapshot: vi.fn(),
  detectBrowserOpenSupport: vi.fn(),
  openUrl: vi.fn(),
  copyToClipboard: vi.fn(),
}));

vi.mock("../config/config.js", () => ({
  readConfigFileSnapshot: mocks.readConfigFileSnapshot,
}));

vi.mock("./onboard-helpers.js", () => ({
  detectBrowserOpenSupport: mocks.detectBrowserOpenSupport,
  openUrl: mocks.openUrl,
}));

vi.mock("../infra/clipboard.js", () => ({
  copyToClipboard: mocks.copyToClipboard,
}));

const runtime = {
  log: vi.fn(),
  error: vi.fn(),
  exit: vi.fn(),
};

function resetRuntime() {
  runtime.log.mockClear();
  runtime.error.mockClear();
  runtime.exit.mockClear();
}

function mockSnapshot(token = "abc") {
  mocks.readConfigFileSnapshot.mockResolvedValue({
    path: "/tmp/argent.json",
    exists: true,
    raw: "{}",
    parsed: {},
    valid: true,
    config: { gateway: { auth: { token } } },
    issues: [],
    legacyIssues: [],
  });
}

describe("dashboardCommand", () => {
  beforeEach(() => {
    resetRuntime();
    mocks.readConfigFileSnapshot.mockReset();
    mocks.detectBrowserOpenSupport.mockReset();
    mocks.openUrl.mockReset();
    mocks.copyToClipboard.mockReset();
    delete process.env.ARGENT_DASHBOARD_URL;
    delete process.env.ARGENT_GATEWAY_TOKEN;
  });

  it("opens and copies the dashboard link by default", async () => {
    mockSnapshot("abc123");
    mocks.copyToClipboard.mockResolvedValue(true);
    mocks.detectBrowserOpenSupport.mockResolvedValue({ ok: true });
    mocks.openUrl.mockResolvedValue(true);

    await dashboardCommand(runtime);

    expect(mocks.copyToClipboard).toHaveBeenCalledWith("http://127.0.0.1:8080/?token=abc123");
    expect(mocks.openUrl).toHaveBeenCalledWith("http://127.0.0.1:8080/?token=abc123");
    expect(runtime.log).toHaveBeenCalledWith(
      "Opened in your browser. Keep that tab to control Argent.",
    );
  });

  it("prints generic hint when browser cannot open", async () => {
    mockSnapshot("shhhh");
    mocks.copyToClipboard.mockResolvedValue(false);
    mocks.detectBrowserOpenSupport.mockResolvedValue({
      ok: false,
      reason: "ssh",
    });

    await dashboardCommand(runtime);

    expect(mocks.openUrl).not.toHaveBeenCalled();
    expect(runtime.log).toHaveBeenCalledWith(
      "Could not open browser automatically. Use the URL above.",
    );
  });

  it("respects --no-open and skips browser attempts", async () => {
    mockSnapshot();
    mocks.copyToClipboard.mockResolvedValue(true);

    await dashboardCommand(runtime, { noOpen: true });

    expect(mocks.detectBrowserOpenSupport).not.toHaveBeenCalled();
    expect(mocks.openUrl).not.toHaveBeenCalled();
    expect(runtime.log).toHaveBeenCalledWith(
      "Browser launch disabled (--no-open). Use the URL above.",
    );
  });
});
