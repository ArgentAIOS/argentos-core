import type { CanvasDocument } from "../components/CanvasPanel";

export interface StoredCanvasDocument extends CanvasDocument {
  savedAt: Date;
  tags?: string[];
}

export interface CanvasIndex {
  documents: {
    id: string;
    title: string;
    type: string;
    savedAt: string;
    path?: string;
    tags?: string[];
    score?: number; // For search results
  }[];
  lastUpdated: string;
}

// API endpoints handle storage paths

const DEFAULT_TIMEOUT_MS = 10000;
const CANVAS_INDEX_CACHE_KEY = "argent-canvas-index-cache-v1";
const CANVAS_INDEX_CACHE_MAX = 220;

function isAbortLikeError(err: unknown): boolean {
  if (err instanceof DOMException) return err.name === "AbortError";
  if (err instanceof Error) return err.name === "AbortError";
  const msg = String(err || "");
  return msg.includes("AbortError") || msg.toLowerCase().includes("signal is aborted");
}

function getAlternateLoopbackOrigin(): string | null {
  if (typeof window === "undefined") return null;
  const { protocol, hostname, port } = window.location;
  const portPart = port ? `:${port}` : "";
  if (hostname === "localhost") return `${protocol}//127.0.0.1${portPart}`;
  if (hostname === "127.0.0.1") return `${protocol}//localhost${portPart}`;
  return null;
}

async function fetchCanvasApi(
  path: string,
  init: RequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  const method = String(init.method || "GET").toUpperCase();
  const isReadOnly = method === "GET" || method === "HEAD";
  const altOrigin = getAlternateLoopbackOrigin();
  const canUseAlt = Boolean(altOrigin && path.startsWith("/"));

  if (isReadOnly && canUseAlt) {
    try {
      return await fetchWithTimeout(path, init, timeoutMs);
    } catch (primaryErr) {
      try {
        return await fetchWithTimeout(`${altOrigin!}${path}`, init, timeoutMs);
      } catch {
        throw primaryErr;
      }
    }
  }

  try {
    return await fetchWithTimeout(path, init, timeoutMs);
  } catch (primaryErr) {
    // Fallback for cases where one loopback host's connection pool is saturated by SSE.
    try {
      if (!canUseAlt) throw primaryErr;
      return await fetchWithTimeout(`${altOrigin!}${path}`, init, timeoutMs);
    } catch {
      throw primaryErr;
    }
  }
}

function toCachedIndexRows(rows: CanvasIndex["documents"]): CanvasIndex["documents"] {
  return rows.slice(0, CANVAS_INDEX_CACHE_MAX).map((row) => ({
    id: String(row.id || ""),
    title: String(row.title || ""),
    type: String(row.type || "markdown"),
    savedAt: String(row.savedAt || new Date().toISOString()),
    ...(row.path ? { path: String(row.path) } : {}),
    ...(Array.isArray(row.tags) ? { tags: row.tags.slice(0, 12).map(String) } : {}),
    ...(typeof row.score === "number" ? { score: row.score } : {}),
  }));
}

function writeCanvasIndexCache(rows: CanvasIndex["documents"]): void {
  try {
    const payload = JSON.stringify(toCachedIndexRows(rows));
    localStorage.setItem(CANVAS_INDEX_CACHE_KEY, payload);
  } catch {
    // Ignore cache writes; network data still works.
  }
}

export function readCanvasIndexCache(): CanvasIndex["documents"] {
  try {
    const raw = localStorage.getItem(CANVAS_INDEX_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as CanvasIndex["documents"]) : [];
  } catch {
    return [];
  }
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
) {
  const upstreamSignal = init.signal;
  if (!timeoutMs || timeoutMs <= 0) {
    return fetch(input, init);
  }

  const controller = new AbortController();
  const onUpstreamAbort = () => controller.abort();
  if (upstreamSignal) {
    if (upstreamSignal.aborted) {
      controller.abort();
    } else {
      upstreamSignal.addEventListener("abort", onUpstreamAbort, { once: true });
    }
  }
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
    if (upstreamSignal) {
      upstreamSignal.removeEventListener("abort", onUpstreamAbort);
    }
  }
}

