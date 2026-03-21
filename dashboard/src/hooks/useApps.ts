import { useState, useEffect, useCallback, useRef } from "react";
import { fetchLocalApi } from "../utils/localApiFetch";

const API_BASE = "/api";

export interface ForgeApp {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  code?: string;
  version: number;
  creator: string;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt?: string;
  openCount: number;
  pinned: boolean;
}

interface UseAppsReturn {
  apps: ForgeApp[];
  loading: boolean;
  error: string | null;
  upsertApp: (app: ForgeApp) => void;
  createApp: (app: {
    name: string;
    description?: string;
    icon?: string;
    code: string;
  }) => Promise<ForgeApp | null>;
  updateApp: (appId: string, updates: Partial<ForgeApp>) => Promise<ForgeApp | null>;
  deleteApp: (appId: string) => Promise<boolean>;
  getApp: (appId: string) => Promise<ForgeApp | null>;
  recordOpen: (appId: string) => Promise<void>;
  pinApp: (appId: string) => Promise<ForgeApp | null>;
  searchApps: (query: string) => Promise<ForgeApp[]>;
  refreshApps: () => Promise<void>;
}

interface UseAppsOptions {
  enabled?: boolean;
  pollMs?: number;
  includeCode?: boolean;
}

function isAbortLikeError(err: unknown): boolean {
  return err instanceof Error && (err.name === "AbortError" || /aborted|abort/i.test(err.message));
}

function sendXhrRequest(method: string, url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open(method, url, true);
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        resolve();
        return;
      }
      reject(new Error(`Failed to delete app (${request.status})`));
    };
    request.onerror = () => reject(new Error("Failed to delete app"));
    request.onabort = () => reject(new Error("Delete request aborted"));
    request.send();
  });
}

