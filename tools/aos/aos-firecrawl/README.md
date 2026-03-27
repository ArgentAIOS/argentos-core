# aos-firecrawl

Agent-native Firecrawl connector for web scraping and extraction.

This connector is intentionally minimal for the ArgentOS demo path:

- `capabilities`
- `health`
- `doctor`
- `config show`
- `scrape`

It prefers the local Argent dashboard proxy on `http://127.0.0.1:9242/api/proxy/fetch/firecrawl`
so it can use `FIRECRAWL_API_KEY` from ArgentOS Service Keys. It falls back to direct Firecrawl
API access when `FIRECRAWL_API_KEY` is present in the process environment.
