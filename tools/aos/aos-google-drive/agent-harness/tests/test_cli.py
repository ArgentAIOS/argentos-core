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

    def create_file(self, *, name: str, mime_type: str | None = None, folder_id: str | None = None) -> dict[str, Any]:
        return {"id": "file_created", "name": name, "mimeType": mime_type or "application/octet-stream", "parents": [folder_id] if folder_id else [], "owners": [], "webViewLink": "https://example.com/file_created", "webContentLink": None, "trashed": False}

    def copy_file(self, *, file_id: str, name: str | None = None) -> dict[str, Any]:
        return {"id": "file_copy", "name": name or "Copy", "mimeType": "application/pdf", "parents": ["folder_1"], "owners": [], "webViewLink": "https://example.com/file_copy", "webContentLink": None, "trashed": False}

    def move_file(self, *, file_id: str, folder_id: str) -> dict[str, Any]:
        return {"id": file_id, "name": "Budget", "mimeType": "application/pdf", "parents": [folder_id], "owners": [], "webViewLink": "https://example.com/file_1", "webContentLink": None, "trashed": False}

    def delete_file(self, *, file_id: str) -> dict[str, Any]:
        return {"deleted": True, "id": file_id}

    def list_folders(self, *, limit: int = 25, folder_id: str | None = None) -> dict[str, Any]:
        folders = [
            {"id": "folder_1", "name": "Invoices", "mimeType": "application/vnd.google-apps.folder", "parents": ["root"], "owners": [{"displayName": "Tester", "emailAddress": "tester@example.com"}], "webViewLink": "https://example.com/folder_1", "webContentLink": None, "trashed": False},
        ]
        return {"files": folders[:limit], "count": min(limit, len(folders)), "raw": {"files": folders}}

    def create_folder(self, *, name: str, folder_id: str | None = None) -> dict[str, Any]:
        return {"id": "folder_created", "name": name, "mimeType": "application/vnd.google-apps.folder", "parents": [folder_id] if folder_id else [], "owners": [], "webViewLink": "https://example.com/folder_created", "webContentLink": None, "trashed": False}

    def create_permission(self, *, file_id: str, email_address: str, role: str) -> dict[str, Any]:
        return {"id": "perm_1", "type": "user", "role": role, "emailAddress": email_address, "displayName": "Colleague"}

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


def test_manifest_and_permissions_are_in_sync():
    manifest = json.loads(CONNECTOR_PATH.read_text())
    permissions = json.loads(PERMISSIONS_PATH.read_text())["permissions"]
    command_ids = [command["id"] for command in manifest["commands"]]
    assert set(command_ids) == set(permissions.keys())
    assert manifest["scope"]["kind"] == "document-storage"


def test_capabilities_exposes_manifest():
    payload = invoke_json(["capabilities"])
    assert payload["tool"] == "aos-google-drive"
    assert payload["data"]["backend"] == "google-drive-api"
    assert "file.list" in json.dumps(payload["data"])
    assert "share.create" in json.dumps(payload["data"])


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
    assert data["runtime"]["implementation_mode"] == "live_read_write"


def test_file_list_requires_readonly_mode(monkeypatch):
    monkeypatch.setenv("GOOGLE_DRIVE_CLIENT_ID", "client-id")
    monkeypatch.setenv("GOOGLE_DRIVE_CLIENT_SECRET", "client-secret")
    monkeypatch.setenv("GOOGLE_DRIVE_REFRESH_TOKEN", "refresh-token")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeGoogleDriveClient())
    result = CliRunner().invoke(cli, ["--json", "--mode", "readonly", "file", "list"])
    assert result.exit_code == 0, result.output


def test_file_create_requires_write_mode(monkeypatch):
    monkeypatch.setenv("GOOGLE_DRIVE_CLIENT_ID", "client-id")
    monkeypatch.setenv("GOOGLE_DRIVE_CLIENT_SECRET", "client-secret")
    monkeypatch.setenv("GOOGLE_DRIVE_REFRESH_TOKEN", "refresh-token")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeGoogleDriveClient())
    result = CliRunner().invoke(cli, ["--json", "--mode", "readonly", "file", "create", "--name", "Draft"])
    payload = json.loads(result.output)
    assert payload["ok"] is False
    assert payload["error"]["code"] == "PERMISSION_DENIED"


def test_file_create_succeeds_in_write_mode(monkeypatch):
    monkeypatch.setenv("GOOGLE_DRIVE_CLIENT_ID", "client-id")
    monkeypatch.setenv("GOOGLE_DRIVE_CLIENT_SECRET", "client-secret")
    monkeypatch.setenv("GOOGLE_DRIVE_REFRESH_TOKEN", "refresh-token")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeGoogleDriveClient())
    payload = invoke_json_with_mode("write", ["file", "create", "--name", "Draft"])
    assert payload["data"]["status"] == "live_write"
    assert payload["data"]["file"]["id"] == "file_created"
    assert payload["data"]["scope_preview"]["command_id"] == "file.create"


def test_search_query_returns_picker_metadata(monkeypatch):
    monkeypatch.setenv("GOOGLE_DRIVE_CLIENT_ID", "client-id")
    monkeypatch.setenv("GOOGLE_DRIVE_CLIENT_SECRET", "client-secret")
    monkeypatch.setenv("GOOGLE_DRIVE_REFRESH_TOKEN", "refresh-token")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeGoogleDriveClient())
    payload = invoke_json(["search", "query", "--query", "budget"])
    assert payload["data"]["results"]["count"] == 1
    assert payload["data"]["picker"]["kind"] == "file"
    assert payload["data"]["scope_preview"]["command_id"] == "search.query"
