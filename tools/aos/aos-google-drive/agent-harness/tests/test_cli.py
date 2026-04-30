from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from click.testing import CliRunner

from cli_aos.google_drive.cli import cli
import cli_aos.google_drive.runtime as runtime


AGENT_HARNESS_ROOT = Path(__file__).resolve().parents[1]
CONNECTOR_PATH = AGENT_HARNESS_ROOT.parent / "connector.json"
PERMISSIONS_PATH = AGENT_HARNESS_ROOT / "permissions.json"


class FakeGoogleDriveClient:
    def list_files(self, *, limit: int = 25, folder_id: str | None = None, mime_type: str | None = None, query_text: str | None = None) -> dict[str, Any]:
        files = [
            {"id": "file_1", "name": "Budget", "mimeType": "application/pdf", "size": "12", "modifiedTime": "2026-03-27T00:00:00Z", "createdTime": "2026-03-26T00:00:00Z", "parents": ["folder_1"], "owners": [{"displayName": "Tester", "emailAddress": "tester@example.com"}], "webViewLink": "https://example.com/file_1", "webContentLink": None, "trashed": False},
            {"id": "file_2", "name": "Notes", "mimeType": "application/vnd.google-apps.document", "size": None, "modifiedTime": "2026-03-27T00:00:00Z", "createdTime": "2026-03-26T00:00:00Z", "parents": ["folder_1"], "owners": [{"displayName": "Tester", "emailAddress": "tester@example.com"}], "webViewLink": "https://example.com/file_2", "webContentLink": None, "trashed": False},
        ]
        return {"files": files[:limit], "count": min(limit, len(files)), "raw": {"files": files}}

    def get_file(self, file_id: str) -> dict[str, Any]:
        return {"id": file_id, "name": "Budget", "mimeType": "application/pdf", "parents": ["folder_1"], "owners": [{"displayName": "Tester", "emailAddress": "tester@example.com"}], "webViewLink": "https://example.com/file_1", "webContentLink": None, "trashed": False}

    def list_folders(self, *, limit: int = 25, folder_id: str | None = None) -> dict[str, Any]:
        folders = [
            {"id": "folder_1", "name": "Invoices", "mimeType": "application/vnd.google-apps.folder", "parents": ["root"], "owners": [{"displayName": "Tester", "emailAddress": "tester@example.com"}], "webViewLink": "https://example.com/folder_1", "webContentLink": None, "trashed": False},
        ]
        return {"files": folders[:limit], "count": min(limit, len(folders)), "raw": {"files": folders}}

    def list_permissions(self, *, file_id: str) -> dict[str, Any]:
        permissions = [{"id": "perm_1", "type": "user", "role": "reader", "emailAddress": "colleague@example.com", "displayName": "Colleague"}]
        return {"permissions": permissions, "count": len(permissions), "raw": {"permissions": permissions}}

    def export_file(self, *, file_id: str, mime_type: str) -> dict[str, Any]:
        return {"file_id": file_id, "mime_type": mime_type, "content_type": mime_type, "bytes_count": 12, "content_base64": "UERGREFUQQ=="}

    def search_files(self, *, query_text: str, limit: int = 25) -> dict[str, Any]:
        results = self.list_files(limit=1, query_text=query_text)
        results["query"] = query_text
        return results

    def read_account(self) -> dict[str, Any]:
        return self.list_files(limit=1)


def invoke_json(args: list[str]) -> dict[str, Any]:
    result = CliRunner().invoke(cli, ["--json", *args])
    assert result.exit_code == 0, result.output
    return json.loads(result.output)


def invoke_json_with_mode(mode: str, args: list[str]) -> dict[str, Any]:
    result = CliRunner().invoke(cli, ["--json", "--mode", mode, *args])
    assert result.exit_code == 0, result.output
    return json.loads(result.output)


def invoke_result(args: list[str]):
    return CliRunner().invoke(cli, ["--json", *args])


def test_manifest_and_permissions_are_in_sync():
    manifest = json.loads(CONNECTOR_PATH.read_text())
    permissions = json.loads(PERMISSIONS_PATH.read_text())["permissions"]
    command_ids = [command["id"] for command in manifest["commands"]]
    assert set(command_ids) == set(permissions.keys())
    assert manifest["scope"]["kind"] == "document-storage"
    assert {command["required_mode"] for command in manifest["commands"]} == {"readonly"}
    assert "file.create" not in command_ids
    assert "share.create" not in command_ids
    field_ids = {field["id"] for field in manifest["scope"]["fields"]}
    assert set(manifest["scope"]["workerFields"]) <= field_ids


def test_manifest_field_applicability_matches_read_surface():
    manifest = json.loads(CONNECTOR_PATH.read_text())
    command_ids = {command["id"] for command in manifest["commands"]}
    command_defaults = manifest["scope"]["commandDefaults"]
    field_contracts = {
        "folder_id": ("args", "GOOGLE_DRIVE_FOLDER_ID"),
        "file_id": ("args", "GOOGLE_DRIVE_FILE_ID"),
        "mime_type": ("args", "GOOGLE_DRIVE_MIME_TYPE"),
        "query": ("args", "GOOGLE_DRIVE_QUERY"),
    }

    for field in manifest["scope"]["fields"]:
        key, expected = field_contracts[field["id"]]
        for command_id in field["applies_to"]:
            assert command_id in command_ids
            assert expected in command_defaults[command_id].get(key, [])


