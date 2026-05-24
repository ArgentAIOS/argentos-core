import { useCallback, useEffect, useRef, useState } from "react";
import { fetchLocalApi } from "../utils/localApiFetch";

export type SystemHealthSnapshot = {
  capturedAt: string;
  cached?: boolean;
  hardware: {
    chip: string;
    model: string;
    machineName: string;
    memoryGb: number;
    cores: { performance: number; efficiency: number };
    chassis: "laptop" | "desktop" | "unknown";
    os: { name: string; version: string };
  };
  thermal: {
    kernelTaskPercent: number | null;
    loadPerCore: number;
    load1: number;
    interpretation: "cool" | "mild" | "moderate" | "throttling" | "severe" | "unknown";
    indicator: "kernel_task" | "load_avg";
  };
  runtimes: {
    ollama: { reachable: boolean; loadedModels: string[]; activeModels: string[] };
    lmStudio: { reachable: boolean; loadedModels: string[] };
    omlx: { reachable: boolean; loadedModels: string[] };
  };
  kernel: {
    enabled: boolean;
    mode: string;
    tickMs: number;
    localModel: string | null;
    idleActivityGateMinutes: number;
  };
  suggestions: Array<{
    id: string;
    severity: "info" | "tip" | "warning";
    title: string;
    body: string;
    source: "rule" | "ai";
  }>;
};

type UseSystemHealthResult = {
  snapshot: SystemHealthSnapshot | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  lastRefreshedAt: Date | null;
};

const DEFAULT_POLL_MS = 60_000;

export function useSystemHealth(
  opts: { pollMs?: number; enabled?: boolean } = {},
): UseSystemHealthResult {
  const pollMs = opts.pollMs ?? DEFAULT_POLL_MS;
  const enabled = opts.enabled !== false;
  const [snapshot, setSnapshot] = useState<SystemHealthSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);
  const inFlight = useRef(false);

  const load = useCallback(async (fresh: boolean) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    setError(null);
    try {
      const url = `/api/system-health/snapshot${fresh ? "?fresh=1" : ""}`;
      const response = await fetchLocalApi(url, { method: "GET" });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const json = (await response.json()) as SystemHealthSnapshot;
      setSnapshot(json);
      setLastRefreshedAt(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, []);

  const refresh = useCallback(() => load(true), [load]);

  useEffect(() => {
    if (!enabled) return;
    void load(false);
    const interval = setInterval(() => void load(false), pollMs);
    return () => clearInterval(interval);
  }, [enabled, pollMs, load]);

  return { snapshot, loading, error, refresh, lastRefreshedAt };
}
