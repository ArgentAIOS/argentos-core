from __future__ import annotations

import json

from click.testing import CliRunner

import cli_aos.wordpress.bridge as bridge
import cli_aos.wordpress.config as config_module
import cli_aos.wordpress.runtime as runtime
from cli_aos.wordpress.cli import cli

REQUIRED_ENV = {
    "WORDPRESS_BASE_URL": "https://example.com",
    "WORDPRESS_USERNAME": "agent-bot",
    "WORDPRESS_APPLICATION_PASSWORD": "secret app password",
}


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


def test_runtime_config_prefers_operator_service_keys(monkeypatch):
    for key in REQUIRED_ENV:
        monkeypatch.setenv(key, f"env-{key}")

    def fake_service_key_env(name: str, default: str | None = None) -> str | None:
        if name in REQUIRED_ENV:
            return REQUIRED_ENV[name]
        return default

    monkeypatch.setattr(config_module, "service_key_env", fake_service_key_env)
    config = config_module.runtime_config()
    assert config["base_url"] == "https://example.com"
    assert config["base_url_source"] == "WORDPRESS_BASE_URL"
    assert config["username_present"] is True
    assert config["application_password_present"] is True


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
