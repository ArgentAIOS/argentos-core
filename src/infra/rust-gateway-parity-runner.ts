import { validateResponseFrame, type ResponseFrame } from "../gateway/protocol/index.js";
import {
  RUST_GATEWAY_INITIAL_PARITY_FIXTURES,
  type RustGatewayParityFixture,
  type RustGatewayParityLabel,
} from "./rust-gateway-parity-fixtures.js";

export type RustGatewayParityEndpoint = "node" | "rust";

export type RustGatewayParityReplayStatus = "passed" | "failed" | "skipped";

export type RustGatewayParityReplayTransport = (params: {
  endpoint: RustGatewayParityEndpoint;
  fixture: RustGatewayParityFixture;
}) => Promise<unknown>;

export type RustGatewayParityReplayResult = {
  fixtureId: string;
  method: string;
  safety: RustGatewayParityFixture["safety"];
  expectedParity: RustGatewayParityLabel;
  observedParity: RustGatewayParityLabel | "failed" | "skipped";
  status: RustGatewayParityReplayStatus;
  nodeOk: boolean | null;
  rustOk: boolean | null;
  notes: string[];
};

export type RustGatewayParityReplayReport = {
  generatedAtMs: number;
  totals: {
    passed: number;
    failed: number;
    skipped: number;
  };
  results: RustGatewayParityReplayResult[];
};

export async function runRustGatewayParityReplay(params: {
  transport: RustGatewayParityReplayTransport;
  fixtures?: RustGatewayParityFixture[];
  nowMs?: () => number;
}): Promise<RustGatewayParityReplayReport> {
  const fixtures = params.fixtures ?? RUST_GATEWAY_INITIAL_PARITY_FIXTURES;
  const results: RustGatewayParityReplayResult[] = [];

  for (const fixture of fixtures) {
    if (fixture.safety === "unsafe" || fixture.expectedParity === "unsafe") {
      results.push({
        fixtureId: fixture.id,
        method: fixture.method,
        safety: fixture.safety,
        expectedParity: fixture.expectedParity,
        observedParity: "skipped",
        status: "skipped",
        nodeOk: null,
        rustOk: null,
        notes: [`blocked unsafe replay: ${fixture.reason}`],
      });
      continue;
    }

    results.push(await replayFixture({ fixture, transport: params.transport }));
  }

  return {
    generatedAtMs: (params.nowMs ?? Date.now)(),
    totals: {
      passed: results.filter((result) => result.status === "passed").length,
      failed: results.filter((result) => result.status === "failed").length,
      skipped: results.filter((result) => result.status === "skipped").length,
    },
    results,
  };
}

