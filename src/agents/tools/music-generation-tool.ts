/**
 * Music Generation Tool
 *
 * Generates music from text descriptions.
 * Provider order defaults to: Replicate -> FAL -> MiniMax.
 * Returns MEDIA:{path} for dashboard rendering.
 */

import { Type } from "@sinclair/typebox";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ArgentConfig } from "../../config/config.js";
import type { AnyAgentTool } from "./common.js";
import { resolveMinimaxApiKey } from "../../agents/minimax-vlm.js";
import { resolveServiceKeyAsync } from "../../infra/service-keys.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import { readNumberParam, readStringParam } from "./common.js";

type MusicProvider = "replicate" | "fal" | "minimax";

const DEFAULT_REPLICATE_MODEL = "visoar/ace-step-1.5";
const DEFAULT_MINIMAX_MODELS = ["music-2.5", "music-2.0"];
const HTTP_TIMEOUT_MS = 20_000;
const DOWNLOAD_TIMEOUT_MS = 45_000;
const REPLICATE_MAX_WAIT_MS = 60_000;
const MINIMAX_MAX_WAIT_MS = 60_000;
const TOOL_TOTAL_TIMEOUT_MS = 45_000;
const REPLICATE_AUTO_RETRY_COUNT = 1;
const REPLICATE_AUTO_ATTEMPT_TIMEOUT_MS = 18_000;
const log = createSubsystemLogger("tools/music-generate");

const MusicGenSchema = Type.Object({
  lyrics: Type.Optional(
    Type.String({
      description:
        "Lyrics or text for the song. Used for vocal generation when supported by the provider.",
    }),
  ),
  prompt: Type.String({
    description:
      "Description of the music style, mood, genre, tempo, and instrumentation (e.g. 'upbeat lo-fi hip hop with piano and drums').",
  }),
  instrumental: Type.Optional(
    Type.Boolean({
      description: "If true, prefer instrumental music without vocals. Default false.",
    }),
  ),
  duration: Type.Optional(
    Type.Number({
      description: "Preferred duration in seconds (provider dependent).",
    }),
  ),
  provider: Type.Optional(
    Type.Union(
      [
        Type.Literal("auto"),
        Type.Literal("replicate"),
        Type.Literal("fal"),
        Type.Literal("minimax"),
      ],
      {
        description: 'Music provider: "auto" (default), "replicate", "fal", or "minimax".',
      },
    ),
  ),
  model: Type.Optional(
    Type.String({
      description: 'MiniMax model id override. Current model ids are "music-2.5" and "music-2.0".',
    }),
  ),
  replicate_model: Type.Optional(
    Type.String({
      description: `Replicate model slug as "owner/name". Defaults to "${DEFAULT_REPLICATE_MODEL}".`,
    }),
  ),
});

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit | undefined,
  timeoutMs: number,
  timeoutLabel: string,
): Promise<Response> {
  try {
    return await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    if (err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError")) {
      throw new Error(`${timeoutLabel}: request timed out after ${timeoutMs}ms`, { cause: err });
    }
    throw err;
  }
}

function normalizeMiniMaxModel(model: string): string {
  const normalized = model.trim().toLowerCase();
  if (normalized === "music-01-lyrics") {
    return "music-2.5";
  }
  if (normalized === "music-01-jingles") {
    return "music-2.0";
  }
  return normalized;
}

function extensionForContentType(contentType: string | null): string {
  if (!contentType) {
    return ".mp3";
  }
  if (contentType.includes("audio/wav") || contentType.includes("audio/wave")) {
    return ".wav";
  }
  if (contentType.includes("audio/flac")) {
    return ".flac";
  }
  if (contentType.includes("audio/ogg")) {
    return ".ogg";
  }
  return ".mp3";
}

async function downloadAudioToTemp(url: string, prefix: string): Promise<string> {
  const audioRes = await fetchWithTimeout(url, undefined, DOWNLOAD_TIMEOUT_MS, "DOWNLOAD_TIMEOUT");
  if (!audioRes.ok) {
    throw new Error(`Failed to download audio (${audioRes.status})`);
  }
  const ext = extensionForContentType(audioRes.headers.get("content-type"));
  const buf = Buffer.from(await audioRes.arrayBuffer());
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
  const filePath = path.join(dir, `${prefix}-${Date.now()}${ext}`);
  fs.writeFileSync(filePath, buf);
  return filePath;
}

