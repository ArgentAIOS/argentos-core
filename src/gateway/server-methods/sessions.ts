import { randomUUID } from "node:crypto";
import fs from "node:fs";
import type { GatewayRequestHandlers } from "./types.js";
import { resolveDefaultAgentId } from "../../agents/agent-scope.js";
import { abortEmbeddedPiRun, waitForEmbeddedPiRunEnd } from "../../agents/pi-embedded.js";
import { stopSubagentsForRequester } from "../../auto-reply/reply/abort.js";
import { clearSessionQueues } from "../../auto-reply/reply/queue.js";
import { loadConfig } from "../../config/config.js";
import {
  loadSessionStore,
  snapshotSessionOrigin,
  resolveMainSessionKey,
  type SessionEntry,
  updateSessionStore,
} from "../../config/sessions.js";
import { normalizeAgentId, parseAgentSessionKey } from "../../routing/session-key.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateSessionsCompactParams,
  validateSessionsDeleteParams,
  validateSessionsListParams,
  validateSessionsPatchParams,
  validateSessionsPreviewParams,
  validateSessionsResetParams,
  validateSessionsResolveParams,
  validateSessionsSearchParams,
} from "../protocol/index.js";
import {
  archiveFileOnDisk,
  listSessionsFromStore,
  loadCombinedSessionStoreForGateway,
  loadSessionEntry,
  readSessionMessages,
  readSessionPreviewItemsFromTranscript,
  resolveGatewaySessionStoreTarget,
  resolveSessionModelRef,
  resolveSessionTranscriptCandidates,
  type SessionsPatchResult,
  type SessionsPreviewEntry,
  type SessionsPreviewResult,
} from "../session-utils.js";
import { applySessionsPatchToStore } from "../sessions-patch.js";
import { resolveSessionKeyFromResolveParams } from "../sessions-resolve.js";

