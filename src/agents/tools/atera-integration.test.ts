import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createAteraEndpointDiagnosticsTool,
  createAteraRemoteActionTool,
  createAteraPatchStatusTool,
  _resetRateLimiter,
} from "./atera-integration.js";

// ── Mock fetch to avoid real API calls ──────────────────────────

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Mock service key resolution to return a test key
vi.mock("./msp-tool-framework.js", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    resolveServiceApiKey: (envVar: string) => "test-api-key-12345",
  };
});

// Helper to create a mock Atera API response
function mockAteraResponse(data: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    text: () => Promise.resolve(JSON.stringify(data)),
    json: () => Promise.resolve(data),
    headers: new Headers(),
  });
}

// Sample agent data matching real Atera API shape
const SAMPLE_AGENT = {
  AgentID: 12345,
  MachineName: "CCSERVER",
  AgentName: "CCSERVER",
  CustomerName: "Cromwell (CCI)",
  CustomerID: 42,
  Online: false,
  LastSeen: "2026-03-04T23:00:00Z",
  OS: "Windows Server 2019 Standard",
  OSType: "Windows",
  OSVersion: "10.0.17763",
  OSBuildNumber: "17763",
  OSArchitecture: "64-bit",
  Processor: "Intel Xeon E-2288G @ 3.70GHz",
  ProcessorCoresCount: 8,
  Memory: 32768, // MB
  Vendor: "Dell",
  MachineModel: "PowerEdge T340",
  SerialNumber: "ABC123",
  DomainName: "cromwell.local",
  CurrentLoggedUsers: "admin",
  LastLoginUser: "admin",
  IpAddresses: ["192.168.1.10", "10.0.0.5"],
  MacAddresses: ["AA:BB:CC:DD:EE:FF"],
  ReportedFromIP: "72.1.2.3",
  AgentVersion: "1.0.45.0",
  Monitored: true,
  CreatedOn: "2023-06-15T08:00:00Z",
  HardwareDisks: [
    { Drive: "C:", Total: 500 * 1024 * 1024 * 1024, Free: 25 * 1024 * 1024 * 1024 },
    { Drive: "D:", Total: 2000 * 1024 * 1024 * 1024, Free: 1500 * 1024 * 1024 * 1024 },
  ],
};

const SAMPLE_AGENT_ONLINE = {
  ...SAMPLE_AGENT,
  AgentID: 12346,
  MachineName: "WORKSTATION-01",
  Online: true,
  LastSeen: new Date().toISOString(),
  OS: "Windows 11 Pro",
  Memory: 16384,
  HardwareDisks: [{ Drive: "C:", Total: 500 * 1024 * 1024 * 1024, Free: 300 * 1024 * 1024 * 1024 }],
};

const SAMPLE_ALERT = {
  AlertID: 999,
  Title: "Disk Usage Critical",
  Severity: "Critical",
  DeviceName: "CCSERVER",
  CustomerName: "Cromwell (CCI)",
  Created: "2026-03-05T11:35:00Z",
  AgentID: 12345,
};

// ── Tool Creation ────────────────────────────────────────────────

beforeEach(() => {
  _resetRateLimiter();
});

describe("Tool Creation", () => {
  it("creates endpoint diagnostics tool with correct name", () => {
    const tool = createAteraEndpointDiagnosticsTool();
    expect(tool.name).toBe("atera_endpoint_diagnostics");
    expect(tool.label).toBe("Atera Endpoint Diagnostics");
  });

  it("creates remote action tool with correct name", () => {
    const tool = createAteraRemoteActionTool();
    expect(tool.name).toBe("atera_remote_action");
    expect(tool.label).toBe("Atera Remote Action");
  });

  it("creates patch status tool with correct name", () => {
    const tool = createAteraPatchStatusTool();
    expect(tool.name).toBe("atera_patch_status");
    expect(tool.label).toBe("Atera Patch Status");
  });
});

// ── Endpoint Diagnostics ─────────────────────────────────────────

