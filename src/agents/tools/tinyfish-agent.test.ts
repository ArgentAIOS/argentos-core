import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as serviceKeys from "../../infra/service-keys.js";
import { createTinyFishAgentTool, TinyFishAgentError, __testing } from "./tinyfish-agent.js";

const {
  resolveAgentApiKey,
  resolveAgentBaseUrl,
  resolveAgentBrowserProfile,
  resolveAgentEnabled,
  resolveAgentMaxStepsCap,
  resolveAgentTimeoutCapSeconds,
  runTinyFishAgent,
  isHttpsUrl,
  isHttpsOnlyUrl,
  DEFAULT_AGENT_BASE_URL,
  DEFAULT_AGENT_MAX_STEPS,
  DEFAULT_AGENT_TIMEOUT_SECONDS,
  MAX_AGENT_MAX_STEPS,
  MAX_AGENT_TIMEOUT_SECONDS,
} = __testing;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("tinyfish_agent config resolution", () => {
  beforeEach(() => {
    vi.spyOn(serviceKeys, "resolveServiceKey").mockReturnValue(undefined);
    vi.unstubAllEnvs();
  });

  it("disabled by default when no config is provided", () => {
    expect(resolveAgentEnabled(undefined)).toBe(false);
  });

  it("disabled by default when agent config exists but enabled is unset", () => {
    expect(resolveAgentEnabled({})).toBe(false);
  });

  it("enabled when agent.enabled=true", () => {
    expect(resolveAgentEnabled({ enabled: true })).toBe(true);
  });

  it("uses default base URL when not configured", () => {
    expect(resolveAgentBaseUrl(undefined)).toBe(DEFAULT_AGENT_BASE_URL);
  });

  it("honors configured baseUrl and strips trailing slashes", () => {
    expect(resolveAgentBaseUrl({ baseUrl: "https://agent.example.com/" })).toBe(
      "https://agent.example.com",
    );
  });

  it("default max steps cap is DEFAULT_AGENT_MAX_STEPS", () => {
    expect(resolveAgentMaxStepsCap(undefined)).toBe(DEFAULT_AGENT_MAX_STEPS);
  });

  it("clamps configured maxSteps within [1, MAX]", () => {
    expect(resolveAgentMaxStepsCap({ maxSteps: 9999 })).toBe(MAX_AGENT_MAX_STEPS);
    expect(resolveAgentMaxStepsCap({ maxSteps: 0 })).toBe(1);
  });

  it("default browser profile is 'lite'", () => {
    expect(resolveAgentBrowserProfile(undefined)).toBe("lite");
  });

  it("honors configured browserProfile", () => {
    expect(resolveAgentBrowserProfile({ browserProfile: "stealth" })).toBe("stealth");
  });

  it("rejects invalid browserProfile and falls back to default", () => {
    expect(
      resolveAgentBrowserProfile({
        // @ts-expect-error testing invalid value
        browserProfile: "ninja",
      }),
    ).toBe("lite");
  });

  it("default timeout is DEFAULT_AGENT_TIMEOUT_SECONDS", () => {
    expect(resolveAgentTimeoutCapSeconds(undefined)).toBe(DEFAULT_AGENT_TIMEOUT_SECONDS);
  });

  it("caps configured timeoutSeconds at MAX_AGENT_TIMEOUT_SECONDS", () => {
    expect(resolveAgentTimeoutCapSeconds({ timeoutSeconds: 99999 })).toBe(
      MAX_AGENT_TIMEOUT_SECONDS,
    );
  });
});

