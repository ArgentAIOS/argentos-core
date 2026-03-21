import { describe, expect, it } from "vitest";
import {
  coerceToFailoverError,
  describeFailoverError,
  resolveRetryAfterMs,
  resolveFailoverReasonFromError,
} from "./failover-error.js";

describe("failover-error", () => {
  it("infers failover reason from HTTP status", () => {
    expect(resolveFailoverReasonFromError({ status: 402 })).toBe("billing");
    expect(resolveFailoverReasonFromError({ statusCode: "429" })).toBe("rate_limit");
    expect(resolveFailoverReasonFromError({ status: 403 })).toBe("auth");
    expect(resolveFailoverReasonFromError({ status: 408 })).toBe("timeout");
  });

  it("infers format errors from error messages", () => {
    expect(
      resolveFailoverReasonFromError({
        message: "invalid request format: messages.1.content.1.tool_use.id",
      }),
    ).toBe("format");
  });

  it("infers timeout from common node error codes", () => {
    expect(resolveFailoverReasonFromError({ code: "ETIMEDOUT" })).toBe("timeout");
    expect(resolveFailoverReasonFromError({ code: "ECONNRESET" })).toBe("timeout");
  });

  it("coerces failover-worthy errors into FailoverError with metadata", () => {
    const err = coerceToFailoverError("credit balance too low", {
      provider: "anthropic",
      model: "claude-opus-4-5",
    });
    expect(err?.name).toBe("FailoverError");
    expect(err?.reason).toBe("billing");
    expect(err?.status).toBe(402);
    expect(err?.provider).toBe("anthropic");
    expect(err?.model).toBe("claude-opus-4-5");
  });

  it("coerces format errors with a 400 status", () => {
    const err = coerceToFailoverError("invalid request format", {
      provider: "google",
      model: "cloud-code-assist",
    });
    expect(err?.reason).toBe("format");
    expect(err?.status).toBe(400);
  });

  it("describes non-Error values consistently", () => {
    const described = describeFailoverError(123);
    expect(described.message).toBe("123");
    expect(described.reason).toBeUndefined();
  });

  it("extracts Retry-After from response headers", () => {
    const err = {
      status: 429,
      response: {
        headers: {
          get: (name: string) => (name.toLowerCase() === "retry-after" ? "120" : null),
        },
      },
    };
    expect(resolveRetryAfterMs(err)).toBe(120_000);
    const failover = coerceToFailoverError(err);
    expect(failover?.retryAfterMs).toBe(120_000);
  });

  it("extracts Retry-After from HTTP-date headers", () => {
    const target = new Date(Date.now() + 90_000).toUTCString();
    const err = {
      status: 429,
      headers: {
        "Retry-After": target,
      },
    };
    const retryAfterMs = resolveRetryAfterMs(err);
    expect(typeof retryAfterMs).toBe("number");
    expect(retryAfterMs as number).toBeGreaterThan(70_000);
    expect(retryAfterMs as number).toBeLessThan(95_000);
  });

  it("ignores invalid Retry-After headers", () => {
    const err = {
      status: 429,
      response: {
        headers: {
          get: (name: string) => (name.toLowerCase() === "retry-after" ? "not-a-number" : null),
        },
      },
    };
    expect(resolveRetryAfterMs(err)).toBeUndefined();
  });
});
