import { getMemoryAdapter } from "../data/storage-factory.js";

export type CommitmentMemoryStatus = "repaired_same_turn" | "blocked_unfulfilled";

function shorten(text: string, max = 160): string {
  const trimmed = text.trim();
  if (!trimmed) {
    return "unspecified commitment";
  }
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max)}...`;
}

function buildSummary(status: CommitmentMemoryStatus, claimText: string): string {
  const shortClaim = shorten(claimText);
  if (status === "repaired_same_turn") {
    return `Commitment repaired in same turn: ${shortClaim}`;
  }
  return `Blocked unfulfilled same-turn commitment: ${shortClaim}`;
}

export async function persistCommitmentMemory(params: {
  status: CommitmentMemoryStatus;
  claimText: string;
  evidenceKinds: string[];
  evidenceTools?: string[];
  artifactPaths?: string[];
  repairCount: number;
  evidenceLatencyMs?: number;
  blockedReason?: string;
  sessionKey?: string;
  runId?: string;
}): Promise<void> {
  const memory = await getMemoryAdapter();
  await memory.createItem({
    memoryType: "self",
    summary: buildSummary(params.status, params.claimText),
    significance: params.status === "repaired_same_turn" ? "noteworthy" : "important",
    happenedAt: new Date().toISOString(),
    extra: {
      source: "commitment-enforcement",
      subsystem: "tool-claim-validation",
      turnScope: "same_turn",
      commitmentStatus: params.status,
      claimText: shorten(params.claimText, 400),
      evidenceKinds: params.evidenceKinds,
      ...(params.evidenceTools?.length ? { evidenceTools: params.evidenceTools } : {}),
      ...(params.artifactPaths?.length ? { artifactPaths: params.artifactPaths } : {}),
      repairCount: params.repairCount,
      ...(typeof params.evidenceLatencyMs === "number"
        ? { evidenceLatencyMs: Math.max(0, Math.floor(params.evidenceLatencyMs)) }
        : {}),
      ...(params.blockedReason ? { blockedReason: params.blockedReason } : {}),
      ...(params.sessionKey ? { sessionKey: params.sessionKey } : {}),
      ...(params.runId ? { runId: params.runId } : {}),
    },
  });
}
