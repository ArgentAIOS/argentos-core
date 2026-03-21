/**
 * Doc Panel CLI command logic
 *
 * Push files to the dashboard DocPanel, list documents, and search.
 */

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { dashboardApiHeaders } from "../utils/dashboard-api.js";

const DASHBOARD_API = process.env.ARGENT_DASHBOARD_API || "http://localhost:9242";

// ---------------------------------------------------------------------------
// Type detection
// ---------------------------------------------------------------------------

const EXT_TYPE_MAP: Record<string, string> = {
  ".md": "markdown",
  ".mdx": "markdown",
  ".ts": "code",
  ".js": "code",
  ".tsx": "code",
  ".jsx": "code",
  ".py": "code",
  ".sh": "code",
  ".bash": "code",
  ".go": "code",
  ".rs": "code",
  ".rb": "code",
  ".java": "code",
  ".c": "code",
  ".cpp": "code",
  ".h": "code",
  ".json": "data",
  ".csv": "data",
  ".tsv": "data",
  ".yaml": "data",
  ".yml": "data",
  ".xml": "data",
  ".toml": "data",
  ".html": "html",
  ".htm": "html",
  ".svg": "html",
};

function detectType(ext: string): string {
  return EXT_TYPE_MAP[ext.toLowerCase()] ?? "markdown";
}

function extractTitle(content: string, filename: string): string {
  const match = content.match(/^#\s+(.+)/m);
  if (match) {
    return match[1].trim();
  }
  return path.basename(filename, path.extname(filename));
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async function apiPost(endpoint: string, body: unknown): Promise<Response> {
  return fetch(`${DASHBOARD_API}${endpoint}`, {
    method: "POST",
    headers: dashboardApiHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
}

async function apiGet(endpoint: string): Promise<Response> {
  return fetch(`${DASHBOARD_API}${endpoint}`, {
    method: "GET",
    headers: dashboardApiHeaders(),
  });
}

// ---------------------------------------------------------------------------
// Push
// ---------------------------------------------------------------------------

interface PushResult {
  id: string;
  title: string;
  tags?: string[];
}

export async function pushDocument(
  filePath: string,
  title?: string,
  tags?: string,
  type?: string,
): Promise<PushResult> {
  const resolved = path.resolve(filePath);
  const content = await fs.readFile(resolved, "utf-8");
  const ext = path.extname(resolved);

  const docType = type ?? detectType(ext);
  const docTitle = title ?? extractTitle(content, resolved);
  const docId = crypto.randomUUID();

  const doc: Record<string, unknown> = {
    id: docId,
    title: docTitle,
    content,
    type: docType,
  };

  // Infer language for code type
  if (docType === "code" && ext) {
    doc.language = ext.replace(".", "");
  }

  const res = await apiPost("/api/canvas/save", { doc });

  if (!res.ok) {
    const err = (await res.json().catch(() => ({ error: "Unknown error" }))) as {
      error?: string;
    };
    throw new Error(err.error || res.statusText);
  }

  const data = (await res.json()) as { id?: string; tags?: string[] };

  // If user passed explicit tags, update them (the API auto-generates tags on save,
  // but we log what the server returned)
  const resultTags = tags ? tags.split(",").map((t) => t.trim()) : data.tags;

  return { id: data.id || docId, title: docTitle, tags: resultTags };
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

interface DocumentEntry {
  id: string;
  title: string;
  type: string;
  createdAt: number;
  tags?: string[];
}

export async function listDocuments(json?: boolean): Promise<void> {
  const res = await apiGet("/api/canvas/documents");

  if (!res.ok) {
    const err = (await res.json().catch(() => ({ error: "Unknown error" }))) as {
      error?: string;
    };
    throw new Error(err.error || res.statusText);
  }

  const data = (await res.json()) as { documents: DocumentEntry[] };
  const docs = Array.isArray(data.documents) ? data.documents : [];

  if (json) {
    console.log(JSON.stringify(docs, null, 2));
    return;
  }

  if (docs.length === 0) {
    console.log("No documents in DocPanel.");
    return;
  }

  // Simple table output
  console.log(`\n  ${"Title".padEnd(40)} ${"Type".padEnd(10)} ${"Tags".padEnd(30)} Date`);
  console.log(`  ${"─".repeat(40)} ${"─".repeat(10)} ${"─".repeat(30)} ${"─".repeat(19)}`);

  for (const doc of docs) {
    const date = doc.createdAt ? new Date(doc.createdAt).toLocaleString() : "—";
    const tags = doc.tags?.join(", ") ?? "";
    const title = doc.title.length > 38 ? `${doc.title.slice(0, 37)}…` : doc.title;
    console.log(
      `  ${title.padEnd(40)} ${doc.type.padEnd(10)} ${tags.slice(0, 30).padEnd(30)} ${date}`,
    );
  }

  console.log(`\n  ${docs.length} document(s)\n`);
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

interface SearchResult {
  id: string;
  title: string;
  snippet: string;
  type: string;
  score: number;
  createdAt: number;
}

export async function searchDocuments(query: string, json?: boolean): Promise<void> {
  const res = await apiPost("/api/canvas/search", { query });

  if (!res.ok) {
    const err = (await res.json().catch(() => ({ error: "Unknown error" }))) as {
      error?: string;
    };
    throw new Error(err.error || res.statusText);
  }

  const data = (await res.json()) as { results: SearchResult[] };
  const results = Array.isArray(data.results) ? data.results : [];

  if (json) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  if (results.length === 0) {
    console.log(`No documents matching "${query}".`);
    return;
  }

  console.log(`\n  Found ${results.length} result(s) for "${query}":\n`);

  for (const r of results) {
    const date = r.createdAt ? new Date(r.createdAt).toLocaleString() : "—";
    const score = r.score ? `${(r.score * 100).toFixed(0)}%` : "";
    console.log(`  ${r.title}  ${score}`);
    console.log(`    ID: ${r.id}  Type: ${r.type}  Created: ${date}`);
    if (r.snippet) {
      console.log(`    ${r.snippet.slice(0, 120)}`);
    }
    console.log();
  }
}
