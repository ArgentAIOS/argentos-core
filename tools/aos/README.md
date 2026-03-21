# agent-cli-tools

Agent-native CLI tools that expose real software capabilities through structured commands, consistent JSON output, and built-in permission enforcement.

## Core Idea

`aos-*` tools make software usable by any agent that can run shell commands.

- No MCP server requirement
- No long-running daemons
- JSON-first command output
- Uniform permission model (`readonly`, `write`, `full`, `admin`)
- Self-describing capabilities (`capabilities --json`)

## Repository Docs

- `ARCHITECTURE.md` - system thesis and design
- `HARNESS-SPEC.md` - required contract for every `aos-*` tool
- `PERMISSIONS.md` - permission tiers and enforcement rules
- `templates/python-click-tool/` - starter scaffold for new tools

## Quick Start

```bash
git clone https://github.com/webdevtodayjason/agent-cli-tools.git
cd agent-cli-tools
```

Use the template to start a new tool:

```bash
cp -R templates/python-click-tool aos-mytool
cd aos-mytool
python3 -m venv .venv
source .venv/bin/activate
pip install -e .[dev]
aos-template-tool --help
pytest -q
```

## Standard Global Interface

Every tool must implement:

- `--json`
- `--mode [readonly|write|full|admin]`
- `--verbose`
- `--version`
- `capabilities --json`
- `health`
- `config show`

## Initial Targets

- `aos-obsidian`
- `aos-pg`
- `aos-gh`
- `aos-google` (wrapping `gws`)
