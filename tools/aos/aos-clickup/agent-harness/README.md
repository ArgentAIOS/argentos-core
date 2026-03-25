# aos-clickup harness

Click-based harness for the ClickUp connector.

## Local run

```bash
cd tools/aos/aos-clickup/agent-harness
python3 -m venv .venv
source .venv/bin/activate
pip install -e .[dev]
pytest -q
```

## Commands

- `aos-clickup capabilities`
- `aos-clickup health`
- `aos-clickup config show`
- `aos-clickup doctor`
- `aos-clickup workspace list`
- `aos-clickup space list`
- `aos-clickup folder list`
- `aos-clickup list list`
- `aos-clickup task list`
- `aos-clickup task create-draft`
- `aos-clickup task update-draft`
