import { describe, expect, it, vi } from "vitest";

const readConfigFileSnapshot = vi.fn(async () => ({
  path: "/tmp/argent.json",
  exists: false,
  valid: true,
  config: {},
  issues: [],
  legacyIssues: [],
}));
const parseConfigJson5 = vi.fn(() => ({ ok: true, parsed: {} }));
const validateConfigObjectWithPlugins = vi.fn(() => ({
  ok: false,
  issues: [
    {
      path: "gateway.auth.token",
      message: "gateway.auth.mode is token but token is empty",
    },
  ],
  warnings: [],
}));

vi.mock("../../config/config.js", () => ({
  CONFIG_PATH: "/tmp/argent.json",
  loadConfig: vi.fn(() => ({})),
  parseConfigJson5: (...args: unknown[]) => parseConfigJson5(...args),
  readConfigFileSnapshot: () => readConfigFileSnapshot(),
  resolveConfigSnapshotHash: vi.fn(() => "hash"),
  validateConfigObjectWithPlugins: (...args: unknown[]) => validateConfigObjectWithPlugins(...args),
  writeConfigFile: vi.fn(async () => undefined),
}));

vi.mock("../../config/legacy.js", () => ({
  applyLegacyMigrations: (value: unknown) => ({ next: value }),
}));

vi.mock("../../config/merge-patch.js", () => ({
  applyMergePatch: (_base: unknown, patch: unknown) => patch,
}));

vi.mock("../../config/schema.js", () => ({
  buildConfigSchema: vi.fn(() => ({})),
}));

vi.mock("../../infra/restart-sentinel.js", () => ({
  formatDoctorNonInteractiveHint: vi.fn(() => ""),
  writeRestartSentinel: vi.fn(async () => null),
}));

vi.mock("../../infra/restart.js", () => ({
  scheduleGatewaySigusr1Restart: vi.fn(() => null),
}));

vi.mock("../../plugins/loader.js", () => ({
  loadArgentPlugins: vi.fn(() => ({ plugins: [] })),
}));

vi.mock("../../channels/plugins/index.js", () => ({
  listChannelPlugins: vi.fn(() => []),
}));

vi.mock("../protocol/index.js", () => ({
  ErrorCodes: { INVALID_REQUEST: "INVALID_REQUEST" },
  errorShape: (_code: string, message: string, details?: unknown) => ({ message, details }),
  formatValidationErrors: vi.fn(() => "bad"),
  validateConfigApplyParams: ((_: unknown) => true) as unknown,
  validateConfigGetParams: ((_: unknown) => true) as unknown,
  validateConfigPatchParams: ((_: unknown) => true) as unknown,
  validateConfigSchemaParams: ((_: unknown) => true) as unknown,
  validateConfigSetParams: ((_: unknown) => true) as unknown,
}));

describe("configHandlers config.apply", () => {
  it("returns actionable invalid-config message for gateway auth token mode", async () => {
    const { configHandlers } = await import("./config.js");

    let response: { ok: boolean; error?: { message?: string } } | null = null;
    await configHandlers["config.apply"]({
      req: { type: "req", id: "1", method: "config.apply", params: {} } as never,
      params: { raw: '{ "gateway": { "auth": { "mode": "token", "token": "" } } }' },
      client: null,
      isWebchatConnect: () => false,
      context: {} as never,
      respond: (ok, _payload, error) => {
        response = { ok, error: error as { message?: string } };
      },
    });

    expect(response?.ok).toBe(false);
    expect(response?.error?.message ?? "").toContain("gateway.auth.token");
  });
});
