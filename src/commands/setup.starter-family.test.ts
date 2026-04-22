import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("starter family manifest", () => {
  it("keeps a broad cross-team roster for first-run bootstrap", async () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const raw = await fs.readFile(path.join(root, "agents", "starter-family.json"), "utf-8");
    const roster = JSON.parse(raw) as Array<{
      id: string;
      team: string;
    }>;

    const ids = new Set(roster.map((agent) => agent.id));
    const teams = new Set(roster.map((agent) => agent.team));

    expect(roster.length).toBeGreaterThanOrEqual(20);
    expect(ids.size).toBe(roster.length);
    expect(teams.has("dev-team")).toBe(true);
    expect(teams.has("marketing-team")).toBe(true);
    expect([...teams].some((team) => team.includes("support") || team.includes("msp"))).toBe(true);
    expect([...teams].some((team) => team.includes("office"))).toBe(true);
    expect(teams.has("think-tank")).toBe(true);
  });
});
