from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from click.testing import CliRunner

from cli_aos.dropbox.cli import cli
import cli_aos.dropbox.runtime as runtime


AGENT_HARNESS_ROOT = Path(__file__).resolve().parents[1]
CONNECTOR_PATH = AGENT_HARNESS_ROOT.parent / "connector.json"
PERMISSIONS_PATH = AGENT_HARNESS_ROOT / "permissions.json"


class FakeDropboxClient:
    def read_account(self) -> dict[str, Any]:
        return {
            "account_id": "dbid:AAC_test_123",
            "name": {"display_name": "Dropbox Test"},
            "email": "test@example.com",
        }

    def list_files(self, *, path: str = "", cursor: str | None = None, limit: int = 25) -> dict[str, Any]:
        files = [
            {
                "id": "id:file_1",
                "name": "Quarterly Budget.xlsx",
                "path_lower": "/docs/quarterly budget.xlsx",
                "path_display": "/Docs/Quarterly Budget.xlsx",
                "tag": "file",
                "size": 1024,
                "server_modified": "2026-03-26T12:00:00Z",
                "content_hash": "abc123",
            },
            {
                "id": "id:file_2",
                "name": "Notes.txt",
                "path_lower": "/docs/notes.txt",
                "path_display": "/Docs/Notes.txt",
                "tag": "file",
                "size": 42,
                "server_modified": "2026-03-26T12:05:00Z",
                "content_hash": "def456",
            },
        ]
        return {"files": files[:limit], "cursor": "cursor_1", "has_more": False, "raw": {"path": path, "cursor": cursor}}

    def list_folders(self, *, path: str = "", cursor: str | None = None, limit: int = 25) -> dict[str, Any]:
        folders = [
            {"id": "id:folder_1", "name": "Docs", "path_lower": "/docs", "path_display": "/Docs", "tag": "folder"},
        ]
        return {"folders": folders[:limit], "cursor": "cursor_1", "has_more": False, "raw": {"path": path, "cursor": cursor}}

    def get_file(self, *, path_or_id: str) -> dict[str, Any]:
        return {
            "id": path_or_id,
            "name": "Quarterly Budget.xlsx",
            "path_lower": "/docs/quarterly budget.xlsx",
            "path_display": "/Docs/Quarterly Budget.xlsx",
            "tag": "file",
            "size": 1024,
            "server_modified": "2026-03-26T12:00:00Z",
            "content_hash": "abc123",
        }

    def upload_file(self, *, dropbox_path: str, source_file: str) -> dict[str, Any]:
        return {
            "status": "uploaded",
            "source_file": Path(source_file).name,
            "metadata": {
                "id": "id:file_upload",
                "name": Path(dropbox_path).name,
                "path_lower": dropbox_path.lower(),
                "path_display": dropbox_path,
                "tag": "file",
                "size": 2048,
            },
            "raw": {},
        }

    def download_file(self, *, path_or_id: str) -> dict[str, Any]:
        return {
            "metadata": {
                "id": path_or_id,
                "name": "Quarterly Budget.xlsx",
                "path_display": "/Docs/Quarterly Budget.xlsx",
                "tag": "file",
            },
            "content_type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "bytes": b"binary-data",
            "content_base64": "YmluYXJ5LWRhdGE=",
            "raw": {},
        }

    def delete_file(self, *, path_or_id: str) -> dict[str, Any]:
        return {"metadata": {"id": path_or_id, "name": "Quarterly Budget.xlsx", "tag": "file"}, "raw": {}}

    def move_file(self, *, source_path: str, dest_path: str) -> dict[str, Any]:
        return {"metadata": {"id": "id:file_1", "name": Path(dest_path).name, "path_display": dest_path, "tag": "file"}, "raw": {}}

    def create_folder(self, *, path: str) -> dict[str, Any]:
        return {"metadata": {"id": "id:folder_new", "name": Path(path).name, "path_display": path, "tag": "folder"}, "raw": {}}

    def create_shared_link(self, *, path: str, settings: dict[str, Any] | None = None) -> dict[str, Any]:
        return {
            "shared_link": {
                "id": "sl.test",
                "url": "https://dropbox.test/shared",
                "name": Path(path).name,
                "path_lower": path.lower(),
                "visibility": "public",
                "expires": None,
                "raw": {},
            },
            "raw": {"settings": settings or {}},
        }

    def list_shared_links(self, *, path: str) -> dict[str, Any]:
        return {
            "links": [
                {
                    "id": "sl.test",
                    "url": "https://dropbox.test/shared",
                    "name": Path(path).name,
                    "path_lower": path.lower(),
                    "visibility": "public",
                    "expires": None,
                    "raw": {},
                }
            ],
            "has_more": False,
            "raw": {},
        }

    def search(self, *, query: str, path: str = "", cursor: str | None = None, limit: int = 25) -> dict[str, Any]:
        return {
            "matches": [
                {
                    "id": "id:file_1",
                    "name": "Quarterly Budget.xlsx",
                    "path_display": "/Docs/Quarterly Budget.xlsx",
                    "path_lower": "/docs/quarterly budget.xlsx",
                    "tag": "file",
                }
            ],
            "cursor": "cursor_search",
            "has_more": False,
            "raw": {"query": query, "path": path, "cursor": cursor, "limit": limit},
        }


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
    assert payload["tool"] == "aos-dropbox"
    assert payload["data"]["backend"] == "dropbox-api"
    assert "file.list" in json.dumps(payload["data"])
    assert "share.create_link" in json.dumps(payload["data"])


