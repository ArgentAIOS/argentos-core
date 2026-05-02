import {
  EXECUTIVE_SHADOW_DEFAULT_BASE_URL,
  EXECUTIVE_SHADOW_DEFAULT_TIMEOUT_MS,
  executiveShadowHealthSchema,
  executiveShadowJournalSchema,
  executiveShadowKernelReadinessSchema,
  executiveShadowMetricsSchema,
  executiveShadowOkSchema,
  executiveShadowStateEnvelopeSchema,
  type ExecutiveShadowHealth,
  type ExecutiveShadowJournalRecord,
  type ExecutiveShadowKernelReadiness,
  type ExecutiveShadowLaneRelease,
  type ExecutiveShadowLaneRequest,
  type ExecutiveShadowMetrics,
  type ExecutiveShadowShutdownRequest,
  type ExecutiveShadowStateEnvelope,
  type ExecutiveShadowTimelineSummary,
  type ExecutiveShadowTickRequest,
  executiveShadowTimelineSummarySchema,
} from "./executive-shadow-contract.js";
import { resolveFetch } from "./fetch.js";

export {
  EXECUTIVE_SHADOW_DEFAULT_BASE_URL,
  EXECUTIVE_SHADOW_DEFAULT_TIMEOUT_MS,
} from "./executive-shadow-contract.js";
export type {
  ExecutiveShadowHealth,
  ExecutiveShadowJournalRecord,
  ExecutiveShadowKernelReadiness,
  ExecutiveShadowLaneRelease,
  ExecutiveShadowLaneRequest,
  ExecutiveShadowMetrics,
  ExecutiveShadowShutdownRequest,
  ExecutiveShadowStateEnvelope,
  ExecutiveShadowTimelineSummary,
  ExecutiveShadowTickRequest,
} from "./executive-shadow-contract.js";
import type { z } from "zod";

export type ExecutiveShadowClientOptions = {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  experimentalWrites?: boolean;
};

export class ExecutiveShadowClientError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(message: string, params: { status: number; body: string }) {
    super(message);
    this.name = "ExecutiveShadowClientError";
    this.status = params.status;
    this.body = params.body;
  }
}

type JsonInit = {
  method?: "GET" | "POST";
  body?: unknown;
};

export class ExecutiveShadowClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly experimentalWrites: boolean;

  constructor(options: ExecutiveShadowClientOptions = {}) {
    const fetchImpl = resolveFetch(options.fetchImpl);
    if (!fetchImpl) {
      throw new Error("fetch is unavailable; provide fetchImpl explicitly");
    }
    this.baseUrl = normalizeBaseUrl(options.baseUrl ?? EXECUTIVE_SHADOW_DEFAULT_BASE_URL);
    this.fetchImpl = fetchImpl;
    this.timeoutMs = options.timeoutMs ?? EXECUTIVE_SHADOW_DEFAULT_TIMEOUT_MS;
    this.experimentalWrites = options.experimentalWrites ?? false;
  }

  async getHealth(): Promise<ExecutiveShadowHealth> {
    return this.requestJson("/health", executiveShadowHealthSchema);
  }

  async getState(): Promise<ExecutiveShadowStateEnvelope> {
    return this.requestJson("/v1/executive/state", executiveShadowStateEnvelopeSchema);
  }

  async getJournal(limit = 20): Promise<ExecutiveShadowJournalRecord[]> {
    return this.requestJson(
      `/v1/executive/journal?limit=${encodeURIComponent(String(limit))}`,
      executiveShadowJournalSchema,
    );
  }

  async getTimeline(limit = 20): Promise<ExecutiveShadowTimelineSummary> {
    return this.requestJson(
      `/v1/executive/timeline?limit=${encodeURIComponent(String(limit))}`,
      executiveShadowTimelineSummarySchema,
    );
  }

  async getMetrics(): Promise<ExecutiveShadowMetrics> {
    return this.requestJson("/v1/executive/metrics", executiveShadowMetricsSchema);
  }

  async getReadiness(): Promise<ExecutiveShadowKernelReadiness> {
    return this.requestJson("/v1/executive/readiness", executiveShadowKernelReadinessSchema);
  }

  async experimentalRequestLane(request: ExecutiveShadowLaneRequest): Promise<{ ok: true }> {
    this.assertExperimentalWrites("requestLane");
    return this.requestJson("/v1/lanes/request", executiveShadowOkSchema, {
      method: "POST",
      body: request,
    });
  }

  async experimentalReleaseLane(request: ExecutiveShadowLaneRelease): Promise<{ ok: true }> {
    this.assertExperimentalWrites("releaseLane");
    return this.requestJson("/v1/lanes/release", executiveShadowOkSchema, {
      method: "POST",
      body: request,
    });
  }

  async experimentalTick(request: ExecutiveShadowTickRequest = {}): Promise<ExecutiveShadowHealth> {
    this.assertExperimentalWrites("tick");
    return this.requestJson("/v1/executive/tick", executiveShadowHealthSchema, {
      method: "POST",
      body: request,
    });
  }

  async experimentalShutdown(request: ExecutiveShadowShutdownRequest = {}): Promise<{ ok: true }> {
    this.assertExperimentalWrites("shutdown");
    return this.requestJson("/v1/executive/shutdown", executiveShadowOkSchema, {
      method: "POST",
      body: request,
    });
  }

  private assertExperimentalWrites(operation: string): void {
    if (!this.experimentalWrites) {
      throw new Error(
        `Executive shadow write operation "${operation}" is disabled; opt in with experimentalWrites=true`,
      );
    }
  }

  private async requestJson<T>(
    path: string,
    schema: z.ZodType<T>,
    init: JsonInit = {},
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: init.method ?? "GET",
        headers: init.body === undefined ? undefined : { "Content-Type": "application/json" },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: controller.signal,
      });
      const text = await response.text();
      if (!response.ok) {
        throw new ExecutiveShadowClientError(
          `Executive shadow request failed (${response.status} ${response.statusText})`,
          { status: response.status, body: text },
        );
      }
      return schema.parse(JSON.parse(text)) as T;
    } finally {
      clearTimeout(timer);
    }
  }
}

export function createExecutiveShadowClient(
  options: ExecutiveShadowClientOptions = {},
): ExecutiveShadowClient {
  return new ExecutiveShadowClient(options);
}

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}
