---
summary: "CLI reference for `argent reset` (reset local state/config)"
read_when:
  - You want to wipe local state while keeping the CLI installed
  - You want a dry-run of what would be removed
title: "reset"
---

# `argent reset`

Reset local config/state (keeps the CLI installed).

```bash
argent reset
argent reset --dry-run
argent reset --scope config+creds+sessions --yes --non-interactive
```
