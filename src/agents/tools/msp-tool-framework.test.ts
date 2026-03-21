import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createMSPTool,
  MSPApiError,
  isRetryableError,
  withRetry,
  recordAudit,
  getAuditLog,
  getAuditStats,
  DEFAULT_RETRY_POLICY,
  type MSPToolConfig,
  type MSPToolAuditEntry,
} from "./msp-tool-framework.js";

// ── MSPApiError ─────────────────────────────────────────────────

describe("MSPApiError", () => {
  it("normalizes error properties", () => {
    const err = new MSPApiError({
      service: "Atera",
      endpoint: "/api/v3/tickets",
      statusCode: 429,
      statusText: "Too Many Requests",
      body: '{"error":"rate_limited"}',
    });
    expect(err.statusCode).toBe(429);
    expect(err.service).toBe("Atera");
    expect(err.isRateLimited).toBe(true);
    expect(err.isAuthError).toBe(false);
    expect(err.message).toContain("Atera API 429");
  });

  it("detects auth errors (401, 403)", () => {
    const err401 = new MSPApiError({
      service: "Atera",
      endpoint: "/test",
      statusCode: 401,
      statusText: "Unauthorized",
      body: "",
    });
    expect(err401.isAuthError).toBe(true);
    expect(err401.isRateLimited).toBe(false);

    const err403 = new MSPApiError({
      service: "Atera",
      endpoint: "/test",
      statusCode: 403,
      statusText: "Forbidden",
      body: "",
    });
    expect(err403.isAuthError).toBe(true);
  });

  it("truncates long response bodies", () => {
    const longBody = "x".repeat(500);
    const err = new MSPApiError({
      service: "Test",
      endpoint: "/test",
      statusCode: 500,
      statusText: "Internal Server Error",
      body: longBody,
    });
    expect(err.responseBody.length).toBe(300);
  });
});

// ── Retry Logic ─────────────────────────────────────────────────

describe("isRetryableError", () => {
  it("retries 429 (rate limit)", () => {
    const err = new MSPApiError({
      service: "Test",
      endpoint: "/test",
      statusCode: 429,
      statusText: "Too Many Requests",
      body: "",
    });
    expect(isRetryableError(err, DEFAULT_RETRY_POLICY)).toBe(true);
  });

  it("retries 502 (bad gateway)", () => {
    const err = new MSPApiError({
      service: "Test",
      endpoint: "/test",
      statusCode: 502,
      statusText: "Bad Gateway",
      body: "",
    });
    expect(isRetryableError(err, DEFAULT_RETRY_POLICY)).toBe(true);
  });

  it("does NOT retry 401 (auth)", () => {
    const err = new MSPApiError({
      service: "Test",
      endpoint: "/test",
      statusCode: 401,
      statusText: "Unauthorized",
      body: "",
    });
    expect(isRetryableError(err, DEFAULT_RETRY_POLICY)).toBe(false);
  });

  it("does NOT retry 404", () => {
    const err = new MSPApiError({
      service: "Test",
      endpoint: "/test",
      statusCode: 404,
      statusText: "Not Found",
      body: "",
    });
    expect(isRetryableError(err, DEFAULT_RETRY_POLICY)).toBe(false);
  });
});