async function replayFixture(params: {
  fixture: RustGatewayParityFixture;
  transport: RustGatewayParityReplayTransport;
}): Promise<RustGatewayParityReplayResult> {
  const notes: string[] = [];
  const nodeValue = await callTransport({
    endpoint: "node",
    fixture: params.fixture,
    transport: params.transport,
  });
  const rustValue = await callTransport({
    endpoint: "rust",
    fixture: params.fixture,
    transport: params.transport,
  });

  if (nodeValue.error) {
    notes.push(`transport/node: ${nodeValue.error}`);
  }
  if (rustValue.error) {
    notes.push(`transport/rust: ${rustValue.error}`);
  }
  if (nodeValue.error || rustValue.error) {
    return buildResult(params.fixture, {
      observedParity: "failed",
      status: "failed",
      nodeOk: null,
      rustOk: null,
      notes,
    });
  }

  const node = coerceResponseFrame(nodeValue.value);
  const rust = coerceResponseFrame(rustValue.value);

  if (!node.frame) {
    notes.push(`envelope/node invalid: ${node.error ?? "unknown validation error"}`);
  }
  if (!rust.frame) {
    notes.push(`envelope/rust invalid: ${rust.error ?? "unknown validation error"}`);
  }
  if (!node.frame || !rust.frame) {
    return buildResult(params.fixture, {
      observedParity: "failed",
      status: "failed",
      nodeOk: node.frame?.ok ?? null,
      rustOk: rust.frame?.ok ?? null,
      notes,
    });
  }

  if (params.fixture.expectedParity === "unsupported") {
    const unsupported = !rust.frame.ok && isUnsupportedResponse(rust.frame);
    return buildResult(params.fixture, {
      observedParity: unsupported ? "unsupported" : "failed",
      status: unsupported ? "passed" : "failed",
      nodeOk: node.frame.ok,
      rustOk: rust.frame.ok,
      notes: unsupported
        ? ["unsupported/rust: method explicitly rejected as unsupported"]
        : ["unsupported/rust: expected unsupported-method rejection"],
    });
  }

  if (params.fixture.expectedParity === "exact") {
    const exact = stableJson(node.frame.payload) === stableJson(rust.frame.payload);
    return buildResult(params.fixture, {
      observedParity: exact ? "exact" : "failed",
      status: exact ? "passed" : "failed",
      nodeOk: node.frame.ok,
      rustOk: rust.frame.ok,
      notes: exact
        ? ["payload/exact: payloads match"]
        : ["payload/exact: node/rust payloads differ"],
    });
  }

  if (params.fixture.expectedParity === "schema-compatible") {
    const errorCheck =
      !node.frame.ok && !rust.frame.ok
        ? validateSchemaCompatibleErrors(params.fixture, node.frame, rust.frame)
        : { ok: true, note: null };
    const payloadCheck =
      node.frame.ok && rust.frame.ok
        ? validateSchemaCompatiblePayloads(params.fixture, node.frame.payload, rust.frame.payload)
        : { ok: true, note: null };
    const compatible = node.frame.ok === rust.frame.ok && errorCheck.ok && payloadCheck.ok;
    const successNotes = ["schema/envelope: response envelopes are compatible"];
    if (errorCheck.note) {
      successNotes.push(errorCheck.note);
    }
    if (payloadCheck.note) {
      successNotes.push(payloadCheck.note);
    }
    return buildResult(params.fixture, {
      observedParity: compatible ? "schema-compatible" : "failed",
      status: compatible ? "passed" : "failed",
      nodeOk: node.frame.ok,
      rustOk: rust.frame.ok,
      notes: compatible
        ? successNotes
        : [
            `schema/envelope: node ok=${node.frame.ok}, rust ok=${rust.frame.ok}`,
            ...(errorCheck.note ? [errorCheck.note] : []),
            ...(payloadCheck.note ? [payloadCheck.note] : []),
          ],
    });
  }

  const mockCompatible = rust.frame.ok;
  return buildResult(params.fixture, {
    observedParity: mockCompatible ? "mock-compatible" : "failed",
    status: mockCompatible ? "passed" : "failed",
    nodeOk: node.frame.ok,
    rustOk: rust.frame.ok,
    notes: mockCompatible
      ? ["mock/rust: synthetic success payload; not promotion evidence"]
      : ["mock/rust: expected synthetic success payload"],
  });
}

async function callTransport(params: {
  endpoint: RustGatewayParityEndpoint;
  fixture: RustGatewayParityFixture;
  transport: RustGatewayParityReplayTransport;
}): Promise<{ value: unknown; error: null } | { value: null; error: string }> {
  try {
    return {
      value: await params.transport({ endpoint: params.endpoint, fixture: params.fixture }),
      error: null,
    };
  } catch (error) {
    return {
      value: null,
      error: String(error),
    };
  }
}

function buildResult(
  fixture: RustGatewayParityFixture,
  result: Omit<RustGatewayParityReplayResult, "fixtureId" | "method" | "safety" | "expectedParity">,
): RustGatewayParityReplayResult {
  return {
    fixtureId: fixture.id,
    method: fixture.method,
    safety: fixture.safety,
    expectedParity: fixture.expectedParity,
    ...result,
  };
}

function coerceResponseFrame(value: unknown): {
  frame: ResponseFrame | null;
  error: string | null;
} {
  if (!validateResponseFrame(value)) {
    return {
      frame: null,
      error:
        validateResponseFrame.errors
          ?.map((error) => `${error.instancePath || "/"} ${error.message ?? "invalid"}`)
          .join("; ") ?? "invalid response frame",
    };
  }
  return { frame: value, error: null };
}

function isUnsupportedResponse(frame: ResponseFrame): boolean {
  const message = frame.error?.message ?? "";
  return /unknown method|unsupported/i.test(message);
}

