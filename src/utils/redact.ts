/**
 * Regex-based secret redaction for tool output, logs, and agent responses.
 *
 * Ported from Hermes Agent (agent/redact.py) — adapted for TypeScript.
 *
 * Applies pattern matching to mask API keys, tokens, credentials, and PII
 * before they reach memory, chat history, or log files.
 *
 * Short tokens (< 18 chars) are fully masked as "***".
 * Longer tokens preserve the first 6 and last 4 characters for debuggability.
 */

type RedactionPattern = {
  name: string;
  regex: RegExp;
};

// Known API key prefixes — match the prefix + contiguous token chars
const PREFIX_PATTERNS: RedactionPattern[] = [
  { name: "openai_like_key", regex: /sk-[A-Za-z0-9_-]{10,}/g }, // OpenAI / OpenRouter / Anthropic
  { name: "github_pat_classic", regex: /ghp_[A-Za-z0-9]{10,}/g },
  { name: "github_pat_fine_grained", regex: /github_pat_[A-Za-z0-9_]{10,}/g },
  { name: "slack_token", regex: /xox[baprs]-[A-Za-z0-9-]{10,}/g },
  { name: "google_api_key", regex: /AIza[A-Za-z0-9_-]{30,}/g },
  { name: "perplexity_key", regex: /pplx-[A-Za-z0-9]{10,}/g },
  { name: "fal_key", regex: /fal_[A-Za-z0-9_-]{10,}/g },
  { name: "firecrawl_key", regex: /fc-[A-Za-z0-9]{10,}/g },
  { name: "browserbase_key", regex: /bb_live_[A-Za-z0-9_-]{10,}/g },
  { name: "codex_encrypted_token", regex: /gAAAA[A-Za-z0-9_=-]{20,}/g },
  { name: "aws_access_key", regex: /AKIA[A-Z0-9]{16}/g },
  { name: "stripe_live_key", regex: /sk_live_[A-Za-z0-9]{10,}/g },
  { name: "stripe_test_key", regex: /sk_test_[A-Za-z0-9]{10,}/g },
  { name: "stripe_restricted_key", regex: /rk_live_[A-Za-z0-9]{10,}/g },
  { name: "sendgrid_key", regex: /SG\.[A-Za-z0-9_-]{10,}/g },
  { name: "huggingface_token", regex: /hf_[A-Za-z0-9]{10,}/g },
  { name: "replicate_token", regex: /r8_[A-Za-z0-9]{10,}/g },
  { name: "npm_token", regex: /npm_[A-Za-z0-9]{10,}/g },
  { name: "pypi_token", regex: /pypi-[A-Za-z0-9_-]{10,}/g },
  { name: "digitalocean_pat", regex: /dop_v1_[A-Za-z0-9]{10,}/g },
  { name: "digitalocean_oauth", regex: /doo_v1_[A-Za-z0-9]{10,}/g },
  { name: "agentmail_key", regex: /am_[A-Za-z0-9_-]{10,}/g },
  { name: "anthropic_key", regex: /sk-ant-[A-Za-z0-9_-]{10,}/g },
  { name: "openrouter_key", regex: /sk-or-[A-Za-z0-9_-]{10,}/g },
  { name: "minimax_plan_key", regex: /sk-cp-[A-Za-z0-9_-]{10,}/g },
  { name: "anthropic_setup_token", regex: /sk-ant-oat01-[A-Za-z0-9_-]{10,}/g },
];

// ENV assignment patterns: KEY=value where KEY contains a secret-like name
const ENV_ASSIGN_RE =
  /([A-Z_]*(?:API_?KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTH)[A-Z_]*)\s*=\s*(['"]?)(\S+)\2/gi;

// JSON field patterns: "apiKey": "value", "token": "value", etc.
const JSON_FIELD_RE =
  /("(?:api_?[Kk]ey|token|secret|password|access_token|refresh_token|auth_token|bearer|secret_value|raw_secret|secret_input|key_material)")\s*:\s*"([^"]+)"/gi;

