# AOS HoLaCe Agent Harness

Run locally:

```sh
python -m pytest
aos-holace --json capabilities
aos-holace --json health
```

Live commands require `HOLACE_API_KEY` and `HOLACE_API_BASE_URL` from operator-controlled service keys. Local `HOLACE_*` environment variables are development fallback only.
