from __future__ import annotations

import json
from pathlib import Path
import subprocess
from typing import Any

from click.testing import CliRunner
import pytest

import cli_aos.wordpress.bridge as bridge
import cli_aos.wordpress.config as config_module
import cli_aos.wordpress.runtime as runtime
import cli_aos.wordpress.service_keys as service_keys_module
from cli_aos.wordpress.cli import cli

REQUIRED_ENV = {
    "WORDPRESS_BASE_URL": "https://example.com",
    "WORDPRESS_USERNAME": "agent-bot",
    "WORDPRESS_APPLICATION_PASSWORD": "secret app password",
}
ALL_ENV_KEYS = (
    "WORDPRESS_BASE_URL",
    "WORDPRESS_USERNAME",
    "WORDPRESS_APPLICATION_PASSWORD",
    "AOS_WORDPRESS_BASE_URL",
    "AOS_WORDPRESS_USERNAME",
    "AOS_WORDPRESS_APPLICATION_PASSWORD",
)
AGENT_HARNESS_ROOT = Path(__file__).resolve().parents[1]
CONNECTOR_PATH = AGENT_HARNESS_ROOT.parent / "connector.json"
PERMISSIONS_PATH = AGENT_HARNESS_ROOT / "permissions.json"


def write_service_keys(tmp_path: Path, values: dict[str, str], *, extra: dict[str, Any] | None = None) -> Path:
    path = tmp_path / "service-keys.json"
    path.write_text(
        json.dumps(
            {
                "version": 1,
                "keys": [
                    {
                        "id": f"sk-{key}",
                        "name": key,
                        "variable": key,
                        "value": value,
                        "enabled": True,
                        **(extra or {}),
                    }
                    for key, value in values.items()
                ],
            }
        )
    )
    return path


def encrypt_secret(tmp_path: Path, plaintext: str) -> str:
    home = tmp_path / "home"
    key_dir = home / ".argentos"
    key_dir.mkdir(parents=True, exist_ok=True)
    (key_dir / ".master-key").write_text("11" * 32)
    script = r"""
const { createCipheriv } = require("node:crypto");
const plaintext = process.argv[1];
const key = Buffer.from("11".repeat(32), "hex");
const iv = Buffer.from("22".repeat(12), "hex");
const cipher = createCipheriv("aes-256-gcm", key, iv);
let encrypted = cipher.update(plaintext, "utf8", "hex");
encrypted += cipher.final("hex");
const tag = cipher.getAuthTag().toString("hex");
process.stdout.write(`enc:v1:${iv.toString("hex")}:${tag}:${encrypted}`);
"""
    result = subprocess.run(
        ["node", "-e", script, plaintext],
        capture_output=True,
        text=True,
        timeout=10,
        check=True,
    )
    return result.stdout


def _clear_env(monkeypatch) -> None:
    for key in ALL_ENV_KEYS:
        monkeypatch.delenv(key, raising=False)


@pytest.fixture(autouse=True)
def no_operator_service_key_by_default(monkeypatch, tmp_path):
    monkeypatch.setattr(service_keys_module, "SERVICE_KEYS_PATH", tmp_path / "missing-service-keys.json")
    _clear_env(monkeypatch)


def test_manifest_and_permissions_are_in_sync():
    manifest = json.loads(CONNECTOR_PATH.read_text())
    permissions = json.loads(PERMISSIONS_PATH.read_text())["permissions"]
    manifest_command_ids = [command["id"] for command in manifest["commands"]]

    assert manifest["tool"] == "aos-wordpress"
    assert manifest["manifest_schema_version"] == "1.0.0"
    assert manifest["scope"]["live_write_smoke_tested"] is False
    assert set(manifest_command_ids) == set(permissions.keys())


