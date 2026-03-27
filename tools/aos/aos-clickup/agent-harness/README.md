# aos-clickup agent-harness

Python Click CLI harness for the aos-clickup connector.

## Install

```bash
cd agent-harness
pip install -e ".[dev]"
```

## Usage

```bash
aos-clickup --json capabilities
aos-clickup --json health
aos-clickup --json config show
aos-clickup --json workspace list
aos-clickup --json --mode write task create "My task" --list-id list_abc123
aos-clickup --json comment list task_abc123
aos-clickup --json --mode write doc create "Meeting notes"
aos-clickup --json goal list
```

## Test

```bash
cd agent-harness
pytest tests/
```
