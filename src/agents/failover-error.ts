import { classifyFailoverReason, type FailoverReason } from "./pi-embedded-helpers.js";

const TIMEOUT_HINT_RE = /timeout|timed out|deadline exceeded|context deadline exceeded/i;
const ABORT_TIMEOUT_RE = /request was aborted|request aborted/i;

export class FailoverError extends Error {
  readonly reason: FailoverReason;
  readonly provider?: string;
  readonly model?: string;
  readonly profileId?: string;
  readonly status?: number;
  readonly code?: string;
  readonly retryAfterMs?: number;

  constructor(
    message: string,
    params: {
      reason: FailoverReason;
      provider?: string;
      model?: string;
      profileId?: string;
      status?: number;
      code?: string;
      retryAfterMs?: number;
      cause?: unknown;
    },
  ) {
    super(message, { cause: params.cause });
    this.name = "FailoverError";
    this.reason = params.reason;
    this.provider = params.provider;
    this.model = params.model;
    this.profileId = params.profileId;
    this.status = params.status;
    this.code = params.code;
    this.retryAfterMs = params.retryAfterMs;
  }
}

export function isFailoverError(err: unknown): err is FailoverError {
  return err instanceof FailoverError;
}

export function resolveFailoverStatus(reason: FailoverReason): number | undefined {
  switch (reason) {
    case "billing":
      return 402;
    case "rate_limit":
      return 429;
    case "auth":
      return 401;
    case "timeout":
      return 408;
    case "overloaded":
      return 529;
    case "format":
      return 400;
    default:
      return undefined;
  }
}

function getStatusCode(err: unknown): number | undefined {
  if (!err || typeof err !== "object") {
    return undefined;
  }
  const candidate =
    (err as { status?: unknown; statusCode?: unknown }).status ??
    (err as { statusCode?: unknown }).statusCode;
  if (typeof candidate === "number") {
    return candidate;
  }
  if (typeof candidate === "string" && /^\d+$/.test(candidate)) {
    return Number(candidate);
  }
  return undefined;
}

function getErrorName(err: unknown): string {
  if (!err || typeof err !== "object") {
    return "";
  }
  return "name" in err ? String(err.name) : "";
}

function getErrorCode(err: unknown): string | undefined {
  if (!err || typeof err !== "object") {
    return undefined;
  }
  const candidate = (err as { code?: unknown }).code;
  if (typeof candidate !== "string") {
    return undefined;
  }
  const trimmed = candidate.trim();
  return trimmed ? trimmed : undefined;
}

function parseRetryAfterValue(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (!trimmed) {
    return undefined;
  }
  const asSeconds = Number(trimmed);
  if (Number.isFinite(asSeconds) && asSeconds >= 0) {
    return Math.round(asSeconds * 1000);
  }
  const asDate = Date.parse(trimmed);
  if (Number.isNaN(asDate)) {
    return undefined;
  }
  return Math.max(0, asDate - Date.now());
}

function readRetryAfterHeader(headers: unknown): number | undefined {
  if (!headers || typeof headers !== "object") {
    return undefined;
  }
  if ("get" in headers && typeof (headers as { get?: unknown }).get === "function") {
    const value = (headers as { get: (name: string) => string | null }).get("retry-after");
    if (typeof value === "string") {
      return parseRetryAfterValue(value);
    }
  }
  const record = headers as Record<string, unknown>;
  const value = record["retry-after"] ?? record["Retry-After"];
  if (typeof value === "string") {
    return parseRetryAfterValue(value);
  }
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.round(value * 1000);
  }
  return undefined;
}

export function resolveRetryAfterMs(err: unknown): number | undefined {
  if (!err || typeof err !== "object") {
    return undefined;
  }
  const directHeaders = (err as { headers?: unknown }).headers;
  const direct = readRetryAfterHeader(directHeaders);
  if (typeof direct === "number") {
    return direct;
  }
  const responseHeaders = (err as { response?: { headers?: unknown } }).response?.headers;
  const fromResponse = readRetryAfterHeader(responseHeaders);
  if (typeof fromResponse === "number") {
    return fromResponse;
  }
  return undefined;
}

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  if (typeof err === "string") {
    return err;
  }
  if (typeof err === "number" || typeof err === "boolean" || typeof err === "bigint") {
    return String(err);
  }
  if (typeof err === "symbol") {
    return err.description ?? "";
  }
  if (err && typeof err === "object") {
    const message = (err as { message?: unknown }).message;
    if (typeof message === "string") {
      return message;
    }
  }
  return "";
}

function hasTimeoutHint(err: unknown): boolean {
  if (!err) {
    return false;
  }
  if (getErrorName(err) === "TimeoutError") {
    return true;
  }
  const message = getErrorMessage(err);
  return Boolean(message && TIMEOUT_HINT_RE.test(message));
}

export function isTimeoutError(err: unknown): boolean {
  if (hasTimeoutHint(err)) {
    return true;
  }
  if (!err || typeof err !== "object") {
    return false;
  }
  if (getErrorName(err) !== "AbortError") {
    return false;
  }
  const message = getErrorMessage(err);
  if (message && ABORT_TIMEOUT_RE.test(message)) {
    return true;
  }
  const cause = "cause" in err ? (err as { cause?: unknown }).cause : undefined;
  const reason = "reason" in err ? (err as { reason?: unknown }).reason : undefined;
  return hasTimeoutHint(cause) || hasTimeoutHint(reason);
}

export function resolveFailoverReasonFromError(err: unknown): FailoverReason | null {
  if (isFailoverError(err)) {
    return err.reason;
  }

  const status = getStatusCode(err);
  if (status === 402) {
    return "billing";
  }
  if (status === 429) {
    return "rate_limit";
  }
  if (status === 401 || status === 403) {
    return "auth";
  }
  if (status === 408) {
    return "timeout";
  }

  const code = (getErrorCode(err) ?? "").toUpperCase();
  if (["ETIMEDOUT", "ESOCKETTIMEDOUT", "ECONNRESET", "ECONNABORTED"].includes(code)) {
    return "timeout";
  }
  if (isTimeoutError(err)) {
    return "timeout";
  }

  const message = getErrorMessage(err);
  if (!message) {
    return null;
  }
  return classifyFailoverReason(message);
}

export function describeFailoverError(err: unknown): {
  message: string;
  reason?: FailoverReason;
  status?: number;
  code?: string;
  retryAfterMs?: number;
} {
  if (isFailoverError(err)) {
    return {
      message: err.message,
      reason: err.reason,
      status: err.status,
      code: err.code,
      retryAfterMs: err.retryAfterMs,
    };
  }
  const message = getErrorMessage(err) || String(err);
  return {
    message,
    reason: resolveFailoverReasonFromError(err) ?? undefined,
    status: getStatusCode(err),
    code: getErrorCode(err),
    retryAfterMs: resolveRetryAfterMs(err),
  };
}

export function coerceToFailoverError(
  err: unknown,
  context?: {
    provider?: string;
    model?: string;
    profileId?: string;
  },
): FailoverError | null {
  if (isFailoverError(err)) {
    return err;
  }
  const reason = resolveFailoverReasonFromError(err);
  if (!reason) {
    return null;
  }

  const message = getErrorMessage(err) || String(err);
  const status = getStatusCode(err) ?? resolveFailoverStatus(reason);
  const code = getErrorCode(err);
  const retryAfterMs = resolveRetryAfterMs(err);

  return new FailoverError(message, {
    reason,
    provider: context?.provider,
    model: context?.model,
    profileId: context?.profileId,
    status,
    code,
    retryAfterMs,
    cause: err instanceof Error ? err : undefined,
  });
}
