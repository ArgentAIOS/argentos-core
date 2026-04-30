# aos-wordpress agent harness

Python Click harness for WordPress with live REST calls through the AOS connector substrate.

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

The connector resolves `WORDPRESS_BASE_URL`, `WORDPRESS_USERNAME`, and `WORDPRESS_APPLICATION_PASSWORD` through operator-controlled service keys before falling back to local environment variables. Scoped service-key entries must be injected by the operator runtime and are not bypassed with local env.

Mutating commands are scoped to draft creation, draft updates, scheduling, explicit publish operations, local media uploads, and category/tag assignment. Production live-write smoke is not claimed until tested against an operator WordPress site.
