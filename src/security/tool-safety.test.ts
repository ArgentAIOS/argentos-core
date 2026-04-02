import { describe, expect, it } from "vitest";
import {
  assertSafeHttpEndpoint,
  sanitizeToolResultForModel,
  sanitizeToolTextForModel,
} from "./tool-safety.js";

describe("tool-safety", () => {
  it("redacts sensitive text and emits structured leak metadata", () => {
    const result = sanitizeToolTextForModel("Authorization: Bearer sk-test-1234567890abcdefgh");

    expect(result.text).not.toContain("1234567890abcdefgh");
    expect(result.safety.leakScan.redacted).toBe(true);
    expect(result.safety.leakScan.redactionCount).toBeGreaterThan(0);
    expect(result.safety.leakScan.categories).toContain("openai_like_key");
  });

  it("wraps external content after redaction", () => {
    const result = sanitizeToolTextForModel("token=sk-test-1234567890abcdefgh", {
      externalContent: { source: "api", includeWarning: true },
    });

    expect(result.text).toContain("<<<EXTERNAL_UNTRUSTED_CONTENT>>>");
    expect(result.text).toContain("SECURITY NOTICE");
    expect(result.text).not.toContain("1234567890abcdefgh");
    expect(result.safety.externalContentWrapped).toBe(true);
  });

  it("sanitizes text blocks in tool results and merges safety metadata into details", () => {
    const result = sanitizeToolResultForModel({
      content: [{ type: "text", text: "password=sk-test-1234567890abcdefgh" }],
      details: { exitCode: 0 },
    });

    const textBlock = result.content[0] as { text?: string };
    const details = result.details as {
      exitCode: number;
      safety?: { leakScan?: { redacted?: boolean } };
    };
    expect(textBlock.text).not.toContain("1234567890abcdefgh");
    expect(details.exitCode).toBe(0);
    expect(details.safety?.leakScan?.redacted).toBe(true);
  });

  it("blocks private endpoints unless explicitly allowlisted", async () => {
    await expect(assertSafeHttpEndpoint("http://127.0.0.1:1234/v1/models")).rejects.toThrow(
      /Blocked|allowlist/i,
    );
    await expect(
      assertSafeHttpEndpoint("http://127.0.0.1:1234/v1/models", {
        allowedHostnames: ["127.0.0.1"],
        hostnameAllowlist: ["127.0.0.1"],
      }),
    ).resolves.toBe("http://127.0.0.1:1234/v1/models");
  });
});