function buildReplicatePrompt(params: {
  prompt: string;
  lyrics?: string;
  instrumental: boolean;
}): string {
  if (!params.lyrics?.trim()) {
    return params.prompt;
  }
  if (params.instrumental) {
    return `${params.prompt}\n\nNo vocals. Instrumental only.`;
  }
  return `${params.prompt}\n\nLyrics:\n${params.lyrics.trim()}`;
}

function extractReplicateAudioUrl(output: unknown): string | null {
  if (typeof output === "string" && /^https?:\/\//i.test(output)) {
    return output;
  }

  if (Array.isArray(output)) {
    for (const item of output) {
      if (typeof item === "string" && /^https?:\/\//i.test(item)) {
        return item;
      }
      if (item && typeof item === "object") {
        const url = (item as Record<string, unknown>)["url"];
        if (typeof url === "string" && /^https?:\/\//i.test(url)) {
          return url;
        }
      }
    }
  }

  if (output && typeof output === "object") {
    const obj = output as Record<string, unknown>;
    for (const key of ["url", "audio", "audio_url", "download_url"]) {
      const value = obj[key];
      if (typeof value === "string" && /^https?:\/\//i.test(value)) {
        return value;
      }
    }
    const nested = obj["audio_file"];
    if (nested && typeof nested === "object") {
      const url = (nested as Record<string, unknown>)["url"];
      if (typeof url === "string" && /^https?:\/\//i.test(url)) {
        return url;
      }
    }
  }

  return null;
}