// Authorization headers
const AUTH_HEADER_RE = /(Authorization:\s*Bearer\s+)(\S+)/gi;

// Telegram bot tokens: bot<digits>:<token> or <digits>:<token>
const TELEGRAM_RE = /(bot)?(\d{8,}):([-A-Za-z0-9_]{30,})/g;

// Private key blocks
const PRIVATE_KEY_RE = /-----BEGIN[A-Z ]*PRIVATE KEY-----[\s\S]*?-----END[A-Z ]*PRIVATE KEY-----/g;

// Database connection strings: protocol://user:PASSWORD@host
const DB_CONNSTR_RE =
  /((?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/[^:]+:)([^@]+)(@)/gi;

export type SensitiveRedactionReport = {
  text: string;
  redacted: boolean;
  redactionCount: number;
  categories: string[];
};

function maskToken(token: string): string {
  if (token.length < 18) {
    return "***";
  }
  return `${token.slice(0, 6)}...${token.slice(-4)}`;
}

function markCategory(counts: Map<string, number>, name: string) {
  counts.set(name, (counts.get(name) ?? 0) + 1);
}

function replaceWithTracking(
  input: string,
  pattern: RegExp,
  category: string,
  counts: Map<string, number>,
  replacer: (...args: unknown[]) => string,
): string {
  pattern.lastIndex = 0;
  return input.replace(pattern, (...args: unknown[]) => {
    markCategory(counts, category);
    return replacer(...args);
  });
}

export function redactSensitiveTextWithReport(
  text: string | null | undefined,
): SensitiveRedactionReport {
  if (text == null || text === "") {
    return {
      text: text ?? "",
      redacted: false,
      redactionCount: 0,
      categories: [],
    };
  }
  let result = text;
  const counts = new Map<string, number>();

  for (const pattern of PREFIX_PATTERNS) {
    result = replaceWithTracking(result, pattern.regex, pattern.name, counts, (match) =>
      maskToken(String(match)),
    );
  }

  result = replaceWithTracking(
    result,
    ENV_ASSIGN_RE,
    "env_assignment",
    counts,
    (_match, name, quote, value) =>
      `${String(name)}=${String(quote)}${maskToken(String(value))}${String(quote)}`,
  );

  result = replaceWithTracking(
    result,
    JSON_FIELD_RE,
    "json_secret_field",
    counts,
    (_match, key, value) => `${String(key)}: "${maskToken(String(value))}"`,
  );

  result = replaceWithTracking(
    result,
    AUTH_HEADER_RE,
    "auth_header",
    counts,
    (_match, prefix, token) => `${String(prefix)}${maskToken(String(token))}`,
  );

  result = replaceWithTracking(
    result,
    TELEGRAM_RE,
    "telegram_bot_token",
    counts,
    (_match, prefix, digits) => `${typeof prefix === "string" ? prefix : ""}${String(digits)}:***`,
  );

  result = replaceWithTracking(
    result,
    PRIVATE_KEY_RE,
    "private_key_block",
    counts,
    () => "[REDACTED PRIVATE KEY]",
  );

  result = replaceWithTracking(
    result,
    DB_CONNSTR_RE,
    "database_connection_string",
    counts,
    (_match, before, _password, after) => `${String(before)}***${String(after)}`,
  );

  return {
    text: result,
    redacted: counts.size > 0,
    redactionCount: Array.from(counts.values()).reduce((sum, count) => sum + count, 0),
    categories: Array.from(counts.keys()),
  };
}

/**
 * Redact sensitive tokens, keys, credentials, and PII from a text string.
 *
 * Safe to call on any string — non-matching text passes through unchanged.
 * Returns the original string if null/undefined/empty.
 */
export function redactSensitiveText(text: string | null | undefined): string {
  return redactSensitiveTextWithReport(text).text;
}
