# aos-google

`aos-google` is an agent-native Google Workspace CLI wrapper.

- Backend: `gws` (`googleworkspace/cli`)
- Interface: stable `aos-*` contract
- Security: permission-gated operations by `--mode`
- Output: structured JSON envelopes

## Required Dependency

`aos-google` requires upstream Google Workspace CLI (`gws`).

- Upstream repo: <https://github.com/googleworkspace/cli>
- Install: `npm install -g @googleworkspace/cli`

## Packaging / Preflight

Use the preflight script during installer/bootstrap to ensure runtime dependencies exist.

```bash
python3 aos-google/installer/preflight_gws.py --json
python3 aos-google/installer/preflight_gws.py --install-missing --require-auth --json
```

If `--install-missing` is enabled, the script installs upstream `gws` via npm:

```bash
npm install -g @googleworkspace/cli
```

Recommended installer gate:

- Run preflight with `--install-missing --require-auth`
- Abort install on non-zero exit code
- Surface preflight JSON in installer logs

## Install (development)

```bash
cd aos-google/agent-harness
python3 -m venv .venv
source .venv/bin/activate
pip install -e '.[dev]'
aos-google --help
aos-google --json doctor
```

## Examples

```bash
aos-google --json --mode readonly health
aos-google --json --mode readonly doctor
aos-google --json --mode readonly gmail search "newer_than:7d"
aos-google --json --mode readonly drive list --page-size 10
aos-google --json --mode write calendar create \
  --calendar-id primary \
  --summary "Team Sync" \
  --start "2026-03-12T15:00:00Z" \
  --end "2026-03-12T15:30:00Z"
```
