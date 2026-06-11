import { afterEach, describe, expect, it, vi } from "vitest";
import type { PersonalSkillCandidate } from "../../memory/memu-types.js";
import {
  getCachedPersonalSkillCandidates,
  invalidatePersonalSkillReadCache,
} from "./personal-skill-read-cache.js";

function candidate(id: string): PersonalSkillCandidate {
  return { id } as PersonalSkillCandidate;
}

describe("personal skill read cache (#405)", () => {
  afterEach(() => {
    invalidatePersonalSkillReadCache();
    vi.useRealTimers();
  });

  it("fills once per agent within the TTL", async () => {
    const fill = vi.fn().mockResolvedValue([candidate("a")]);
    const first = await getCachedPersonalSkillCandidates({ agentId: "main", fill });
    const second = await getCachedPersonalSkillCandidates({ agentId: "main", fill });
    expect(first).toEqual(second);
    expect(fill).toHaveBeenCalledTimes(1);
  });

  it("keeps agents isolated", async () => {
    const fillA = vi.fn().mockResolvedValue([candidate("a")]);
    const fillB = vi.fn().mockResolvedValue([candidate("b")]);
    await getCachedPersonalSkillCandidates({ agentId: "main", fill: fillA });
    await getCachedPersonalSkillCandidates({ agentId: "ops", fill: fillB });
    expect(fillA).toHaveBeenCalledTimes(1);
    expect(fillB).toHaveBeenCalledTimes(1);
  });

  it("refills after invalidation", async () => {
    const fill = vi.fn().mockResolvedValue([candidate("a")]);
    await getCachedPersonalSkillCandidates({ agentId: "main", fill });
    invalidatePersonalSkillReadCache("main");
    await getCachedPersonalSkillCandidates({ agentId: "main", fill });
    expect(fill).toHaveBeenCalledTimes(2);
  });

  it("clear-all invalidation drops every agent", async () => {
    const fill = vi.fn().mockResolvedValue([candidate("a")]);
    await getCachedPersonalSkillCandidates({ agentId: "main", fill });
    await getCachedPersonalSkillCandidates({ agentId: "ops", fill });
    invalidatePersonalSkillReadCache();
    await getCachedPersonalSkillCandidates({ agentId: "main", fill });
    await getCachedPersonalSkillCandidates({ agentId: "ops", fill });
    expect(fill).toHaveBeenCalledTimes(4);
  });

  it("refills after the TTL expires", async () => {
    vi.useFakeTimers();
    const fill = vi.fn().mockResolvedValue([candidate("a")]);
    await getCachedPersonalSkillCandidates({ agentId: "main", fill });
    vi.advanceTimersByTime(61_000);
    await getCachedPersonalSkillCandidates({ agentId: "main", fill });
    expect(fill).toHaveBeenCalledTimes(2);
  });

  it("does not cache failures", async () => {
    const fill = vi
      .fn()
      .mockRejectedValueOnce(new Error("backend down"))
      .mockResolvedValueOnce([candidate("a")]);
    await expect(getCachedPersonalSkillCandidates({ agentId: "main", fill })).rejects.toThrow(
      "backend down",
    );
    const recovered = await getCachedPersonalSkillCandidates({ agentId: "main", fill });
    expect(recovered).toHaveLength(1);
    expect(fill).toHaveBeenCalledTimes(2);
  });

  it("dedupes concurrent fills for the same agent", async () => {
    let resolveFill: (value: PersonalSkillCandidate[]) => void = () => {};
    const fill = vi.fn().mockImplementation(
      () =>
        new Promise<PersonalSkillCandidate[]>((resolve) => {
          resolveFill = resolve;
        }),
    );
    const p1 = getCachedPersonalSkillCandidates({ agentId: "main", fill });
    const p2 = getCachedPersonalSkillCandidates({ agentId: "main", fill });
    resolveFill([candidate("a")]);
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toBe(r2);
    expect(fill).toHaveBeenCalledTimes(1);
  });
});