function validateSchemaCompatiblePayloads(
  fixture: RustGatewayParityFixture,
  nodePayload: unknown,
  rustPayload: unknown,
): { ok: boolean; note: string | null } {
  const validator = schemaPayloadValidators[fixture.method];
  const notes: string[] = [];
  if (!validator) {
    const discovery = validateRequiredMethodDiscovery(fixture, nodePayload, rustPayload);
    return discovery.ok ? { ok: true, note: discovery.note } : discovery;
  }
  const node = validator(nodePayload);
  const rust = validator(rustPayload);
  if (node.ok && rust.ok) {
    notes.push(`schema/payload: ${validator.description}`);
    const discovery = validateRequiredMethodDiscovery(fixture, nodePayload, rustPayload);
    if (!discovery.ok) {
      return discovery;
    }
    if (discovery.note) {
      notes.push(discovery.note);
    }
    return { ok: true, note: notes.join("; ") };
  }

  return {
    ok: false,
    note: `schema/payload: ${fixture.method} invalid (${node.ok ? "node ok" : `node ${node.error}`}; ${rust.ok ? "rust ok" : `rust ${rust.error}`})`,
  };
}

function validateRequiredMethodDiscovery(
  fixture: RustGatewayParityFixture,
  nodePayload: unknown,
  rustPayload: unknown,
): { ok: boolean; note: string | null } {
  if (!fixture.requiredMethods?.length) {
    return { ok: true, note: null };
  }
  const nodeMethods = extractFeatureMethods(nodePayload);
  const rustMethods = extractFeatureMethods(rustPayload);
  if (!nodeMethods || !rustMethods) {
    return {
      ok: false,
      note: `schema/methods: ${fixture.method} must expose features.methods arrays`,
    };
  }
  const missingFromNode = fixture.requiredMethods.filter((method) => !nodeMethods.has(method));
  const missingFromRust = fixture.requiredMethods.filter((method) => !rustMethods.has(method));
  if (missingFromNode.length > 0 || missingFromRust.length > 0) {
    return {
      ok: false,
      note: `schema/methods: required discovery drift (node missing ${formatMethodList(missingFromNode)}; rust missing ${formatMethodList(missingFromRust)})`,
    };
  }
  return {
    ok: true,
    note: `schema/methods: both gateways advertise required read-only methods (${fixture.requiredMethods.length})`,
  };
}

function extractFeatureMethods(payload: unknown): Set<string> | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  const features = (payload as Record<string, unknown>).features;
  if (!features || typeof features !== "object" || Array.isArray(features)) {
    return null;
  }
  const methods = (features as Record<string, unknown>).methods;
  if (!Array.isArray(methods) || !methods.every((method) => typeof method === "string")) {
    return null;
  }
  return new Set(methods);
}

function formatMethodList(methods: string[]): string {
  return methods.length > 0 ? methods.join(",") : "none";
}

function validateSchemaCompatibleErrors(
  fixture: RustGatewayParityFixture,
  nodeFrame: ResponseFrame,
  rustFrame: ResponseFrame,
): { ok: boolean; note: string | null } {
  if (!nodeFrame.error || !rustFrame.error) {
    return {
      ok: false,
      note: "schema/error: both gateways must return structured error envelopes",
    };
  }
  const leakedProbe = findLeakedRedactionProbe(fixture, nodeFrame, rustFrame);
  if (leakedProbe) {
    return {
      ok: false,
      note: `schema/error: auth failure leaked redaction probe ${leakedProbe}`,
    };
  }
  return {
    ok: true,
    note: fixture.redactionProbes?.length
      ? "schema/error: auth failure errors are structured and redacted"
      : "schema/error: error envelopes are structured",
  };
}

function findLeakedRedactionProbe(
  fixture: RustGatewayParityFixture,
  nodeFrame: ResponseFrame,
  rustFrame: ResponseFrame,
): string | null {
  const haystack = `${stableJson(nodeFrame.error)}\n${stableJson(rustFrame.error)}`;
  for (const probe of fixture.redactionProbes ?? []) {
    if (probe && haystack.includes(probe)) {
      return probe;
    }
  }
  return null;
}

type PayloadValidation = { ok: true } | { ok: false; error: string };
type PayloadValidator = ((payload: unknown) => PayloadValidation) & { description: string };

