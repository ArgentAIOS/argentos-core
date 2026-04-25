# aos-cognee

Cognee connector for ArgentOS Memory V3. It gives agents a local OS-style CLI for searching,
ingesting, and maintaining a Cognee knowledge graph over the configured Argent vault.

## Install

```bash
cd tools/aos/aos-cognee/agent-harness
python3 -m venv .venv
. .venv/bin/activate
pip install -e ".[dev]"
```

After install, `aos-cognee` should be on PATH when the virtual environment is active. Core also
discovers installed connector virtual environments under `tools/aos/*/agent-harness/.venv`.

## Commands

```bash
aos-cognee --json capabilities
aos-cognee --json health
aos-cognee --json search "How does the vault connect memory and operations?"
aos-cognee --json --mode write ingest-vault --path ~/.argentos/vault
aos-cognee --json --mode full cognify
aos-cognee --json --mode full memify
```

`search` implements the contract used by Core memory retrieval:

```bash
aos-cognee --json --mode readonly search "relationship between A and B" --search-mode GRAPH_COMPLETION
```

## Configuration

The connector reads:

- `ARGENT_CONFIG_PATH`, defaulting to `~/.argentos/argent.json`
- `memory.vault.path`
- `memory.vault.knowledgeCollection`
- `AOS_COGNEE_VAULT_PATH`
- `AOS_COGNEE_DATASET`

Cognee itself may require provider keys or local model configuration depending on how the operator
configures Cognee.