def test_manifest_selection_surfaces_are_consistent():
    manifest = json.loads(CONNECTOR_PATH.read_text())
    picker_hints = manifest["scope"]["pickerHints"]
    command_defaults = manifest["scope"]["commandDefaults"]

    for command_id, defaults in command_defaults.items():
        selection_surface = defaults["selection_surface"]
        assert selection_surface in picker_hints
        assert picker_hints[selection_surface]["selection_surface"] == selection_surface


def test_capabilities_exposes_manifest():
    payload = invoke_json(["capabilities"])
    assert payload["tool"] == "aos-google-drive"
    assert payload["data"]["backend"] == "google-drive-api"
    assert "file.list" in json.dumps(payload["data"])
    assert "share.create" not in json.dumps(payload["data"])


def test_health_requires_credentials(monkeypatch):
    monkeypatch.delenv("GOOGLE_DRIVE_CLIENT_ID", raising=False)
    monkeypatch.delenv("GOOGLE_DRIVE_CLIENT_SECRET", raising=False)
    monkeypatch.delenv("GOOGLE_DRIVE_REFRESH_TOKEN", raising=False)
    payload = invoke_json(["health"])
    assert payload["data"]["status"] == "needs_setup"
    assert "GOOGLE_DRIVE_CLIENT_ID" in json.dumps(payload["data"])


def test_health_ready_with_fake_client(monkeypatch):
    monkeypatch.setenv("GOOGLE_DRIVE_CLIENT_ID", "client-id")
    monkeypatch.setenv("GOOGLE_DRIVE_CLIENT_SECRET", "client-secret")
    monkeypatch.setenv("GOOGLE_DRIVE_REFRESH_TOKEN", "refresh-token")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeGoogleDriveClient())
    payload = invoke_json(["health"])
    assert payload["data"]["status"] == "ready"
    assert payload["data"]["probe"]["ok"] is True
    assert payload["data"]["probe"]["details"]["file_count"] == 1


def test_config_show_redacts_credentials(monkeypatch):
    monkeypatch.setenv("GOOGLE_DRIVE_CLIENT_ID", "client-id-secret")
    monkeypatch.setenv("GOOGLE_DRIVE_CLIENT_SECRET", "client-secret-secret")
    monkeypatch.setenv("GOOGLE_DRIVE_REFRESH_TOKEN", "refresh-token-secret")
    monkeypatch.setenv("GOOGLE_DRIVE_FOLDER_ID", "folder_1")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeGoogleDriveClient())
    payload = invoke_json(["config", "show"])
    data = payload["data"]
    assert "client-id-secret" not in json.dumps(data)
    assert "client-secret-secret" not in json.dumps(data)
    assert "refresh-token-secret" not in json.dumps(data)
    assert data["scope"]["folder_id"] == "folder_1"
    assert data["runtime"]["implementation_mode"] == "live_read_only"
    assert "GOOGLE_DRIVE_FOLDER_ID" in data["auth"]["service_keys"]


def test_file_list_requires_readonly_mode(monkeypatch):
    monkeypatch.setenv("GOOGLE_DRIVE_CLIENT_ID", "client-id")
    monkeypatch.setenv("GOOGLE_DRIVE_CLIENT_SECRET", "client-secret")
    monkeypatch.setenv("GOOGLE_DRIVE_REFRESH_TOKEN", "refresh-token")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeGoogleDriveClient())
    result = CliRunner().invoke(cli, ["--json", "--mode", "readonly", "file", "list"])
    assert result.exit_code == 0, result.output


def test_removed_write_command_returns_usage_error(monkeypatch):
    monkeypatch.setenv("GOOGLE_DRIVE_CLIENT_ID", "client-id")
    monkeypatch.setenv("GOOGLE_DRIVE_CLIENT_SECRET", "client-secret")
    monkeypatch.setenv("GOOGLE_DRIVE_REFRESH_TOKEN", "refresh-token")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeGoogleDriveClient())
    result = invoke_result(["--mode", "write", "file", "create", "--name", "Draft"])
    assert result.exit_code != 0
    assert "No such command" in result.output


def test_search_query_returns_picker_metadata(monkeypatch):
    monkeypatch.setenv("GOOGLE_DRIVE_CLIENT_ID", "client-id")
    monkeypatch.setenv("GOOGLE_DRIVE_CLIENT_SECRET", "client-secret")
    monkeypatch.setenv("GOOGLE_DRIVE_REFRESH_TOKEN", "refresh-token")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeGoogleDriveClient())
    payload = invoke_json(["search", "query", "--query", "budget"])
    assert payload["data"]["results"]["count"] == 1
    assert payload["data"]["picker"]["kind"] == "file"
    assert payload["data"]["scope_preview"]["command_id"] == "search.query"