describe("Endpoint Diagnostics", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("returns device diagnostics for a single agent", async () => {
    mockFetch
      .mockReturnValueOnce(mockAteraResponse(SAMPLE_AGENT)) // GET /agents/{id}
      .mockReturnValueOnce(mockAteraResponse({ items: [SAMPLE_ALERT] })); // GET /alerts

    const tool = createAteraEndpointDiagnosticsTool();
    const result = await tool.execute("call-1", { action: "device", agent_id: 12345 });
    const text = result.content[0]!.text;

    expect(text).toContain("Endpoint Diagnostics: CCSERVER");
    expect(text).toContain("Offline");
    expect(text).toContain("Intel Xeon");
    expect(text).toContain("32 GB");
    expect(text).toContain("Windows Server 2019");
    expect(text).toContain("Health Score");
  });

  it("returns error when no agent_id or machine_name provided", async () => {
    const tool = createAteraEndpointDiagnosticsTool();
    const result = await tool.execute("call-1", { action: "device" });
    expect(result.content[0]!.text).toContain("agent_id or machine_name");
  });

  it("calculates health score with offline penalty", async () => {
    mockFetch
      .mockReturnValueOnce(mockAteraResponse(SAMPLE_AGENT))
      .mockReturnValueOnce(mockAteraResponse({ items: [SAMPLE_ALERT] }));

    const tool = createAteraEndpointDiagnosticsTool();
    const result = await tool.execute("call-1", { action: "device", agent_id: 12345 });
    const text = result.content[0]!.text;

    // Offline (-40) + 1 alert (-10) + disk C: at 95% (-20) = 30/100
    expect(text).toContain("Score:");
    // Score should be significantly reduced for offline + alert + full disk
    expect(text).toMatch(/Score: \d+\/100/);
  });

  it("handles customer_scan action", async () => {
    mockFetch
      .mockReturnValueOnce(mockAteraResponse({ items: [SAMPLE_AGENT, SAMPLE_AGENT_ONLINE] }))
      .mockReturnValueOnce(mockAteraResponse({ items: [SAMPLE_ALERT] }));

    const tool = createAteraEndpointDiagnosticsTool();
    const result = await tool.execute("call-1", { action: "customer_scan", customer_id: 42 });
    const text = result.content[0]!.text;

    expect(text).toContain("Customer Device Health Scan");
    expect(text).toContain("2 devices");
    expect(text).toContain("CCSERVER");
    expect(text).toContain("WORKSTATION-01");
  });

  it("handles fleet_health action", async () => {
    mockFetch
      .mockReturnValueOnce(mockAteraResponse({ items: [SAMPLE_AGENT, SAMPLE_AGENT_ONLINE] }))
      .mockReturnValueOnce(mockAteraResponse({ items: [SAMPLE_ALERT] }));

    const tool = createAteraEndpointDiagnosticsTool();
    const result = await tool.execute("call-1", { action: "fleet_health" });
    const text = result.content[0]!.text;

    expect(text).toContain("Fleet Health Overview");
    expect(text).toContain("Total Devices:");
    expect(text).toContain("OS Distribution");
  });
});

// ── Remote Action ────────────────────────────────────────────────

