import { createReadStream, mkdirSync, readFileSync } from "node:fs";
import fsAsync from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import { resolveStateDir } from "../config/paths.js";

export type SessionSnapshot = {
  sessionId: string;
  sessionKey?: string;
  timestamp: string;
  summary: string;
  tokensBefore?: number;
  tokensAfter?: number;
  /** True when snapshot was built from raw transcript extraction (no LLM). */
  emergency?: boolean;
};

/**
 * Save a compaction summary snapshot to disk.
 * Written atomically (tmp + rename) so readers never see a partial file.
 * Failure is non-fatal — callers should wrap in try-catch.
 */
export async function saveSessionSnapshot(params: {
  sessionId: string;
  sessionKey?: string;
  summary: string;
  tokensBefore?: number;
  tokensAfter?: number;
  agentId: string;
}): Promise<void> {
  const stateDir = resolveStateDir();
  const agentDir = path.join(stateDir, "agents", params.agentId);
  mkdirSync(agentDir, { recursive: true });

  const snapshotPath = path.join(agentDir, "session-snapshot.json");
  const tmpPath = `${snapshotPath}.tmp`;

  const snapshot: SessionSnapshot = {
    sessionId: params.sessionId,
    sessionKey: params.sessionKey,
    timestamp: new Date().toISOString(),
    summary: params.summary,
    tokensBefore: params.tokensBefore,
    tokensAfter: params.tokensAfter,
  };

  await fsAsync.writeFile(tmpPath, JSON.stringify(snapshot, null, 2), "utf-8");
  await fsAsync.rename(tmpPath, snapshotPath);
}

/**
 * Load a session snapshot from disk.
 * Returns null if no snapshot exists or the file is corrupted.
 */
export function loadSessionSnapshot(agentId: string): SessionSnapshot | null {
  try {
    const stateDir = resolveStateDir();
    const snapshotPath = path.join(stateDir, "agents", agentId, "session-snapshot.json");
    const raw = readFileSync(snapshotPath, "utf-8");
    const parsed = JSON.parse(raw) as SessionSnapshot;
    if (!parsed.summary || typeof parsed.summary !== "string") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Emergency snapshot — extract last N messages from JSONL transcript.
// No LLM needed. Used when compaction fails and session is about to reset.
// ---------------------------------------------------------------------------

type TranscriptMessage = {
  role: "user" | "assistant";
  text: string;
};

/** Maximum messages to keep in an emergency snapshot. */
const EMERGENCY_MAX_MESSAGES = 30;
/** Skip system nudge messages shorter than this. */
const MIN_USER_MESSAGE_LENGTH = 12;
/** Max characters per individual message in the snapshot. */
const MAX_MSG_CHARS = 1500;

/**
 * Read a JSONL transcript and extract the last N real user/assistant messages.
 * "Real" = skips very short system nudges, heartbeat pings, and empty content.
 * Streams the file line-by-line so it works even on multi-MB transcripts.
 */
async function extractMessagesFromTranscript(transcriptPath: string): Promise<TranscriptMessage[]> {
  const messages: TranscriptMessage[] = [];

  const rl = createInterface({
    input: createReadStream(transcriptPath, { encoding: "utf-8" }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      // Standard Pi transcript format: { type: "message", message: { role, content } }
      const msg = entry?.message ?? entry;
      const role = msg?.role;
      if (role !== "user" && role !== "assistant") continue;

      // Extract text from content array or string
      let text = "";
      const content = msg.content;
      if (typeof content === "string") {
        text = content;
      } else if (Array.isArray(content)) {
        text = content
          .filter((b: { type?: string }) => b.type === "text")
          .map((b: { text?: string }) => b.text ?? "")
          .join("\n");
      }
      if (!text.trim()) continue;

      // Skip system nudges / heartbeat pings for user messages
      if (role === "user" && text.length < MIN_USER_MESSAGE_LENGTH) continue;
      // Skip nudges that look like system injections (timestamps-only, etc.)
      if (role === "user" && /^\[.*\]\s*$/.test(text.trim())) continue;

      messages.push({ role, text: text.slice(0, MAX_MSG_CHARS) });
    } catch {
      // Malformed line — skip
    }
  }

  // Keep only the last N messages
  return messages.slice(-EMERGENCY_MAX_MESSAGES);
}

/**
 * Format extracted messages into a human-readable summary string.
 */
function formatEmergencySnapshot(messages: TranscriptMessage[]): string {
  if (messages.length === 0) {
    return "(Emergency snapshot: no recoverable messages found in transcript.)";
  }

  const lines = [
    `# Emergency Context Recovery (${messages.length} messages)`,
    "",
    "This snapshot was extracted from the raw session transcript after",
    "compaction failed. It contains the last conversation messages to",
    "help recover context.",
    "",
    "---",
    "",
  ];

  for (const msg of messages) {
    const label = msg.role === "user" ? "USER" : "ASSISTANT";
    const trimmed = msg.text.trim();
    lines.push(`**${label}:** ${trimmed}`);
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Save an emergency snapshot from a raw JSONL transcript file.
 * Called when compaction has failed and the session is about to reset.
 * No LLM call needed — just reads the transcript and extracts messages.
 *
 * Returns true if a snapshot was saved, false if nothing was recoverable.
 */
export async function saveEmergencySnapshot(params: {
  transcriptPath: string;
  sessionId: string;
  sessionKey?: string;
  agentId: string;
}): Promise<boolean> {
  try {
    // Check that the transcript file exists and has content
    const stat = await fsAsync.stat(params.transcriptPath);
    if (stat.size < 100) return false; // too small to be useful

    const messages = await extractMessagesFromTranscript(params.transcriptPath);
    if (messages.length === 0) return false;

    const summary = formatEmergencySnapshot(messages);

    const stateDir = resolveStateDir();
    const agentDir = path.join(stateDir, "agents", params.agentId);
    mkdirSync(agentDir, { recursive: true });

    const snapshotPath = path.join(agentDir, "session-snapshot.json");
    const tmpPath = `${snapshotPath}.tmp`;

    const snapshot: SessionSnapshot = {
      sessionId: params.sessionId,
      sessionKey: params.sessionKey,
      timestamp: new Date().toISOString(),
      summary,
      emergency: true,
    };

    await fsAsync.writeFile(tmpPath, JSON.stringify(snapshot, null, 2), "utf-8");
    await fsAsync.rename(tmpPath, snapshotPath);
    return true;
  } catch {
    // Emergency snapshot is best-effort — never crash the reset path.
    return false;
  }
}
