---
name: argentos-blogwatcher
description: Monitor blogs and RSS/Atom feeds for updates using the
  blogwatcher-cli tool. Add blogs, scan for new articles, track read status, and
  filter by category.
version: 2.0.0
author: JulienTant (fork of Hyaxia/blogwatcher)
license: MIT
metadata:
  argent:
    tags:
      - RSS
      - Blogs
      - Feed-Reader
      - Monitoring
    homepage: https://github.com/JulienTant/blogwatcher-cli
  imported_from:
    original_name: blogwatcher
    source: upstream skill profile
prerequisites:
  commands:
    - blogwatcher-cli
---

# Blogwatcher

Track blog and RSS/Atom feed updates with the `blogwatcher-cli` tool. Supports automatic feed discovery, HTML scraping fallback, OPML import, and read/unread article management.

## Installation

Pick one method:

- **Go:** `go install github.com/JulienTant/blogwatcher-cli/cmd/blogwatcher-cli@latest`
- **Docker:** `docker run --rm -v blogwatcher-cli:/data ghcr.io/julientant/blogwatcher-cli`
- **Binary (Linux amd64):** `curl -sL https://github.com/JulienTant/blogwatcher-cli/releases/latest/download/blogwatcher-cli_linux_amd64.tar.gz | tar xz -C /usr/local/bin blogwatcher-cli`
- **Binary (Linux arm64):** `curl -sL https://github.com/JulienTant/blogwatcher-cli/releases/latest/download/blogwatcher-cli_linux_arm64.tar.gz | tar xz -C /usr/local/bin blogwatcher-cli`
- **Binary (macOS Apple Silicon):** `curl -sL https://github.com/JulienTant/blogwatcher-cli/releases/latest/download/blogwatcher-cli_darwin_arm64.tar.gz | tar xz -C /usr/local/bin blogwatcher-cli`
- **Binary (macOS Intel):** `curl -sL https://github.com/JulienTant/blogwatcher-cli/releases/latest/download/blogwatcher-cli_darwin_amd64.tar.gz | tar xz -C /usr/local/bin blogwatcher-cli`

All releases: https://github.com/JulienTant/blogwatcher-cli/releases

### Docker with persistent storage

By default the database lives at `~/.blogwatcher-cli/blogwatcher-cli.db`. In Docker this is lost on container restart. Use `BLOGWATCHER_DB` or a volume mount to persist it:

```bash
# Named volume (simplest)
docker run --rm -v blogwatcher-cli:/data -e BLOGWATCHER_DB=/data/blogwatcher-cli.db ghcr.io/julientant/blogwatcher-cli scan

# Host bind mount
docker run --rm -v /path/on/host:/data -e BLOGWATCHER_DB=/data/blogwatcher-cli.db ghcr.io/julientant/blogwatcher-cli scan
```

### Migrating from the original blogwatcher

If upgrading from `Hyaxia/blogwatcher`, move your database:

```bash
mv ~/.blogwatcher/blogwatcher.db ~/.blogwatcher-cli/blogwatcher-cli.db
```

The binary name changed from `blogwatcher` to `blogwatcher-cli`.

## Common Commands

### Managing blogs

- Add a blog: `blogwatcher-cli add "My Blog" https://example.com`
- Add with explicit feed: `blogwatcher-cli add "My Blog" https://example.com --feed-url https://example.com/feed.xml`
- Add with HTML scraping: `blogwatcher-cli add "My Blog" https://example.com --scrape-selector "article h2 a"`
- List tracked blogs: `blogwatcher-cli blogs`
- Remove a blog: `blogwatcher-cli remove "My Blog" --yes`
- Import from OPML: `blogwatcher-cli import subscriptions.opml`

### Scanning and reading

- Scan all blogs: `blogwatcher-cli scan`
- Scan one blog: `blogwatcher-cli scan "My Blog"`
- List unread articles: `blogwatcher-cli articles`
- List all articles: `blogwatcher-cli articles --all`
- Filter by blog: `blogwatcher-cli articles --blog "My Blog"`
- Filter by category: `blogwatcher-cli articles --category "Engineering"`
- Mark article read: `blogwatcher-cli read 1`
- Mark article unread: `blogwatcher-cli unread 1`
- Mark all read: `blogwatcher-cli read-all`
- Mark all read for a blog: `blogwatcher-cli read-all --blog "My Blog" --yes`

## Environment Variables

All flags can be set via environment variables with the `BLOGWATCHER_` prefix:

| Variable               | Description                                    |
| ---------------------- | ---------------------------------------------- |
| `BLOGWATCHER_DB`       | Path to SQLite database file                   |
| `BLOGWATCHER_WORKERS`  | Number of concurrent scan workers (default: 8) |
| `BLOGWATCHER_SILENT`   | Only output "scan done" when scanning          |
| `BLOGWATCHER_YES`      | Skip confirmation prompts                      |
| `BLOGWATCHER_CATEGORY` | Default filter for articles by category        |