describe("withRetry", () => {
  it("succeeds on first try", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await withRetry(fn, { ...DEFAULT_RETRY_POLICY, maxRetries: 2 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on retryable error then succeeds", async () => {
    const err = new MSPApiError({
      service: "Test",
      endpoint: "/test",
      statusCode: 502,
      statusText: "Bad Gateway",
      body: "",
    });
    const fn = vi.fn().mockRejectedValueOnce(err).mockResolvedValue("ok");
    const result = await withRetry(fn, {
      ...DEFAULT_RETRY_POLICY,
      maxRetries: 2,
      baseDelayMs: 1,
    });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("throws on non-retryable error immediately", async () => {
    const err = new MSPApiError({
      service: "Test",
      endpoint: "/test",
      statusCode: 401,
      statusText: "Unauthorized",
      body: "",
    });
    const fn = vi.fn().mockRejectedValue(err);
    await expect(
      withRetry(fn, { ...DEFAULT_RETRY_POLICY, maxRetries: 3, baseDelayMs: 1 }),
    ).rejects.toThrow("Unauthorized");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("exhausts retries and throws", async () => {
    const err = new MSPApiError({
      service: "Test",
      endpoint: "/test",
      statusCode: 429,
      statusText: "Too Many Requests",
      body: "",
    });
    const fn = vi.fn().mockRejectedValue(err);
    await expect(
      withRetry(fn, { ...DEFAULT_RETRY_POLICY, maxRetries: 2, baseDelayMs: 1 }),
    ).rejects.toThrow("Too Many Requests");
    expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
  });
});

// ── Audit Logging ───────────────────────────────────────────────

describe("audit logging", () => {
  beforeEach(() => {
    // Clear audit buffer by recording enough empty entries
    // (no exported clear function, so we just test from current state)
  });

  it("records and retrieves audit entries", () => {
    const entry: MSPToolAuditEntry = {
      toolName: "atera_tickets",
      action: "list",
      success: true,
      durationMs: 150,
      startedAt: new Date().toISOString(),
    };
    recordAudit(entry);
    const log = getAuditLog({ toolName: "atera_tickets" });
    expect(log.length).toBeGreaterThan(0);
    expect(log[log.length - 1]!.action).toBe("list");
  });

  it("computes audit stats", () => {
    recordAudit({
      toolName: "test_tool",
      action: "list",
      success: true,
      durationMs: 100,
      startedAt: new Date().toISOString(),
    });
    recordAudit({
      toolName: "test_tool",
      action: "search",
      success: false,
      durationMs: 200,
      startedAt: new Date().toISOString(),
      error: "timeout",
    });
    const stats = getAuditStats();
    expect(stats["test_tool"]).toBeDefined();
    expect(stats["test_tool"]!.calls).toBeGreaterThanOrEqual(2);
    expect(stats["test_tool"]!.errors).toBeGreaterThanOrEqual(1);
  });
});

// ── createMSPTool ───────────────────────────────────────────────

describe("createMSPTool", () => {
  const mockConfig: MSPToolConfig = {
    apiKey: "test-key-123",
    serviceName: "TestService",
  };

  it("creates a tool with correct name and label", () => {
    const tool = createMSPTool({
      name: "test_tool",
      label: "Test Tool",
      description: "A test tool",
      parameters: {},
      resolveConfig: () => mockConfig,
      actions: {
        list: async () => ({ content: [{ type: "text" as const, text: "ok" }] }),
      },
      defaultAction: "list",
    });

    expect(tool.name).toBe("test_tool");
    expect(tool.label).toBe("Test Tool");
  });

  it("routes to correct action handler", async () => {
    const listHandler = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "listed" }],
    });
    const searchHandler = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "searched" }],
    });

    const tool = createMSPTool({
      name: "test_tool",
      label: "Test Tool",
      description: "A test tool",
      parameters: {},
      resolveConfig: () => mockConfig,
      actions: { list: listHandler, search: searchHandler },
      defaultAction: "list",
    });

    const result = await tool.execute("call-1", { action: "search", query: "test" });
    expect(searchHandler).toHaveBeenCalled();
    expect(listHandler).not.toHaveBeenCalled();
    expect(result.content[0]).toEqual({ type: "text", text: "searched" });
  });

  it("uses default action when action param omitted", async () => {
    const listHandler = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "listed" }],
    });

    const tool = createMSPTool({
      name: "test_tool",
      label: "Test Tool",
      description: "A test tool",
      parameters: {},
      resolveConfig: () => mockConfig,
      actions: { list: listHandler },
      defaultAction: "list",
    });

    await tool.execute("call-1", {});
    expect(listHandler).toHaveBeenCalled();
  });

  it("returns friendly error for unknown action", async () => {
    const tool = createMSPTool({
      name: "test_tool",
      label: "Test Tool",
      description: "A test tool",
      parameters: {},
      resolveConfig: () => mockConfig,
      actions: { list: async () => ({ content: [{ type: "text" as const, text: "ok" }] }) },
    });

    const result = await tool.execute("call-1", { action: "explode" });
    expect(result.content[0]).toHaveProperty("text");
    expect((result.content[0] as any).text).toContain('Unknown action: "explode"');
  });

  it("returns friendly error when API key is missing", async () => {
    const tool = createMSPTool({
      name: "test_tool",
      label: "Test Tool",
      description: "A test tool",
      parameters: {},
      resolveConfig: () => ({ apiKey: "", serviceName: "TestService" }),
      actions: { list: async () => ({ content: [{ type: "text" as const, text: "ok" }] }) },
      defaultAction: "list",
    });

    const result = await tool.execute("call-1", {});
    expect((result.content[0] as any).text).toContain("API key not configured");
  });

  it("records audit entry on success", async () => {
    const onAudit = vi.fn();
    const tool = createMSPTool({
      name: "audit_test",
      label: "Audit Test",
      description: "test",
      parameters: {},
      resolveConfig: () => mockConfig,
      actions: {
        list: async () => ({ content: [{ type: "text" as const, text: "ok" }] }),
      },
      defaultAction: "list",
      onAudit,
    });

    await tool.execute("call-1", {});
    expect(onAudit).toHaveBeenCalledTimes(1);
    expect(onAudit.mock.calls[0][0]).toMatchObject({
      toolName: "audit_test",
      action: "list",
      success: true,
    });
    expect(onAudit.mock.calls[0][0].durationMs).toBeGreaterThanOrEqual(0);
  });

  it("records audit entry on error", async () => {
    const onAudit = vi.fn();
    const tool = createMSPTool({
      name: "audit_test",
      label: "Audit Test",
      description: "test",
      parameters: {},
      resolveConfig: () => mockConfig,
      actions: {
        list: async () => {
          throw new Error("boom");
        },
      },
      defaultAction: "list",
      onAudit,
    });

    await tool.execute("call-1", {});
    expect(onAudit).toHaveBeenCalledTimes(1);
    expect(onAudit.mock.calls[0][0]).toMatchObject({
      toolName: "audit_test",
      action: "list",
      success: false,
      error: "boom",
    });
  });

  it("returns friendly message for rate limit errors", async () => {
    const tool = createMSPTool({
      name: "rate_test",
      label: "Rate Test",
      description: "test",
      parameters: {},
      resolveConfig: () => mockConfig,
      actions: {
        list: async () => {
          throw new MSPApiError({
            service: "Test",
            endpoint: "/test",
            statusCode: 429,
            statusText: "Too Many Requests",
            body: "",
          });
        },
      },
      defaultAction: "list",
      retryPolicy: { ...DEFAULT_RETRY_POLICY, maxRetries: 0 },
    });

    const result = await tool.execute("call-1", {});
    expect((result.content[0] as any).text).toContain("Rate limited");
  });

  it("returns friendly message for auth errors", async () => {
    const tool = createMSPTool({
      name: "auth_test",
      label: "Auth Test",
      description: "test",
      parameters: {},
      resolveConfig: () => mockConfig,
      actions: {
        list: async () => {
          throw new MSPApiError({
            service: "Test",
            endpoint: "/test",
            statusCode: 401,
            statusText: "Unauthorized",
            body: "",
          });
        },
      },
      defaultAction: "list",
    });

    const result = await tool.execute("call-1", {});
    expect((result.content[0] as any).text).toContain("Authentication failed");
  });
});
