---
summary: "TinyFish — the recommended free default for ArgentOS web_search and web_fetch"
read_when:
  - You're setting up Argent for the first time and want web tools working in 30 seconds
  - You want web search results tuned for agent retrieval (rank-stable, structured)
  - You need to fetch JS-heavy pages or pages with anti-bot protection
  - You want a free web-tool option without credit-card sign-up
title: "tinyfish"
---

# TinyFish — Recommended Default for `web_search` + `web_fetch`

**TinyFish is the recommended default web-tools provider for ArgentOS.** It ships
REST APIs for web search and browser-based page fetch that are **free for every
account, no credits used**. Onboarding and the CLI wizard surface TinyFish first
because it's the fastest path to working web tools — zero credit-card setup,
zero quota wrangling.

Brave Search and Perplexity remain fully supported as alternatives for users
who already have those keys; Firecrawl remains supported as a `web_fetch`
fallback.

- Sign-up + API key: <https://agent.tinyfish.ai/api-keys>
- Docs: <https://docs.tinyfish.ai>
- Rate limits (free): Search = 30 req/min, Fetch = 150 URLs/min.

## Configuration

Set your API key once. Either of the following works:

```bash
# Environment variable (Gateway environment)
export TINYFISH_API_KEY=tf_...

# Or via argent configure
argent configure --section web
```

The configure wizard prompts for the TinyFish key during the web-tools step.

### Config file fields

```yaml
tools:
  web:
    search:
      provider: tinyfish # switch web_search to TinyFish
      tinyfish:
        apiKey: tf_... # optional; falls back to TINYFISH_API_KEY
        baseUrl: https://api.search.tinyfish.ai
        location: US # optional default country code
        language: en # optional default language code
    fetch:
      tinyfish:
        enabled: true # opt-in; default false
        apiKey: tf_... # optional; falls back to TINYFISH_API_KEY
        baseUrl: https://api.fetch.tinyfish.ai
        format: markdown # markdown | html | json
        timeoutSeconds: 150
```

## Using TinyFish for `web_search`

When `tools.web.search.provider=tinyfish`, every `web_search` call routes to
the TinyFish Search API. The agent uses the same `web_search` tool — no code
change required.

The response shape mirrors Brave: `query`, `provider`, `count`, `results[]` with
`title`, `url`, `description` (snippet), `siteName`, `position`. Additional
fields specific to TinyFish: `totalResults`, `page`.

> `freshness` is Brave-only. The tool rejects `freshness` when provider is
> `tinyfish` or `perplexity`.

## Using TinyFish for `web_fetch`

`web_fetch` defaults to argent's SSRF-guarded direct fetch (with Readability
extraction and an optional Firecrawl fallback). TinyFish is **opt-in**:

1. Set `tools.web.fetch.tinyfish.enabled=true` and provide an API key.
2. Callers pass `backend: "tinyfish"` to `web_fetch`:

```json
{
  "tool": "web_fetch",
  "arguments": {
    "url": "https://example.com/dynamic-spa",
    "backend": "tinyfish"
  }
}
```

When `backend` is omitted (or `"direct"`), behavior is unchanged: argent's
SSRF-guarded fetch runs, with Firecrawl fallback if configured. TinyFish is
only invoked when the caller explicitly requests it **and** TinyFish is enabled
in config.

### When to use the TinyFish fetch backend

- JavaScript-heavy SPAs that Readability can't extract from
- Sites that block direct fetches (Cloudflare, anti-bot challenges)
- Pages that need a real browser to render before extraction

## Using TinyFish Browser (low-level Playwright/CDP)

For tasks that need full browser automation — driving the page, executing JS,
clicking through anti-bot challenges, multi-step DOM interaction — argent
exposes the TinyFish **Browser API** as two first-class agent tools:

| Tool                     | Purpose                                               |
| ------------------------ | ----------------------------------------------------- |
| `tinyfish_browser_open`  | Create a remote browser session, return a CDP URL.    |
| `tinyfish_browser_close` | Acknowledge release (no-op; sessions auto-terminate). |

**When to reach for this vs the other web tools:**