## Example Output

```
$ blogwatcher-cli blogs
Tracked blogs (1):

  xkcd
    URL: https://xkcd.com
    Feed: https://xkcd.com/atom.xml
    Last scanned: 2026-04-03 10:30
```

```
$ blogwatcher-cli scan
Scanning 1 blog(s)...

  xkcd
    Source: RSS | Found: 4 | New: 4

Found 4 new article(s) total!
```

```
$ blogwatcher-cli articles
Unread articles (2):

  [1] [new] Barrel - Part 13
       Blog: xkcd
       URL: https://xkcd.com/3095/
       Published: 2026-04-02
       Categories: Comics, Science

  [2] [new] Volcano Fact
       Blog: xkcd
       URL: https://xkcd.com/3094/
       Published: 2026-04-01
       Categories: Comics
```

## Python RSS Fallback + Cron Watcher

Use this when `blogwatcher-cli` is not installed, when the site blocks browser access with Cloudflare, or when you need a self-contained scheduled digest. Medium author pages may show a bot challenge in the browser, but their RSS feed is often still accessible at:

```text
https://medium.com/feed/@USERNAME
```

Pattern:

1. Fetch the feed directly with `urllib.request` and a normal User-Agent.
2. Parse RSS with `xml.etree.ElementTree`.
3. For Medium full text, read `content:encoded` (`http://purl.org/rss/1.0/modules/content/`).
4. Strip HTML to cleaned text.
5. Store seen GUIDs in a state file under `~/.hermes/state/`.
6. Put the script in `~/.hermes/scripts/` and schedule it with `cronjob`; cron `script` paths must be relative to `~/.hermes/scripts/`, not absolute paths.

Minimal script shape:

```python
#!/usr/bin/env python3
import html, json, re, urllib.request, xml.etree.ElementTree as ET
from pathlib import Path

FEED_URL = "https://medium.com/feed/@USERNAME"
STATE_PATH = Path.home() / ".hermes" / "state" / "medium_seen.json"

def clean(raw):
    raw = re.sub(r"</(p|h\\d|li|blockquote)>", "\n", raw or "", flags=re.I)
    raw = re.sub(r"<br\\s*/?>", "\n", raw, flags=re.I)
    txt = re.sub(r"<[^>]+>", " ", raw)
    txt = html.unescape(txt)
    txt = re.sub(r"\n\s*\n+", "\n", txt)
    txt = re.sub(r"[ \\t]+", " ", txt)
    return txt.strip()

req = urllib.request.Request(FEED_URL, headers={"User-Agent": "Mozilla/5.0"})
root = ET.fromstring(urllib.request.urlopen(req, timeout=30).read())
ns = {"content": "http://purl.org/rss/1.0/modules/content/"}
items = []
for item in root.find("channel").findall("item"):
    encoded = item.find("content:encoded", ns)
    content = clean(encoded.text if encoded is not None else "")
    guid = item.findtext("guid") or item.findtext("link") or item.findtext("title")
    items.append({
        "guid": guid,
        "title": item.findtext("title") or "Untitled",
        "link": item.findtext("link") or "",
        "published": item.findtext("pubDate") or "",
        "content": content,
        "word_count": len(content.split()),
    })

STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
seen = set()
if STATE_PATH.exists():
    seen = set(json.loads(STATE_PATH.read_text()).get("seen", []))
new_items = [i for i in items if i["guid"] not in seen]
STATE_PATH.write_text(json.dumps({"feed_url": FEED_URL, "seen": sorted(seen | {i["guid"] for i in items})}, indent=2))

print(f"Total articles in feed: {len(items)}")
print(f"New articles since last run: {len(new_items)}")
for article in new_items:
    print("\n" + "=" * 80)
    print(article["title"])
    print(article["link"])
    print(article["published"])
    print(article["content"])
```

Schedule it:

```python
cronjob(action="create",
  name="Follow Medium feed",
  schedule="every 24h",
  script="medium_seen.py",  # relative to ~/.hermes/scripts/
  prompt="The pre-run script prints any new articles. If none, say so exactly. If new articles exist, read them fully and produce a digest with summary, key claims, implications, critique, and follow-up questions.",
  deliver="origin",
  enabled_toolsets=["web"])
```

## Notes

- Auto-discovers RSS/Atom feeds from blog homepages when no `--feed-url` is provided.
- Falls back to HTML scraping if RSS fails and `--scrape-selector` is configured.
- Categories from RSS/Atom feeds are stored and can be used to filter articles.
- Import blogs in bulk from OPML files exported by Feedly, Inoreader, NewsBlur, etc.
- Database stored at `~/.blogwatcher-cli/blogwatcher-cli.db` by default (override with `--db` or `BLOGWATCHER_DB`).
- Use `blogwatcher-cli <command> --help` to discover all flags and options.