async function generateReplicateMusic(params: {
  prompt: string;
  lyrics?: string;
  instrumental: boolean;
  duration?: number;
  model: string;
  apiKey: string;
  overallTimeoutMs?: number;
}): Promise<string> {
  const deadlineMs = Date.now() + Math.max(5_000, params.overallTimeoutMs ?? REPLICATE_MAX_WAIT_MS);
  const remainingMs = () => Math.max(1_000, deadlineMs - Date.now());
  const model = params.model.trim();
  const slash = model.indexOf("/");
  if (slash <= 0 || slash === model.length - 1) {
    throw new Error(`REPLICATE_MODEL_INVALID: model must be "owner/name", got "${model}"`);
  }
  const owner = model.slice(0, slash);
  const name = model.slice(slash + 1);
  const modelMetaRes = await fetchWithTimeout(
    `https://api.replicate.com/v1/models/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`,
    {
      headers: {
        Authorization: `Token ${params.apiKey}`,
      },
    },
    Math.min(HTTP_TIMEOUT_MS, remainingMs()),
    "REPLICATE_MODEL_TIMEOUT",
  );
  if (!modelMetaRes.ok) {
    const errText = await modelMetaRes.text();
    if (modelMetaRes.status === 401 || modelMetaRes.status === 403) {
      throw new Error(`REPLICATE_AUTH: ${errText}`);
    }
    throw new Error(`REPLICATE_MODEL_INVALID: ${errText}`);
  }
  const modelMeta = (await modelMetaRes.json()) as {
    latest_version?: { id?: string };
  };
  const versionId = modelMeta.latest_version?.id;
  if (!versionId) {
    throw new Error("REPLICATE_MODEL_INVALID: model has no latest_version id");
  }

  const commonPrompt = buildReplicatePrompt({
    prompt: params.prompt,
    lyrics: params.lyrics,
    instrumental: params.instrumental,
  });
  const durationValue =
    typeof params.duration === "number" && Number.isFinite(params.duration) && params.duration > 0
      ? Math.round(params.duration)
      : undefined;
  const lyricsValue = params.lyrics?.trim();

  const inputCandidates: Record<string, unknown>[] = [];
  const promptInput: Record<string, unknown> = { prompt: commonPrompt };
  if (durationValue) {
    promptInput["duration"] = durationValue;
  }
  inputCandidates.push(promptInput);

  const captionInput: Record<string, unknown> = { caption: params.prompt };
  if (durationValue) {
    captionInput["duration"] = durationValue;
  }
  if (lyricsValue) {
    captionInput["lyrics"] = lyricsValue;
  } else if (!params.instrumental) {
    captionInput["lyrics"] = commonPrompt;
  }
  inputCandidates.push(captionInput);

  let lastSubmitStatus = 0;
  let lastSubmitText = "unknown submit error";
  let prediction: {
    status?: string;
    error?: string;
    output?: unknown;
    urls?: { get?: string };
  } | null = null;

  for (const input of inputCandidates) {
    const submitRes = await fetchWithTimeout(
      "https://api.replicate.com/v1/predictions",
      {
        method: "POST",
        headers: {
          Authorization: `Token ${params.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ version: versionId, input }),
      },
      Math.min(HTTP_TIMEOUT_MS, remainingMs()),
      "REPLICATE_SUBMIT_TIMEOUT",
    );

    const errOrPayloadText = await submitRes.text();
    lastSubmitStatus = submitRes.status;
    lastSubmitText = errOrPayloadText;

    if (!submitRes.ok) {
      if (submitRes.status === 401 || submitRes.status === 403) {
        throw new Error(`REPLICATE_AUTH: ${errOrPayloadText}`);
      }
      if (
        submitRes.status === 404 ||
        /requested resource could not be found|model/i.test(errOrPayloadText)
      ) {
        throw new Error(`REPLICATE_MODEL_INVALID: ${errOrPayloadText}`);
      }
      // Try next candidate when this looks like input validation.
      if (
        submitRes.status === 422 ||
        /validation|input|required|unexpected/i.test(errOrPayloadText)
      ) {
        continue;
      }
      throw new Error(`REPLICATE_SUBMIT_FAILED: ${errOrPayloadText}`);
    }

    prediction = JSON.parse(errOrPayloadText) as {
      status?: string;
      error?: string;
      output?: unknown;
      urls?: { get?: string };
    };
    break;
  }

  if (!prediction) {
    throw new Error(`REPLICATE_SUBMIT_FAILED: ${lastSubmitStatus} ${lastSubmitText}`);
  }
  type ReplicatePrediction = {
    status?: string;
    error?: string;
    output?: unknown;
    urls?: { get?: string };
  };

  let polled = prediction as ReplicatePrediction;
  const maxWaitMs = Math.min(REPLICATE_MAX_WAIT_MS, Math.max(5_000, deadlineMs - Date.now()));
  const pollIntervalMs = 3_000;
  const started = Date.now();

  while (polled.status && !["succeeded", "failed", "canceled"].includes(polled.status)) {
    if (Date.now() - started > maxWaitMs) {
      throw new Error("REPLICATE_TIMEOUT: music generation timed out");
    }
    const pollUrl = polled.urls?.get;
    if (!pollUrl) {
      throw new Error("REPLICATE_FAILED: no prediction poll URL returned");
    }
    await sleep(pollIntervalMs);
    const pollRes = await fetchWithTimeout(
      pollUrl,
      {
        headers: { Authorization: `Token ${params.apiKey}` },
      },
      Math.min(HTTP_TIMEOUT_MS, remainingMs()),
      "REPLICATE_POLL_TIMEOUT",
    );
    if (!pollRes.ok) {
      const errText = await pollRes.text();
      throw new Error(`REPLICATE_POLL_FAILED: ${errText}`);
    }
    polled = (await pollRes.json()) as ReplicatePrediction;
  }

  if (polled.status !== "succeeded") {
    throw new Error(`REPLICATE_FAILED: ${polled.error ?? polled.status ?? "unknown error"}`);
  }

  const audioUrl = extractReplicateAudioUrl(polled.output);
  if (!audioUrl) {
    throw new Error("REPLICATE_FAILED: no audio URL in prediction output");
  }
  return downloadAudioToTemp(audioUrl, "music-replicate");
}

async function generateFalMusic(params: {
  prompt: string;
  duration?: number;
  apiKey: string;
  overallTimeoutMs?: number;
}): Promise<string> {
  const seconds = Math.max(1, Math.min(180, Math.round(params.duration ?? 10)));
  const timeoutMs = Math.min(
    DOWNLOAD_TIMEOUT_MS,
    Math.max(5_000, params.overallTimeoutMs ?? DOWNLOAD_TIMEOUT_MS),
  );
  const res = await fetchWithTimeout(
    "https://fal.run/fal-ai/stable-audio",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Key ${params.apiKey}`,
      },
      body: JSON.stringify({
        prompt: params.prompt,
        seconds_total: seconds,
      }),
    },
    timeoutMs,
    "FAL_TIMEOUT",
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`FAL_FAILED: ${errText}`);
  }

  const json = (await res.json()) as { audio_file?: { url?: string } };
  const audioUrl = json.audio_file?.url;
  if (!audioUrl) {
    throw new Error("FAL_FAILED: no audio URL returned");
  }
  return downloadAudioToTemp(audioUrl, "music-fal");
}