export const sessionsHandlers: GatewayRequestHandlers = {
  "sessions.list": ({ params, respond }) => {
    if (!validateSessionsListParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid sessions.list params: ${formatValidationErrors(validateSessionsListParams.errors)}`,
        ),
      );
      return;
    }
    const p = params;
    const cfg = loadConfig();
    const { storePath, store } = loadCombinedSessionStoreForGateway(cfg);
    const result = listSessionsFromStore({
      cfg,
      storePath,
      store,
      opts: p,
    });
    respond(true, result, undefined);
  },
  "sessions.preview": ({ params, respond }) => {
    if (!validateSessionsPreviewParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid sessions.preview params: ${formatValidationErrors(
            validateSessionsPreviewParams.errors,
          )}`,
        ),
      );
      return;
    }
    const p = params;
    const keysRaw = Array.isArray(p.keys) ? p.keys : [];
    const keys = keysRaw
      .map((key) => String(key ?? "").trim())
      .filter(Boolean)
      .slice(0, 64);
    const limit =
      typeof p.limit === "number" && Number.isFinite(p.limit) ? Math.max(1, p.limit) : 12;
    const maxChars =
      typeof p.maxChars === "number" && Number.isFinite(p.maxChars)
        ? Math.max(20, p.maxChars)
        : 240;

    if (keys.length === 0) {
      respond(true, { ts: Date.now(), previews: [] } satisfies SessionsPreviewResult, undefined);
      return;
    }

    const cfg = loadConfig();
    const storeCache = new Map<string, Record<string, SessionEntry>>();
    const previews: SessionsPreviewEntry[] = [];

    for (const key of keys) {
      try {
        const target = resolveGatewaySessionStoreTarget({ cfg, key });
        const store = storeCache.get(target.storePath) ?? loadSessionStore(target.storePath);
        storeCache.set(target.storePath, store);
        const entry =
          target.storeKeys.map((candidate) => store[candidate]).find(Boolean) ??
          store[target.canonicalKey];
        if (!entry?.sessionId) {
          previews.push({ key, status: "missing", items: [] });
          continue;
        }
        const items = readSessionPreviewItemsFromTranscript(
          entry.sessionId,
          target.storePath,
          entry.sessionFile,
          target.agentId,
          limit,
          maxChars,
        );
        previews.push({
          key,
          status: items.length > 0 ? "ok" : "empty",
          items,
        });
      } catch {
        previews.push({ key, status: "error", items: [] });
      }
    }

    respond(true, { ts: Date.now(), previews } satisfies SessionsPreviewResult, undefined);
  },
  "sessions.resolve": ({ params, respond }) => {
    if (!validateSessionsResolveParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid sessions.resolve params: ${formatValidationErrors(validateSessionsResolveParams.errors)}`,
        ),
      );
      return;
    }
    const p = params;
    const cfg = loadConfig();

    const resolved = resolveSessionKeyFromResolveParams({ cfg, p });
    if (!resolved.ok) {
      respond(false, undefined, resolved.error);
      return;
    }
    respond(true, { ok: true, key: resolved.key }, undefined);
  },
  "sessions.patch": async ({ params, respond, context }) => {
    if (!validateSessionsPatchParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid sessions.patch params: ${formatValidationErrors(validateSessionsPatchParams.errors)}`,
        ),
      );
      return;
    }
    const p = params;
    const key = String(p.key ?? "").trim();
    if (!key) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "key required"));
      return;
    }

    const cfg = loadConfig();
    const target = resolveGatewaySessionStoreTarget({ cfg, key });
    const storePath = target.storePath;
    const applied = await updateSessionStore(storePath, async (store) => {
      const primaryKey = target.storeKeys[0] ?? key;
      const existingKey = target.storeKeys.find((candidate) => store[candidate]);
      if (existingKey && existingKey !== primaryKey && !store[primaryKey]) {
        store[primaryKey] = store[existingKey];
        delete store[existingKey];
      }
      return await applySessionsPatchToStore({
        cfg,
        store,
        storeKey: primaryKey,
        patch: p,
        loadGatewayModelCatalog: context.loadGatewayModelCatalog,
      });
    });
    if (!applied.ok) {
      respond(false, undefined, applied.error);
      return;
    }
    const parsed = parseAgentSessionKey(target.canonicalKey ?? key);
    const agentId = normalizeAgentId(parsed?.agentId ?? resolveDefaultAgentId(cfg));
    const resolved = resolveSessionModelRef(cfg, applied.entry, agentId);
    const result: SessionsPatchResult = {
      ok: true,
      path: storePath,
      key: target.canonicalKey,
      entry: applied.entry,
      resolved: {
        modelProvider: resolved.provider,
        model: resolved.model,
      },
    };
    respond(true, result, undefined);
  },
  "sessions.reset": async ({ params, respond }) => {
    if (!validateSessionsResetParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid sessions.reset params: ${formatValidationErrors(validateSessionsResetParams.errors)}`,
        ),
      );
      return;
    }
    const p = params;
    const key = String(p.key ?? "").trim();
    if (!key) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "key required"));
      return;
    }

    const cfg = loadConfig();
    const target = resolveGatewaySessionStoreTarget({ cfg, key });
    const storePath = target.storePath;
    const next = await updateSessionStore(storePath, (store) => {
      const primaryKey = target.storeKeys[0] ?? key;
      const existingKey = target.storeKeys.find((candidate) => store[candidate]);
      if (existingKey && existingKey !== primaryKey && !store[primaryKey]) {
        store[primaryKey] = store[existingKey];
        delete store[existingKey];
      }
      const entry = store[primaryKey];
      const now = Date.now();
      const nextEntry: SessionEntry = {
        sessionId: randomUUID(),
        updatedAt: now,
        systemSent: false,
        abortedLastRun: false,
        thinkingLevel: entry?.thinkingLevel,
        verboseLevel: entry?.verboseLevel,
        reasoningLevel: entry?.reasoningLevel,
        responseUsage: entry?.responseUsage,
        model: entry?.model,
        contextTokens: entry?.contextTokens,
        sendPolicy: entry?.sendPolicy,
        label: entry?.label,
        origin: snapshotSessionOrigin(entry),
        lastChannel: entry?.lastChannel,
        lastTo: entry?.lastTo,
        skillsSnapshot: entry?.skillsSnapshot,
        // Reset token counts to 0 on session reset (#1523)
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
      };
      store[primaryKey] = nextEntry;
      const globalEntry = store["__lastUserMessage"] as SessionEntry | undefined;
      store["__lastUserMessage"] = {
        ...(globalEntry || {}),
        sessionId: globalEntry?.sessionId ?? "__lastUserMessage",
        updatedAt: now,
        sessionClearedAt: now,
        sessionClearedFromKey: primaryKey,
        sessionClearedReason: "sessions.reset",
      };
      return nextEntry;
    });
    respond(true, { ok: true, key: target.canonicalKey, entry: next }, undefined);
  },
  "sessions.delete": async ({ params, respond }) => {
    if (!validateSessionsDeleteParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid sessions.delete params: ${formatValidationErrors(validateSessionsDeleteParams.errors)}`,
        ),
      );
      return;
    }
    const p = params;
    const key = String(p.key ?? "").trim();
    if (!key) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "key required"));
      return;
    }

    const cfg = loadConfig();
    const mainKey = resolveMainSessionKey(cfg);
    const target = resolveGatewaySessionStoreTarget({ cfg, key });
    if (target.canonicalKey === mainKey) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `Cannot delete the main session (${mainKey}).`),
      );
      return;
    }

    const deleteTranscript = typeof p.deleteTranscript === "boolean" ? p.deleteTranscript : true;

    const storePath = target.storePath;
    const { entry } = loadSessionEntry(key);
    const sessionId = entry?.sessionId;
    const existed = Boolean(entry);
    const queueKeys = new Set<string>(target.storeKeys);
    queueKeys.add(target.canonicalKey);
    if (sessionId) {
      queueKeys.add(sessionId);
    }
    clearSessionQueues([...queueKeys]);
    stopSubagentsForRequester({ cfg, requesterSessionKey: target.canonicalKey });
    if (sessionId) {
      abortEmbeddedPiRun(sessionId);
      const ended = await waitForEmbeddedPiRunEnd(sessionId, 15_000);
      if (!ended) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.UNAVAILABLE,
            `Session ${key} is still active; try again in a moment.`,
          ),
        );
        return;
      }
    }
    await updateSessionStore(storePath, (store) => {
      const primaryKey = target.storeKeys[0] ?? key;
      const existingKey = target.storeKeys.find((candidate) => store[candidate]);
      if (existingKey && existingKey !== primaryKey && !store[primaryKey]) {
        store[primaryKey] = store[existingKey];
        delete store[existingKey];
      }
      if (store[primaryKey]) {
        delete store[primaryKey];
      }
    });

    const archived: string[] = [];
    if (deleteTranscript && sessionId) {
      for (const candidate of resolveSessionTranscriptCandidates(
        sessionId,
        storePath,
        entry?.sessionFile,
        target.agentId,
      )) {
        if (!fs.existsSync(candidate)) {
          continue;
        }
        try {
          archived.push(archiveFileOnDisk(candidate, "deleted"));
        } catch {
          // Best-effort.
        }
      }
    }

    respond(true, { ok: true, key: target.canonicalKey, deleted: existed, archived }, undefined);
  },
  "sessions.compact": async ({ params, respond }) => {
    if (!validateSessionsCompactParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid sessions.compact params: ${formatValidationErrors(validateSessionsCompactParams.errors)}`,
        ),
      );
      return;
    }
    const p = params;
    const key = String(p.key ?? "").trim();
    if (!key) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "key required"));
      return;
    }

    const maxLines =
      typeof p.maxLines === "number" && Number.isFinite(p.maxLines)
        ? Math.max(1, Math.floor(p.maxLines))
        : 400;

    const cfg = loadConfig();
    const target = resolveGatewaySessionStoreTarget({ cfg, key });
    const storePath = target.storePath;
    // Lock + read in a short critical section; transcript work happens outside.
    const compactTarget = await updateSessionStore(storePath, (store) => {
      const primaryKey = target.storeKeys[0] ?? key;
      const existingKey = target.storeKeys.find((candidate) => store[candidate]);
      if (existingKey && existingKey !== primaryKey && !store[primaryKey]) {
        store[primaryKey] = store[existingKey];
        delete store[existingKey];
      }
      return { entry: store[primaryKey], primaryKey };
    });
    const entry = compactTarget.entry;
    const sessionId = entry?.sessionId;
    if (!sessionId) {
      respond(
        true,
        {
          ok: true,
          key: target.canonicalKey,
          compacted: false,
          reason: "no sessionId",
        },
        undefined,
      );
      return;
    }

    const filePath = resolveSessionTranscriptCandidates(
      sessionId,
      storePath,
      entry?.sessionFile,
      target.agentId,
    ).find((candidate) => fs.existsSync(candidate));
    if (!filePath) {
      respond(
        true,
        {
          ok: true,
          key: target.canonicalKey,
          compacted: false,
          reason: "no transcript",
        },
        undefined,
      );
      return;
    }

    const raw = fs.readFileSync(filePath, "utf-8");
    const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length <= maxLines) {
      respond(
        true,
        {
          ok: true,
          key: target.canonicalKey,
          compacted: false,
          kept: lines.length,
        },
        undefined,
      );
      return;
    }

    const archived = archiveFileOnDisk(filePath, "bak");
    const keptLines = lines.slice(-maxLines);
    fs.writeFileSync(filePath, `${keptLines.join("\n")}\n`, "utf-8");

    await updateSessionStore(storePath, (store) => {
      const entryKey = compactTarget.primaryKey;
      const entryToUpdate = store[entryKey];
      if (!entryToUpdate) {
        return;
      }
      delete entryToUpdate.inputTokens;
      delete entryToUpdate.outputTokens;
      delete entryToUpdate.totalTokens;
      entryToUpdate.updatedAt = Date.now();
    });

    respond(
      true,
      {
        ok: true,
        key: target.canonicalKey,
        compacted: true,
        archived,
        kept: keptLines.length,
      },
      undefined,
    );
  },
  "sessions.search": ({ params, respond }) => {
    if (!validateSessionsSearchParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid sessions.search params: ${formatValidationErrors(validateSessionsSearchParams.errors)}`,
        ),
      );
      return;
    }
    const p = params;
    const query = String(p.query ?? "")
      .trim()
      .toLowerCase();
    if (!query) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "query required"));
      return;
    }
    const limit =
      typeof p.limit === "number" && Number.isFinite(p.limit)
        ? Math.max(1, Math.floor(p.limit))
        : 30;
    const snippetChars =
      typeof p.snippetChars === "number" && Number.isFinite(p.snippetChars)
        ? Math.max(20, Math.floor(p.snippetChars))
        : 200;

    const cfg = loadConfig();
    const { storePath, store } = loadCombinedSessionStoreForGateway(cfg);

    type SearchHit = {
      sessionKey: string;
      role: string;
      text: string;
      snippet: string;
      timestamp: number;
      sessionUpdatedAt: number;
    };
    const hits: SearchHit[] = [];

    for (const [key, entry] of Object.entries(store)) {
      if (!entry?.sessionId) continue;
      if (hits.length >= limit) break;

      let messages: unknown[];
      try {
        const parsed = parseAgentSessionKey(key);
        const agentId = parsed ? normalizeAgentId(parsed.agentId) : undefined;
        messages = readSessionMessages(entry.sessionId, storePath, entry.sessionFile, agentId);
      } catch {
        continue;
      }

      for (const msg of messages) {
        if (hits.length >= limit) break;
        const m = msg as { role?: string; content?: unknown; timestamp?: number };
        if (!m.role || m.role === "tool" || m.role === "system") continue;

        const text = extractMessageText(m.content);
        if (!text) continue;

        const idx = text.toLowerCase().indexOf(query);
        if (idx === -1) continue;

        const start = Math.max(0, idx - 60);
        const end = Math.min(text.length, idx + query.length + 100);
        let snippet = text.slice(start, end);
        if (start > 0) snippet = "..." + snippet;
        if (end < text.length) snippet = snippet + "...";

        hits.push({
          sessionKey: key,
          role: m.role,
          text: snippet.slice(0, snippetChars),
          snippet: snippet.slice(0, snippetChars),
          timestamp: typeof m.timestamp === "number" ? m.timestamp : 0,
          sessionUpdatedAt: entry.updatedAt ?? 0,
        });
      }
    }

    // Sort by most recent session first
    hits.sort((a, b) => b.sessionUpdatedAt - a.sessionUpdatedAt || b.timestamp - a.timestamp);

    respond(true, { query: p.query, count: hits.length, hits }, undefined);
  },
};

/** Extract plain text from message content (string or content array). */
function extractMessageText(content: unknown): string | null {
  if (typeof content === "string") return content.trim() || null;
  if (!Array.isArray(content)) return null;
  const parts: string[] = [];
  for (const part of content) {
    if (!part || typeof part !== "object") continue;
    const p = part as { type?: string; text?: string };
    if ((p.type === "text" || p.type === "output_text" || p.type === "input_text") && p.text) {
      parts.push(p.text);
    }
  }
  return parts.join("\n").trim() || null;
}
