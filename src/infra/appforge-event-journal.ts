/**
 * Durable AppForge producer event journal.
 *
 * Each mutation that goes through `workflows.emitAppForgeEvent` is appended
 * here as a JSONL line. Consumers (workflow engine, downstream connectors)
 * can:
 *
 *   1. Subscribe in-process for live events (best-effort, in-memory).
 *   2. List events since a given id — restart-safe tail-based catch-up.
 *   3. Register a durable named consumer whose cursor (`lastDeliveredId`)
 *      is persisted to disk so the consumer can resume after a gateway
 *      restart without missing or replaying events.
 *
 * File layout (under `<journalRoot>`):
 *   - `events.jsonl` — append-only producer log (one JSON record per line).
 *   - `consumers.json` — durable consumer registry + cursors.
 *
 * The journal is intentionally file-backed (rather than reusing the
 * Postgres workflow tables) so it survives the gateway losing its DB
 * connection — this is the same pattern as
 * `rust-gateway-receipt-store.ts` and `heartbeat-journal.ts`.
 */
import { EventEmitter } from "node:events";
import { mkdir, readFile, writeFile, appendFile, rename } from "node:fs/promises";
import path from "node:path";
import type { NormalizedAppForgeWorkflowEvent } from "./appforge-workflow-events.js";

const JOURNAL_VERSION = "appforge-event-journal-v1";
const CONSUMERS_VERSION = "appforge-event-consumers-v1";

export type AppForgeEventKind =
  | "record.created"
  | "record.updated"
  | "record.deleted"
  | "table.created"
  | "table.updated"
  | "table.deleted"
  | "view.created"
  | "view.updated"
  | "view.deleted"
  | "capability.completed"
  | "review.requested"
  | "review.completed"
  | (string & {});

export type AppForgeEventScope = {
  appId: string;
  baseId?: string;
  tableId?: string;
  recordId?: string;
  viewId?: string;
  capabilityId?: string;
};

export type AppForgeEventActor = {
  id: string;
  type?: string;
  displayName?: string;
};

export type AppForgeJournalEvent = {
  /** Monotonically increasing per-journal id (starts at 1). */
  id: number;
  /** Original eventType string (e.g. `forge.record.created`). */
  eventType: string;
  /** Short canonical kind (e.g. `record.created`). */
  kind: AppForgeEventKind;
  scope: AppForgeEventScope;
  actor: AppForgeEventActor | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  payload: Record<string, unknown>;
  /** ISO timestamp from the normalized event payload. */
  timestamp: string;
  /** Wall-clock ms when the event was appended (used for ordering across processes). */
  recordedAtMs: number;
};

export type AppForgeEventFilter = {
  /** Match any of these kinds. Empty/undefined means accept all kinds. */
  kinds?: AppForgeEventKind[];
  /** Partial scope match — every supplied field must equal the event scope. */
  scope?: Partial<AppForgeEventScope>;
};

export type AppForgeJournalListOptions = AppForgeEventFilter & {
  /** Only return events with id > sinceId (tail-based catch-up). */
  sinceId?: number;
  /** Cap on returned entries (after filtering). */
  limit?: number;
};

export type AppForgeConsumerState = {
  consumerId: string;
  filter: AppForgeEventFilter;
  lastDeliveredId: number;
  registeredAt: string;
  updatedAt: string;
};

export type AppForgeJournalAppendInput = {
  event: NormalizedAppForgeWorkflowEvent;
  actor?: AppForgeEventActor | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  /** Override the ISO timestamp (tests). */
  timestampOverride?: string;
  /** Override the wall-clock id offset (tests). */
  recordedAtMsOverride?: number;
};

export type AppForgeEventJournal = {
  append: (input: AppForgeJournalAppendInput) => Promise<AppForgeJournalEvent>;
  list: (options?: AppForgeJournalListOptions) => Promise<AppForgeJournalEvent[]>;
  getLastId: () => Promise<number>;
  /**
   * Register an in-memory subscriber. Returns an `unsubscribe` function.
   * NOT durable across restarts — for that, also call `registerConsumer`
   * and reconcile via `list({ sinceId })` on startup.
   */
  subscribe: (
    filter: AppForgeEventFilter,
    listener: (event: AppForgeJournalEvent) => void,
  ) => { unsubscribe: () => void };
  /**
   * Register or update a durable named consumer. If the consumer already
   * exists, the filter is overwritten and `lastDeliveredId` is preserved.
   */
  registerConsumer: (
    consumerId: string,
    filter: AppForgeEventFilter,
  ) => Promise<AppForgeConsumerState>;
  /** Advance the consumer cursor (idempotent — never moves backwards). */
  acknowledge: (consumerId: string, eventId: number) => Promise<AppForgeConsumerState>;
  getConsumer: (consumerId: string) => Promise<AppForgeConsumerState | null>;
  listConsumers: () => Promise<AppForgeConsumerState[]>;
  /** For tests — flushes in-memory caches. */
  __resetForTest?: () => void;
};

