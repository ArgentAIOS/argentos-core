import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CRON_CACHE_CASCADE,
  MAX_CACHED_JOBS,
  MAX_CACHE_BYTES,
  MAX_PAYLOAD_PREVIEW,
  STORAGE_KEY,
  _resetCronCacheStateForTests,
  safePersistCronJobs,
  toCachedJobs,
  tryPersistSnapshot,
  type CronJob,
} from "./useCronJobs";

/**
 * Coverage for the GH #157 fix.
 *
 * Bug: the dashboard cron-jobs cache disabled itself with a one-shot
 *   `[CronJobs] localStorage cache disabled (quota/storage error)`
 * warning the first time any tier in its fallback ladder threw — and stayed
 * disabled for the rest of the session.
 *
 * Fix shape: a `CRON_CACHE_CASCADE` of progressively smaller + lighter
 * projections (full → 200 → 100 → 50 → 25 → 10 jobs, with state-stripping at
 * the tightest tiers) plus a proactive `MAX_CACHE_BYTES` ceiling that refuses
 * to write payloads above ~1 MB. These tests pin the cap and the eviction
 * direction so the regression cannot quietly come back.
 */

/** Build a synthetic cron job. The optional `weight` blows up the payload so we
 *  can deliberately push past the byte cap in tests. */
function makeJob(i: number, weight = 0): CronJob {
  return {
    id: `job-${i}`,
    name: `Job ${i}`,
    enabled: true,
    schedule: { kind: "every", everyMs: 60_000 },
    payload: { kind: "speak", text: weight > 0 ? "x".repeat(weight) : `text-${i}` },
    state: {
      nextRunAtMs: 1_700_000_000_000 + i * 60_000,
      lastRunAtMs: 1_700_000_000_000 + i,
      lastExecutionMode: "live",
      lastGateDecision: "allow_live",
      lastGateReason: weight > 0 ? "g".repeat(weight) : `reason-${i}`,
      lastSimulationEvidence: {
        mode: "paper_trade",
        policy: "external_side_effect_gate",
        simulatedAtMs: 1_700_000_000_000 + i,
        payloadKind: "speak",
        action: "speak",
        reason: weight > 0 ? "s".repeat(weight) : `sim-${i}`,
      },
    },
  };
}

/**
 * Minimal Storage shim with an optional byte budget. Mirrors the localStorage
 * surface useCronJobs.ts touches (getItem/setItem/removeItem) and throws a
 * synthetic QuotaExceededError when the configured budget would be exceeded.
 */
class FakeStorage implements Storage {
  private data = new Map<string, string>();
  public quotaBytes: number | null;
  public setCalls = 0;

  constructor(quotaBytes: number | null = null) {
    this.quotaBytes = quotaBytes;
  }

  private usedBytes(skipKey: string | null = null): number {
    let used = 0;
    for (const [key, value] of this.data) {
      if (key === skipKey) {
        continue;
      }
      used += key.length + value.length;
    }
    return used;
  }