export function useApps(options: UseAppsOptions = {}): UseAppsReturn {
  const { enabled = true, pollMs = 5000, includeCode = false } = options;
  const [apps, setApps] = useState<ForgeApp[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const appsRef = useRef<ForgeApp[]>([]);
  const refreshInFlightRef = useRef(false);
  const refreshPendingRef = useRef(false);
  const refreshAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    appsRef.current = apps;
  }, [apps]);

  const refreshApps = useCallback(async () => {
    if (refreshInFlightRef.current) {
      refreshPendingRef.current = true;
      return;
    }
    do {
      refreshPendingRef.current = false;
      refreshInFlightRef.current = true;
      const controller = new AbortController();
      refreshAbortRef.current = controller;
      const timeout = setTimeout(() => controller.abort(), 8_000);
      try {
        const query = includeCode ? "?includeCode=1" : "";
        const res = await fetchLocalApi(
          `${API_BASE}/apps${query}`,
          { signal: controller.signal },
          8_000,
        );
        if (!res.ok) throw new Error("Failed to fetch apps");
        const data = await res.json();
        setApps(data.apps || []);
        setError(null);
      } catch (err) {
        if (!(err instanceof Error && err.name === "AbortError")) {
          console.error("[useApps] Error fetching apps:", err);
          setError(err instanceof Error ? err.message : "Failed to fetch apps");
        }
      } finally {
        clearTimeout(timeout);
        if (refreshAbortRef.current === controller) {
          refreshAbortRef.current = null;
        }
        refreshInFlightRef.current = false;
        setLoading(false);
      }
    } while (refreshPendingRef.current);
  }, [includeCode]);

  const upsertApp = useCallback((app: ForgeApp) => {
    setApps((prev) => {
      const existingIndex = prev.findIndex((candidate) => candidate.id === app.id);
      if (existingIndex === -1) {
        return [app, ...prev];
      }
      return prev.map((candidate) =>
        candidate.id === app.id ? { ...candidate, ...app } : candidate,
      );
    });
  }, []);

  // Initial fetch + polling
  useEffect(() => {
    if (!enabled) {
      refreshAbortRef.current?.abort();
      refreshAbortRef.current = null;
      refreshInFlightRef.current = false;
      setLoading(false);
      return;
    }
    refreshApps();
    const interval = setInterval(refreshApps, pollMs);
    return () => {
      clearInterval(interval);
      refreshAbortRef.current?.abort();
      refreshAbortRef.current = null;
      refreshInFlightRef.current = false;
    };
  }, [enabled, pollMs, refreshApps]);

  // SSE listener for instant updates
  useEffect(() => {
    if (!enabled) return;
    const eventSource = new EventSource(`${API_BASE}/apps/events`);

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (
          data.type === "app_created" ||
          data.type === "app_updated" ||
          data.type === "app_deleted"
        ) {
          refreshApps();
        }
      } catch (err) {
        console.error("[useApps] SSE parse error:", err);
      }
    };

    eventSource.onerror = () => {
      // Silently reconnect - EventSource handles reconnection
    };

    return () => eventSource.close();
  }, [enabled, refreshApps]);

  const createApp = useCallback(
    async (app: {
      name: string;
      description?: string;
      icon?: string;
      code: string;
    }): Promise<ForgeApp | null> => {
      try {
        const res = await fetchLocalApi(`${API_BASE}/apps`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(app),
        });
        if (!res.ok) throw new Error("Failed to create app");
        const data = await res.json();
        setApps((prev) => [data.app, ...prev]);
        return data.app;
      } catch (err) {
        console.error("[useApps] Error creating app:", err);
        setError(err instanceof Error ? err.message : "Failed to create app");
        return null;
      }
    },
    [],
  );

  const updateApp = useCallback(
    async (appId: string, updates: Partial<ForgeApp>): Promise<ForgeApp | null> => {
      try {
        const res = await fetchLocalApi(`${API_BASE}/apps/${appId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updates),
        });
        if (!res.ok) throw new Error("Failed to update app");
        const data = await res.json();
        setApps((prev) => prev.map((a) => (a.id === appId ? data.app : a)));
        return data.app;
      } catch (err) {
        console.error("[useApps] Error updating app:", err);
        setError(err instanceof Error ? err.message : "Failed to update app");
        return null;
      }
    },
    [],
  );

  const deleteApp = useCallback(async (appId: string): Promise<boolean> => {
    const previousApps = appsRef.current;
    const deletedApp = previousApps.find((app) => app.id === appId);

    setApps((prev) => prev.filter((app) => app.id !== appId));

    try {
      const res = await fetchLocalApi(
        `${API_BASE}/apps/${appId}/delete`,
        {
          method: "POST",
          cache: "no-store",
        },
        4_000,
      );
      if (!res.ok) throw new Error("Failed to delete app");
      setError(null);
      return true;
    } catch (err) {
      if (isAbortLikeError(err)) {
        try {
          await sendXhrRequest("POST", `${API_BASE}/apps/${appId}/delete`);
          setError(null);
          return true;
        } catch (xhrErr) {
          err = xhrErr;
        }
      }

      if (deletedApp) {
        setApps((prev) => {
          if (prev.some((app) => app.id === deletedApp.id)) {
            return prev;
          }
          return [deletedApp, ...prev];
        });
      } else {
        setApps(previousApps);
      }

      console.error("[useApps] Error deleting app:", err);
      setError(err instanceof Error ? err.message : "Failed to delete app");
      return false;
    }
  }, []);

  const getApp = useCallback(async (appId: string): Promise<ForgeApp | null> => {
    try {
      const res = await fetchLocalApi(`${API_BASE}/apps/${appId}`);
      if (!res.ok) throw new Error("Failed to get app");
      const data = await res.json();
      return data.app;
    } catch (err) {
      console.error("[useApps] Error getting app:", err);
      return null;
    }
  }, []);

  const recordOpen = useCallback(async (appId: string): Promise<void> => {
    try {
      await fetchLocalApi(`${API_BASE}/apps/${appId}/open`, { method: "POST" });
    } catch (err) {
      console.error("[useApps] Error recording open:", err);
    }
  }, []);

  const pinApp = useCallback(async (appId: string): Promise<ForgeApp | null> => {
    try {
      const res = await fetchLocalApi(`${API_BASE}/apps/${appId}/pin`, { method: "POST" });
      if (!res.ok) throw new Error("Failed to pin app");
      const data = await res.json();
      setApps((prev) => prev.map((a) => (a.id === appId ? data.app : a)));
      return data.app;
    } catch (err) {
      console.error("[useApps] Error pinning app:", err);
      return null;
    }
  }, []);

  const searchApps = useCallback(async (query: string): Promise<ForgeApp[]> => {
    try {
      const res = await fetchLocalApi(`${API_BASE}/apps/search?q=${encodeURIComponent(query)}`);
      if (!res.ok) throw new Error("Failed to search apps");
      const data = await res.json();
      return data.apps || [];
    } catch (err) {
      console.error("[useApps] Error searching apps:", err);
      return [];
    }
  }, []);

  return {
    apps,
    loading,
    error,
    upsertApp,
    createApp,
    updateApp,
    deleteApp,
    getApp,
    recordOpen,
    pinApp,
    searchApps,
    refreshApps,
  };
}
