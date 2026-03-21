#!/usr/bin/env -S node --import tsx

type ProbeCategory =
  | "ok"
  | "overloaded"
  | "rate_limit"
  | "auth"
  | "timeout"
  | "server_error"
  | "other";

type ProbeResult = {
  attempt: number;
  durationMs: number;
  httpStatus?: number;
  category: ProbeCategory;
  errorType?: string;
  errorCode?: string;
  errorMessage?: string;
};

function parseFlag(name: string): string | undefined {
  const prefix = `--${name}=`;
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith(prefix)) {
      return arg.slice(prefix.length).trim();
    }
  }
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === `--${name}`) {
      return args[i + 1]?.trim();
    }
  }
  return undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.slice(2).includes(`--${name}`);
}

function toInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, parsed));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function classifyFailure(params: {
  status?: number;
  errorType?: string;
  errorCode?: string;
  errorMessage?: string;
}): ProbeCategory {
  const status = params.status;
  const blob = `${params.errorType ?? ""} ${params.errorCode ?? ""} ${params.errorMessage ?? ""}`
    .trim()
    .toLowerCase();
  if (status === 401 || status === 403 || /\bauth|api key|unauthorized|forbidden\b/i.test(blob)) {
    return "auth";
  }
  if (status === 429 || /\brate.?limit|too many requests|quota|exhausted\b/i.test(blob)) {
    return "rate_limit";
  }
  if (
    /\boverloaded|overloaded_error|capacity|service unavailable|unavailable|model.*decommissioned\b/i.test(
      blob,
    )
  ) {
    return "overloaded";
  }
  if (typeof status === "number" && status >= 500) {
    return "server_error";
  }
  return "other";
}

function printUsage(): void {
  console.log(`Groq external overload probe

Usage:
  node --import tsx scripts/groq-overload-probe.ts [options]

Options:
  --model <id>          Model id (default: deepseek-r1-distill-llama-70b)
  --attempts <n>        Number of requests (default: 20)
  --interval-ms <ms>    Delay between attempts (default: 500)
  --timeout-ms <ms>     Per-request timeout (default: 20000)
  --max-tokens <n>      Max tokens per call (default: 32)
  --api-key <key>       Groq API key (or use GROQ_API_KEY / GROQ_LLAMA_API_KEY)
  --json                Print machine-readable JSON summary
  --help                Show this help
`);
}

async function main(): Promise<void> {
  if (hasFlag("help") || hasFlag("h")) {
    printUsage();
    return;
  }

  const apiKey = parseFlag("api-key") || process.env.GROQ_API_KEY || process.env.GROQ_LLAMA_API_KEY;
  if (!apiKey) {
    console.error(
      "Missing Groq API key. Set GROQ_API_KEY (or GROQ_LLAMA_API_KEY) or pass --api-key.",
    );
    process.exitCode = 2;
    return;
  }

  const model = parseFlag("model") || "deepseek-r1-distill-llama-70b";
  const attempts = toInt(parseFlag("attempts"), 20, 1, 500);
  const intervalMs = toInt(parseFlag("interval-ms"), 500, 0, 60_000);
  const timeoutMs = toInt(parseFlag("timeout-ms"), 20_000, 500, 120_000);
  const maxTokens = toInt(parseFlag("max-tokens"), 32, 1, 4_096);
  const asJson = hasFlag("json");

  const endpoint = "https://api.groq.com/openai/v1/chat/completions";
  const prompt = "Reply with exactly the word: pong";
  const results: ProbeResult[] = [];
  const startedAt = Date.now();

  for (let i = 1; i <= attempts; i += 1) {
    const requestStart = Date.now();
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), timeoutMs);

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: prompt }],
          temperature: 0,
          max_tokens: maxTokens,
        }),
        signal: abort.signal,
      });
      clearTimeout(timeout);
      const durationMs = Date.now() - requestStart;
      const text = await response.text();
      let payload: Record<string, unknown> | undefined;
      try {
        payload = JSON.parse(text) as Record<string, unknown>;
      } catch {
        payload = undefined;
      }

      if (response.ok) {
        results.push({
          attempt: i,
          durationMs,
          httpStatus: response.status,
          category: "ok",
        });
        if (!asJson) {
          console.log(`#${i} OK ${response.status} ${durationMs}ms`);
        }
      } else {
        const errorObj =
          payload && typeof payload.error === "object" && payload.error
            ? (payload.error as Record<string, unknown>)
            : undefined;
        const errorType =
          typeof errorObj?.type === "string"
            ? errorObj.type
            : typeof payload?.type === "string"
              ? payload.type
              : undefined;
        const errorCode = typeof errorObj?.code === "string" ? errorObj.code : undefined;
        const errorMessage =
          typeof errorObj?.message === "string"
            ? errorObj.message
            : typeof payload?.message === "string"
              ? payload.message
              : text.slice(0, 300);
        const category = classifyFailure({
          status: response.status,
          errorType,
          errorCode,
          errorMessage,
        });
        const result: ProbeResult = {
          attempt: i,
          durationMs,
          httpStatus: response.status,
          category,
          errorType,
          errorCode,
          errorMessage,
        };
        results.push(result);
        if (!asJson) {
          console.log(
            `#${i} ${category.toUpperCase()} ${response.status} ${durationMs}ms type=${errorType ?? "-"} code=${errorCode ?? "-"} msg=${(errorMessage ?? "").slice(0, 120)}`,
          );
        }
      }
    } catch (error) {
      clearTimeout(timeout);
      const durationMs = Date.now() - requestStart;
      const message = error instanceof Error ? error.message : String(error);
      const isTimeout =
        error instanceof Error &&
        (error.name === "AbortError" || /abort|timed out|timeout/i.test(message));
      const result: ProbeResult = {
        attempt: i,
        durationMs,
        category: isTimeout ? "timeout" : "other",
        errorMessage: message,
      };
      results.push(result);
      if (!asJson) {
        console.log(
          `#${i} ${(isTimeout ? "TIMEOUT" : "OTHER").toUpperCase()} - ${durationMs}ms msg=${message.slice(0, 120)}`,
        );
      }
    }

    if (i < attempts && intervalMs > 0) {
      await sleep(intervalMs);
    }
  }

  const durationMs = Date.now() - startedAt;
  const counts: Record<ProbeCategory, number> = {
    ok: 0,
    overloaded: 0,
    rate_limit: 0,
    auth: 0,
    timeout: 0,
    server_error: 0,
    other: 0,
  };
  for (const entry of results) {
    counts[entry.category] += 1;
  }

  const summary = {
    provider: "groq",
    model,
    attempts,
    intervalMs,
    timeoutMs,
    maxTokens,
    durationMs,
    counts,
    okRate: Number(((counts.ok / Math.max(1, attempts)) * 100).toFixed(1)),
    results,
  };

  if (asJson) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }
  console.log("\nSummary");
  console.log(
    `attempts=${attempts} ok=${counts.ok} overloaded=${counts.overloaded} rate_limit=${counts.rate_limit} auth=${counts.auth} timeout=${counts.timeout} server_error=${counts.server_error} other=${counts.other} okRate=${summary.okRate}% totalMs=${durationMs}`,
  );
}

void main();
