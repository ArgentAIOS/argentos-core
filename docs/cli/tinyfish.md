---
summary: "Use TinyFish as a free agent-tuned search and fetch backend for ArgentOS"
read_when:
  - You want web search results tuned for agent retrieval (rank-stable, structured)
  - You need to fetch JS-heavy pages or pages with anti-bot protection
  - You want a free web-tool option without credit-card sign-up
title: "tinyfish"
---

# TinyFish (`web_search` provider + `web_fetch` backend)

TinyFish ships REST APIs for web search and browser-based page fetch that are
**free for every account** (no credits used). ArgentOS integrates both as
**first-class, additive** options to the existing `web_search` and `web_fetch`
tools — alongside Brave / Perplexity (search) and Firecrawl (fetch).

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

## Out of scope (for now)

TinyFish's paid features — browser sessions and goal-based automation
(`agent.tinyfish.ai/v1/automation/...`) — are not yet wired in. If you need
those, see <https://docs.tinyfish.ai/agent-api>.

## Troubleshooting

| Error                                      | Fix                                                                            |
| ------------------------------------------ | ------------------------------------------------------------------------------ |
| `missing_tinyfish_api_key`                 | Set `TINYFISH_API_KEY` or `tools.web.search.tinyfish.apiKey`.                  |
| `web_fetch backend="tinyfish" is disabled` | Set `tools.web.fetch.tinyfish.enabled=true` in config.                         |
| `TinyFish Search API error (401)`          | Key is missing or revoked. Regenerate at <https://agent.tinyfish.ai/api-keys>. |
| `TinyFish Fetch returned no content`       | Per-URL fetch failure (anti-bot, timeout, invalid_url). Try a different URL.   |