- `web_search` — finding pages. (Free, no credits.)
- `web_fetch` — pulling one page's content. (Free; opt-in TinyFish backend for JS-heavy sites.)
- **`tinyfish_browser_open`** — when you need to **drive** a browser: click,
  type, wait for network idle, evaluate JS, deal with login flows or
  anti-bot. Argent does **not** wrap Playwright — it returns the `cdp_url`
  the agent (or a higher-level tool) connects to via
  `chromium.connect_over_cdp(cdp_url)`.
- TinyFish **Agent API** (`tinyfish_agent`, below) — when you want a
  natural-language goal ("scrape every product on this site"). The Browser
  API is the low-level escape hatch when the Agent API's abstraction isn't a
  fit.

### Schema

`tinyfish_browser_open`:

```json
{
  "url": "https://example.com", // optional initial URL
  "timeoutSeconds": 90 // optional HTTP timeout (10–600s)
}
```

Returns:

```json
{
  "provider": "tinyfish",
  "session_id": "br-a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "cdp_url": "wss://example.tinyfish.io/cdp",
  "base_url": "https://example.tinyfish.io",
  "initialUrl": "https://example.com",
  "expires_in_seconds": 3600,
  "tookMs": 12345,
  "note": "Sessions auto-terminate after 1 hour of inactivity…"
}
```

`tinyfish_browser_close`:

```json
{ "session_id": "br-a1b2c3d4-…" }
```

Returns an acknowledgement only — **the TinyFish Browser API has no explicit
close/delete endpoint.** Sessions auto-terminate after 1 hour of inactivity.
The close tool exists for symmetry with `_open` and so agents don't try to
make a non-existent API call.

### Example (Python, Playwright)

```python
from playwright.async_api import async_playwright

# Get cdp_url from tinyfish_browser_open tool call
cdp_url = "wss://example.tinyfish.io/cdp"

async with async_playwright() as p:
    browser = await p.chromium.connect_over_cdp(cdp_url)
    page = await browser.new_page()
    await page.goto("https://example.com")
    title = await page.title()
```

### Lifecycle

- Session startup: 10–30 seconds. The tool's default HTTP timeout is 90s.
- Idle timeout: 1 hour. No keep-alive needed — every CDP message resets it.
- No explicit close: stop using the `cdp_url` to release the session.

### Free tier vs paid

Browser is part of the **paid** Agent/Browser surface. Search and Fetch
remain free with no credits. When the free-tier wall is hit, the tool returns
`tinyfish_browser_paid_tier_required` with status 402 or 403. Upgrade at
<https://agent.tinyfish.ai>.

## Using the `tinyfish_agent` tool (natural-language browser automation)

The TinyFish Agent API runs a goal-driven browser-automation agent on real
websites. Unlike `web_search` (free) and `web_fetch` (free with optional
TinyFish backend), the **Agent API is a paid feature** — runs are billed
against your TinyFish account. The tool is **opt-in** and disabled by default.

### When to use it vs `web_search` / `web_fetch`

| Use                                                          | Reach for                           |
| ------------------------------------------------------------ | ----------------------------------- |
| "Find me articles about X"                                   | `web_search`                        |
| "Give me the content of this URL"                            | `web_fetch`                         |
| "Render this JS-heavy SPA and extract"                       | `web_fetch` with `backend=tinyfish` |
| "Log into X, navigate menus, extract Y"                      | `tinyfish_agent`                    |
| "Fill out this form, submit, return the confirmation number" | `tinyfish_agent`                    |
| Multi-step goal across pages with clicks                     | `tinyfish_agent`                    |

If a static fetch can answer the question, prefer `web_fetch`. Agent runs are
slower (seconds-to-minutes) and cost credits.

### Enabling

```yaml
tools:
  web:
    agent:
      enabled: true # required — off by default
      # apiKey: tf_... # optional; falls back to TINYFISH_API_KEY
      # baseUrl: https://agent.tinyfish.ai
      # browserProfile: lite # or "stealth"
      # maxSteps: 150 # hard cap on per-call max_steps (1-500)
      # timeoutSeconds: 300 # hard cap on per-call timeout (max 600)
      # capture:
      #   screenshots: true
      #   snapshots: false
```

The same `TINYFISH_API_KEY` used by Search + Fetch is reused. No second key.

### Tool schema

```json
{
  "tool": "tinyfish_agent",
  "arguments": {
    "goal": "Find the price of the cheapest non-stop flight from JFK to LAX on Friday and return it",
    "url": "https://www.google.com/travel/flights",
    "max_steps": 50,
    "browser_profile": "lite",
    "screenshots": true,
    "timeout_seconds": 180
  }
}
```

