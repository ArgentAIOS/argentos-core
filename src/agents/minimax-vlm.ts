import fs from "node:fs";
import path from "node:path";
import { resolveServiceKey } from "../infra/service-keys.js";

/**
 * Resolves the MiniMax API key from (in priority order):
 * 1. Service key store / env fallback for MINIMAX_CODE_PLAN_KEY
 * 2. Service key store / env fallback for MINIMAX_API_KEY
 * 3. providers.minimax.apiKey in argent-models.json (dashboard provider config)
 */
export function resolveMinimaxApiKey(): string | undefined {
  const configuredKey =
    resolveServiceKey("MINIMAX_CODE_PLAN_KEY")?.trim() ||
    resolveServiceKey("MINIMAX_API_KEY")?.trim();
  if (configuredKey) return configuredKey;

  try {
    const stateDir =
      process.env.ARGENT_STATE_DIR?.trim() || path.join(process.env.HOME || "~", ".argentos");
    const agentId = process.env.ARGENT_AGENT_ID?.trim() || "main";
    const agentDir =
      process.env.ARGENT_AGENT_DIR?.trim() ||
      process.env.PI_CODING_AGENT_DIR?.trim() ||
      path.join(stateDir, "agents", agentId, "agent");
    const modelsPath = path.join(agentDir, "argent-models.json");
    if (!fs.existsSync(modelsPath)) return undefined;
    const json = JSON.parse(fs.readFileSync(modelsPath, "utf-8")) as {
      providers?: { minimax?: { apiKey?: string } };
    };
    const storedKey = json.providers?.minimax?.apiKey?.trim();
    if (!storedKey) return undefined;
    // If stored value looks like an env var name (ALL_CAPS_WITH_UNDERSCORES), resolve it
    if (/^[A-Z][A-Z0-9_]+$/.test(storedKey)) {
      return process.env[storedKey]?.trim() || undefined;
    }
    return storedKey;
  } catch {
    return undefined;
  }
}

type MinimaxBaseResp = {
  status_code?: number;
  status_msg?: string;
};

function coerceApiHost(params: {
  apiHost?: string;
  modelBaseUrl?: string;
  env?: NodeJS.ProcessEnv;
}): string {
  const env = params.env ?? process.env;
  const raw =
    params.apiHost?.trim() ||
    env.MINIMAX_API_HOST?.trim() ||
    params.modelBaseUrl?.trim() ||
    "https://api.minimax.io";

  try {
    const url = new URL(raw);
    return url.origin;
  } catch {}

  try {
    const url = new URL(`https://${raw}`);
    return url.origin;
  } catch {
    return "https://api.minimax.io";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function pickString(rec: Record<string, unknown>, key: string): string {
  const v = rec[key];
  return typeof v === "string" ? v : "";
}

function resolveVisionFallbackTimeoutMs(timeoutMs?: number): number {
  const direct = typeof timeoutMs === "number" ? Math.floor(timeoutMs) : Number.NaN;
  const envValue = Number.parseInt(process.env.ARGENT_VISION_FALLBACK_TIMEOUT_MS ?? "", 10);
  const candidate = Number.isFinite(direct) && direct > 0 ? direct : envValue;
  const fallback = Number.isFinite(candidate) && candidate > 0 ? candidate : 8_000;
  return Math.min(Math.max(fallback, 1_000), 60_000);
}

export async function minimaxUnderstandImage(params: {
  apiKey: string;
  prompt: string;
  imageDataUrl: string;
  apiHost?: string;
  modelBaseUrl?: string;
  timeoutMs?: number;
}): Promise<string> {
  const apiKey = params.apiKey.trim();
  if (!apiKey) {
    throw new Error("MiniMax VLM: apiKey required");
  }
  const prompt = params.prompt.trim();
  if (!prompt) {
    throw new Error("MiniMax VLM: prompt required");
  }
  const imageDataUrl = params.imageDataUrl.trim();
  if (!imageDataUrl) {
    throw new Error("MiniMax VLM: imageDataUrl required");
  }
  if (!/^data:image\/(png|jpeg|webp);base64,/i.test(imageDataUrl)) {
    throw new Error("MiniMax VLM: imageDataUrl must be a base64 data:image/(png|jpeg|webp) URL");
  }

  const host = coerceApiHost({
    apiHost: params.apiHost,
    modelBaseUrl: params.modelBaseUrl,
  });
  const url = new URL("/v1/coding_plan/vlm", host).toString();
  const timeoutMs = resolveVisionFallbackTimeoutMs(params.timeoutMs);

  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "MM-API-Source": "ArgentOS",
      },
      body: JSON.stringify({
        prompt,
        image_url: imageDataUrl,
      }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`MiniMax VLM request timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timeoutHandle);
  }

  const traceId = res.headers.get("Trace-Id") ?? "";
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const trace = traceId ? ` Trace-Id: ${traceId}` : "";
    throw new Error(
      `MiniMax VLM request failed (${res.status} ${res.statusText}).${trace}${
        body ? ` Body: ${body.slice(0, 400)}` : ""
      }`,
    );
  }

  const json = (await res.json().catch(() => null)) as unknown;
  if (!isRecord(json)) {
    const trace = traceId ? ` Trace-Id: ${traceId}` : "";
    throw new Error(`MiniMax VLM response was not JSON.${trace}`);
  }

  const baseResp = isRecord(json.base_resp) ? (json.base_resp as MinimaxBaseResp) : {};
  const code = typeof baseResp.status_code === "number" ? baseResp.status_code : -1;
  if (code !== 0) {
    const msg = (baseResp.status_msg ?? "").trim();
    const trace = traceId ? ` Trace-Id: ${traceId}` : "";
    throw new Error(`MiniMax VLM API error (${code})${msg ? `: ${msg}` : ""}.${trace}`);
  }

  const content = pickString(json, "content").trim();
  if (!content) {
    const trace = traceId ? ` Trace-Id: ${traceId}` : "";
    throw new Error(`MiniMax VLM returned no content.${trace}`);
  }

  return content;
}
