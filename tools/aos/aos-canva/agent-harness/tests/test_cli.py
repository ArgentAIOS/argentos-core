from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from click.testing import CliRunner

from cli_aos.canva.cli import cli
from cli_aos.canva import config as canva_config
import cli_aos.canva.runtime as runtime


AGENT_HARNESS_ROOT = Path(__file__).resolve().parents[1]
CONNECTOR_PATH = AGENT_HARNESS_ROOT.parent / "connector.json"
PERMISSIONS_PATH = AGENT_HARNESS_ROOT / "permissions.json"


class FakeCanvaClient:
    def list_designs(self, *, limit: int = 25, continuation: str | None = None, query: str | None = None, ownership: str | None = None, sort_by: str | None = None) -> dict[str, Any]:
        return {"items": [{"id": "design-1", "title": "Campaign Deck", "page_count": 5, "raw": {}}], "continuation": None, "raw": {}}

    def get_design(self, design_id: str) -> dict[str, Any]:
        return {"id": design_id, "title": "Campaign Deck", "page_count": 5, "raw": {}}

    def create_design(self, *, title: str | None = None, design_type: dict[str, Any] | None = None, asset_id: str | None = None) -> dict[str, Any]:
        return {"id": "design-new", "title": title, "raw": {"design_type": design_type, "asset_id": asset_id}}

    def list_brand_templates(self, *, limit: int = 25, continuation: str | None = None) -> dict[str, Any]:
        return {"items": [{"id": "brand-1", "title": "Brand Kit", "create_url": "https://canva.example/create", "raw": {}}], "continuation": None, "raw": {}}

    def get_brand_template(self, brand_template_id: str) -> dict[str, Any]:
        return {"id": brand_template_id, "title": "Brand Kit", "raw": {}}

    def get_brand_template_dataset(self, brand_template_id: str) -> dict[str, Any]:
        return {"dataset": {"headline": {"type": "text"}}}

    def create_design_autofill_job(self, *, brand_template_id: str, data: dict[str, Any], title: str | None = None) -> dict[str, Any]:
        return {"job": {"id": "job-1", "status": "success", "result": {"type": "create_design", "design": {"id": "design-autofill", "title": title}}}}

    def get_design_autofill_job(self, job_id: str) -> dict[str, Any]:
        return {"job": {"id": job_id, "status": "success", "result": {"type": "create_design", "design": {"id": "design-autofill", "title": "Autofilled"}}}}

    def list_folder_items(self, folder_id: str, *, limit: int = 25, continuation: str | None = None, item_types: list[str] | None = None, sort_by: str | None = None) -> dict[str, Any]:
        items = [
            {"type": "folder", "folder": {"id": "folder-1", "name": "Assets", "raw": {}}},
            {"type": "design", "design": {"id": "design-1", "title": "Campaign Deck", "page_count": 5, "raw": {}}},
            {"type": "image", "image": {"type": "image", "id": "asset-1", "name": "Hero", "raw": {}}},
        ]
        if item_types == ["design"]:
            items = items[1:2]
        if item_types == ["image"]:
            items = items[2:3]
        return {"items": items[:limit], "continuation": None, "raw": {}}

    def get_folder(self, folder_id: str) -> dict[str, Any]:
        return {"id": folder_id, "name": "Root", "raw": {}}

    def create_folder(self, *, name: str, parent_folder_id: str) -> dict[str, Any]:
        return {"id": "folder-new", "name": name, "raw": {"parent_folder_id": parent_folder_id}}

    def create_asset_upload_job(self, *, file_path: str, name: str | None = None) -> dict[str, Any]:
        return {"job": {"id": "asset-job-1", "status": "success", "asset": {"id": "asset-1", "name": name or Path(file_path).name}}}

    def create_url_asset_upload_job(self, *, name: str, url: str) -> dict[str, Any]:
        return {"job": {"id": "asset-job-2", "status": "success", "asset": {"id": "asset-2", "name": name, "url": url}}}

    def get_asset_upload_job(self, job_id: str) -> dict[str, Any]:
        return {"job": {"id": job_id, "status": "success", "asset": {"id": "asset-1", "name": "Hero"}}}

    def get_url_asset_upload_job(self, job_id: str) -> dict[str, Any]:
        return {"job": {"id": job_id, "status": "success", "asset": {"id": "asset-2", "name": "Hero"}}}

    def create_export_job(self, *, design_id: str, export_format: str) -> dict[str, Any]:
        return {"job": {"id": "export-1", "status": "in_progress"}}

    def get_export_job(self, export_id: str) -> dict[str, Any]:
        return {"job": {"id": export_id, "status": "success", "urls": ["https://example.com/export.png"]}}


