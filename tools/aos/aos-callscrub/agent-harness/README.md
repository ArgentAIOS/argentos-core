# AOS CallScrub Agent Harness

Run locally:

```sh
python -m pytest
aos-callscrub --json capabilities
aos-callscrub --json health
```

Live commands require `CALLSCRUB_API_KEY` and `CALLSCRUB_API_BASE_URL` from operator-controlled service keys. Local `CALLSCRUB_*` environment variables are development fallback only.