function resolveDefaultJournalRoot(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.ARGENT_APPFORGE_EVENT_JOURNAL_DIR?.trim();
  if (configured) {
    return path.resolve(configured);
  }
  const stateDir = env.ARGENT_STATE_DIR?.trim();
  if (stateDir) {
    return path.join(path.resolve(stateDir), "appforge", "events");
  }
  const home = env.HOME?.trim() || process.cwd();
  return path.join(home, ".argentos", "appforge", "events");
}

export function resolveAppForgeEventJournalPaths(env: NodeJS.ProcessEnv = process.env): {
  root: string;
  eventsPath: string;
  consumersPath: string;
} {
  const root = resolveDefaultJournalRoot(env);
  return {
    root,
    eventsPath: path.join(root, "events.jsonl"),
    consumersPath: path.join(root, "consumers.json"),
  };
}

const KIND_FROM_EVENT_TYPE: Record<string, AppForgeEventKind> = {
  "forge.record.created": "record.created",
  "forge.record.updated": "record.updated",
  "forge.record.deleted": "record.deleted",
  "forge.table.created": "table.created",
  "forge.table.updated": "table.updated",
  "forge.table.deleted": "table.deleted",
  "forge.view.created": "view.created",
  "forge.view.updated": "view.updated",
  "forge.view.deleted": "view.deleted",
  "forge.review.requested": "review.requested",
  "forge.review.completed": "review.completed",
  "forge.capability.completed": "capability.completed",
};

export function kindFromAppForgeEventType(eventType: string): AppForgeEventKind {
  const direct = KIND_FROM_EVENT_TYPE[eventType];
  if (direct) {
    return direct;
  }
  // Strip a leading `forge.` if present, otherwise keep verbatim (defensive).
  return eventType.startsWith("forge.") ? eventType.slice("forge.".length) : eventType;
}

export function scopeFromAppForgeEvent(event: NormalizedAppForgeWorkflowEvent): AppForgeEventScope {
  const payload = event.payload as Record<string, unknown>;
  const scope: AppForgeEventScope = { appId: event.appId };
  const baseId = typeof payload.baseId === "string" ? payload.baseId : undefined;
  if (baseId) {
    scope.baseId = baseId;
  }
  const tableId = typeof payload.tableId === "string" ? payload.tableId : undefined;
  if (tableId) {
    scope.tableId = tableId;
  }
  const recordId = typeof payload.recordId === "string" ? payload.recordId : undefined;
  if (recordId) {
    scope.recordId = recordId;
  }
  const viewId = typeof payload.viewId === "string" ? payload.viewId : undefined;
  if (viewId) {
    scope.viewId = viewId;
  }
  if (event.capabilityId) {
    scope.capabilityId = event.capabilityId;
  }
  return scope;
}

export function matchesAppForgeEventFilter(
  event: AppForgeJournalEvent,
  filter: AppForgeEventFilter | undefined,
): boolean {
  if (!filter) {
    return true;
  }
  if (filter.kinds && filter.kinds.length > 0 && !filter.kinds.includes(event.kind)) {
    return false;
  }
  if (filter.scope) {
    for (const [key, value] of Object.entries(filter.scope)) {
      if (typeof value !== "string" || !value) {
        continue;
      }
      const actual = (event.scope as Record<string, unknown>)[key];
      if (actual !== value) {
        return false;
      }
    }
  }
  return true;
}

function normalizeFilterForPersistence(
  filter: AppForgeEventFilter | undefined,
): AppForgeEventFilter {
  if (!filter) {
    return {};
  }
  const out: AppForgeEventFilter = {};
  if (filter.kinds && filter.kinds.length > 0) {
    out.kinds = [...filter.kinds];
  }
  if (filter.scope) {
    const scope: Partial<AppForgeEventScope> = {};
    for (const [key, value] of Object.entries(filter.scope)) {
      if (typeof value === "string" && value) {
        (scope as Record<string, string>)[key] = value;
      }
    }
    if (Object.keys(scope).length > 0) {
      out.scope = scope;
    }
  }
  return out;
}

type JournalLine = { version: string; event: AppForgeJournalEvent };
type ConsumersFile = { version: string; consumers: AppForgeConsumerState[] };