def invoke_json(args: list[str], monkeypatch, service_keys: dict[str, str] | None = None) -> dict[str, Any]:
    if monkeypatch is not None:
        resolver = lambda name: (service_keys or {}).get(name)
        monkeypatch.setattr(canva_config, "resolve_service_key", resolver)
        monkeypatch.setattr(
            canva_config,
            "service_key_env",
            lambda name, default=None: (service_keys or {}).get(name) or canva_config.os.getenv(name, default),
        )
    result = CliRunner().invoke(cli, ["--json", *args])
    assert result.exit_code == 0, result.output
    return json.loads(result.output)


def invoke_json_with_mode(mode: str, args: list[str], monkeypatch, service_keys: dict[str, str] | None = None) -> dict[str, Any]:
    if monkeypatch is not None:
        resolver = lambda name: (service_keys or {}).get(name)
        monkeypatch.setattr(canva_config, "resolve_service_key", resolver)
        monkeypatch.setattr(
            canva_config,
            "service_key_env",
            lambda name, default=None: (service_keys or {}).get(name) or canva_config.os.getenv(name, default),
        )
    result = CliRunner().invoke(cli, ["--json", "--mode", mode, *args])
    assert result.exit_code == 0, result.output
    return json.loads(result.output)


def test_manifest_and_permissions_are_in_sync():
    manifest = json.loads(CONNECTOR_PATH.read_text())
    permissions = json.loads(PERMISSIONS_PATH.read_text())["permissions"]
    command_ids = [command["id"] for command in manifest["commands"]]
    assert set(command_ids) == set(permissions.keys())
    assert manifest["scope"]["kind"] == "design"
    assert "brand_template.get" in command_ids
    assert "folder.get" in command_ids
    assert "design.clone" not in command_ids
    assert "template.list" not in command_ids


def test_capabilities_exposes_manifest():
    payload = invoke_json(["capabilities"], monkeypatch=None)
    assert payload["tool"] == "aos-canva"
    assert payload["data"]["backend"] == "canva-api"
    encoded = json.dumps(payload["data"])
    assert "brand_template.get" in encoded
    assert "CANVA_ACCESS_TOKEN" in encoded


def test_health_requires_credentials(monkeypatch):
    monkeypatch.delenv("CANVA_ACCESS_TOKEN", raising=False)
    monkeypatch.delenv("CANVA_API_KEY", raising=False)
    payload = invoke_json(["health"], monkeypatch)
    assert payload["data"]["status"] == "needs_setup"
    assert "CANVA_ACCESS_TOKEN" in json.dumps(payload["data"])


def test_health_ready_with_fake_client(monkeypatch):
    monkeypatch.setenv("CANVA_ACCESS_TOKEN", "token-123")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeCanvaClient())
    payload = invoke_json(["health"], monkeypatch)
    assert payload["data"]["status"] == "ready"
    assert payload["data"]["probe"]["details"]["designs"]["items"][0]["id"] == "design-1"


def test_config_show_redacts_credentials(monkeypatch):
    monkeypatch.setenv("CANVA_ACCESS_TOKEN", "secret-token")
    payload = invoke_json(["config", "show"], monkeypatch)
    encoded = json.dumps(payload["data"])
    assert "secret-token" not in encoded
    assert payload["data"]["auth"]["access_token_present"] is True


