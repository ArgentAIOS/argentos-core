from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from click.testing import CliRunner

from cli_aos.box.cli import cli
import cli_aos.box.runtime as runtime
import cli_aos.box.service_keys as service_keys


AGENT_HARNESS_ROOT = Path(__file__).resolve().parents[1]
CONNECTOR_PATH = AGENT_HARNESS_ROOT.parent / "connector.json"
PERMISSIONS_PATH = AGENT_HARNESS_ROOT / "permissions.json"


class FakeBoxClient:
    def get_folder(self, folder_id: str) -> dict[str, Any]:
        return {"id": folder_id, "type": "folder", "name": "Root", "raw": {}}

    def list_folder_items(self, folder_id: str, *, limit: int = 25) -> dict[str, Any]:
        items = [
            {"id": "100", "type": "file", "name": "a.txt", "raw": {}},
            {"id": "200", "type": "folder", "name": "subfolder", "raw": {}},
        ]
        return {"items": items[:limit], "total_count": min(limit, len(items)), "raw": {}}

    def get_file(self, file_id: str) -> dict[str, Any]:
        return {"id": file_id, "type": "file", "name": "a.txt", "raw": {}}

    def download_file(self, file_id: str) -> dict[str, Any]:
        return {"content_type": "text/plain", "bytes_count": 4, "download_url": "https://example.com/dl", "content_base64": "ZGF0YQ=="}

    def list_collaborations(self, folder_id: str) -> dict[str, Any]:
        return {"entries": [{"id": "500", "role": "editor", "status": "accepted", "accessible_by": {"login": "person@example.com"}, "raw": {}}], "total_count": 1, "raw": {}}

    def search(self, *, query_text: str, limit: int = 25) -> dict[str, Any]:
        return {"entries": [{"id": "600", "type": "file", "name": "match.txt", "raw": {"query": query_text}}], "total_count": 1, "raw": {}}

    def get_metadata(self, *, file_id: str) -> dict[str, Any]:
        return {"global": {"properties": {"stage": "draft"}}}


def invoke_json(args: list[str]) -> dict[str, Any]:
    result = CliRunner().invoke(cli, ["--json", *args])
    assert result.exit_code == 0, result.output
    return json.loads(result.output)


def test_manifest_and_permissions_are_in_sync():
    manifest = json.loads(CONNECTOR_PATH.read_text())
    permissions = json.loads(PERMISSIONS_PATH.read_text())["permissions"]
    command_ids = [command["id"] for command in manifest["commands"]]
    assert set(command_ids) == set(permissions.keys())
    assert manifest["scope"]["kind"] == "document-storage"
    assert manifest["scope"]["write_bridge_available"] is False
    assert all(command["required_mode"] == "readonly" for command in manifest["commands"])
    assert not any(command["action_class"] == "write" for command in manifest["commands"])


def test_manifest_field_applicability_matches_commands():
    manifest = json.loads(CONNECTOR_PATH.read_text())
    command_ids = {command["id"] for command in manifest["commands"]}
    assert set(manifest["scope"]["workerFields"]) == {"file_id", "folder_id", "query"}
    for field in manifest["scope"]["fields"]:
        assert set(field["applies_to"]).issubset(command_ids)
    assert set(manifest["scope"]["commandDefaults"]).issubset(command_ids)


def test_manifest_selection_surfaces_are_consistent():
    manifest = json.loads(CONNECTOR_PATH.read_text())
    picker_surfaces = set(manifest["scope"]["pickerHints"])
    for command in manifest["commands"]:
        surface = manifest["scope"]["commandDefaults"].get(command["id"], {}).get("selection_surface")
        if surface:
            assert surface in picker_surfaces


def test_capabilities_exposes_manifest():
    payload = invoke_json(["capabilities"])
    assert payload["tool"] == "aos-box"
    assert payload["data"]["backend"] == "box-api"
    assert "file.download" in json.dumps(payload["data"])
    assert "collaboration.list" in json.dumps(payload["data"])
    assert payload["data"]["write_support"] == {}


def test_health_requires_credentials(monkeypatch):
    monkeypatch.delenv("BOX_ACCESS_TOKEN", raising=False)
    payload = invoke_json(["health"])
    assert payload["data"]["status"] == "needs_setup"
    assert "BOX_ACCESS_TOKEN" in json.dumps(payload["data"])