| Field             | Required | Notes                                                                     |
| ----------------- | -------- | ------------------------------------------------------------------------- |
| `goal`            | yes      | Plain-English description of what success looks like and what to return.  |
| `url`             | yes      | Starting URL. http/https only.                                            |
| `max_steps`       | no       | Caller cap (1-500). Clamped to `tools.web.agent.maxSteps`.                |
| `browser_profile` | no       | `lite` (default) or `stealth`.                                            |
| `screenshots`     | no       | Capture screenshots at key steps.                                         |
| `snapshots`       | no       | Capture DOM snapshots.                                                    |
| `recording`       | no       | Capture a screencast.                                                     |
| `webhook_url`     | no       | HTTPS-only lifecycle webhook.                                             |
| `timeout_seconds` | no       | Per-call timeout (max 600). Defaults to `tools.web.agent.timeoutSeconds`. |

### Return shape

On success the tool returns:

```json
{
  "provider": "tinyfish",
  "status": "COMPLETED",
  "success": true,
  "run_id": "run_abc123",
  "num_of_steps": 7,
  "started_at": "2026-05-13T00:00:00Z",
  "finished_at": "2026-05-13T00:01:00Z",
  "browser_profile": "lite",
  "max_steps": 50,
  "result": {
    /* extracted JSON from the agent */
  }
}
```

On failure, you get a structured error payload (one of `error: "tinyfish_agent_paid_feature"`,
`tinyfish_agent_auth_failed`, `tinyfish_agent_rate_limited`, `tinyfish_agent_timeout`,
or `tinyfish_agent_error`) plus the upstream `code`, `httpStatus`, and a `docs` link.

### Paid feature — what happens when you're out of credits

When the TinyFish account has no credits or an inactive subscription, the
agent run returns HTTP 403 with `code: INSUFFICIENT_CREDITS`. The tool maps
that to a clear `tinyfish_agent_paid_feature` error pointing at
<https://agent.tinyfish.ai/billing>, not a cryptic upstream response.

### Caveats

- Long-running. Synchronous runs can take seconds-to-minutes. The default
  300-second timeout matches typical site-automation patterns; raise it via
  `tools.web.agent.timeoutSeconds` (max 600s) if your goals routinely exceed
  that.
- No cache. Each run is a fresh agent invocation. Don't poll.
- The `result` field is whatever the agent extracted — it may contain
  untrusted page content. Treat it like any other tool output (don't
  exec/eval; pass through structured-output guards if your downstream
  pipeline expects a schema).

## Troubleshooting

| Error                                      | Fix                                                                                                                                  |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `missing_tinyfish_api_key`                 | Set `TINYFISH_API_KEY` or `tools.web.search.tinyfish.apiKey`.                                                                        |
| `web_fetch backend="tinyfish" is disabled` | Set `tools.web.fetch.tinyfish.enabled=true` in config.                                                                               |
| `TinyFish Search API error (401)`          | Key is missing or revoked. Regenerate at <https://agent.tinyfish.ai/api-keys>.                                                       |
| `TinyFish Fetch returned no content`       | Per-URL fetch failure (anti-bot, timeout, invalid_url). Try a different URL.                                                         |
| `tinyfish_agent_paid_feature`              | Account is out of TinyFish credits or inactive. Top up at <https://agent.tinyfish.ai/billing>, or disable `tools.web.agent.enabled`. |
| `tinyfish_agent_auth_failed`               | Agent API rejected the API key. Regenerate at <https://agent.tinyfish.ai/api-keys>.                                                  |
| `tinyfish_agent_rate_limited`              | Slow down — TinyFish Agent has per-minute rate limits.                                                                               |
| `tinyfish_agent_timeout`                   | Run exceeded `tools.web.agent.timeoutSeconds`. Raise the timeout (max 600s) or scope the goal more tightly.                          |
| `tinyfish_browser_paid_tier_required`      | Browser is paid. Upgrade at <https://agent.tinyfish.ai>.                                                                             |
| `tinyfish_browser_error` (4xx/5xx)         | Check status + detail in the tool result; transient TinyFish-side issue.                                                             |
| `tinyfish_browser_request_failed`          | Network/timeout error talking to TinyFish. Retry; bump `timeoutSeconds`.                                                             |
