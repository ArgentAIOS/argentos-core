from __future__ import annotations

import json
import sys
import types

from click.testing import CliRunner

from cli_aos.cognee.cli import cli


def parse_json(output: str) -> dict:
    return json.loads(output)


def test_capabilities_contract() -> None:
    result = CliRunner().invoke(cli, ["--json", "capabilities"])
    assert result.exit_code == 0, result.output
    payload = parse_json(result.output)
    assert payload["ok"] is True
    assert payload["tool"] == "aos-cognee"
    assert payload["command"] == "capabilities"
    assert payload["data"]["backend"] == "cognee"
    assert any(command["id"] == "search" for command in payload["data"]["commands"])


def test_search_uses_cognee_and_emits_aos_envelope(monkeypatch) -> None:
    fake = types.ModuleType("cognee")

    class SearchType:
        GRAPH_COMPLETION = "GRAPH_COMPLETION"

    async def search(query_text: str, query_type: str, top_k: int):
        print("noisy cognee startup")
        assert query_text == "How does A connect to B?"
        assert query_type == "GRAPH_COMPLETION"
        assert top_k == 3
        return [{"summary": "A connects to B through C", "score": 0.9, "source": "vault"}]

    fake.SearchType = SearchType
    fake.search = search
    monkeypatch.setitem(sys.modules, "cognee", fake)

    result = CliRunner().invoke(
        cli,
        [
            "--json",
            "--mode",
            "readonly",
            "search",
            "How does A connect to B?",
            "--search-mode",
            "GRAPH_COMPLETION",
            "--limit",
            "3",
        ],
    )
    assert result.exit_code == 0, result.output
    payload = parse_json(result.stdout)
    assert payload["ok"] is True
    assert payload["data"]["results"][0]["summary"] == "A connects to B through C"
    assert "noisy cognee startup" not in result.stdout


def test_write_command_requires_write_mode() -> None:
    result = CliRunner().invoke(cli, ["--json", "ingest-vault", "--path", "/tmp"])
    assert result.exit_code == 3
    payload = parse_json(result.output)
    assert payload["ok"] is False
    assert payload["error"]["code"] == "PERMISSION_DENIED"


def test_missing_cognee_dependency_is_reported(monkeypatch) -> None:
    from cli_aos.cognee import runtime

    def fail_import(name: str):
        if name == "cognee":
            raise ModuleNotFoundError("No module named 'cognee'")
        return __import__(name)

    monkeypatch.delitem(sys.modules, "cognee", raising=False)
    monkeypatch.setattr(runtime.importlib, "import_module", fail_import)
    result = CliRunner().invoke(
        cli,
        ["--json", "--mode", "readonly", "search", "relationship between A and B"],
    )
    assert result.exit_code == 5
    payload = parse_json(result.output)
    assert payload["ok"] is False
    assert payload["error"]["code"] == "DEPENDENCY_MISSING"