// Save a canvas document
export async function saveCanvasDocument(doc: CanvasDocument, tags?: string[]): Promise<void> {
  const storedDoc: StoredCanvasDocument = {
    ...doc,
    savedAt: new Date(),
    tags,
  };

  try {
    // Save document (backend will generate embedding + auto-tags)
    const response = await fetchCanvasApi("/api/canvas/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ doc: storedDoc }),
    });

    if (response.ok) {
      const result = await response.json();
      console.log("[Canvas] Saved document with tags:", result.tags);
    }
  } catch (err) {
    console.error("[Canvas] Failed to save document:", err);
  }
}

// Load all documents
export async function loadCanvasIndex(limit = 500): Promise<CanvasIndex["documents"]> {
  const cappedLimit = Math.max(1, Math.min(1000, Math.trunc(limit) || 500));
  const endpoint = `/api/canvas/documents?limit=${cappedLimit}`;
  const timeoutMs = cappedLimit <= 150 ? 2500 : cappedLimit <= 500 ? 4500 : 9000;
  try {
    const response = await fetchCanvasApi(endpoint, { cache: "no-store" }, timeoutMs);
    if (response.ok) {
      const data = await response.json();
      const rows = Array.isArray(data?.documents) ? data.documents : [];
      writeCanvasIndexCache(rows);
      return rows;
    }
  } catch (err) {
    // Abort during navigation/unmount should not blank the browser list.
    if (isAbortLikeError(err)) {
      try {
        const retry = await fetchCanvasApi(endpoint, { cache: "no-store" }, 8000);
        if (retry.ok) {
          const data = await retry.json();
          const rows = Array.isArray(data?.documents) ? data.documents : [];
          writeCanvasIndexCache(rows);
          return rows;
        }
      } catch {}
    }
    console.error("[Canvas] Failed to load documents:", err);
  }
  return [];
}

// Load a specific document by ID
export async function loadCanvasDocument(id: string): Promise<StoredCanvasDocument | null> {
  try {
    const response = await fetchCanvasApi(`/api/canvas/document/${id}`, {}, 12000);
    if (response.ok) {
      return await response.json();
    }
  } catch (err) {
    console.error("[Canvas] Failed to load document:", err);
  }
  return null;
}

// Delete a document
export async function deleteCanvasDocument(id: string, hard = false): Promise<boolean> {
  try {
    const response = await fetchCanvasApi(
      `/api/canvas/document/${id}${hard ? "?hard=true" : ""}`,
      {
        method: "DELETE",
      },
      12000,
    );
    return response.ok;
  } catch (err) {
    console.error("[Canvas] Failed to delete document:", err);
    return false;
  }
}

// Search documents (server-side with embeddings)
export async function searchDocuments(
  query: string,
  mode: "keyword" | "semantic" | "hybrid" = "hybrid",
): Promise<any[]> {
  try {
    const response = await fetchCanvasApi(
      "/api/canvas/search",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, mode, limit: 20 }),
      },
      12000,
    );

    if (response.ok) {
      const data = await response.json();
      return data.results.map((doc: any) => ({
        id: doc.id,
        title: doc.title,
        type: doc.type,
        savedAt: new Date(doc.created_at).toISOString(),
        tags: doc.tags,
        score: doc.score || doc.similarity,
      }));
    }
  } catch (err) {
    console.error("[Canvas] Search failed:", err);
  }
  return [];
}

// Simple client-side filter (fallback)
export function filterDocuments(
  docs: CanvasIndex["documents"],
  query: string,
): CanvasIndex["documents"] {
  const q = query.toLowerCase();
  return docs.filter(
    (doc) =>
      doc.title.toLowerCase().includes(q) || doc.tags?.some((tag) => tag.toLowerCase().includes(q)),
  );
}

// Group documents by date
export function groupByDate(
  docs: CanvasIndex["documents"],
): Record<string, CanvasIndex["documents"]> {
  const groups: Record<string, CanvasIndex["documents"]> = {};

  docs.forEach((doc) => {
    const date = doc.savedAt.split("T")[0];
    if (!groups[date]) {
      groups[date] = [];
    }
    groups[date].push(doc);
  });

  return groups;
}
