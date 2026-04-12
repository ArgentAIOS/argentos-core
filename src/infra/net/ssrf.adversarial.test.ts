import { describe, expect, it, vi } from "vitest";
import { resolvePinnedHostnameWithPolicy } from "./ssrf.js";

describe("ssrf adversarial coverage", () => {
  it("normalizes mixed-case trailing-dot hosts before wildcard allowlist checks", async () => {
    const lookup = vi.fn(async () => [{ address: "93.184.216.34", family: 4 as const }]);

    const pinned = await resolvePinnedHostnameWithPolicy("Api.Example.com.", {
      lookupFn: lookup,
      policy: {
        hostnameAllowlist: ["*.example.com", "*", "*."],
      },
    });

    expect(pinned.hostname).toBe("api.example.com");
    expect(lookup).toHaveBeenCalledWith("api.example.com", { all: true });
  });

  it("does not let wildcard subdomain rules match the bare parent domain", async () => {
    const lookup = vi.fn(async () => [{ address: "93.184.216.34", family: 4 as const }]);

    await expect(
      resolvePinnedHostnameWithPolicy("example.com", {
        lookupFn: lookup,
        policy: { hostnameAllowlist: ["*.example.com"] },
      }),
    ).rejects.toThrow(/allowlist/i);
  });

  it("allows explicitly-allowlisted localhost only when policy opts in", async () => {
    const lookup = vi.fn(async () => [{ address: "127.0.0.1", family: 4 as const }]);

    const pinned = await resolvePinnedHostnameWithPolicy("LOCALHOST", {
      lookupFn: lookup,
      policy: {
        allowedHostnames: ["localhost"],
        hostnameAllowlist: ["localhost"],
      },
    });

    expect(pinned.hostname).toBe("localhost");
    expect(pinned.addresses).toEqual(["127.0.0.1"]);
  });
});