describe("tinyfish_agent api key resolution", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it("prefers explicit config apiKey", () => {
    vi.spyOn(serviceKeys, "resolveServiceKey").mockReturnValue("service-key");
    vi.stubEnv("TINYFISH_API_KEY", "env-key");
    const resolved = resolveAgentApiKey({ agent: { enabled: true, apiKey: "config-key" } });
    expect(resolved).toBe("config-key");
  });

  it("falls back to service-keys when no config apiKey", () => {
    vi.spyOn(serviceKeys, "resolveServiceKey").mockReturnValue("service-key");
    vi.stubEnv("TINYFISH_API_KEY", "env-key");
    const resolved = resolveAgentApiKey({ agent: { enabled: true } });
    expect(resolved).toBe("service-key");
  });

  it("falls back to TINYFISH_API_KEY env when service-keys empty", () => {
    vi.spyOn(serviceKeys, "resolveServiceKey").mockReturnValue(undefined);
    vi.stubEnv("TINYFISH_API_KEY", "env-key");
    const resolved = resolveAgentApiKey({ agent: { enabled: true } });
    expect(resolved).toBe("env-key");
  });

  it("returns undefined when nothing is set", () => {
    vi.spyOn(serviceKeys, "resolveServiceKey").mockReturnValue(undefined);
    vi.stubEnv("TINYFISH_API_KEY", "");
    expect(resolveAgentApiKey({ agent: { enabled: true } })).toBeUndefined();
  });
});

describe("tinyfish_agent URL guards", () => {
  it("accepts https URLs", () => {
    expect(isHttpsUrl("https://example.com")).toBe(true);
    expect(isHttpsOnlyUrl("https://example.com")).toBe(true);
  });

  it("accepts http URLs only on the general guard", () => {
    expect(isHttpsUrl("http://example.com")).toBe(true);
    expect(isHttpsOnlyUrl("http://example.com")).toBe(false);
  });

  it("rejects non-http schemes", () => {
    expect(isHttpsUrl("javascript:alert(1)")).toBe(false);
    expect(isHttpsUrl("file:///etc/passwd")).toBe(false);
    expect(isHttpsOnlyUrl("javascript:alert(1)")).toBe(false);
  });

  it("rejects garbage", () => {
    expect(isHttpsUrl("not a url")).toBe(false);
    expect(isHttpsOnlyUrl("not a url")).toBe(false);
  });
});

describe("createTinyFishAgentTool registration", () => {
  beforeEach(() => {
    vi.spyOn(serviceKeys, "resolveServiceKey").mockReturnValue(undefined);
    vi.unstubAllEnvs();
  });

  it("returns null when the agent tool is disabled", () => {
    const tool = createTinyFishAgentTool({ config: {}, sandboxed: false });
    expect(tool).toBeNull();
  });

  it("returns a registered tool when enabled", () => {
    const tool = createTinyFishAgentTool({
      config: { tools: { web: { agent: { enabled: true } } } },
      sandboxed: false,
    });
    expect(tool).not.toBeNull();
    expect(tool?.name).toBe("tinyfish_agent");
    expect(tool?.label).toBe("TinyFish Agent");
    expect(typeof tool?.execute).toBe("function");
  });

  it("schema requires goal and url", () => {
    const tool = createTinyFishAgentTool({
      config: { tools: { web: { agent: { enabled: true } } } },
      sandboxed: false,
    });
    expect(tool).not.toBeNull();
    const schema = tool!.parameters as { required?: string[] };
    expect(schema.required).toEqual(expect.arrayContaining(["goal", "url"]));
  });

  it("returns missing-key payload when no API key is available", async () => {
    vi.stubEnv("TINYFISH_API_KEY", "");
    const tool = createTinyFishAgentTool({
      config: { tools: { web: { agent: { enabled: true } } } },
      sandboxed: false,
    });
    const res = await tool!.execute("call-1", {
      goal: "find the price",
      url: "https://example.com",
    });
    expect((res.details as { error: string }).error).toBe("missing_tinyfish_api_key");
  });

  it("rejects non-http urls", async () => {
    vi.stubEnv("TINYFISH_API_KEY", "tf_key");
    const tool = createTinyFishAgentTool({
      config: { tools: { web: { agent: { enabled: true } } } },
      sandboxed: false,
    });
    const res = await tool!.execute("call-1", {
      goal: "do thing",
      url: "javascript:alert(1)",
    });
    expect((res.details as { error: string }).error).toBe("invalid_url");
  });

  it("rejects non-https webhook_url", async () => {
    vi.stubEnv("TINYFISH_API_KEY", "tf_key");
    const tool = createTinyFishAgentTool({
      config: { tools: { web: { agent: { enabled: true } } } },
      sandboxed: false,
    });
    const res = await tool!.execute("call-1", {
      goal: "do thing",
      url: "https://example.com",
      webhook_url: "http://insecure.example.com",
    });
    expect((res.details as { error: string }).error).toBe("invalid_webhook_url");
  });
});

