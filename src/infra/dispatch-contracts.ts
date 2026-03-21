import postgres from "postgres";
import { resolvePostgresUrl, resolveRuntimeStorageConfig } from "../data/storage-resolver.js";
import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("infra/dispatch-contracts");

export type DispatchContractStatus =
  | "contract_created"
  | "accepted"
  | "started"
  | "heartbeat"
  | "completed"
  | "failed"
  | "cancelled";

export interface DispatchContractRecord {
  contractId: string;
  taskId?: string;
  task: string;
  targetAgentId: string;
  dispatchedBy: string;
  toolGrantSnapshot: string[];
  timeoutMs: number;
  heartbeatIntervalMs: number;
  status: DispatchContractStatus;
  createdAt: Date;
  updatedAt: Date;
  expiresAt?: Date;
  acceptedAt?: Date;
  startedAt?: Date;
  lastHeartbeatAt?: Date;
  completedAt?: Date;
  failedAt?: Date;
  cancelledAt?: Date;
  failureReason?: string;
  resultSummary?: string;
  metadata: Record<string, unknown>;
}

export interface DispatchContractEvent {
  id: number;
  contractId: string;
  status: DispatchContractStatus;
  eventAt: Date;
  payload: Record<string, unknown>;
}

export interface CreateDispatchContractInput {
  contractId?: string;
  taskId?: string;
  task: string;
  targetAgentId: string;
  dispatchedBy: string;
  toolGrantSnapshot: string[];
  timeoutMs: number;
  heartbeatIntervalMs: number;
  createdAt?: Date;
  expiresAt?: Date;
  metadata?: Record<string, unknown>;
}

export interface AppendDispatchContractEventInput {
  contractId: string;
  status: Exclude<DispatchContractStatus, "contract_created">;
  eventAt?: Date;
  payload?: Record<string, unknown>;
  failureReason?: string;
  resultSummary?: string;
}

type DispatchContractRow = {
  contract_id: string;
  task_id: string | null;
  task: string;
  target_agent_id: string;
  dispatched_by: string;
  tool_grant_snapshot: unknown;
  timeout_ms: number;
  heartbeat_interval_ms: number;
  status: DispatchContractStatus;
  created_at: Date | string;
  updated_at: Date | string;
  expires_at: Date | string | null;
  accepted_at: Date | string | null;
  started_at: Date | string | null;
  last_heartbeat_at: Date | string | null;
  completed_at: Date | string | null;
  failed_at: Date | string | null;
  cancelled_at: Date | string | null;
  failure_reason: string | null;
  result_summary: string | null;
  metadata: unknown;
};

type DispatchContractEventRow = {
  id: number;
  contract_id: string;
  status: DispatchContractStatus;
  event_at: Date | string;
  payload: unknown;
};

let _sql: ReturnType<typeof postgres> | null = null;
let _initPromise: Promise<ReturnType<typeof postgres> | null> | null = null;

const testContracts = new Map<string, DispatchContractRecord>();
const testEvents = new Map<string, DispatchContractEvent[]>();
let testEventId = 1;
const activeContractMonitors = new Map<
  string,
  { timeoutHandle: NodeJS.Timeout; heartbeatHandle: NodeJS.Timeout }
>();
const monitorFailing = new Set<string>();

function isTestEnv(): boolean {
  return process.env.NODE_ENV === "test" || Boolean(process.env.VITEST);
}

function isPgBacked(): boolean {
  const cfg = resolveRuntimeStorageConfig(process.env);
  return cfg.backend === "postgres" || cfg.backend === "dual";
}

