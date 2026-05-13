# 1Password Service Account Backend for `argent secrets`

Argent's secret store is **additive**: any service-key entry whose value is a
1Password Service Account reference (`op://Vault/Item/field`) is resolved
through the `op` CLI on demand. Literal values continue to work unchanged.

This is read-only by default: Argent never writes to 1Password without an
explicit user action.

## Why use it

- Centralize credentials in 1Password — operators rotate in one place.
- Per-key opt-in: switch a single variable from a literal value to a
  reference. No global flag flip required.
- Cached for 5 minutes in-memory per process, so the CLI/gateway are not
  shelling out on every lookup.

## Requirements

1. **1Password CLI (`op`)** — install from
   <https://developer.1password.com/docs/cli/get-started/>.
2. **Service Account token** — create one at
   <https://my.1password.com/integrations/active_list>. The token grants
   read access to the vaults you select; treat it like an API key.

## Reference syntax

```
op://<Vault>/<Item>/<field>
```

`<field>` may include slashes for section/field addressing
(`op://Vault/Item/section/field`). Argent passes the entire reference to
`op read` so anything `op` accepts is valid.

Examples:

```
op://Argent/Composio API Key/credential
op://Argent/Atera/api_key
op://Engineering/SendGrid/notifications/api_key
```

## Setup

```bash
argent secrets backend 1password setup --token <ops_...>
```

What it does:

1. Verifies `op --version` succeeds.
2. Verifies the token by listing reachable vaults.
3. Stores the token **encrypted at rest** in `~/.argentos/service-keys.json`
   under the variable `OP_SERVICE_ACCOUNT_TOKEN`.

The token itself is never echoed back to the terminal.

If you'd rather pass the token via env, skip `--token` and export
`OP_SERVICE_ACCOUNT_TOKEN` before running `setup`. The setup will still
verify reachability.

## Migrate an existing key to 1Password

1. Create the item in 1Password (`op item create ...` or the desktop app).
2. In the Argent dashboard (Settings → API Keys) edit the key's value and
   replace it with the `op://...` reference. Save.
3. Argent will resolve the reference automatically on next access.

You can also run `argent secrets backend 1password setup --migrate-existing`
for guidance — actual migration is manual to keep the trust boundary clear.

## Verify a single key

```bash
argent secrets backend 1password test ATERA_API_KEY
```

Prints whether the variable is stored as a literal value or as a 1Password
ref, then resolves it end-to-end. Values are masked (`abcd...wxyz`).

## Doctor

```bash
argent doctor
```

When any service-key contains an `op://` reference, `argent doctor` emits a
**1Password** section reporting:

- whether `op` is reachable
- whether the token is present
- whether a sample resolution succeeds

You can also run the check standalone:

```bash
argent secrets backend 1password doctor [--sample op://Vault/Item/field]
```

## Resolution order

When you call `resolveServiceKey("MY_KEY")`:

1. `service-keys.json` entry exists → decrypt → if value is `op://...`,
   resolve via `op read` (cached 5 min)
   - on success, return the resolved value
   - on failure, log a redacted warning and fall through
2. `process.env.MY_KEY` (gateway plist / shell)
3. `argent.json` `env.vars.MY_KEY` (legacy; off by default)

If you use PostgreSQL as the storage backend, the PG row is checked first
and the same `op://` detection applies.

## Security notes

- `OP_SERVICE_ACCOUNT_TOKEN` is never logged, printed to stdout, or echoed
  in error messages. Any `op` CLI output passes through a redactor first.
- The cache lives in process memory only. Restart the gateway to force a
  refresh, or call `clearOnePasswordCache()` from a dev script.
- Argent does not store any 1Password vault content on disk. Only the
  reference string lives in `service-keys.json`.

## Troubleshooting

| Symptom                            | Likely cause                                | Fix                                                        |
| ---------------------------------- | ------------------------------------------- | ---------------------------------------------------------- |
| `op CLI not found on PATH`         | `op` not installed                          | Install the 1Password CLI                                  |
| `OP_SERVICE_ACCOUNT_TOKEN not set` | Token missing or not visible to the gateway | Re-run `setup`, or export the env var in the gateway plist |
| `op read non-zero exit`            | Ref typo, missing access, or revoked token  | Run `argent secrets backend 1password test <variable>`     |
| `empty_value`                      | Item exists but the field is empty          | Check the field in 1Password                               |

## Roadmap

- **Global backend flag** (`secrets.backend=1password`) — ship as a
  follow-up. The per-key reference flow is sufficient for most teams and
  composes with other resolution layers.
- **Automated migration** — opt-in tool to push existing values into a
  named vault and rewrite the entries to refs.