describe("runTinyFishAgent (transport)", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("POSTs to /v1/automation/run with X-API-Key and parses the response", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : (input as URL).toString();
      expect(url).toBe("https://agent.tinyfish.ai/v1/automation/run");
      return new Response(
        JSON.stringify({
          run_id: "run_123",
          status: "COMPLETED",
          started_at: "2026-05-13T00:00:00Z",
          finished_at: "2026-05-13T00:01:00Z",
          num_of_steps: 7,
          result: { price: "$249" },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const data = await runTinyFishAgent({
      goal: "find the price",
      url: "https://flights.example.com",
      apiKey: "tf_test",
      baseUrl: DEFAULT_AGENT_BASE_URL,
      maxSteps: 50,
      browserProfile: "lite",
      capture: { screenshots: true },
      timeoutSeconds: 30,
    });

    expect(data.status).toBe("COMPLETED");
    expect(data.run_id).toBe("run_123");
    expect(data.num_of_steps).toBe(7);
    expect(data.result).toEqual({ price: "$249" });

    const [, init] = fetchMock.mock.calls[0]!;
    const headers = (init as RequestInit | undefined)?.headers as Record<string, string>;
    expect(headers["X-API-Key"]).toBe("tf_test");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.url).toBe("https://flights.example.com");
    expect(body.goal).toBe("find the price");
    expect(body.browser_profile).toBe("lite");
    expect(body.agent_config.max_steps).toBe(50);
    expect(body.capture_config).toEqual({ screenshots: true });
    expect(body.api_integration).toBe("argentos");
  });

  it("throws TinyFishAgentError with INSUFFICIENT_CREDITS on 403", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: {
              code: "INSUFFICIENT_CREDITS",
              message: "Out of credits",
              help_url: "https://agent.tinyfish.ai/billing",
            },
          }),
          { status: 403, headers: { "Content-Type": "application/json" } },
        ),
    ) as unknown as typeof fetch;

    await expect(
      runTinyFishAgent({
        goal: "x",
        url: "https://example.com",
        apiKey: "tf_test",
        baseUrl: DEFAULT_AGENT_BASE_URL,
        maxSteps: 10,
        browserProfile: "lite",
        capture: {},
        timeoutSeconds: 5,
      }),
    ).rejects.toMatchObject({
      httpStatus: 403,
      code: "INSUFFICIENT_CREDITS",
    });
  });

  it("throws TinyFishAgentError with INVALID_API_KEY on 401", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: { code: "INVALID_API_KEY", message: "bad key" },
          }),
          { status: 401, headers: { "Content-Type": "application/json" } },
        ),
    ) as unknown as typeof fetch;

    await expect(
      runTinyFishAgent({
        goal: "x",
        url: "https://example.com",
        apiKey: "bad",
        baseUrl: DEFAULT_AGENT_BASE_URL,
        maxSteps: 10,
        browserProfile: "lite",
        capture: {},
        timeoutSeconds: 5,
      }),
    ).rejects.toMatchObject({ httpStatus: 401, code: "INVALID_API_KEY" });
  });
});