function asDate(value: Date | string | null | undefined): Date | undefined {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function mapContractRow(row: DispatchContractRow): DispatchContractRecord {
  return {
    contractId: row.contract_id,
    taskId: row.task_id ?? undefined,
    task: row.task,
    targetAgentId: row.target_agent_id,
    dispatchedBy: row.dispatched_by,
    toolGrantSnapshot: asStringArray(row.tool_grant_snapshot),
    timeoutMs: row.timeout_ms,
    heartbeatIntervalMs: row.heartbeat_interval_ms,
    status: row.status,
    createdAt: asDate(row.created_at) ?? new Date(),
    updatedAt: asDate(row.updated_at) ?? new Date(),
    expiresAt: asDate(row.expires_at),
    acceptedAt: asDate(row.accepted_at),
    startedAt: asDate(row.started_at),
    lastHeartbeatAt: asDate(row.last_heartbeat_at),
    completedAt: asDate(row.completed_at),
    failedAt: asDate(row.failed_at),
    cancelledAt: asDate(row.cancelled_at),
    failureReason: row.failure_reason ?? undefined,
    resultSummary: row.result_summary ?? undefined,
    metadata: asRecord(row.metadata),
  };
}

function mapEventRow(row: DispatchContractEventRow): DispatchContractEvent {
  return {
    id: row.id,
    contractId: row.contract_id,
    status: row.status,
    eventAt: asDate(row.event_at) ?? new Date(),
    payload: asRecord(row.payload),
  };
}

function normalizeToolGrantSnapshot(values: string[]): string[] {
  const unique = new Set<string>();
  for (const raw of values) {
    const tool = raw.trim();
    if (!tool) continue;
    unique.add(tool);
  }
  return Array.from(unique);
}

function applyEventToContract(
  contract: DispatchContractRecord,
  input: AppendDispatchContractEventInput,
  eventAt: Date,
) {
  contract.status = input.status;
  contract.updatedAt = eventAt;
  if (input.status === "accepted") {
    contract.acceptedAt = eventAt;
  } else if (input.status === "started") {
    contract.startedAt = eventAt;
  } else if (input.status === "heartbeat") {
    contract.lastHeartbeatAt = eventAt;
  } else if (input.status === "completed") {
    contract.completedAt = eventAt;
    if (typeof input.resultSummary === "string" && input.resultSummary.trim().length > 0) {
      contract.resultSummary = input.resultSummary.trim();
    }
  } else if (input.status === "failed") {
    contract.failedAt = eventAt;
    if (typeof input.failureReason === "string" && input.failureReason.trim().length > 0) {
      contract.failureReason = input.failureReason.trim();
    }
  } else if (input.status === "cancelled") {
    contract.cancelledAt = eventAt;
    if (typeof input.failureReason === "string" && input.failureReason.trim().length > 0) {
      contract.failureReason = input.failureReason.trim();
    }
  }
}

async function getSql(): Promise<ReturnType<typeof postgres> | null> {
  if (isTestEnv()) return null;
  if (!isPgBacked()) return null;
  if (_sql) return _sql;
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    const connectionString = resolvePostgresUrl();
    const sql = postgres(connectionString, {
      max: 2,
      idle_timeout: 10,
      connect_timeout: 5,
      prepare: false,
    });
    try {
      await sql`SELECT 1`;
      await sql`
        CREATE TABLE IF NOT EXISTS dispatch_contracts (
          contract_id TEXT PRIMARY KEY,
          task_id TEXT,
          task TEXT NOT NULL,
          target_agent_id TEXT NOT NULL,
          dispatched_by TEXT NOT NULL,
          tool_grant_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb,
          timeout_ms INTEGER NOT NULL,
          heartbeat_interval_ms INTEGER NOT NULL,
          status TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          expires_at TIMESTAMPTZ,
          accepted_at TIMESTAMPTZ,
          started_at TIMESTAMPTZ,
          last_heartbeat_at TIMESTAMPTZ,
          completed_at TIMESTAMPTZ,
          failed_at TIMESTAMPTZ,
          cancelled_at TIMESTAMPTZ,
          failure_reason TEXT,
          result_summary TEXT,
          metadata JSONB NOT NULL DEFAULT '{}'::jsonb
        )
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS dispatch_contract_events (
          id BIGSERIAL PRIMARY KEY,
          contract_id TEXT NOT NULL REFERENCES dispatch_contracts(contract_id) ON DELETE CASCADE,
          status TEXT NOT NULL,
          event_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          payload JSONB NOT NULL DEFAULT '{}'::jsonb
        )
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS idx_dispatch_contracts_status
          ON dispatch_contracts(status)
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS idx_dispatch_contracts_target_agent
          ON dispatch_contracts(target_agent_id)
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS idx_dispatch_contracts_task
          ON dispatch_contracts(task_id)
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS idx_dispatch_contract_events_contract_time
          ON dispatch_contract_events(contract_id, event_at DESC)
      `;
      _sql = sql;
      return sql;
    } catch (err) {
      log.warn(`dispatch-contracts init failed: ${String(err)}`);
      try {
        await sql.end({ timeout: 1 });
      } catch {}
      return null;
    } finally {
      _initPromise = null;
    }
  })();

  return _initPromise;
}

function requireStoreAvailable(sql: ReturnType<typeof postgres> | null) {
  if (sql || isTestEnv()) return;
  throw new Error(
    "Dispatch contracts require PostgreSQL storage (backend=postgres|dual) or test mode.",
  );
}