def test_health_ready_with_fake_client(monkeypatch):
    monkeypatch.setenv("BOX_ACCESS_TOKEN", "token-123")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeBoxClient())
    payload = invoke_json(["health"])
    assert payload["data"]["status"] == "ready"
    assert payload["data"]["probe"]["ok"] is True
    assert payload["data"]["probe"]["details"]["folder"]["id"] == "0"


def test_config_show_redacts_credentials(monkeypatch):
    monkeypatch.setenv("BOX_ACCESS_TOKEN", "secret-token")
    monkeypatch.setenv("BOX_CLIENT_ID", "client-123")
    monkeypatch.setenv("BOX_CLIENT_SECRET", "secret-456")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeBoxClient())
    payload = invoke_json(["config", "show"])
    data = payload["data"]
    encoded = json.dumps(data)
    assert "secret-token" not in encoded
    assert "secret-456" not in encoded
    assert data["auth"]["access_token_present"] is True
    assert data["runtime"]["implementation_mode"] == "live_read_only"
    assert "BOX_FOLDER_ID" in data["auth"]["operator_service_keys"]


def test_service_keys_take_precedence_over_environment(monkeypatch):
    service_key_values = {
        "BOX_ACCESS_TOKEN": "operator-token",
        "BOX_FOLDER_ID": "operator-folder",
        "BOX_FILE_ID": "operator-file",
        "BOX_QUERY": "operator report",
    }
    for variable in service_key_values:
        monkeypatch.setenv(variable, f"env_{variable.lower()}")
    monkeypatch.setattr(service_keys, "resolve_service_key", lambda variable: service_key_values.get(variable))
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeBoxClient())

    payload = invoke_json(["config", "show"])
    data = payload["data"]

    assert data["scope"]["folder_id"] == "operator-folder"
    assert data["scope"]["file_id"] == "operator-file"
    assert data["scope"]["query"] == "operator report"
    assert data["auth"]["sources"]["BOX_FOLDER_ID"] == "service-keys"
    assert "env_box_access_token" not in json.dumps(data)
    assert "operator-token" not in json.dumps(data)


def test_file_list_returns_picker(monkeypatch):
    monkeypatch.setenv("BOX_ACCESS_TOKEN", "token-123")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeBoxClient())
    payload = invoke_json(["file", "list"])
    assert len(payload["data"]["files"]) == 1
    assert payload["data"]["picker"]["kind"] == "box_file"


def test_removed_write_commands_are_not_exposed(monkeypatch):
    monkeypatch.setenv("BOX_ACCESS_TOKEN", "token-123")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeBoxClient())
    commands = [
        ["file", "upload", "--folder-id", "0"],
        ["file", "copy", "100", "--parent-id", "0"],
        ["file", "move", "100", "--parent-id", "0"],
        ["folder", "create", "--name", "New Folder"],
        ["share", "create", "100"],
        ["share", "update", "100"],
        ["collaboration", "create", "--folder-id", "0", "--email", "person@example.com"],
        ["metadata", "set", "100", "--metadata-json", "{\"stage\":\"approved\"}"],
    ]
    for command in commands:
        result = CliRunner().invoke(cli, ["--json", "--mode", "write", *command])
        payload = json.loads(result.output)
        assert result.exit_code == 2
        assert payload["ok"] is False
        assert payload["error"]["code"] == "INVALID_USAGE"


def test_search_query_returns_results(monkeypatch):
    monkeypatch.setenv("BOX_ACCESS_TOKEN", "token-123")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeBoxClient())
    payload = invoke_json(["search", "query", "--query", "annual report"])
    assert len(payload["data"]["results"]) == 1
    assert payload["data"]["scope_preview"]["command_id"] == "search.query"


def test_metadata_get_returns_metadata(monkeypatch):
    monkeypatch.setenv("BOX_ACCESS_TOKEN", "token-123")
    monkeypatch.setenv("BOX_FILE_ID", "100")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeBoxClient())
    payload = invoke_json(["metadata", "get"])
    assert payload["data"]["metadata"]["global"]["properties"]["stage"] == "draft"
