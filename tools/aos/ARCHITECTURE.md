# aos-tools Architecture

## Thesis

CLI is the universal agent interface. Agents need deterministic commands with structured output, not protocol-specific middleware.

## Design Goals

1. No always-on service dependencies.
2. Direct operation against native data layers (files, APIs, DBs).
3. Stable JSON contract for all commands.
4. Built-in permission enforcement inside each tool.
5. Tool-level health and capability discovery.

## System Layers

1. `aos-*` CLI tool
2. Permission gate (`--mode` + command manifest)
3. Backend adapter (filesystem/API/SDK/DB)
4. Output formatter (human + JSON)

## Why This Works

- Compatible with any agent framework that can run shell commands.
- Lower operational overhead than MCP server meshes.
- Reduced failure modes (no persistent handshakes/socket lifecycle).
- Easier testing and reproducibility.

## Compatibility Model

- Tool contract is versioned via `manifest_schema_version` in `capabilities` output.
- Breaking output changes require major version bump.
- New commands are additive.

## Security Model

- Least privilege via `--mode`.
- Commands mapped to minimum mode in `permissions.json`.
- Unauthorized operations fail with structured errors and non-zero exit.
- Secrets never returned in plain text from `config show`.

## Initial Reference Integrations

- CLI-Anything methodology for generation/scaffolding.
- `gws` (Google Workspace CLI) as backend for `aos-google`.
