# aos-cognee agent harness

Python Click CLI wrapper around Cognee for ArgentOS agents.

```bash
python3 -m venv .venv
. .venv/bin/activate
pip install -e ".[dev]"
aos-cognee --json health
```

The harness emits the standard AOS JSON envelope:

```json
{
  "ok": true,
  "tool": "aos-cognee",
  "command": "search",
  "data": {},
  "meta": {}
}
```