describe("createTinyFishAgentTool error mapping", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.spyOn(serviceKeys, "resolveServiceKey").mockReturnValue(undefined);
    vi.unstubAllEnvs();
    vi.stubEnv("TINYFISH_API_KEY", "tf_key");
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("maps INSUFFICIENT_CREDITS to tinyfish_agent_paid_feature", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: {
              code: "INSUFFICIENT_CREDITS",
              message: "Out of credits",
              help_url: "https://agent.tinyfish.ai/billing",
            },
          }),
          { status: 403 },
        ),
    ) as unknown as typeof fetch;

    const tool = createTinyFishAgentTool({
      config: { tools: { web: { agent: { enabled: true } } } },
      sandboxed: false,
    })!;
    const res = await tool.execute("c", { goal: "x", url: "https://example.com" });
    const details = res.details as { error: string; docs?: string };
    expect(details.error).toBe("tinyfish_agent_paid_feature");
    expect(details.docs).toBe("https://agent.tinyfish.ai/billing");
  });

  it("maps 401 to tinyfish_agent_auth_failed", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { code: "INVALID_API_KEY", message: "bad key" } }), {
          status: 401,
        }),
    ) as unknown as typeof fetch;

    const tool = createTinyFishAgentTool({
      config: { tools: { web: { agent: { enabled: true } } } },
      sandboxed: false,
    })!;
    const res = await tool.execute("c", { goal: "x", url: "https://example.com" });
    expect((res.details as { error: string }).error).toBe("tinyfish_agent_auth_failed");
  });

  it("maps rate limit (429) to tinyfish_agent_rate_limited", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ error: { code: "RATE_LIMIT_EXCEEDED", message: "slow down" } }),
          { status: 429 },
        ),
    ) as unknown as typeof fetch;

    const tool = createTinyFishAgentTool({
      config: { tools: { web: { agent: { enabled: true } } } },
      sandboxed: false,
    })!;
    const res = await tool.execute("c", { goal: "x", url: "https://example.com" });
    expect((res.details as { error: string }).error).toBe("tinyfish_agent_rate_limited");
  });

  it("returns success payload on COMPLETED", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            run_id: "r1",
            status: "COMPLETED",
            num_of_steps: 4,
            result: { ok: true },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    ) as unknown as typeof fetch;

    const tool = createTinyFishAgentTool({
      config: { tools: { web: { agent: { enabled: true, maxSteps: 200 } } } },
      sandboxed: false,
    })!;
    const res = await tool.execute("c", {
      goal: "x",
      url: "https://example.com",
      max_steps: 50,
      browser_profile: "stealth",
    });
    const details = res.details as {
      provider: string;
      status: string;
      success: boolean;
      browser_profile: string;
      max_steps: number;
      result: unknown;
    };
    expect(details.provider).toBe("tinyfish");
    expect(details.status).toBe("COMPLETED");
    expect(details.success).toBe(true);
    expect(details.browser_profile).toBe("stealth");
    expect(details.max_steps).toBe(50);
    expect(details.result).toEqual({ ok: true });
  });

  it("clamps requested max_steps to the configured cap", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify({ run_id: "r", status: "COMPLETED", num_of_steps: 1 }), {
        status: 200,
      });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const tool = createTinyFishAgentTool({
      config: { tools: { web: { agent: { enabled: true, maxSteps: 25 } } } },
      sandboxed: false,
    })!;
    await tool.execute("c", {
      goal: "x",
      url: "https://example.com",
      max_steps: 9999,
    });

    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    const body = JSON.parse(init.body as string);
    expect(body.agent_config.max_steps).toBe(25);
  });
});

describe("TinyFishAgentError", () => {
  it("exposes httpStatus and code", () => {
    const err = new TinyFishAgentError({
      httpStatus: 500,
      code: "INTERNAL_ERROR",
      message: "boom",
    });
    expect(err.httpStatus).toBe(500);
    expect(err.code).toBe("INTERNAL_ERROR");
    expect(err.message).toBe("boom");
    expect(err.name).toBe("TinyFishAgentError");
  });
});