async function generateMiniMaxMusic(params: {
  prompt: string;
  lyrics?: string;
  instrumental: boolean;
  model: string;
  apiKey: string;
  overallTimeoutMs?: number;
}): Promise<string> {
  const deadlineMs = Date.now() + Math.max(5_000, params.overallTimeoutMs ?? MINIMAX_MAX_WAIT_MS);
  const remainingMs = () => Math.max(1_000, deadlineMs - Date.now());
  const normalizedModel = params.model.trim().toLowerCase();
  const lyricsRequired = normalizedModel === "music-2.5" || normalizedModel === "music-2.0";
  const effectiveLyrics =
    params.lyrics?.trim() || (lyricsRequired ? "Instrumental track. No vocals." : "");

  const body: Record<string, unknown> = {
    model: normalizedModel,
    prompt: params.prompt,
    instrumental: params.instrumental,
  };

  if (lyricsRequired || (!params.instrumental && effectiveLyrics)) {
    body.lyrics = effectiveLyrics;
  }

  const submitRes = await fetchWithTimeout(
    "https://api.minimax.io/v1/music_generation",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${params.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
    Math.min(HTTP_TIMEOUT_MS, remainingMs()),
    "MINIMAX_SUBMIT_TIMEOUT",
  );

  if (!submitRes.ok) {
    const errText = await submitRes.text();
    throw new Error(`MINIMAX_SUBMIT_FAILED: ${submitRes.status} ${errText}`);
  }

  const submitJson = (await submitRes.json()) as {
    task_id?: string;
    base_resp?: { status_code?: number; status_msg?: string };
  };

  if (submitJson.base_resp?.status_code && submitJson.base_resp.status_code !== 0) {
    const statusMsg = submitJson.base_resp.status_msg ?? "unknown error";
    if (/invalid model/i.test(statusMsg)) {
      throw new Error(`MODEL_INVALID: ${statusMsg}`);
    }
    if (/lyrics is required/i.test(statusMsg)) {
      throw new Error(`LYRICS_REQUIRED: ${statusMsg}`);
    }
    if (/insufficient balance|insufficient quota|no quota|insufficient credits/i.test(statusMsg)) {
      throw new Error(`INSUFFICIENT_BALANCE: ${statusMsg}`);
    }
    throw new Error(`MINIMAX_FAILED: ${statusMsg}`);
  }

  const taskId = submitJson.task_id;
  if (!taskId) {
    throw new Error("MINIMAX_FAILED: no task_id returned");
  }

  const maxWaitMs = Math.min(MINIMAX_MAX_WAIT_MS, Math.max(5_000, deadlineMs - Date.now()));
  const pollIntervalMs = 4_000;
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    await sleep(pollIntervalMs);

    let pollRes: Response;
    try {
      pollRes = await fetchWithTimeout(
        `https://api.minimax.io/v1/query/music_generation?task_id=${taskId}`,
        { headers: { Authorization: `Bearer ${params.apiKey}` } },
        Math.min(HTTP_TIMEOUT_MS, remainingMs()),
        "MINIMAX_POLL_TIMEOUT",
      );
    } catch {
      continue;
    }
    if (!pollRes.ok) {
      continue;
    }

    const pollJson = (await pollRes.json()) as {
      status?: string;
      download_url?: string;
      base_resp?: { status_code?: number; status_msg?: string };
    };

    if (pollJson.status === "Success") {
      const audioUrl = pollJson.download_url;
      if (!audioUrl) {
        throw new Error("MINIMAX_FAILED: no download URL");
      }
      return downloadAudioToTemp(audioUrl, "music-minimax");
    }

    if (pollJson.status === "Fail") {
      throw new Error(`MINIMAX_FAILED: ${pollJson.base_resp?.status_msg ?? "unknown error"}`);
    }
  }

  throw new Error("MINIMAX_TIMEOUT: music generation timed out");
}