def test_health_requires_credentials(monkeypatch):
    monkeypatch.delenv("DROPBOX_APP_KEY", raising=False)
    monkeypatch.delenv("DROPBOX_APP_SECRET", raising=False)
    monkeypatch.delenv("DROPBOX_REFRESH_TOKEN", raising=False)
    payload = invoke_json(["health"])
    assert payload["data"]["status"] == "needs_setup"
    assert "DROPBOX_APP_KEY" in json.dumps(payload["data"])


def test_health_ready_with_fake_client(monkeypatch):
    monkeypatch.setenv("DROPBOX_APP_KEY", "app_key")
    monkeypatch.setenv("DROPBOX_APP_SECRET", "app_secret")
    monkeypatch.setenv("DROPBOX_REFRESH_TOKEN", "refresh_token")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeDropboxClient())
    payload = invoke_json(["health"])
    assert payload["data"]["status"] == "ready"
    assert payload["data"]["probe"]["ok"] is True
    assert payload["data"]["probe"]["details"]["sample_files"] == ["Quarterly Budget.xlsx"]


def test_config_show_redacts_credentials(monkeypatch):
    monkeypatch.setenv("DROPBOX_APP_KEY", "dropbox_app_key_secret")
    monkeypatch.setenv("DROPBOX_APP_SECRET", "dropbox_app_secret_secret")
    monkeypatch.setenv("DROPBOX_REFRESH_TOKEN", "dropbox_refresh_token_secret")
    monkeypatch.setenv("DROPBOX_PATH", "/Docs")
    payload = invoke_json(["config", "show"])
    data = payload["data"]
    assert "dropbox_app_key_secret" not in json.dumps(data)
    assert "dropbox_app_secret_secret" not in json.dumps(data)
    assert "dropbox_refresh_token_secret" not in json.dumps(data)
    assert data["scope"]["path"] == "/Docs"
    assert data["runtime"]["implementation_mode"] == "live_read_write"


def test_file_list_returns_picker_metadata(monkeypatch):
    monkeypatch.setenv("DROPBOX_APP_KEY", "app_key")
    monkeypatch.setenv("DROPBOX_APP_SECRET", "app_secret")
    monkeypatch.setenv("DROPBOX_REFRESH_TOKEN", "refresh_token")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeDropboxClient())
    payload = invoke_json(["file", "list", "--path", "/Docs", "--limit", "1"])
    assert payload["data"]["files"]["cursor"] == "cursor_1"
    assert payload["data"]["picker"]["kind"] == "file"
    assert payload["data"]["scope_preview"]["command_id"] == "file.list"


def test_folder_create_requires_write_mode(monkeypatch):
    monkeypatch.setenv("DROPBOX_APP_KEY", "app_key")
    monkeypatch.setenv("DROPBOX_APP_SECRET", "app_secret")
    monkeypatch.setenv("DROPBOX_REFRESH_TOKEN", "refresh_token")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeDropboxClient())
    result = CliRunner().invoke(cli, ["--json", "--mode", "readonly", "folder", "create", "--path", "/Docs/New"])
    payload = json.loads(result.output)
    assert payload["ok"] is False
    assert payload["error"]["code"] == "PERMISSION_DENIED"


def test_folder_create_succeeds_in_write_mode(monkeypatch):
    monkeypatch.setenv("DROPBOX_APP_KEY", "app_key")
    monkeypatch.setenv("DROPBOX_APP_SECRET", "app_secret")
    monkeypatch.setenv("DROPBOX_REFRESH_TOKEN", "refresh_token")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeDropboxClient())
    payload = invoke_json_with_mode("write", ["folder", "create", "--path", "/Docs/New"])
    assert payload["data"]["status"] == "live_write"
    assert payload["data"]["folder"]["metadata"]["path_display"] == "/Docs/New"
    assert payload["data"]["scope_preview"]["command_id"] == "folder.create"


def test_search_query_returns_picker_metadata(monkeypatch):
    monkeypatch.setenv("DROPBOX_APP_KEY", "app_key")
    monkeypatch.setenv("DROPBOX_APP_SECRET", "app_secret")
    monkeypatch.setenv("DROPBOX_REFRESH_TOKEN", "refresh_token")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeDropboxClient())
    payload = invoke_json(["search", "query", "--query", "budget"])
    assert payload["data"]["search"]["cursor"] == "cursor_search"
    assert payload["data"]["picker"]["kind"] == "file"
    assert payload["data"]["scope_preview"]["command_id"] == "search.query"
