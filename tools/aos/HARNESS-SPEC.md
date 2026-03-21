# HARNESS-SPEC

Mandatory contract for all `aos-*` tools.

## 1. CLI Contract

Each tool must support:

- Global flags: `--json`, `--mode`, `--verbose`, `--version`
- Commands: `capabilities`, `health`, `config show`

### Required `--mode` values

- `readonly`
- `write`
- `full`
- `admin`

## 2. Output Contract

### JSON success envelope

```json
{
  "ok": true,
  "tool": "aos-example",
  "command": "note.read",
  "data": {},
  "meta": {
    "mode": "readonly",
    "duration_ms": 12,
    "timestamp": "2026-03-12T15:00:00Z",
    "version": "1.0.0"
  }
}
```

### JSON error envelope

```json
{
  "ok": false,
  "tool": "aos-example",
  "command": "note.delete",
  "error": {
    "code": "PERMISSION_DENIED",
    "message": "Command requires mode=full",
    "details": {
      "required_mode": "full",
      "actual_mode": "readonly"
    }
  },
  "meta": {
    "mode": "readonly",
    "duration_ms": 3,
    "timestamp": "2026-03-12T15:00:01Z",
    "version": "1.0.0"
  }
}
```

## 3. Exit Codes

- `0`: success
- `2`: invalid usage/arguments
- `3`: permission denied
- `4`: auth/config error
- `5`: backend unavailable
- `6`: not found
- `10`: internal error

## 4. Capabilities Contract

`capabilities --json` must include:

- `tool`
- `version`
- `manifest_schema_version`
- `modes`
- `commands` (id, summary, required_mode, supports_json)

## 5. Permission Enforcement

- Enforced inside command execution path, not only at docs level.
- Mappings sourced from `permissions.json`.
- Every command must have a declared minimum mode.

## 6. Security Baseline

- No shell execution of unsanitized user input.
- Path-based tools must enforce root allowlist boundaries.
- `config show` must redact secrets.
- Error messages must not leak credentials or tokens.

## 7. Testing Requirements

Minimum required tests:

- Command help/shape tests
- JSON envelope snapshot tests
- Permission gate tests per mode
- Health failure/success tests
- One integration test against real backend fixture

## 8. Release Requirements

- Semantic versioning
- Changelog entry per release
- Signed tags/releases when possible
- Reproducible install path documented
