import type { Task } from "../data/types.js";
import type { MemoryItem } from "../memory/memu-types.js";
import type {
  CronArtifactContract,
  CronDocPanelArtifactRequirement,
  CronJob,
  CronTaskArtifactRequirement,
} from "./types.js";
import { normalizeKnowledgeCollection } from "../data/knowledge-acl.js";
import { getPgMemoryAdapter, getStorageAdapter } from "../data/storage-factory.js";

const DEFAULT_TASK_SCAN_LIMIT = 500;
const DEFAULT_DOC_SCAN_LIMIT = 500;
const DEFAULT_WATCHDOG_AFTER_MS = 5 * 60_000;

function normalizeOptionalString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function stripCitation(summary: string): string {
  return summary.replace(/^\s*\[\[citation:[^\]]+\]\]\s*/i, "").trim();
}

function stringContains(haystack: string, needle: string): boolean {
  if (!needle) return true;
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

function normalizeStringList(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeOptionalString(entry)).filter(Boolean);
  }
  const single = normalizeOptionalString(value);
  return single ? [single] : [];
}

function getDocTitle(item: MemoryItem): string {
  const extra = item.extra ?? {};
  return normalizeOptionalString(extra.docTitle) || stripCitation(item.summary);
}

function getDocCollection(item: MemoryItem): string {
  const extra = item.extra ?? {};
  return normalizeKnowledgeCollection(normalizeOptionalString(extra.collection), "");
}

function matchesDocPanelRequirement(
  item: MemoryItem,
  requirement: CronDocPanelArtifactRequirement,
): boolean {
  const extra = item.extra ?? {};
  const documentId = normalizeOptionalString(extra.docId) || item.id;
  const title = getDocTitle(item);
  const sourceFile = normalizeOptionalString(extra.sourceFile);
  const collection = getDocCollection(item);

  if (requirement.documentId && documentId !== requirement.documentId.trim()) {
    return false;
  }
  if (requirement.titleIncludes && !stringContains(title, requirement.titleIncludes.trim())) {
    return false;
  }
  if (
    requirement.sourceFileIncludes &&
    !stringContains(sourceFile, requirement.sourceFileIncludes.trim())
  ) {
    return false;
  }
  const collections = normalizeStringList(requirement.collection).map((entry) =>
    normalizeKnowledgeCollection(entry, "").toLowerCase(),
  );
  if (collections.length > 0 && !collections.includes(collection.toLowerCase())) {
    return false;
  }
  return true;
}

function matchesTaskRequirement(task: Task, requirement: CronTaskArtifactRequirement): boolean {
  if (requirement.taskId && task.id !== requirement.taskId.trim()) {
    return false;
  }
  if (
    requirement.titleIncludes &&
    !stringContains(normalizeOptionalString(task.title), requirement.titleIncludes.trim())
  ) {
    return false;
  }
  if (
    requirement.parentTaskId &&
    normalizeOptionalString(task.parentTaskId) !== requirement.parentTaskId.trim()
  ) {
    return false;
  }
  if (requirement.agentId && normalizeOptionalString(task.agentId) !== requirement.agentId.trim()) {
    return false;
  }
  const assignee = normalizeOptionalString(task.assignee);
  if (requirement.assignee && assignee !== requirement.assignee.trim()) {
    return false;
  }
  const statuses = normalizeStringList(requirement.status as string | string[]);
  if (statuses.length > 0 && !statuses.includes(task.status)) {
    return false;
  }
  const sources = normalizeStringList(requirement.source as string | string[]);
  if (sources.length > 0 && !sources.includes(task.source)) {
    return false;
  }
  const wantedTags = normalizeStringList(requirement.tags);
  if (wantedTags.length > 0) {
    const taskTags = (task.tags ?? []).map((entry) => normalizeOptionalString(entry).toLowerCase());
    const missing = wantedTags.some((entry) => !taskTags.includes(entry.toLowerCase()));
    if (missing) {
      return false;
    }
  }
  return true;
}

function describeDocPanelRequirement(requirement: CronDocPanelArtifactRequirement): string {
  const parts: string[] = [];
  if (requirement.documentId) parts.push(`documentId=${requirement.documentId.trim()}`);
  if (requirement.titleIncludes) parts.push(`title includes "${requirement.titleIncludes.trim()}"`);
  if (requirement.collection) {
    parts.push(`collection=${normalizeStringList(requirement.collection).join(",")}`);
  }
  if (requirement.sourceFileIncludes) {
    parts.push(`source file includes "${requirement.sourceFileIncludes.trim()}"`);
  }
  return parts.join(", ");
}

function describeTaskRequirement(requirement: CronTaskArtifactRequirement): string {
  const parts: string[] = [];
  if (requirement.taskId) parts.push(`taskId=${requirement.taskId.trim()}`);
  if (requirement.titleIncludes) parts.push(`title includes "${requirement.titleIncludes.trim()}"`);
  if (requirement.assignee) parts.push(`assignee=${requirement.assignee.trim()}`);
  if (requirement.agentId) parts.push(`agentId=${requirement.agentId.trim()}`);
  const statuses = normalizeStringList(requirement.status as string | string[]);
  if (statuses.length > 0) parts.push(`status=${statuses.join("/")}`);
  const sources = normalizeStringList(requirement.source as string | string[]);
  if (sources.length > 0) parts.push(`source=${sources.join("/")}`);
  const tags = normalizeStringList(requirement.tags);
  if (tags.length > 0) parts.push(`tags=${tags.join(",")}`);
  if (requirement.parentTaskId) parts.push(`parentTaskId=${requirement.parentTaskId.trim()}`);
  return parts.join(", ");
}