def test_capabilities_exposes_manifest_scope(monkeypatch):
    _clear_env(monkeypatch)
    result = CliRunner().invoke(cli, ["--json", "capabilities"])
    assert result.exit_code == 0

    payload = json.loads(result.output)
    manifest = json.loads(CONNECTOR_PATH.read_text())
    assert payload["tool"] == "aos-wordpress"
    assert payload["scope"] == manifest["scope"]
    assert payload["fields"] == manifest["fields"]
    assert payload["worker_visible_actions"] == manifest["worker_visible_actions"]
    assert payload["auth"] == manifest["auth"]
    assert payload["commands"] == manifest["commands"]
    assert payload["write_support"]["live_write_smoke_tested"] is False


def _set_required_env(monkeypatch) -> None:
    for key, value in REQUIRED_ENV.items():
        monkeypatch.setenv(key, value)


def test_capabilities_json():
    result = CliRunner().invoke(cli, ["--json", "capabilities"])
    assert result.exit_code == 0
    assert '"tool": "aos-wordpress"' in result.output
    assert '"health"' in result.output
    assert '"page.create_draft"' in result.output


def test_health_reports_needs_setup_without_env(monkeypatch):
    for key in REQUIRED_ENV:
        monkeypatch.delenv(key, raising=False)
    result = CliRunner().invoke(cli, ["--json", "health"])
    assert result.exit_code == 0
    assert '"status": "needs_setup"' in result.output
    assert 'WORDPRESS_BASE_URL' in result.output


def test_health_reports_auth_error(monkeypatch):
    _set_required_env(monkeypatch)
    monkeypatch.setattr(bridge, "probe_site", lambda _config=None: {"ok": True, "details": {"name": "Example"}, "message": "ok"})
    monkeypatch.setattr(
        bridge,
        "probe_api",
        lambda _config=None: {"ok": False, "code": "AUTH_ERROR", "message": "bad password", "details": {"status_code": 401}},
    )
    result = CliRunner().invoke(cli, ["--json", "health"])
    assert result.exit_code == 0
    assert '"status": "auth_error"' in result.output
    assert 'bad password' in result.output


def test_config_show_redacts_application_password(monkeypatch):
    _set_required_env(monkeypatch)
    monkeypatch.setattr(bridge, "probe_site", lambda _config=None: {"ok": True, "details": {"name": "Example"}, "message": "ok"})
    monkeypatch.setattr(
        bridge,
        "probe_api",
        lambda _config=None: {"ok": True, "code": "OK", "message": "auth ok", "details": {"id": 11, "name": "Agent Bot"}},
    )
    result = CliRunner().invoke(cli, ["--json", "config", "show"])
    assert result.exit_code == 0
    assert 'secret app password' not in result.output
    assert '"runtime_ready": true' in result.output
    assert '"implemented_write_commands"' in result.output


def test_permission_denied_for_write_path_in_readonly():
    result = CliRunner().invoke(cli, ["--json", "--mode", "readonly", "page", "create_draft", "--title", "Hello"])
    assert result.exit_code == 3
    assert 'PERMISSION_DENIED' in result.output


def test_runtime_config_accepts_wp_json_suffix(monkeypatch):
    monkeypatch.setenv("WORDPRESS_BASE_URL", "https://example.com/wp-json")
    monkeypatch.setenv("WORDPRESS_USERNAME", "agent-bot")
    monkeypatch.setenv("WORDPRESS_APPLICATION_PASSWORD", "secret")
    config = config_module.runtime_config()
    assert config["base_url"] == "https://example.com"
    assert config["api_root_url"] == "https://example.com/wp-json"


def test_runtime_config_prefers_operator_service_keys(monkeypatch, tmp_path):
    for key in REQUIRED_ENV:
        monkeypatch.setenv(key, f"env-{key}")

    monkeypatch.setattr(service_keys_module, "SERVICE_KEYS_PATH", write_service_keys(tmp_path, REQUIRED_ENV))
    config = config_module.runtime_config()
    assert config["base_url"] == "https://example.com"
    assert config["base_url_source"] == "repo-service-key"
    assert config["base_url_variable"] == "WORDPRESS_BASE_URL"
    assert config["username_present"] is True
    assert config["username_source"] == "repo-service-key"
    assert config["application_password_present"] is True
    assert config["application_password_source"] == "repo-service-key"