function isTerminalStatus(status: DispatchContractStatus): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

function clearDispatchContractMonitor(contractId: string) {
  const handles = activeContractMonitors.get(contractId);
  if (!handles) return;
  clearTimeout(handles.timeoutHandle);
  clearInterval(handles.heartbeatHandle);
  activeContractMonitors.delete(contractId);
}

async function autoFailContract(
  contractId: string,
  reason: string,
  payload?: Record<string, unknown>,
) {
  if (monitorFailing.has(contractId)) return;
  monitorFailing.add(contractId);
  try {
    const latest = await getDispatchContract(contractId);
    if (!latest || isTerminalStatus(latest.status)) {
      clearDispatchContractMonitor(contractId);
      return;
    }
    await appendDispatchContractEvent({
      contractId,
      status: "failed",
      failureReason: reason,
      payload,
    });
  } catch (err) {
    log.warn(`dispatch-contracts monitor auto-fail error: ${String(err)}`);
  } finally {
    monitorFailing.delete(contractId);
  }
}

export async function ensureDispatchContractMonitor(contractId: string): Promise<void> {
  const contract = await getDispatchContract(contractId);
  if (!contract || isTerminalStatus(contract.status)) {
    clearDispatchContractMonitor(contractId);
    return;
  }

  clearDispatchContractMonitor(contractId);
  const timeoutAt = contract.expiresAt
    ? contract.expiresAt.getTime()
    : contract.createdAt.getTime() + contract.timeoutMs;
  const timeoutDelay = Math.max(1, timeoutAt - Date.now());
  const heartbeatPollMs = Math.max(250, Math.min(contract.heartbeatIntervalMs, 5000));

  const timeoutHandle = setTimeout(() => {
    void autoFailContract(contractId, `dispatch contract timed out after ${contract.timeoutMs}ms`, {
      source: "timeout-monitor",
    });
  }, timeoutDelay);
  timeoutHandle.unref?.();

  const heartbeatHandle = setInterval(() => {
    void (async () => {
      const latest = await getDispatchContract(contractId);
      if (!latest || isTerminalStatus(latest.status)) {
        clearDispatchContractMonitor(contractId);
        return;
      }
      if (latest.status !== "heartbeat") return;
      const last = latest.lastHeartbeatAt?.getTime();
      if (!last) return;
      const elapsed = Date.now() - last;
      if (elapsed > latest.heartbeatIntervalMs * 2) {
        await autoFailContract(contractId, `dispatch contract missed heartbeat for ${elapsed}ms`, {
          source: "heartbeat-monitor",
          elapsedMs: elapsed,
        });
      }
    })();
  }, heartbeatPollMs);
  heartbeatHandle.unref?.();

  activeContractMonitors.set(contractId, { timeoutHandle, heartbeatHandle });
}

export async function recordDispatchContractHeartbeat(
  contractId: string,
  payload: Record<string, unknown> = {},
): Promise<DispatchContractRecord> {
  const updated = await appendDispatchContractEvent({
    contractId,
    status: "heartbeat",
    payload,
  });
  await ensureDispatchContractMonitor(contractId);
  return updated;
}

export async function createDispatchContract(
  input: CreateDispatchContractInput,
): Promise<DispatchContractRecord> {
  const contractId = input.contractId ?? crypto.randomUUID();
  const now = input.createdAt ?? new Date();
  const toolGrantSnapshot = normalizeToolGrantSnapshot(input.toolGrantSnapshot);
  const metadata = input.metadata ?? {};

  const sql = await getSql();
  requireStoreAvailable(sql);

  if (isTestEnv()) {
    const contract: DispatchContractRecord = {
      contractId,
      taskId: input.taskId,
      task: input.task,
      targetAgentId: input.targetAgentId,
      dispatchedBy: input.dispatchedBy,
      toolGrantSnapshot,
      timeoutMs: input.timeoutMs,
      heartbeatIntervalMs: input.heartbeatIntervalMs,
      status: "contract_created",
      createdAt: now,
      updatedAt: now,
      expiresAt: input.expiresAt,
      metadata,
    };
    testContracts.set(contractId, contract);
    const initialEvent: DispatchContractEvent = {
      id: testEventId++,
      contractId,
      status: "contract_created",
      eventAt: now,
      payload: {},
    };
    testEvents.set(contractId, [initialEvent]);
    await ensureDispatchContractMonitor(contractId);
    return { ...contract, metadata: { ...contract.metadata } };
  }

  await sql!`
    INSERT INTO dispatch_contracts (
      contract_id,
      task_id,
      task,
      target_agent_id,
      dispatched_by,
      tool_grant_snapshot,
      timeout_ms,
      heartbeat_interval_ms,
      status,
      created_at,
      updated_at,
      expires_at,
      metadata
    )
    VALUES (
      ${contractId},
      ${input.taskId ?? null},
      ${input.task},
      ${input.targetAgentId},
      ${input.dispatchedBy},
      ${JSON.stringify(toolGrantSnapshot)}::jsonb,
      ${input.timeoutMs},
      ${input.heartbeatIntervalMs},
      ${"contract_created"},
      ${now},
      ${now},
      ${input.expiresAt ?? null},
      ${JSON.stringify(metadata)}::jsonb
    )
  `;

  await sql!`
    INSERT INTO dispatch_contract_events (
      contract_id,
      status,
      event_at,
      payload
    )
    VALUES (
      ${contractId},
      ${"contract_created"},
      ${now},
      ${"{}"}::jsonb
    )
  `;

  const record = await getDispatchContract(contractId);
  if (!record) {
    throw new Error(`failed to load created contract: ${contractId}`);
  }
  await ensureDispatchContractMonitor(contractId);
  return record;
}