const schemaPayloadValidators: Record<string, PayloadValidator | undefined> = {
  connect: withDescription(
    (payload) =>
      validateObject(payload, [
        ["type", "string"],
        ["protocol", "number"],
        ["server", "object"],
        ["features", "object"],
        ["snapshot", "object"],
      ]),
    "hello-ok payload includes protocol, server, features, and snapshot",
  ),
  health: withDescription(
    (payload) =>
      validateObject(payload, [
        ["ok", "boolean"],
        ["durationMs", "number"],
        ["defaultAgentId", "string"],
      ]),
    "health payload includes ok, durationMs, and defaultAgentId",
  ),
  status: withDescription(
    (payload) =>
      validateObject(payload, [
        ["heartbeat", "object"],
        ["sessions", "object"],
        ["channelSummary", "array"],
        ["queuedSystemEvents", "array"],
      ]),
    "status payload includes heartbeat, sessions, channelSummary, and queuedSystemEvents",
  ),
  "system-presence": withDescription(
    (payload) => (Array.isArray(payload) ? { ok: true } : { ok: false, error: "not an array" }),
    "presence payload is an array",
  ),
  "commands.list": withDescription(
    (payload) => validateObject(payload, [["commands", "array"]]),
    "commands.list payload includes a commands array",
  ),
  "config.schema": withDescription(
    (payload) => validateObject(payload, [["schema", "object"]]),
    "config schema payload includes a schema object",
  ),
  "models.list": withDescription(
    (payload) => validateModelsListPayload(payload),
    "models.list payload includes schema-compatible model choices",
  ),
  "sessions.list": withDescription(
    (payload) => validateSessionsListPayload(payload),
    "sessions.list payload includes schema-compatible session rows",
  ),
};

function withDescription(
  validator: (payload: unknown) => PayloadValidation,
  description: string,
): PayloadValidator {
  return Object.assign(validator, { description });
}

function validateObject(
  value: unknown,
  fields: Array<[key: string, type: "string" | "number" | "boolean" | "object" | "array"]>,
): PayloadValidation {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "not an object" };
  }
  const record = value as Record<string, unknown>;
  for (const [key, type] of fields) {
    const field = record[key];
    if (type === "array") {
      if (!Array.isArray(field)) {
        return { ok: false, error: `${key} is not an array` };
      }
      continue;
    }
    if (type === "object") {
      if (!field || typeof field !== "object" || Array.isArray(field)) {
        return { ok: false, error: `${key} is not an object` };
      }
      continue;
    }
    if (typeof field !== type) {
      return { ok: false, error: `${key} is not ${type}` };
    }
  }
  return { ok: true };
}

function validateModelsListPayload(payload: unknown): PayloadValidation {
  const base = validateObject(payload, [["models", "array"]]);
  if (!base.ok) {
    return base;
  }

  const models = (payload as { models: unknown[] }).models;
  for (const [index, model] of models.entries()) {
    const choice = validateObject(model, [
      ["id", "string"],
      ["name", "string"],
      ["provider", "string"],
    ]);
    if (!choice.ok) {
      return { ok: false, error: `models[${index}].${choice.error}` };
    }

    const record = model as Record<string, unknown>;
    if ("contextWindow" in record && !Number.isInteger(record.contextWindow)) {
      return { ok: false, error: `models[${index}].contextWindow is not an integer` };
    }
    if ("reasoning" in record && typeof record.reasoning !== "boolean") {
      return { ok: false, error: `models[${index}].reasoning is not boolean` };
    }
  }

  return { ok: true };
}

function validateSessionsListPayload(payload: unknown): PayloadValidation {
  const base = validateObject(payload, [
    ["ts", "number"],
    ["path", "string"],
    ["count", "number"],
    ["defaults", "object"],
    ["sessions", "array"],
  ]);
  if (!base.ok) {
    return base;
  }

  const { count, sessions } = payload as { count: number; sessions: unknown[] };
  if (!Number.isInteger(count)) {
    return { ok: false, error: "count is not an integer" };
  }
  if (count !== sessions.length) {
    return { ok: false, error: "count does not match sessions length" };
  }

  for (const [index, session] of sessions.entries()) {
    const row = validateObject(session, [
      ["key", "string"],
      ["kind", "string"],
    ]);
    if (!row.ok) {
      return { ok: false, error: `sessions[${index}].${row.error}` };
    }
  }

  return { ok: true };
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value)
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, sortJson(nested)]),
  );
}
