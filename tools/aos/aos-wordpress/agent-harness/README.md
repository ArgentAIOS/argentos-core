# aos-wordpress agent harness

Python Click harness for WordPress with live REST calls.

## Install

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -e '.[dev]'
aos-wordpress --json capabilities
aos-wordpress --json health
aos-wordpress --json config show
aos-wordpress --json doctor
```

## Notes

The connector uses WordPress Application Password auth and keeps mutating commands scoped to draft creation, draft updates, scheduling, and explicit publish operations.