def test_encrypted_repo_service_key_decrypts_with_master_key(monkeypatch, tmp_path):
    home = tmp_path / "home"
    key_dir = home / ".argentos"
    key_dir.mkdir(parents=True)
    (key_dir / ".master-key").write_text("11" * 32)
    monkeypatch.setenv("HOME", str(home))
    encrypted = encrypt_secret(tmp_path, "operator-secret-password")
    monkeypatch.setattr(
        service_keys_module,
        "SERVICE_KEYS_PATH",
        write_service_keys(tmp_path, {"WORDPRESS_APPLICATION_PASSWORD": encrypted}),
    )

    config = config_module.runtime_config()
    assert config["application_password"] == "operator-secret-password"
    assert config["application_password_source"] == "repo-service-key"
    assert config["application_password_usable"] is True


def test_unreadable_encrypted_repo_service_key_falls_back_to_env_like_core_resolver(monkeypatch, tmp_path):
    _set_required_env(monkeypatch)
    monkeypatch.setattr(
        service_keys_module,
        "SERVICE_KEYS_PATH",
        write_service_keys(tmp_path, {"WORDPRESS_APPLICATION_PASSWORD": "enc:v1:abc:def:ghi"}),
    )

    config = config_module.runtime_config()
    assert config["application_password"] == "secret app password"
    assert config["application_password_source"] == "env_fallback"
    assert config["application_password_usable"] is True


def test_scoped_repo_service_key_blocks_env_fallback(monkeypatch, tmp_path):
    _set_required_env(monkeypatch)
    monkeypatch.setattr(
        service_keys_module,
        "SERVICE_KEYS_PATH",
        write_service_keys(
            tmp_path,
            {"WORDPRESS_APPLICATION_PASSWORD": "repo-secret-key"},
            extra={"allowedRoles": ["operator"]},
        ),
    )

    config = config_module.runtime_config()
    assert config["application_password"] == ""
    assert config["application_password_source"] == "repo-service-key-scoped"
    assert config["application_password_present"] is False
    assert config["application_password_usable"] is False


def test_operator_context_can_supply_tool_scoped_keys():
    config = config_module.runtime_config(
        {
            "service_keys": {
                "aos-wordpress": {
                    "base_url": "https://operator-context.example.com",
                    "username": "operator-user",
                    "application_password": "operator-password",
                }
            }
        }
    )

    assert config["base_url"] == "https://operator-context.example.com"
    assert config["username"] == "operator-user"
    assert config["application_password"] == "operator-password"
    assert config["base_url_source"] == "operator:service_keys:tool"
    assert config["application_password_source"] == "operator:service_keys:tool"


def test_live_command_uses_operator_context_keys(monkeypatch):
    calls: list[dict[str, object]] = []

    def fake_request_json(method, path, **kwargs):
        calls.append({"method": method, "path": path, **kwargs})
        config = kwargs["config"]
        assert config["base_url_source"] == "operator:service_keys:tool"
        assert config["username"] == "operator-user"
        assert config["application_password"] == "operator-password"
        if path == "/":
            return {"name": "Example Site", "url": "https://operator-context.example.com", "routes": {"/wp/v2/posts": {}}}
        if path == "/wp/v2/users/me":
            return {"id": 9, "name": "Operator User", "slug": "operator-user", "roles": ["editor"]}
        raise AssertionError(path)

    monkeypatch.setattr(runtime, "_request_json", fake_request_json)
    result = CliRunner().invoke(
        cli,
        ["--json", "site", "read"],
        obj={
            "service_keys": {
                "aos-wordpress": {
                    "base_url": "https://operator-context.example.com",
                    "username": "operator-user",
                    "application_password": "operator-password",
                }
            }
        },
    )

    assert result.exit_code == 0
    assert len(calls) == 2
    assert '"Operator User"' in result.output


