# aos-1password

Live ArgentOS connector for 1Password using the official `op` CLI.

The connector is intentionally conservative:

- `item.get` returns item metadata and fields with concealed values redacted.
- `item.reveal` is admin-gated and returns one requested field value.
- No write commands are exposed in this first surface.

## Setup

Install and authorize the 1Password CLI:

```bash
op --version
op signin
op whoami
```

For headless automation, the operator should store `OP_SERVICE_ACCOUNT_TOKEN` in ArgentOS service keys. The harness resolves that service key and injects it into the `op` subprocess environment so workflows do not carry the credential as an input field. Local environment fallback is supported for development only.

When multiple accounts are available, set `OP_ACCOUNT` or `AOS_1PASSWORD_ACCOUNT`.

Optional defaults:

- `AOS_1PASSWORD_VAULT` - vault name or ID
- `AOS_1PASSWORD_ITEM` - item name or ID
- `AOS_1PASSWORD_FIELD` - field ID or label for `item.reveal`
- `AOS_1PASSWORD_OP_PATH` - custom `op` binary path

## Commands

```bash
aos-1password --json health
aos-1password --json account whoami
aos-1password --json vault list
aos-1password --json item list --vault Private
aos-1password --json item get github.com --vault Private
aos-1password --json --mode admin item reveal github.com --vault Private --field password
```
