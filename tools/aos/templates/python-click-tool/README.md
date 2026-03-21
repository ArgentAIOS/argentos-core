# Python Click Tool Template

Starter scaffold for building a new `aos-*` tool.

## Includes

- Click-based CLI entrypoint
- Global `--json`, `--mode`, `--verbose`
- `capabilities`, `health`, `config show`
- `permissions.json`-driven gate
- Basic tests

## Usage

1. Copy this directory to `aos-<service>/`
2. Rename package `cli_aos/template_tool` to your service package
3. Update `permissions.json`, command IDs, and metadata