function resolveProviderOrder(requested?: string): MusicProvider[] {
  const normalized = (requested ?? "auto").trim().toLowerCase();
  if (normalized === "replicate") {
    return ["replicate"];
  }
  if (normalized === "fal") {
    return ["fal"];
  }
  if (normalized === "minimax") {
    return ["minimax"];
  }
  return ["replicate", "fal", "minimax"];
}

function isRetryableReplicateError(message: string): boolean {
  const normalized = message.toLowerCase();
  if (
    normalized.startsWith("replicate_auth:") ||
    normalized.startsWith("replicate_model_invalid:")
  ) {
    return false;
  }
  return (
    normalized.includes("timeout") ||
    normalized.includes("timed out") ||
    normalized.includes("poll_failed") ||
    normalized.includes("network") ||
    normalized.includes("429") ||
    normalized.includes("502") ||
    normalized.includes("503") ||
    normalized.includes("504")
  );
}

export function createMusicGenerationTool(options?: {
  agentSessionKey?: string;
  config?: ArgentConfig;
}): AnyAgentTool {
  return {
    label: "Music Generation",
    name: "music_generate",
    description: `Generate original music from text descriptions.

Default provider order: Replicate -> FAL -> MiniMax.

Keys:
- REPLICATE_API_KEY (or REPLICATE_AI_KEY)
- FAL_API_KEY
- MINIMAX_API_KEY (plus MiniMax music entitlement/credits)

Returns a MEDIA: path. Copy the MEDIA line exactly into your response.`,
    parameters: MusicGenSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const prompt = readStringParam(params, "prompt", { required: true });
      const lyrics = readStringParam(params, "lyrics");
      const requestedProvider = readStringParam(params, "provider");
      const duration = readNumberParam(params, "duration");
      const instrumental = params["instrumental"] === true || params["instrumental"] === "true";
      const requestedMiniMaxModel = readStringParam(params, "model")?.trim();
      const requestedReplicateModel =
        readStringParam(params, "replicate_model")?.trim() || DEFAULT_REPLICATE_MODEL;

      const providerOrder = resolveProviderOrder(requestedProvider);
      const minimaxKey =
        (
          await resolveServiceKeyAsync("MINIMAX_CODE_PLAN_KEY", options?.config, {
            sessionKey: options?.agentSessionKey,
            source: "music_generate",
          })
        )?.trim() ||
        (
          await resolveServiceKeyAsync("MINIMAX_API_KEY", options?.config, {
            sessionKey: options?.agentSessionKey,
            source: "music_generate",
          })
        )?.trim() ||
        resolveMinimaxApiKey();
      const replicateKey =
        (
          await resolveServiceKeyAsync("REPLICATE_API_KEY", options?.config, {
            sessionKey: options?.agentSessionKey,
            source: "music_generate",
          })
        )?.trim() ||
        (
          await resolveServiceKeyAsync("REPLICATE_AI_KEY", options?.config, {
            sessionKey: options?.agentSessionKey,
            source: "music_generate",
          })
        )?.trim() ||
        (
          await resolveServiceKeyAsync("REPLICATE_API_TOKEN", options?.config, {
            sessionKey: options?.agentSessionKey,
            source: "music_generate",
          })
        )?.trim();
      const falKey = (
        await resolveServiceKeyAsync("FAL_API_KEY", options?.config, {
          sessionKey: options?.agentSessionKey,
          source: "music_generate",
        })
      )?.trim();

      const attemptErrors: string[] = [];
      const attemptTimeline: string[] = [];
      const providerTimingsMs: Record<MusicProvider, number> = {
        replicate: 0,
        fal: 0,
        minimax: 0,
      };
      let sawAnyKey = false;
      const deadlineMs = Date.now() + TOOL_TOTAL_TIMEOUT_MS;
      const remainingMs = () => Math.max(0, deadlineMs - Date.now());
      const normalizedRequestedProvider = (requestedProvider ?? "auto").trim().toLowerCase();
      log.info("music_generate start", {
        providerOrder,
        requestedProvider: normalizedRequestedProvider,
        instrumental,
        hasLyrics: Boolean(lyrics?.trim()),
        duration,
      });

      for (const provider of providerOrder) {
        const budgetMs = remainingMs();
        if (budgetMs < 3_000) {
          attemptErrors.push("global timeout budget exhausted");
          break;
        }
        if (provider === "replicate") {
          if (!replicateKey) {
            attemptErrors.push("replicate: missing REPLICATE_API_KEY");
            continue;
          }
          sawAnyKey = true;
          const autoMode = normalizedRequestedProvider === "auto";
          const maxAttempts = autoMode ? 1 + REPLICATE_AUTO_RETRY_COUNT : 1;
          let lastError = "unknown error";

          for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            const startedAt = Date.now();
            try {
              const perAttemptBudget = autoMode
                ? Math.min(
                    REPLICATE_AUTO_ATTEMPT_TIMEOUT_MS,
                    Math.max(5_000, Math.min(budgetMs, remainingMs())),
                  )
                : Math.max(5_000, Math.min(budgetMs, remainingMs()));
              const filePath = await generateReplicateMusic({
                prompt,
                lyrics,
                instrumental,
                duration: typeof duration === "number" ? duration : undefined,
                model: requestedReplicateModel,
                apiKey: replicateKey,
                overallTimeoutMs: perAttemptBudget,
              });
              const durationMs = Date.now() - startedAt;
              providerTimingsMs.replicate += durationMs;
              attemptTimeline.push(`replicate#${attempt}:ok:${durationMs}ms`);
              log.info("music_generate attempt", {
                provider: "replicate",
                attempt,
                status: "ok",
                durationMs,
              });
              return {
                content: [{ type: "text", text: `MEDIA:${filePath}` }],
                details: {
                  path: filePath,
                  provider: "replicate",
                  model: requestedReplicateModel,
                },
              };
            } catch (err) {
              const durationMs = Date.now() - startedAt;
              providerTimingsMs.replicate += durationMs;
              const msg = err instanceof Error ? err.message : String(err);
              lastError = msg;
              attemptTimeline.push(`replicate#${attempt}:fail:${durationMs}ms:${msg}`);
              log.warn("music_generate attempt", {
                provider: "replicate",
                attempt,
                status: "fail",
                durationMs,
                reason: msg,
              });
              const canRetry =
                attempt < maxAttempts && isRetryableReplicateError(msg) && remainingMs() > 3_000;
              if (canRetry) {
                continue;
              }
              break;
            }
          }

          attemptErrors.push(`replicate: ${lastError}`);
          continue;
        }

        if (provider === "fal") {
          if (!falKey) {
            attemptErrors.push("fal: missing FAL_API_KEY");
            continue;
          }
          sawAnyKey = true;
          const startedAt = Date.now();
          try {
            const filePath = await generateFalMusic({
              prompt,
              duration: typeof duration === "number" ? duration : undefined,
              apiKey: falKey,
              overallTimeoutMs: budgetMs,
            });
            const durationMs = Date.now() - startedAt;
            providerTimingsMs.fal += durationMs;
            attemptTimeline.push(`fal#1:ok:${durationMs}ms`);
            log.info("music_generate attempt", {
              provider: "fal",
              attempt: 1,
              status: "ok",
              durationMs,
            });
            return {
              content: [{ type: "text", text: `MEDIA:${filePath}` }],
              details: {
                path: filePath,
                provider: "fal",
              },
            };
          } catch (err) {
            const durationMs = Date.now() - startedAt;
            providerTimingsMs.fal += durationMs;
            const msg = err instanceof Error ? err.message : String(err);
            attemptTimeline.push(`fal#1:fail:${durationMs}ms:${msg}`);
            log.warn("music_generate attempt", {
              provider: "fal",
              attempt: 1,
              status: "fail",
              durationMs,
              reason: msg,
            });
            attemptErrors.push(`fal: ${msg}`);
            continue;
          }
        }

        if (!minimaxKey) {
          attemptErrors.push("minimax: missing MINIMAX_API_KEY");
          continue;
        }
        sawAnyKey = true;
        const minimaxModels = requestedMiniMaxModel
          ? Array.from(
              new Set([normalizeMiniMaxModel(requestedMiniMaxModel), ...DEFAULT_MINIMAX_MODELS]),
            )
          : DEFAULT_MINIMAX_MODELS;

        let minimaxLastError = "unknown error";
        let minimaxSucceeded = false;

        for (const model of minimaxModels) {
          const startedAt = Date.now();
          try {
            const filePath = await generateMiniMaxMusic({
              prompt,
              lyrics,
              instrumental,
              model,
              apiKey: minimaxKey,
              overallTimeoutMs: Math.min(budgetMs, remainingMs()),
            });
            const durationMs = Date.now() - startedAt;
            providerTimingsMs.minimax += durationMs;
            attemptTimeline.push(`minimax(${model})#1:ok:${durationMs}ms`);
            log.info("music_generate attempt", {
              provider: "minimax",
              model,
              attempt: 1,
              status: "ok",
              durationMs,
            });
            minimaxSucceeded = true;
            return {
              content: [{ type: "text", text: `MEDIA:${filePath}` }],
              details: {
                path: filePath,
                provider: "minimax",
                model,
              },
            };
          } catch (err) {
            const durationMs = Date.now() - startedAt;
            providerTimingsMs.minimax += durationMs;
            const msg = err instanceof Error ? err.message : String(err);
            attemptTimeline.push(`minimax(${model})#1:fail:${durationMs}ms:${msg}`);
            log.warn("music_generate attempt", {
              provider: "minimax",
              model,
              attempt: 1,
              status: "fail",
              durationMs,
              reason: msg,
            });
            minimaxLastError = msg;
            if (msg.startsWith("MODEL_INVALID:")) {
              continue;
            }
            if (msg.startsWith("INSUFFICIENT_BALANCE:")) {
              break;
            }
            if (msg.startsWith("LYRICS_REQUIRED:")) {
              break;
            }
            break;
          }
        }

        if (!minimaxSucceeded) {
          attemptErrors.push(`minimax: ${minimaxLastError}`);
        }
      }

      if (!sawAnyKey) {
        log.warn("music_generate no keys", { providerOrder });
        return {
          content: [
            {
              type: "text",
              text: "No music provider API keys found. Configure REPLICATE_API_KEY (or REPLICATE_AI_KEY), FAL_API_KEY, or MINIMAX_API_KEY.",
            },
          ],
          details: { error: "no_music_provider_keys", attempted: attemptErrors },
        };
      }

      const timingSummary =
        attemptTimeline.length > 0 ? ` Attempts: ${attemptTimeline.join(" | ")}` : "";
      log.warn("music_generate failed_all", {
        providerOrder,
        attemptErrors,
        attemptTimeline,
        providerTimingsMs,
      });
      return {
        content: [
          {
            type: "text",
            text: `Music generation failed across providers (${providerOrder.join(" -> ")}). ${attemptErrors.join(
              " | ",
            )}.${timingSummary}`,
          },
        ],
        details: {
          error: "music_generation_failed_all_providers",
          attempted: attemptErrors,
          attemptTimeline,
          providerTimingsMs,
          providerOrder,
        },
      };
    },
  };
}
