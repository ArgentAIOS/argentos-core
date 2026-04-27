# AOS PayPunch Agent Harness

Run locally:

```sh
python -m pytest
aos-paypunch --json capabilities
aos-paypunch --json health
```

Live commands require `PAYPUNCH_API_KEY` and `PAYPUNCH_API_BASE_URL` from operator-controlled service keys. Local `PAYPUNCH_*` environment variables are development fallback only.
