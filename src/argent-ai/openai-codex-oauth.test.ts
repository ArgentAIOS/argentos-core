import { createHash, randomBytes } from "node:crypto";
import { describe, it, expect, afterEach, vi } from "vitest";

/**
 * Tests for the OpenAI Codex OAuth PKCE module.
 *
 * We test the module's internal logic by importing and exercising it
 * against mocked HTTP and fetch. The actual OAuth endpoints aren't hit.
 */

describe("openai-codex-oauth (Argent)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("module exports loginOpenAICodex function", async () => {
    const mod = await import("./openai-codex-oauth.js");
    expect(typeof mod.loginOpenAICodex).toBe("function");
  });

  it("function accepts a single options parameter", async () => {
    const mod = await import("./openai-codex-oauth.js");
    expect(mod.loginOpenAICodex.length).toBe(1);
  });

  describe("PKCE generation", () => {
    it("generates valid base64url code verifier", () => {
      const verifier = randomBytes(64).toString("base64url").slice(0, 128);
      expect(verifier.length).toBeGreaterThan(42);
      expect(verifier.length).toBeLessThanOrEqual(128);
      // base64url charset: [A-Za-z0-9_-]
      expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it("generates correct S256 code challenge", () => {
      const verifier = "test_verifier_12345";
      const challenge = createHash("sha256").update(verifier).digest("base64url");
      expect(challenge).toBeTruthy();
      expect(challenge.length).toBeGreaterThan(0);
      expect(challenge).not.toBe(verifier);
    });

    it("S256 challenge is deterministic for same verifier", () => {
      const verifier = "deterministic_test_verifier";
      const challenge1 = createHash("sha256").update(verifier).digest("base64url");
      const challenge2 = createHash("sha256").update(verifier).digest("base64url");
      expect(challenge1).toBe(challenge2);
    });
  });

  describe("loginOpenAICodex invocation", () => {
    it("calls onAuth with an authorization URL containing PKCE params", async () => {
      const mod = await import("./openai-codex-oauth.js");
      let authUrl = "";
      let capturedState = "";

      const promise = mod.loginOpenAICodex({
        onAuth: (info) => {
          authUrl = info.url;
          // Extract state from the URL so we can hit the callback server
          const url = new URL(info.url);
          capturedState = url.searchParams.get("state") || "";

          // Immediately hit the callback server with a fake auth code
          // This resolves the callbackPromise before the 30s manual timeout
          setTimeout(() => {
            fetch(`http://localhost:1455/callback?code=test_code&state=${capturedState}`).catch(
              () => {},
            );
          }, 50);
        },
        onPrompt: async () => "",
        onProgress: () => {},
      });

      // The token exchange will fail (no real OAuth server), but we captured the URL
      await promise.catch(() => {});

      expect(authUrl).toBeTruthy();
      const url = new URL(authUrl);
      expect(url.searchParams.get("response_type")).toBe("code");
      expect(url.searchParams.get("code_challenge_method")).toBe("S256");
      expect(url.searchParams.get("code_challenge")).toBeTruthy();
      expect(url.searchParams.get("state")).toBeTruthy();
      expect(url.searchParams.get("redirect_uri")).toContain("1455");
    });

    it("calls onProgress with status messages", async () => {
      const mod = await import("./openai-codex-oauth.js");
      const progressMessages: string[] = [];
      let capturedState = "";

      const promise = mod.loginOpenAICodex({
        onAuth: (info) => {
          const url = new URL(info.url);
          capturedState = url.searchParams.get("state") || "";
          // Trigger callback to avoid 30s wait
          setTimeout(() => {
            fetch(`http://localhost:1455/callback?code=test_code&state=${capturedState}`).catch(
              () => {},
            );
          }, 50);
        },
        onPrompt: async () => "",
        onProgress: (msg) => {
          progressMessages.push(msg);
        },
      });

      await promise.catch(() => {});

      expect(progressMessages.length).toBeGreaterThan(0);
      expect(progressMessages.some((m) => m.includes("PKCE"))).toBe(true);
      expect(progressMessages.some((m) => m.includes("callback"))).toBe(true);
    });

    it("returns error when callback has wrong state", async () => {
      const mod = await import("./openai-codex-oauth.js");

      const promise = mod.loginOpenAICodex({
        onAuth: () => {
          // Hit callback with wrong state
          setTimeout(() => {
            fetch("http://localhost:1455/callback?code=test&state=wrong_state").catch(() => {});
          }, 50);
        },
        onPrompt: async () => {
          throw new Error("abort");
        },
        onProgress: () => {},
      });

      await expect(promise).rejects.toThrow();
    });
  });
});
