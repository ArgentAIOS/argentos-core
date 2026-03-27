from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from click.testing import CliRunner

from cli_aos.box.cli import cli
import cli_aos.box.runtime as runtime


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

    def upload_file(self, *, folder_id: str, file_path: str, name: str | None = None) -> dict[str, Any]:
        return {"entries": [{"id": "300", "type": "file", "name": name or "upload.txt", "raw": {"folder_id": folder_id, "file_path": file_path}}], "raw": {}}

    def copy_file(self, *, file_id: str, parent_id: str, name: str | None = None) -> dict[str, Any]:
        return {"id": "301", "type": "file", "name": name or "copy.txt", "raw": {"source": file_id, "parent_id": parent_id}}

    def move_file(self, *, file_id: str, parent_id: str) -> dict[str, Any]:
        return {"id": file_id, "type": "file", "name": "moved.txt", "raw": {"parent_id": parent_id}}

    def create_folder(self, *, name: str, parent_id: str) -> dict[str, Any]:
        return {"id": "400", "type": "folder", "name": name, "raw": {"parent_id": parent_id}}

    def update_shared_link(self, *, file_id: str, access: str | None = None) -> dict[str, Any]:
        return {"id": file_id, "type": "file", "name": "shared.txt", "shared_link": {"access": access or "open"}, "raw": {}}

    def list_collaborations(self, folder_id: str) -> dict[str, Any]:
        return {"entries": [{"id": "500", "role": "editor", "status": "accepted", "accessible_by": {"login": "person@example.com"}, "raw": {}}], "total_count": 1, "raw": {}}

    def create_collaboration(self, *, folder_id: str, email: str, role: str = "editor") -> dict[str, Any]:
        return {"id": "501", "role": role, "status": "pending", "accessible_by": {"login": email}, "raw": {"folder_id": folder_id}}

    def search(self, *, query_text: str, limit: int = 25) -> dict[str, Any]:
        return {"entries": [{"id": "600", "type": "file", "name": "match.txt", "raw": {"query": query_text}}], "total_count": 1, "raw": {}}

    def get_metadata(self, *, file_id: str) -> dict[str, Any]:
        return {"global": {"properties": {"stage": "draft"}}}

    def set_metadata(self, *, file_id: str, scope: str, template: str, values: dict[str, Any]) -> dict[str, Any]:
        return {"scope": scope, "template": template, "values": values, "file_id": file_id}


def invoke_json(args: list[str]) -> dict[str, Any]:
    result = CliRunner().invoke(cli, ["--json", *args])
    assert result.exit_code == 0, result.output
    return json.loads(result.output)


def invoke_json_with_mode(mode: str, args: list[str]) -> dict[str, Any]:
    result = CliRunner().invoke(cli, ["--json", "--mode", mode, *args])
    assert result.exit_code == 0, result.output
    return json.loads(result.output)


def test_manifest_and_permissions_are_in_sync():
    manifest = json.loads(CONNECTOR_PATH.read_text())
    permissions = json.loads(PERMISSIONS_PATH.read_text())["permissions"]
    command_ids = [command["id"] for command in manifest["commands"]]
    assert set(command_ids) == set(permissions.keys())
    assert manifest["scope"]["kind"] == "document-storage"


def test_capabilities_exposes_manifest():
    payload = invoke_json(["capabilities"])
    assert payload["tool"] == "aos-box"
    assert payload["data"]["backend"] == "box-api"
    assert "file.upload" in json.dumps(payload["data"])
    assert "collaboration.create" in json.dumps(payload["data"])


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


def test_file_list_returns_picker(monkeypatch):
    monkeypatch.setenv("BOX_ACCESS_TOKEN", "token-123")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeBoxClient())
    payload = invoke_json(["file", "list"])
    assert len(payload["data"]["files"]) == 1
    assert payload["data"]["picker"]["kind"] == "box_file"


def test_folder_create_requires_write_mode(monkeypatch):
    monkeypatch.setenv("BOX_ACCESS_TOKEN", "token-123")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeBoxClient())
    result = CliRunner().invoke(cli, ["--json", "--mode", "readonly", "folder", "create", "--name", "New Folder"])
    payload = json.loads(result.output)
    assert payload["ok"] is False
    assert payload["error"]["code"] == "PERMISSION_DENIED"


def test_folder_create_succeeds_in_write_mode(monkeypatch):
    monkeypatch.setenv("BOX_ACCESS_TOKEN", "token-123")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeBoxClient())
    payload = invoke_json_with_mode("write", ["folder", "create", "--name", "New Folder"])
    assert payload["data"]["status"] == "live_write"
    assert payload["data"]["folder"]["id"] == "400"


def test_search_query_returns_results(monkeypatch):
    monkeypatch.setenv("BOX_ACCESS_TOKEN", "token-123")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeBoxClient())
    payload = invoke_json(["search", "query", "--query", "annual report"])
    assert len(payload["data"]["results"]) == 1
    assert payload["data"]["scope_preview"]["command_id"] == "search.query"


def test_metadata_set_succeeds_in_write_mode(monkeypatch):
    monkeypatch.setenv("BOX_ACCESS_TOKEN", "token-123")
    monkeypatch.setenv("BOX_FILE_ID", "100")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeBoxClient())
    payload = invoke_json_with_mode("write", ["metadata", "set", "--metadata-json", "{\"stage\":\"approved\"}"])
    assert payload["data"]["metadata"]["values"]["stage"] == "approved"