async function readTextIfExists(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return "";
    }
    throw error;
  }
}

async function readAllEvents(eventsPath: string): Promise<AppForgeJournalEvent[]> {
  const raw = await readTextIfExists(eventsPath);
  if (!raw.trim()) {
    return [];
  }
  const events: AppForgeJournalEvent[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    let parsed: JournalLine;
    try {
      parsed = JSON.parse(trimmed) as JournalLine;
    } catch {
      // Tolerate partial trailing writes — skip un-parseable lines.
      continue;
    }
    if (
      parsed?.version === JOURNAL_VERSION &&
      parsed.event &&
      typeof parsed.event.id === "number"
    ) {
      events.push(parsed.event);
    }
  }
  return events;
}

async function readConsumers(consumersPath: string): Promise<AppForgeConsumerState[]> {
  const raw = await readTextIfExists(consumersPath);
  if (!raw.trim()) {
    return [];
  }
  let parsed: ConsumersFile;
  try {
    parsed = JSON.parse(raw) as ConsumersFile;
  } catch {
    return [];
  }
  if (parsed?.version !== CONSUMERS_VERSION || !Array.isArray(parsed.consumers)) {
    return [];
  }
  return parsed.consumers.filter(
    (c): c is AppForgeConsumerState =>
      typeof c?.consumerId === "string" && typeof c?.lastDeliveredId === "number",
  );
}

async function writeConsumers(
  consumersPath: string,
  consumers: AppForgeConsumerState[],
): Promise<void> {
  await mkdir(path.dirname(consumersPath), { recursive: true, mode: 0o700 });
  const payload: ConsumersFile = { version: CONSUMERS_VERSION, consumers };
  const tmp = `${consumersPath}.tmp`;
  await writeFile(tmp, JSON.stringify(payload, null, 2), { mode: 0o600 });
  await rename(tmp, consumersPath);
}

export type CreateAppForgeEventJournalOptions = {
  /** Override the journal directory. Defaults to env-resolved path. */
  root?: string;
  eventsPath?: string;
  consumersPath?: string;
};