def test_site_read_uses_runtime(monkeypatch):
    _set_required_env(monkeypatch)

    def fake_request_json(method, path, **_kwargs):
        assert method == "GET"
        if path == "/":
            return {"name": "Example Site", "url": "https://example.com", "routes": {"/wp/v2/posts": {}}}
        if path == "/wp/v2/users/me":
            return {"id": 9, "name": "Agent Bot", "slug": "agent-bot", "roles": ["editor"]}
        raise AssertionError(path)

    monkeypatch.setattr(runtime, "_request_json", fake_request_json)
    result = CliRunner().invoke(cli, ["--json", "site", "read"])
    assert result.exit_code == 0
    assert '"operation": "read"' in result.output
    assert '"Example Site"' in result.output
    assert '"editor"' in result.output


def test_page_create_draft_uses_pages_endpoint(monkeypatch):
    _set_required_env(monkeypatch)
    calls: list[dict[str, object]] = []

    def fake_request_json(method, path, **kwargs):
        calls.append({"method": method, "path": path, **kwargs})
        return {"id": 77, "status": "draft", "title": {"rendered": "Landing"}}

    monkeypatch.setattr(runtime, "_request_json", fake_request_json)
    result = CliRunner().invoke(cli, ["--json", "--mode", "write", "page", "create_draft", "--title", "Landing", "--slug", "landing"])
    assert result.exit_code == 0
    assert calls[0]["path"] == "/wp/v2/pages"
    assert calls[0]["payload"]["status"] == "draft"
    assert calls[0]["payload"]["slug"] == "landing"
    assert '"resource": "page"' in result.output


def test_post_create_draft_uses_posts_endpoint(monkeypatch):
    _set_required_env(monkeypatch)
    calls: list[dict[str, object]] = []

    def fake_request_json(method, path, **kwargs):
        calls.append({"method": method, "path": path, **kwargs})
        return {"id": 88, "status": "draft", "title": {"rendered": "Launch"}}

    monkeypatch.setattr(runtime, "_request_json", fake_request_json)
    result = CliRunner().invoke(cli, ["--json", "--mode", "write", "post", "create_draft", "--title", "Launch"])
    assert result.exit_code == 0
    assert calls[0]["method"] == "POST"
    assert calls[0]["path"] == "/wp/v2/posts"
    assert calls[0]["payload"]["status"] == "draft"
    assert calls[0]["payload"]["title"] == "Launch"


def test_post_update_draft_uses_posts_endpoint(monkeypatch):
    _set_required_env(monkeypatch)
    calls: list[dict[str, object]] = []

    def fake_request_json(method, path, **kwargs):
        calls.append({"method": method, "path": path, **kwargs})
        return {"id": 88, "status": "draft", "title": {"rendered": "Launch edit"}}

    monkeypatch.setattr(runtime, "_request_json", fake_request_json)
    result = CliRunner().invoke(
        cli,
        ["--json", "--mode", "write", "post", "update_draft", "88", "--title", "Launch edit"],
    )
    assert result.exit_code == 0
    assert calls[0]["method"] == "POST"
    assert calls[0]["path"] == "/wp/v2/posts/88"
    assert calls[0]["payload"]["status"] == "draft"
    assert calls[0]["payload"]["title"] == "Launch edit"


def test_page_publish_uses_pages_endpoint(monkeypatch):
    _set_required_env(monkeypatch)
    calls: list[dict[str, object]] = []

    def fake_request_json(method, path, **kwargs):
        calls.append({"method": method, "path": path, **kwargs})
        return {"id": 77, "status": "publish"}

    monkeypatch.setattr(runtime, "_request_json", fake_request_json)
    result = CliRunner().invoke(cli, ["--json", "--mode", "write", "page", "publish", "77"])
    assert result.exit_code == 0
    assert calls[0]["path"] == "/wp/v2/pages/77"
    assert calls[0]["payload"]["status"] == "publish"


