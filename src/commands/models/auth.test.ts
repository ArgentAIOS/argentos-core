import { describe, expect, it } from "vitest";
import { assertOpenAICodexCredentialsValid } from "./auth.js";

describe("assertOpenAICodexCredentialsValid", () => {
  it("throws when credentials are null", () => {
    expect(() => assertOpenAICodexCredentialsValid(null)).toThrow(/did not return credentials/i);
  });

  it("throws when credentials are undefined", () => {
    expect(() => assertOpenAICodexCredentialsValid(undefined)).toThrow(
      /did not return credentials/i,
    );
  });

  it("throws when access token is missing", () => {
    expect(() =>
      assertOpenAICodexCredentialsValid({ refresh: "r" } as {
        access?: string;
        refresh?: string;
      }),
    ).toThrow(/tokens are missing/i);
  });

  it("throws when refresh token is missing", () => {
    expect(() =>
      assertOpenAICodexCredentialsValid({ access: "a" } as {
        access?: string;
        refresh?: string;
      }),
    ).toThrow(/tokens are missing/i);
  });

  it("throws when access token is empty string", () => {
    expect(() => assertOpenAICodexCredentialsValid({ access: "", refresh: "r" })).toThrow(
      /tokens are missing/i,
    );
  });

  it("throws when refresh token is empty string", () => {
    expect(() => assertOpenAICodexCredentialsValid({ access: "a", refresh: "" })).toThrow(
      /tokens are missing/i,
    );
  });

  it("succeeds when both access and refresh are populated", () => {
    expect(() =>
      assertOpenAICodexCredentialsValid({
        access: "access-token",
        refresh: "refresh-token",
      }),
    ).not.toThrow();
  });

  it("error message references the re-run command", () => {
    try {
      assertOpenAICodexCredentialsValid({ access: "a", refresh: "" });
      throw new Error("expected throw");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      expect(msg).toMatch(/argent models auth login/);
      expect(msg).toMatch(/--provider openai-codex/);
    }
  });
});