async function findDocPanelDraft(
  agentId: string,
  requirement: CronDocPanelArtifactRequirement,
): Promise<MemoryItem | null> {
  await getStorageAdapter();
  const pgMemory = getPgMemoryAdapter();
  if (!pgMemory) {
    throw new Error("DocPanel artifact verification requires PostgreSQL memory adapter");
  }
  const memory = pgMemory.withAgentId ? pgMemory.withAgentId(agentId) : pgMemory;
  const items = await memory.listItems({
    memoryType: "knowledge",
    limit: requirement.limit ?? DEFAULT_DOC_SCAN_LIMIT,
  });
  return items.find((item) => matchesDocPanelRequirement(item, requirement)) ?? null;
}

async function findTaskArtifact(requirement: CronTaskArtifactRequirement): Promise<Task | null> {
  const storage = await getStorageAdapter();
  if (requirement.taskId) {
    const task = await storage.tasks.get(requirement.taskId.trim());
    return task && matchesTaskRequirement(task, requirement) ? task : null;
  }
  const tasks = await storage.tasks.list({
    assignee: requirement.assignee,
    agentId: requirement.agentId,
    parentTaskId: requirement.parentTaskId,
    status: requirement.status,
    source: requirement.source,
    tags: requirement.tags,
    limit: requirement.limit ?? DEFAULT_TASK_SCAN_LIMIT,
  });
  return tasks.find((task) => matchesTaskRequirement(task, requirement)) ?? null;
}

export function hasPendingCronArtifactWatchdog(job: CronJob): boolean {
  return job.state.watchdog?.status === "pending" && typeof job.state.watchdog.dueAtMs === "number";
}

export function resolveCronArtifactWatchdogDueAtMs(job: CronJob): number | undefined {
  return hasPendingCronArtifactWatchdog(job) ? job.state.watchdog?.dueAtMs : undefined;
}

export function resolveCronArtifactWatchdogDelayMs(job: CronJob): number | null {
  if (job.payload.kind !== "agentTurn") {
    return null;
  }
  if (!job.payload.artifactContract?.watchdog?.required) {
    return null;
  }
  const raw = job.payload.artifactContract.watchdog.afterMs;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return Math.max(1000, Math.trunc(raw));
  }
  return DEFAULT_WATCHDOG_AFTER_MS;
}

export function shouldAnnounceCronArtifactWatchdogFailure(job: CronJob): boolean {
  return (
    job.payload.kind === "agentTurn" &&
    job.payload.artifactContract?.watchdog?.announceOnFailure === true
  );
}

export function resolveCronWatchdogContract(job: CronJob): CronArtifactContract | undefined {
  if (job.payload.kind !== "agentTurn") {
    return undefined;
  }
  return job.payload.artifactContract?.watchdog?.required;
}

export async function verifyCronArtifactContract(params: {
  agentId: string;
  contract: CronArtifactContract;
}): Promise<{ ok: true; summary: string } | { ok: false; error: string }> {
  const confirmations: string[] = [];
  const failures: string[] = [];

  if (params.contract.docPanelDraft) {
    const doc = await findDocPanelDraft(params.agentId, params.contract.docPanelDraft);
    if (!doc) {
      failures.push(
        `missing DocPanel draft${describeDocPanelRequirement(params.contract.docPanelDraft) ? ` (${describeDocPanelRequirement(params.contract.docPanelDraft)})` : ""}`,
      );
    } else {
      confirmations.push(`DocPanel draft "${getDocTitle(doc)}"`);
    }
  }

  if (params.contract.handoffTask) {
    const task = await findTaskArtifact(params.contract.handoffTask);
    if (!task) {
      failures.push(
        `missing handoff task${describeTaskRequirement(params.contract.handoffTask) ? ` (${describeTaskRequirement(params.contract.handoffTask)})` : ""}`,
      );
    } else {
      confirmations.push(`handoff task "${normalizeOptionalString(task.title)}"`);
    }
  }

  if (params.contract.deliveryTask) {
    const task = await findTaskArtifact(params.contract.deliveryTask);
    if (!task) {
      failures.push(
        `missing delivery task${describeTaskRequirement(params.contract.deliveryTask) ? ` (${describeTaskRequirement(params.contract.deliveryTask)})` : ""}`,
      );
    } else {
      confirmations.push(`delivery task "${normalizeOptionalString(task.title)}"`);
    }
  }

  if (failures.length > 0) {
    return { ok: false, error: failures.join("; ") };
  }

  return {
    ok: true,
    summary:
      confirmations.length > 0
        ? `verified ${confirmations.join("; ")}`
        : "artifact contract verified",
  };
}