def test_config_show_prefers_operator_service_keys(monkeypatch):
    monkeypatch.setenv("CANVA_ACCESS_TOKEN", "env-token")
    monkeypatch.setenv("CANVA_FOLDER_ID", "env-folder")
    payload = invoke_json(
        ["config", "show"],
        monkeypatch,
        service_keys={"CANVA_ACCESS_TOKEN": "operator-token", "CANVA_FOLDER_ID": "operator-folder"},
    )
    encoded = json.dumps(payload["data"])
    assert "operator-token" not in encoded
    assert "env-token" not in encoded
    assert payload["data"]["auth"]["access_token_source"] == "service-keys"
    assert payload["data"]["defaults"]["folder_id"] == "operator-folder"


def test_design_list_returns_picker(monkeypatch):
    monkeypatch.setenv("CANVA_ACCESS_TOKEN", "token-123")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeCanvaClient())
    payload = invoke_json(["design", "list"], monkeypatch)
    assert payload["data"]["picker"]["kind"] == "canva_design"
    assert payload["data"]["designs"][0]["id"] == "design-1"


def test_brand_template_get_returns_template(monkeypatch):
    monkeypatch.setenv("CANVA_ACCESS_TOKEN", "token-123")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeCanvaClient())
    payload = invoke_json(["brand-template", "get", "brand-1"], monkeypatch)
    assert payload["data"]["brand_template"]["id"] == "brand-1"


def test_folder_get_returns_folder(monkeypatch):
    monkeypatch.setenv("CANVA_ACCESS_TOKEN", "token-123")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeCanvaClient())
    payload = invoke_json(["folder", "get", "folder-1"], monkeypatch)
    assert payload["data"]["folder"]["id"] == "folder-1"


def test_folder_create_requires_write_mode(monkeypatch):
    monkeypatch.setenv("CANVA_ACCESS_TOKEN", "token-123")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeCanvaClient())
    result = CliRunner().invoke(cli, ["--json", "--mode", "readonly", "folder", "create", "--name", "New Folder"])
    payload = json.loads(result.output)
    assert payload["ok"] is False
    assert payload["error"]["code"] == "PERMISSION_DENIED"


def test_folder_create_succeeds_in_write_mode(monkeypatch):
    monkeypatch.setenv("CANVA_ACCESS_TOKEN", "token-123")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeCanvaClient())
    payload = invoke_json_with_mode("write", ["folder", "create", "--name", "New Folder"], monkeypatch)
    assert payload["data"]["status"] == "live_write"
    assert payload["data"]["folder"]["id"] == "folder-new"


def test_export_start_requires_write_mode(monkeypatch):
    monkeypatch.setenv("CANVA_ACCESS_TOKEN", "token-123")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeCanvaClient())
    result = CliRunner().invoke(cli, ["--json", "--mode", "readonly", "export", "start", "design-1"])
    payload = json.loads(result.output)
    assert payload["ok"] is False
    assert payload["error"]["code"] == "PERMISSION_DENIED"


def test_export_start_succeeds_in_write_mode(monkeypatch):
    monkeypatch.setenv("CANVA_ACCESS_TOKEN", "token-123")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeCanvaClient())
    payload = invoke_json_with_mode("write", ["export", "start", "design-1"], monkeypatch)
    assert payload["data"]["status"] == "live_write"
    assert payload["data"]["job"]["job"]["id"] == "export-1"


def test_export_download_returns_urls(monkeypatch):
    monkeypatch.setenv("CANVA_ACCESS_TOKEN", "token-123")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeCanvaClient())
    payload = invoke_json(["export", "download", "export-1"], monkeypatch)
    assert payload["data"]["downloads"][0] == "https://example.com/export.png"


def test_autofill_create_succeeds_in_write_mode(monkeypatch):
    monkeypatch.setenv("CANVA_ACCESS_TOKEN", "token-123")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeCanvaClient())
    payload = invoke_json_with_mode(
        "write",
        ["autofill-create", "--brand-template-id", "brand-1", "--autofill-data", "{\"headline\":\"Spring\"}"],
        monkeypatch,
    )
    assert payload["data"]["status"] == "live_write"
    assert payload["data"]["job"]["job"]["id"] == "job-1"
