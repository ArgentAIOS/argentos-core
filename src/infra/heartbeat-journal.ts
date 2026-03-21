import { mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";

export interface JournalEntry {
  cycleNumber: number;
  occurredAt: string; // ISO timestamp
  durationMs: number;
  score: {
    before: number;
    after: number;
    delta: number;
    target: number;
    targetReached: boolean;
  };
  verification: {
    model: string;
    verified: number;
    failed: number;
    unclear: number;
  };
  failures?: Array<{ taskId: string; reason: string }>;
  reflection?: string;
  lesson?: string;
}

export function appendJournalEntry(workspaceDir: string, entry: JournalEntry): void {
  const date = entry.occurredAt.slice(0, 10); // YYYY-MM-DD
  const dir = join(workspaceDir, "memory", "journal");
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, `${date}.jsonl`);
  appendFileSync(filePath, JSON.stringify(entry) + "\n");
}
