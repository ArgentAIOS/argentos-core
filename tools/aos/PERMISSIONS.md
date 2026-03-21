# Permission Model

All `aos-*` tools use a shared four-tier mode model.

## Modes

- `readonly`: read/list/search only
- `write`: `readonly` + create/update non-destructive operations
- `full`: `write` + delete/execute standard destructive operations
- `admin`: `full` + configuration/system-wide/high-risk operations

## Enforcement Rules

1. Every command maps to one minimum mode in `permissions.json`.
2. If caller mode is below required mode, command must fail.
3. Failure response must use JSON error envelope with `PERMISSION_DENIED`.
4. Human output must still explain required vs actual mode.

## Example Manifest

```json
{
  "tool": "aos-obsidian",
  "permissions": {
    "note.read": "readonly",
    "note.create": "write",
    "note.delete": "full",
    "vault.config": "admin"
  }
}
```

## Mode Comparison

`readonly < write < full < admin`

## Guidance

- Default to least privilege when introducing new commands.
- Treat bulk operations as at least `full`.
- Treat credential/config changes as `admin`.
