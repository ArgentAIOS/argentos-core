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

// Known API key prefixes — match the prefix + contiguous token chars
const PREFIX_PATTERNS = [
  /sk-[A-Za-z0-9_-]{10,}/g, // OpenAI / OpenRouter / Anthropic (sk-ant-*)
  /ghp_[A-Za-z0-9]{10,}/g, // GitHub PAT (classic)
  /github_pat_[A-Za-z0-9_]{10,}/g, // GitHub PAT (fine-grained)
  /xox[baprs]-[A-Za-z0-9-]{10,}/g, // Slack tokens
  /AIza[A-Za-z0-9_-]{30,}/g, // Google API keys
  /pplx-[A-Za-z0-9]{10,}/g, // Perplexity
  /fal_[A-Za-z0-9_-]{10,}/g, // Fal.ai
  /fc-[A-Za-z0-9]{10,}/g, // Firecrawl
  /bb_live_[A-Za-z0-9_-]{10,}/g, // BrowserBase
  /gAAAA[A-Za-z0-9_=-]{20,}/g, // Codex encrypted tokens
  /AKIA[A-Z0-9]{16}/g, // AWS Access Key ID
  /sk_live_[A-Za-z0-9]{10,}/g, // Stripe secret key (live)
  /sk_test_[A-Za-z0-9]{10,}/g, // Stripe secret key (test)
  /rk_live_[A-Za-z0-9]{10,}/g, // Stripe restricted key
  /SG\.[A-Za-z0-9_-]{10,}/g, // SendGrid API key
  /hf_[A-Za-z0-9]{10,}/g, // HuggingFace token
  /r8_[A-Za-z0-9]{10,}/g, // Replicate API token
  /npm_[A-Za-z0-9]{10,}/g, // npm access token
  /pypi-[A-Za-z0-9_-]{10,}/g, // PyPI API token
  /dop_v1_[A-Za-z0-9]{10,}/g, // DigitalOcean PAT
  /doo_v1_[A-Za-z0-9]{10,}/g, // DigitalOcean OAuth
  /am_[A-Za-z0-9_-]{10,}/g, // AgentMail API key
  /sk-ant-[A-Za-z0-9_-]{10,}/g, // Anthropic (explicit prefix)
  /sk-or-[A-Za-z0-9_-]{10,}/g, // OpenRouter
  /sk-cp-[A-Za-z0-9_-]{10,}/g, // MiniMax Coding Plan
  /sk-ant-oat01-[A-Za-z0-9_-]{10,}/g, // Anthropic setup token
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

function maskToken(token: string): string {
  if (token.length < 18) return "***";
  return `${token.slice(0, 6)}...${token.slice(-4)}`;
}

/**
 * Redact sensitive tokens, keys, credentials, and PII from a text string.
 *
 * Safe to call on any string — non-matching text passes through unchanged.
 * Returns the original string if null/undefined/empty.
 */
export function redactSensitiveText(text: string | null | undefined): string {
  if (text == null || text === "") return text ?? "";
  let result = text;

  // Known prefixes (sk-, ghp_, AKIA, etc.)
  for (const pattern of PREFIX_PATTERNS) {
    pattern.lastIndex = 0;
    result = result.replace(pattern, (match) => maskToken(match));
  }

  // ENV assignments: OPENAI_API_KEY=sk-abc...
  result = result.replace(ENV_ASSIGN_RE, (_match, name, quote, value) => {
    return `${name}=${quote}${maskToken(value)}${quote}`;
  });

  // JSON fields: "apiKey": "value"
  result = result.replace(JSON_FIELD_RE, (_match, key, value) => {
    return `${key}: "${maskToken(value)}"`;
  });

  // Authorization headers
  result = result.replace(AUTH_HEADER_RE, (_match, prefix, token) => {
    return `${prefix}${maskToken(token)}`;
  });

  // Telegram bot tokens
  result = result.replace(TELEGRAM_RE, (_match, prefix, digits) => {
    return `${prefix ?? ""}${digits}:***`;
  });

  // Private key blocks
  result = result.replace(PRIVATE_KEY_RE, "[REDACTED PRIVATE KEY]");

  // Database connection string passwords
  result = result.replace(DB_CONNSTR_RE, (_match, before, _password, after) => {
    return `${before}***${after}`;
  });

  return result;
}