def test_media_list_uses_media_endpoint(monkeypatch):
    _set_required_env(monkeypatch)
    calls: list[dict[str, object]] = []

    def fake_request_json(method, path, **kwargs):
        calls.append({"method": method, "path": path, **kwargs})
        return [{"id": 1, "media_type": "image"}]

    monkeypatch.setattr(runtime, "_request_json", fake_request_json)
    result = CliRunner().invoke(cli, ["--json", "media", "list", "--search", "logo", "--media-type", "image"])
    assert result.exit_code == 0
    assert calls[0]["path"] == "/wp/v2/media"
    assert calls[0]["query"]["search"] == "logo"
    assert calls[0]["query"]["media_type"] == "image"
    assert '"count": 1' in result.output


def test_taxonomy_list_uses_categories_and_tags(monkeypatch):
    _set_required_env(monkeypatch)
    calls: list[dict[str, object]] = []

    def fake_request_json(method, path, **kwargs):
        calls.append({"method": method, "path": path, **kwargs})
        if path.endswith("/categories"):
            return [{"id": 3, "name": "SEO"}]
        if path.endswith("/tags"):
            return [{"id": 5, "name": "Marketing"}]
        raise AssertionError(path)

    monkeypatch.setattr(runtime, "_request_json", fake_request_json)
    result = CliRunner().invoke(cli, ["--json", "taxonomy", "list", "--search", "mark"])
    assert result.exit_code == 0
    assert calls[0]["path"] == "/wp/v2/categories"
    assert calls[1]["path"] == "/wp/v2/tags"
    assert calls[0]["query"]["search"] == "mark"
    assert '"SEO"' in result.output
    assert '"Marketing"' in result.output


def test_media_upload_posts_file_bytes_and_updates_metadata(monkeypatch, tmp_path):
    _set_required_env(monkeypatch)
    media_file = tmp_path / "logo.txt"
    media_file.write_text("hello media", encoding="utf-8")
    calls: list[dict[str, object]] = []

    def fake_request_bytes(method, path, **kwargs):
        calls.append({"method": method, "path": path, **kwargs})
        return {"id": 44, "source_url": "https://example.com/logo.txt"}

    def fake_request_json(method, path, **kwargs):
        calls.append({"method": method, "path": path, **kwargs})
        return {"id": 44, "title": {"rendered": "Logo"}}

    monkeypatch.setattr(runtime, "_request_bytes", fake_request_bytes)
    monkeypatch.setattr(runtime, "_request_json", fake_request_json)
    result = CliRunner().invoke(
        cli,
        [
            "--json",
            "--mode",
            "write",
            "media",
            "upload",
            str(media_file),
            "title=Logo",
            "alt_text=Company logo",
        ],
    )
    assert result.exit_code == 0
    assert calls[0]["method"] == "POST"
    assert calls[0]["path"] == "/wp/v2/media"
    assert calls[0]["body"] == b"hello media"
    assert calls[0]["headers"]["Content-Disposition"] == 'attachment; filename="logo.txt"'
    assert calls[1]["path"] == "/wp/v2/media/44"
    assert calls[1]["payload"]["alt_text"] == "Company logo"
    payload = json.loads(result.output)["data"]
    assert payload["operation"] == "upload"
    assert payload["metadata"]["title"] == "Logo"


def test_taxonomy_assign_terms_updates_post_terms(monkeypatch):
    _set_required_env(monkeypatch)
    calls: list[dict[str, object]] = []

    def fake_request_json(method, path, **kwargs):
        calls.append({"method": method, "path": path, **kwargs})
        return {"id": 123, "categories": [3, 4], "tags": [5]}

    monkeypatch.setattr(runtime, "_request_json", fake_request_json)
    result = CliRunner().invoke(
        cli,
        ["--json", "--mode", "write", "taxonomy", "assign_terms", "post_id=123", "categories=3,4", "tags=5"],
    )
    assert result.exit_code == 0
    assert calls[0]["method"] == "POST"
    assert calls[0]["path"] == "/wp/v2/posts/123"
    assert calls[0]["payload"] == {"categories": [3, 4], "tags": [5]}
    payload = json.loads(result.output)["data"]
    assert payload["operation"] == "assign_terms"
    assert payload["target"] == {"resource": "post", "id": "123"}