export async function appendDispatchContractEvent(
  input: AppendDispatchContractEventInput,
): Promise<DispatchContractRecord> {
  const eventAt = input.eventAt ?? new Date();
  const payload = input.payload ?? {};

  const sql = await getSql();
  requireStoreAvailable(sql);

  if (isTestEnv()) {
    const existing = testContracts.get(input.contractId);
    if (!existing) {
      throw new Error(`dispatch contract not found: ${input.contractId}`);
    }
    const contract: DispatchContractRecord = {
      ...existing,
      metadata: { ...existing.metadata },
      toolGrantSnapshot: [...existing.toolGrantSnapshot],
    };
    applyEventToContract(contract, input, eventAt);
    testContracts.set(contract.contractId, contract);

    const events = testEvents.get(contract.contractId) ?? [];
    events.push({
      id: testEventId++,
      contractId: contract.contractId,
      status: input.status,
      eventAt,
      payload: { ...payload },
    });
    testEvents.set(contract.contractId, events);
    if (isTerminalStatus(contract.status)) {
      clearDispatchContractMonitor(contract.contractId);
    } else if (
      contract.status === "accepted" ||
      contract.status === "started" ||
      contract.status === "heartbeat"
    ) {
      await ensureDispatchContractMonitor(contract.contractId);
    }
    return contract;
  }

  const statusUpdates = {
    accepted_at: input.status === "accepted" ? eventAt : null,
    started_at: input.status === "started" ? eventAt : null,
    last_heartbeat_at: input.status === "heartbeat" ? eventAt : null,
    completed_at: input.status === "completed" ? eventAt : null,
    failed_at: input.status === "failed" ? eventAt : null,
    cancelled_at: input.status === "cancelled" ? eventAt : null,
    failure_reason:
      input.status === "failed" || input.status === "cancelled"
        ? (input.failureReason ?? null)
        : null,
    result_summary: input.status === "completed" ? (input.resultSummary ?? null) : null,
  };

  const update = await sql!`
    UPDATE dispatch_contracts
    SET
      status = ${input.status},
      updated_at = ${eventAt},
      accepted_at = COALESCE(${statusUpdates.accepted_at}, accepted_at),
      started_at = COALESCE(${statusUpdates.started_at}, started_at),
      last_heartbeat_at = COALESCE(${statusUpdates.last_heartbeat_at}, last_heartbeat_at),
      completed_at = COALESCE(${statusUpdates.completed_at}, completed_at),
      failed_at = COALESCE(${statusUpdates.failed_at}, failed_at),
      cancelled_at = COALESCE(${statusUpdates.cancelled_at}, cancelled_at),
      failure_reason = COALESCE(${statusUpdates.failure_reason}, failure_reason),
      result_summary = COALESCE(${statusUpdates.result_summary}, result_summary)
    WHERE contract_id = ${input.contractId}
    RETURNING contract_id
  `;

  if (!update[0]?.contract_id) {
    throw new Error(`dispatch contract not found: ${input.contractId}`);
  }

  await sql!`
    INSERT INTO dispatch_contract_events (
      contract_id,
      status,
      event_at,
      payload
    )
    VALUES (
      ${input.contractId},
      ${input.status},
      ${eventAt},
      ${JSON.stringify(payload)}::jsonb
    )
  `;

  const record = await getDispatchContract(input.contractId);
  if (!record) {
    throw new Error(`failed to load contract after event append: ${input.contractId}`);
  }
  if (isTerminalStatus(record.status)) {
    clearDispatchContractMonitor(input.contractId);
  } else if (
    record.status === "accepted" ||
    record.status === "started" ||
    record.status === "heartbeat"
  ) {
    await ensureDispatchContractMonitor(input.contractId);
  }
  return record;
}