describe("Remote Action", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("lists available actions", async () => {
    const tool = createAteraRemoteActionTool();
    const result = await tool.execute("call-1", { action: "list" });
    const text = result.content[0]!.text;

    expect(text).toContain("Available Remote Actions");
    expect(text).toContain("create_alert");
    expect(text).toContain("dismiss_alert");
    expect(text).toContain("set_custom_field");
    expect(text).toContain("create_diagnostic_ticket");
  });

  it("creates an alert via API", async () => {
    mockFetch.mockReturnValueOnce(mockAteraResponse({ AlertID: 1001 }));

    const tool = createAteraRemoteActionTool();
    const result = await tool.execute("call-1", {
      action: "create_alert",
      title: "Test Alert",
      severity: "Warning",
      device_name: "CCSERVER",
    });
    const text = result.content[0]!.text;

    expect(text).toContain("Alert created successfully");
    expect(text).toContain("Test Alert");
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("dismisses an alert", async () => {
    mockFetch.mockReturnValueOnce(
      Promise.resolve({ ok: true, status: 200, statusText: "OK", text: () => Promise.resolve("") }),
    );

    const tool = createAteraRemoteActionTool();
    const result = await tool.execute("call-1", { action: "dismiss_alert", alert_id: 999 });
    expect(result.content[0]!.text).toContain("dismissed successfully");
  });

  it("requires title for create_alert", async () => {
    const tool = createAteraRemoteActionTool();
    const result = await tool.execute("call-1", { action: "create_alert" });
    expect(result.content[0]!.text).toContain("title is required");
  });

  it("creates diagnostic ticket", async () => {
    mockFetch.mockReturnValueOnce(mockAteraResponse({ TicketID: 57300 }));

    const tool = createAteraRemoteActionTool();
    const result = await tool.execute("call-1", {
      action: "create_diagnostic_ticket",
      title: "Disk Critical on CCSERVER",
      customer_id: 42,
      agent_id: 12345,
      priority: "High",
    });
    const text = result.content[0]!.text;

    expect(text).toContain("Diagnostic ticket created");
    expect(text).toContain("57300");
  });
});

// ── Patch Status ─────────────────────────────────────────────────

describe("Patch Status", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("shows OS inventory", async () => {
    mockFetch.mockReturnValueOnce(
      mockAteraResponse({ items: [SAMPLE_AGENT, SAMPLE_AGENT_ONLINE] }),
    );

    const tool = createAteraPatchStatusTool();
    const result = await tool.execute("call-1", { action: "os_inventory" });
    const text = result.content[0]!.text;

    expect(text).toContain("OS Version Inventory");
    expect(text).toContain("Windows Server 2019");
    expect(text).toContain("Windows 11 Pro");
    expect(text).toContain("Compliance Score:");
  });

  it("detects stale agents", async () => {
    const staleAgent = {
      ...SAMPLE_AGENT,
      MachineName: "OLD-PC",
      LastSeen: "2025-01-01T00:00:00Z", // Very old
    };
    mockFetch
      .mockReturnValueOnce(mockAteraResponse({ items: [staleAgent, SAMPLE_AGENT_ONLINE] }))
      .mockReturnValue(mockAteraResponse({ items: [] })); // Subsequent pages empty

    const tool = createAteraPatchStatusTool();
    const result = await tool.execute("call-1", { action: "stale_agents" });
    const text = result.content[0]!.text;

    expect(text).toContain("Stale Agents");
    expect(text).toContain("OLD-PC");
    expect(text).toContain("1 of 2");
  });

  it("generates customer posture report", async () => {
    mockFetch.mockReturnValueOnce(
      mockAteraResponse({ items: [SAMPLE_AGENT, SAMPLE_AGENT_ONLINE] }),
    );

    const tool = createAteraPatchStatusTool();
    const result = await tool.execute("call-1", { action: "customer_posture", customer_id: 42 });
    const text = result.content[0]!.text;

    expect(text).toContain("Patch Posture:");
    expect(text).toContain("Cromwell");
    expect(text).toContain("Compliance Score:");
    expect(text).toContain("Grade:");
  });

  it("requires customer_id for customer_posture", async () => {
    const tool = createAteraPatchStatusTool();
    const result = await tool.execute("call-1", { action: "customer_posture" });
    expect(result.content[0]!.text).toContain("customer_id is required");
  });

  it("generates fleet compliance dashboard", async () => {
    mockFetch.mockReturnValueOnce(
      mockAteraResponse({ items: [SAMPLE_AGENT, SAMPLE_AGENT_ONLINE] }),
    );

    const tool = createAteraPatchStatusTool();
    const result = await tool.execute("call-1", { action: "fleet_compliance" });
    const text = result.content[0]!.text;

    expect(text).toContain("Fleet Patch Compliance Dashboard");
    expect(text).toContain("Per-Customer Compliance");
  });

  it("detects outdated OS versions", async () => {
    const win7Agent = { ...SAMPLE_AGENT, OS: "Windows 7 Professional", MachineName: "LEGACY-PC" };
    mockFetch
      .mockReturnValueOnce(mockAteraResponse({ items: [win7Agent, SAMPLE_AGENT_ONLINE] }))
      .mockReturnValue(mockAteraResponse({ items: [] }));

    const tool = createAteraPatchStatusTool();
    const result = await tool.execute("call-1", { action: "os_inventory" });
    const text = result.content[0]!.text;

    expect(text).toContain("Outdated OS Detection");
    expect(text).toContain("LEGACY-PC");
    expect(text).toContain("End-of-life Windows");
  });
});