export function createAppForgeEventJournal(
  options: CreateAppForgeEventJournalOptions = {},
): AppForgeEventJournal {
  const defaults = resolveAppForgeEventJournalPaths();
  const eventsPath =
    options.eventsPath ??
    (options.root ? path.join(options.root, "events.jsonl") : defaults.eventsPath);
  const consumersPath =
    options.consumersPath ??
    (options.root ? path.join(options.root, "consumers.json") : defaults.consumersPath);

  let cachedLastId: number | null = null;
  let appendChain: Promise<void> = Promise.resolve();
  let consumerChain: Promise<void> = Promise.resolve();
  const emitter = new EventEmitter();
  // Avoid noisy "MaxListenersExceededWarning" — there can be many durable consumers.
  emitter.setMaxListeners(0);

  async function loadLastId(): Promise<number> {
    if (cachedLastId !== null) {
      return cachedLastId;
    }
    const events = await readAllEvents(eventsPath);
    let max = 0;
    for (const evt of events) {
      if (evt.id > max) {
        max = evt.id;
      }
    }
    cachedLastId = max;
    return max;
  }

  async function appendInternal(input: AppForgeJournalAppendInput): Promise<AppForgeJournalEvent> {
    const lastId = await loadLastId();
    const nextId = lastId + 1;
    const eventType = input.event.eventType;
    const timestamp =
      input.timestampOverride ??
      (typeof input.event.payload?.emittedAt === "string"
        ? (input.event.payload.emittedAt as string)
        : new Date().toISOString());
    const event: AppForgeJournalEvent = {
      id: nextId,
      eventType,
      kind: kindFromAppForgeEventType(eventType),
      scope: scopeFromAppForgeEvent(input.event),
      actor: input.actor ?? null,
      before: input.before ?? null,
      after: input.after ?? null,
      payload: { ...input.event.payload },
      timestamp,
      recordedAtMs: input.recordedAtMsOverride ?? Date.now(),
    };
    await mkdir(path.dirname(eventsPath), { recursive: true, mode: 0o700 });
    const line = JSON.stringify({ version: JOURNAL_VERSION, event } satisfies JournalLine);
    await appendFile(eventsPath, `${line}\n`, { mode: 0o600 });
    cachedLastId = nextId;
    // Notify in-memory listeners after the durable write.
    emitter.emit("event", event);
    return event;
  }

  function serialiseAppend(input: AppForgeJournalAppendInput): Promise<AppForgeJournalEvent> {
    let resolveResult!: (value: AppForgeJournalEvent | PromiseLike<AppForgeJournalEvent>) => void;
    let rejectResult!: (reason: unknown) => void;
    const result = new Promise<AppForgeJournalEvent>((resolve, reject) => {
      resolveResult = resolve;
      rejectResult = reject;
    });
    appendChain = appendChain
      .then(() => appendInternal(input))
      .then((value) => {
        resolveResult(value);
      })
      .catch((err) => {
        rejectResult(err);
      });
    return result;
  }

  async function updateConsumer(
    consumerId: string,
    update: (existing: AppForgeConsumerState | null) => AppForgeConsumerState,
  ): Promise<AppForgeConsumerState> {
    let nextState!: AppForgeConsumerState;
    const work = consumerChain.then(async () => {
      const consumers = await readConsumers(consumersPath);
      const existingIndex = consumers.findIndex((c) => c.consumerId === consumerId);
      const existing = existingIndex >= 0 ? (consumers[existingIndex] ?? null) : null;
      nextState = update(existing);
      if (existingIndex >= 0) {
        consumers[existingIndex] = nextState;
      } else {
        consumers.push(nextState);
      }
      await writeConsumers(consumersPath, consumers);
    });
    consumerChain = work.catch(() => undefined);
    await work;
    return nextState;
  }

  return {
    async append(input) {
      return serialiseAppend(input);
    },
    async list(options = {}) {
      const events = await readAllEvents(eventsPath);
      const filter: AppForgeEventFilter = {
        kinds: options.kinds,
        scope: options.scope,
      };
      let filtered = events.filter((evt) => matchesAppForgeEventFilter(evt, filter));
      if (typeof options.sinceId === "number") {
        const sinceId = options.sinceId;
        filtered = filtered.filter((evt) => evt.id > sinceId);
      }
      filtered.sort((a, b) => a.id - b.id);
      if (typeof options.limit === "number" && options.limit >= 0) {
        filtered = filtered.slice(0, options.limit);
      }
      return filtered;
    },
    async getLastId() {
      return loadLastId();
    },
    subscribe(filter, listener) {
      const handler = (event: AppForgeJournalEvent) => {
        if (matchesAppForgeEventFilter(event, filter)) {
          try {
            listener(event);
          } catch {
            /* ignore listener failures */
          }
        }
      };
      emitter.on("event", handler);
      return {
        unsubscribe: () => {
          emitter.off("event", handler);
        },
      };
    },
    async registerConsumer(consumerId, filter) {
      if (!consumerId.trim()) {
        throw new Error("consumerId is required");
      }
      const normalized = normalizeFilterForPersistence(filter);
      const now = new Date().toISOString();
      return updateConsumer(consumerId, (existing) => {
        if (existing) {
          return {
            ...existing,
            filter: normalized,
            updatedAt: now,
          };
        }
        return {
          consumerId,
          filter: normalized,
          lastDeliveredId: 0,
          registeredAt: now,
          updatedAt: now,
        };
      });
    },
    async acknowledge(consumerId, eventId) {
      if (!consumerId.trim()) {
        throw new Error("consumerId is required");
      }
      if (!Number.isFinite(eventId) || eventId < 0) {
        throw new Error("eventId must be a non-negative number");
      }
      const now = new Date().toISOString();
      return updateConsumer(consumerId, (existing) => {
        if (!existing) {
          return {
            consumerId,
            filter: {},
            lastDeliveredId: eventId,
            registeredAt: now,
            updatedAt: now,
          };
        }
        return {
          ...existing,
          lastDeliveredId: Math.max(existing.lastDeliveredId, eventId),
          updatedAt: now,
        };
      });
    },
    async getConsumer(consumerId) {
      const consumers = await readConsumers(consumersPath);
      return consumers.find((c) => c.consumerId === consumerId) ?? null;
    },
    async listConsumers() {
      return readConsumers(consumersPath);
    },
    __resetForTest: () => {
      cachedLastId = null;
      appendChain = Promise.resolve();
      consumerChain = Promise.resolve();
      emitter.removeAllListeners();
    },
  };
}

// ── Singleton wiring ────────────────────────────────────────────────────────
//
// The gateway holds exactly one journal per process. Tests can override via
// `setAppForgeEventJournalForTest()` to inject a per-test temp journal.

let singleton: AppForgeEventJournal | null = null;

export function getAppForgeEventJournal(): AppForgeEventJournal {
  singleton ??= createAppForgeEventJournal();
  return singleton;
}

export function setAppForgeEventJournalForTest(journal: AppForgeEventJournal | null): void {
  singleton = journal;
}