export async function getDispatchContract(
  contractId: string,
): Promise<DispatchContractRecord | null> {
  const sql = await getSql();
  requireStoreAvailable(sql);

  if (isTestEnv()) {
    const existing = testContracts.get(contractId);
    if (!existing) return null;
    return {
      ...existing,
      toolGrantSnapshot: [...existing.toolGrantSnapshot],
      metadata: { ...existing.metadata },
    };
  }

  const rows = await sql<DispatchContractRow[]>`
    SELECT
      contract_id,
      task_id,
      task,
      target_agent_id,
      dispatched_by,
      tool_grant_snapshot,
      timeout_ms,
      heartbeat_interval_ms,
      status,
      created_at,
      updated_at,
      expires_at,
      accepted_at,
      started_at,
      last_heartbeat_at,
      completed_at,
      failed_at,
      cancelled_at,
      failure_reason,
      result_summary,
      metadata
    FROM dispatch_contracts
    WHERE contract_id = ${contractId}
    LIMIT 1
  `;
  if (!rows[0]) return null;
  return mapContractRow(rows[0]);
}

export async function listDispatchContractEvents(
  contractId: string,
  limit = 200,
): Promise<DispatchContractEvent[]> {
  const sql = await getSql();
  requireStoreAvailable(sql);

  if (isTestEnv()) {
    const events = testEvents.get(contractId) ?? [];
    return events
      .slice()
      .sort((a, b) => a.eventAt.getTime() - b.eventAt.getTime())
      .slice(-Math.max(1, limit));
  }

  const rows = await sql<DispatchContractEventRow[]>`
    SELECT id, contract_id, status, event_at, payload
    FROM dispatch_contract_events
    WHERE contract_id = ${contractId}
    ORDER BY event_at ASC, id ASC
    LIMIT ${Math.max(1, limit)}
  `;
  return rows.map(mapEventRow);
}

export async function listDispatchContracts(opts?: {
  status?: DispatchContractStatus;
  targetAgentId?: string;
  taskId?: string;
  limit?: number;
}): Promise<DispatchContractRecord[]> {
  const limit = Math.max(1, opts?.limit ?? 100);
  const sql = await getSql();
  requireStoreAvailable(sql);

  if (isTestEnv()) {
    let values = Array.from(testContracts.values());
    if (opts?.status) values = values.filter((item) => item.status === opts.status);
    if (opts?.targetAgentId)
      values = values.filter((item) => item.targetAgentId === opts.targetAgentId);
    if (opts?.taskId) values = values.filter((item) => item.taskId === opts.taskId);
    values.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return values.slice(0, limit).map((item) => ({
      ...item,
      toolGrantSnapshot: [...item.toolGrantSnapshot],
      metadata: { ...item.metadata },
    }));
  }

  const rows = await sql<DispatchContractRow[]>`
    SELECT
      contract_id,
      task_id,
      task,
      target_agent_id,
      dispatched_by,
      tool_grant_snapshot,
      timeout_ms,
      heartbeat_interval_ms,
      status,
      created_at,
      updated_at,
      expires_at,
      accepted_at,
      started_at,
      last_heartbeat_at,
      completed_at,
      failed_at,
      cancelled_at,
      failure_reason,
      result_summary,
      metadata
    FROM dispatch_contracts
    WHERE (${opts?.status ? sql`status = ${opts.status}` : sql`TRUE`})
      AND (${opts?.targetAgentId ? sql`target_agent_id = ${opts.targetAgentId}` : sql`TRUE`})
      AND (${opts?.taskId ? sql`task_id = ${opts.taskId}` : sql`TRUE`})
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;
  return rows.map(mapContractRow);
}

export function resetDispatchContractsStoreForTests(): void {
  if (!isTestEnv()) return;
  for (const contractId of activeContractMonitors.keys()) {
    clearDispatchContractMonitor(contractId);
  }
  monitorFailing.clear();
  testContracts.clear();
  testEvents.clear();
  testEventId = 1;
}
