import type { OperatorAlertEvent } from "./operator-alerts.js";

export type OperatorAlertSinkStatus = "sent" | "skipped" | "failed";

export type OperatorAlertRouteContext = {
  source?: string;
  signal?: AbortSignal;
};

export type OperatorAlertSinkResult = {
  status: OperatorAlertSinkStatus;
  message?: string;
  details?: Record<string, unknown>;
};

export type OperatorAlertSink = {
  id: string;
  route: (
    event: OperatorAlertEvent,
    context: OperatorAlertRouteContext,
  ) => OperatorAlertSinkResult | Promise<OperatorAlertSinkResult>;
};

export type OperatorAlertRouteSinkResult = OperatorAlertSinkResult & {
  sinkId: string;
};

export type OperatorAlertRouteSummary = {
  alertId: string;
  total: number;
  sent: number;
  skipped: number;
  failed: number;
  results: OperatorAlertRouteSinkResult[];
};

export type OperatorAlertUnregister = () => boolean;

export type OperatorAlertRouter = {
  register: (sink: OperatorAlertSink) => OperatorAlertUnregister;
  route: (
    event: OperatorAlertEvent,
    context?: OperatorAlertRouteContext,
  ) => Promise<OperatorAlertRouteSummary>;
  listSinkIds: () => string[];
  clear: () => void;
};

function normalizeSinkId(id: string): string {
  return id.trim();
}

function failureFromError(sinkId: string, err: unknown): OperatorAlertRouteSinkResult {
  return {
    sinkId,
    status: "failed",
    message: err instanceof Error ? err.message : String(err),
  };
}

function summarize(
  alertId: string,
  results: OperatorAlertRouteSinkResult[],
): OperatorAlertRouteSummary {
  return {
    alertId,
    total: results.length,
    sent: results.filter((result) => result.status === "sent").length,
    skipped: results.filter((result) => result.status === "skipped").length,
    failed: results.filter((result) => result.status === "failed").length,
    results,
  };
}

export function createOperatorAlertRouter(): OperatorAlertRouter {
  const sinks = new Map<string, OperatorAlertSink>();

  return {
    register(sink) {
      const id = normalizeSinkId(sink.id);
      if (!id) {
        throw new Error("Operator alert sink id is required.");
      }
      const registered = { ...sink, id };
      sinks.set(id, registered);

      return () => {
        if (sinks.get(id) !== registered) {
          return false;
        }
        return sinks.delete(id);
      };
    },

    async route(event, context = {}) {
      const results: OperatorAlertRouteSinkResult[] = [];
      for (const sink of sinks.values()) {
        if (context.signal?.aborted) {
          results.push({
            sinkId: sink.id,
            status: "skipped",
            message: "Operator alert routing aborted before sink ran.",
          });
          continue;
        }
        try {
          const result = await sink.route(event, context);
          results.push({ ...result, sinkId: sink.id });
        } catch (err) {
          results.push(failureFromError(sink.id, err));
        }
      }
      return summarize(event.id, results);
    },

    listSinkIds() {
      return [...sinks.keys()];
    },

    clear() {
      sinks.clear();
    },
  };
}

const defaultOperatorAlertRouter = createOperatorAlertRouter();

export function registerOperatorAlertSink(sink: OperatorAlertSink): OperatorAlertUnregister {
  return defaultOperatorAlertRouter.register(sink);
}

export async function routeOperatorAlertEvent(
  event: OperatorAlertEvent,
  context?: OperatorAlertRouteContext,
): Promise<OperatorAlertRouteSummary> {
  return await defaultOperatorAlertRouter.route(event, context);
}

export function listOperatorAlertSinkIds(): string[] {
  return defaultOperatorAlertRouter.listSinkIds();
}

export const __operatorAlertRouterTesting = {
  clear() {
    defaultOperatorAlertRouter.clear();
  },
};