  get length(): number {
    return this.data.size;
  }
  key(index: number): string | null {
    return Array.from(this.data.keys())[index] ?? null;
  }
  clear(): void {
    this.data.clear();
  }
  getItem(key: string): string | null {
    return this.data.has(key) ? (this.data.get(key) as string) : null;
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
  setItem(key: string, value: string): void {
    this.setCalls += 1;
    if (this.quotaBytes !== null) {
      const projected = this.usedBytes(key) + key.length + value.length;
      if (projected > this.quotaBytes) {
        const err = new Error("The quota has been exceeded.");
        err.name = "QuotaExceededError";
        throw err;
      }
    }
    this.data.set(key, value);
  }
}

function installFakeStorage(quotaBytes: number | null = null): FakeStorage {
  const storage = new FakeStorage(quotaBytes);
  // jsdom and undici-style harnesses both expose localStorage on globalThis.
  Object.defineProperty(globalThis, "localStorage", {
    value: storage,
    configurable: true,
    writable: true,
  });
  return storage;
}

beforeEach(() => {
  _resetCronCacheStateForTests();
  installFakeStorage();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("toCachedJobs", () => {
  it("keeps at most `step.cap` jobs and evicts oldest (FIFO from start of array)", () => {
    const jobs = Array.from({ length: 600 }, (_, i) => makeJob(i));
    const cached = toCachedJobs(jobs, {
      cap: 50,
      dropState: false,
      previewLen: MAX_PAYLOAD_PREVIEW,
    });

    expect(cached).toHaveLength(50);
    // We keep the LAST 50, so the first id retained is job-550 and the last
    // is job-599. The first 550 entries should have been evicted.
    expect(cached[0].id).toBe("job-550");
    expect(cached[cached.length - 1].id).toBe("job-599");
  });

  it("drops the heavy `state` field when step.dropState is true", () => {
    const jobs = [makeJob(0)];
    const heavy = toCachedJobs(jobs, {
      cap: 10,
      dropState: false,
      previewLen: MAX_PAYLOAD_PREVIEW,
    });
    const lite = toCachedJobs(jobs, { cap: 10, dropState: true, previewLen: MAX_PAYLOAD_PREVIEW });
    expect(heavy[0].state).toBeDefined();
    expect(heavy[0].state?.lastSimulationEvidence).toBeDefined();
    expect(lite[0].state).toBeUndefined();
  });

  it("trims string previews to step.previewLen", () => {
    const jobs = [makeJob(0, 2000)];
    const cached = toCachedJobs(jobs, { cap: 1, dropState: false, previewLen: 60 });
    expect(cached[0].payload.text?.length).toBe(60);
    expect(cached[0].state?.lastGateReason?.length).toBe(60);
    expect(cached[0].state?.lastSimulationEvidence?.reason.length).toBe(60);
  });
});

describe("tryPersistSnapshot", () => {
  it("refuses (returns false, does not write) when the snapshot exceeds MAX_CACHE_BYTES", () => {
    const storage = installFakeStorage();
    // A single job with ~2 MB of inline text is well past the 1 MB cap.
    const fat = [makeJob(0, MAX_CACHE_BYTES * 2)];
    const ok = tryPersistSnapshot(fat, {
      cap: 1,
      dropState: false,
      previewLen: MAX_CACHE_BYTES * 2,
    });
    expect(ok).toBe(false);
    expect(storage.setCalls).toBe(0);
    expect(storage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("writes the snapshot under MAX_CACHE_BYTES", () => {
    const storage = installFakeStorage();
    const jobs = [makeJob(0), makeJob(1)];
    const ok = tryPersistSnapshot(jobs, CRON_CACHE_CASCADE[0]);
    expect(ok).toBe(true);
    expect(storage.setCalls).toBe(1);
    const persisted = JSON.parse(storage.getItem(STORAGE_KEY) as string);
    expect(persisted).toHaveLength(2);
  });
});

describe("safePersistCronJobs", () => {
  it("at steady state writes a single full snapshot capped to MAX_CACHED_JOBS", () => {
    const storage = installFakeStorage();
    const jobs = Array.from({ length: MAX_CACHED_JOBS + 100 }, (_, i) => makeJob(i));
    safePersistCronJobs(jobs);

    expect(storage.setCalls).toBe(1);
    const persisted = JSON.parse(storage.getItem(STORAGE_KEY) as string);
    expect(persisted).toHaveLength(MAX_CACHED_JOBS);
    // FIFO eviction: oldest 100 dropped, newest MAX_CACHED_JOBS retained.
    expect(persisted[0].id).toBe("job-100");
    expect(persisted[persisted.length - 1].id).toBe(`job-${MAX_CACHED_JOBS + 99}`);
  });

  it("cascades to a tighter step when the browser throws QuotaExceededError", () => {
    // Tight quota: 60 KB is enough for ~25-50 small jobs but not 500.
    const storage = installFakeStorage(60_000);
    const jobs = Array.from({ length: 600 }, (_, i) => makeJob(i));
    safePersistCronJobs(jobs);

    const raw = storage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    const persisted = JSON.parse(raw as string) as CronJob[];
    // Hit a tier strictly smaller than the full cap.
    expect(persisted.length).toBeLessThan(MAX_CACHED_JOBS);
    expect(persisted.length).toBeGreaterThan(0);
    // The browser was hit more than once because the cascade fell through.
    expect(storage.setCalls).toBeGreaterThan(1);
  });

  it("emits one warning + disables cache when every cascade tier exceeds quota", () => {
    // Quota so small (1 byte) that no tier can ever fit.
    const storage = installFakeStorage(1);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const jobs = Array.from({ length: 600 }, (_, i) => makeJob(i));

    safePersistCronJobs(jobs);
    safePersistCronJobs(jobs); // Second call must NOT re-warn or re-attempt.

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain("[CronJobs] localStorage cache disabled");
    expect(storage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("is a no-op once cronCacheStorageDisabled has flipped (no re-attempts)", () => {
    const storage = installFakeStorage(1);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const jobs = [makeJob(0)];

    safePersistCronJobs(jobs); // Flips the disabled flag.
    const callsAfterFirst = storage.setCalls;
    safePersistCronJobs(jobs);
    safePersistCronJobs(jobs);
    expect(storage.setCalls).toBe(callsAfterFirst);
  });
});
