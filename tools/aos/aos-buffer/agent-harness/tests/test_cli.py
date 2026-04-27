from __future__ import annotations

import json
import subprocess
import threading
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

from click.testing import CliRunner
import pytest

from cli_aos.buffer.cli import cli
from cli_aos.buffer import service_keys


HARNESS_ROOT = Path(__file__).resolve().parents[1]
CONNECTOR_PATH = HARNESS_ROOT.parent / "connector.json"
PERMISSIONS_PATH = HARNESS_ROOT / "permissions.json"
ALL_ENV_KEYS = (
    "BUFFER_API_KEY",
    "BUFFER_ACCESS_TOKEN",
    "BUFFER_BASE_URL",
    "BUFFER_ORGANIZATION_ID",
    "BUFFER_CHANNEL_ID",
    "BUFFER_PROFILE_ID",
    "BUFFER_POST_ID",
)


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

ACCOUNT = {
    "id": "acct_1",
    "email": "buffer@example.com",
    "name": "Argent Buffer",
    "timezone": "America/Chicago",
    "organizations": [
        {"id": "org_1", "name": "Argent", "channelCount": 2},
        {"id": "org_2", "name": "Argent Labs", "channelCount": 1},
    ],
}

CHANNELS_BY_ORG = {
    "org_1": [
        {"id": "chan_1", "name": "Argent X", "service": "twitter", "avatar": "https://cdn.example.com/x.png", "isQueuePaused": False},
        {"id": "chan_2", "name": "Argent LinkedIn", "service": "linkedin", "avatar": "https://cdn.example.com/li.png", "isQueuePaused": False},
    ],
    "org_2": [
        {"id": "chan_3", "name": "Labs Threads", "service": "threads", "avatar": "https://cdn.example.com/th.png", "isQueuePaused": True},
    ],
}

POSTS_BY_ORG = {
    "org_1": [
        {"id": "post_1", "text": "Launch day", "status": "scheduled", "dueAt": "2026-04-01T15:00:00Z", "createdAt": "2026-03-31T09:00:00Z", "channelId": "chan_1"},
        {"id": "post_2", "text": "Shipped update", "status": "sent", "dueAt": "2026-03-28T15:00:00Z", "createdAt": "2026-03-28T09:00:00Z", "channelId": "chan_2"},
        {"id": "post_3", "text": "Deep pagination target", "status": "draft", "dueAt": None, "createdAt": "2026-03-27T09:00:00Z", "channelId": "chan_1"},
    ],
    "org_2": [
        {"id": "post_4", "text": "Labs note", "status": "scheduled", "dueAt": "2026-04-02T15:00:00Z", "createdAt": "2026-03-31T10:00:00Z", "channelId": "chan_3"},
    ],
}


class MockBufferHandler(BaseHTTPRequestHandler):
    requests: list[dict[str, Any]] = []

    def log_message(self, format: str, *args) -> None:  # noqa: A003
        return

    def _send_json(self, payload: dict[str, Any], status: int = 200) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self) -> None:  # noqa: N802
        content_length = int(self.headers.get("Content-Length") or "0")
        body_text = self.rfile.read(content_length).decode("utf-8") if content_length else "{}"
        payload = json.loads(body_text)
        query = payload.get("query", "")
        variables = payload.get("variables", {})
        self.__class__.requests.append(
            {
                "path": self.path,
                "auth": self.headers.get("Authorization"),
                "query": query,
                "variables": variables,
            }
        )

        if "account {" in query:
            self._send_json({"data": {"account": ACCOUNT}})
            return

        if "channels(input:" in query:
            organization_id = variables["organizationId"]
            self._send_json({"data": {"channels": CHANNELS_BY_ORG.get(organization_id, [])}})
            return

        if "channel(input:" in query:
            channel_id = variables["id"]
            for channels in CHANNELS_BY_ORG.values():
                for channel in channels:
                    if channel["id"] == channel_id:
                        record = dict(channel)
                        record["displayName"] = channel["name"]
                        self._send_json({"data": {"channel": record}})
                        return
            self._send_json({"errors": [{"message": "Channel not found", "extensions": {"code": "NOT_FOUND"}}]})
            return

        if "posts(" in query:
            organization_id = variables["organizationId"]
            channel_ids = variables.get("channelIds") or []
            statuses = variables.get("statuses") or []
            first = int(variables.get("first") or 10)
            after = variables.get("after")
            start = int(after) if after else 0
            posts = list(POSTS_BY_ORG.get(organization_id, []))
            if channel_ids:
                posts = [post for post in posts if post["channelId"] in channel_ids]
            if statuses:
                posts = [post for post in posts if post["status"] in statuses]
            selected = posts[start : start + first]
            end = start + len(selected)
            edges = [{"cursor": str(index + 1), "node": post} for index, post in enumerate(selected, start=start)]
            self._send_json(
                {
                    "data": {
                        "posts": {
                            "edges": edges,
                            "pageInfo": {
                                "hasNextPage": end < len(posts),
                                "endCursor": str(end) if end < len(posts) else None,
                            },
                        }
                    }
                }
            )
            return

        self._send_json({"errors": [{"message": "Unhandled query", "extensions": {"code": "UNEXPECTED"}}]})


@contextmanager
def mock_buffer_server():
    MockBufferHandler.requests = []
    server = ThreadingHTTPServer(("127.0.0.1", 0), MockBufferHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield {
            "base_url": f"http://127.0.0.1:{server.server_address[1]}",
            "requests": MockBufferHandler.requests,
        }
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


def invoke_json(args: list[str], *, obj: dict[str, Any] | None = None) -> dict[str, Any]:
    result = CliRunner().invoke(cli, ["--json", *args], obj=obj)
    assert result.exit_code == 0, result.output
    return json.loads(result.output)


@pytest.fixture(autouse=True)
def no_operator_service_keys_by_default(monkeypatch, tmp_path):
    monkeypatch.setattr(service_keys, "SERVICE_KEYS_PATH", tmp_path / "missing-service-keys.json")
    for key in ALL_ENV_KEYS:
        monkeypatch.delenv(key, raising=False)


def test_help_advertises_required_global_flags_and_modes():
    result = CliRunner().invoke(cli, ["--help"])
    assert result.exit_code == 0, result.output
    assert "--json" in result.output
    assert "--mode" in result.output
    assert "--verbose" in result.output
    assert "[readonly|write|full|admin]" in result.output


def test_manifest_and_permissions_are_in_sync():
    manifest = json.loads(CONNECTOR_PATH.read_text())
    permissions = json.loads(PERMISSIONS_PATH.read_text())["permissions"]
    command_ids = [command["id"] for command in manifest["commands"]]
    assert set(command_ids) == set(permissions.keys())
    assert manifest["backend"] == "buffer-graphql-api"
    assert manifest["scope"]["commandDefaults"]["post.list"]["args"] == ["BUFFER_ORGANIZATION_ID", "BUFFER_CHANNEL_ID"]
    assert manifest["scope"]["kind"] == "social-media"
    assert manifest["scope"]["live_write_smoke_tested"] is False
    assert manifest["scope"]["required_one_of"] == [["BUFFER_API_KEY", "BUFFER_ACCESS_TOKEN"]]
    assert manifest["auth"]["service_keys"] == ["BUFFER_API_KEY", "BUFFER_ACCESS_TOKEN"]
    assert "BUFFER_BASE_URL" in manifest["auth"]["optional_service_keys"]
    assert "post.create_draft" not in command_ids
    assert "post.schedule" not in command_ids
    assert {command["required_mode"] for command in manifest["commands"]} == {"readonly"}


def test_capabilities_exposes_graphql_manifest():
    payload = invoke_json(["capabilities"])
    assert payload["tool"] == "aos-buffer"
    assert payload["meta"]["version"] == "0.1.0"
    assert payload["data"]["backend"] == "buffer-graphql-api"
    assert payload["data"]["modes"] == ["readonly", "write", "full", "admin"]
    assert payload["data"]["write_support"]["scaffold_only"] is False
    assert payload["data"]["write_support"]["scaffolded_commands"] == []
    assert payload["data"]["write_support"]["live_write_smoke_tested"] is False
    assert "profile.read" in json.dumps(payload["data"])
    assert "post.create_draft" not in json.dumps(payload["data"])
    assert "post.schedule" not in json.dumps(payload["data"])


def test_removed_write_command_returns_json_usage_error():
    result = CliRunner().invoke(cli, ["--json", "post", "create-draft", "Launch post"])
    assert result.exit_code == 2, result.output
    payload = json.loads(result.output)
    assert payload["ok"] is False
    assert payload["error"]["code"] == "INVALID_USAGE"
    assert payload["meta"]["mode"] == "readonly"
    assert payload["meta"]["version"] == "0.1.0"


def test_health_requires_api_key(monkeypatch):
    monkeypatch.delenv("BUFFER_API_KEY", raising=False)
    monkeypatch.delenv("BUFFER_ACCESS_TOKEN", raising=False)
    payload = invoke_json(["health"])
    assert payload["data"]["status"] == "needs_setup"
    assert "BUFFER_API_KEY" in json.dumps(payload["data"])


def test_health_ready_with_mock_server(monkeypatch):
    with mock_buffer_server() as server:
        monkeypatch.setenv("BUFFER_API_KEY", "secret-token")
        monkeypatch.setenv("BUFFER_BASE_URL", server["base_url"])
        payload = invoke_json(["health"])
        assert payload["data"]["status"] == "ready"
        assert payload["data"]["probe"]["ok"] is True
        assert payload["data"]["probe"]["details"]["organization_count"] == 2


def test_config_show_redacts_and_surfaces_scope(monkeypatch):
    monkeypatch.setenv("BUFFER_API_KEY", "very-secret-token")
    monkeypatch.setenv("BUFFER_BASE_URL", "http://127.0.0.1:9000")
    monkeypatch.setenv("BUFFER_ORGANIZATION_ID", "org_1")
    monkeypatch.setenv("BUFFER_CHANNEL_ID", "chan_1")
    monkeypatch.setenv("BUFFER_PROFILE_ID", "chan_legacy")
    monkeypatch.setenv("BUFFER_POST_ID", "post_1")
    payload = invoke_json(["config", "show"])
    data = payload["data"]
    assert "very-secret-token" not in json.dumps(data)
    assert data["auth"]["access_token_source"] == "env_fallback"
    assert data["runtime"]["service_key_precedence"] == "operator-service-keys-first-with-env-fallback"
    assert data["runtime"]["live_write_smoke_tested"] is False
    assert data["runtime"]["command_defaults"]["post.read"]["args"][0] == "BUFFER_POST_ID"
    assert data["runtime"]["picker_scopes"]["channel"]["selected"]["channel_id"] == "chan_1"
    assert data["runtime"]["picker_scopes"]["profile"]["selected"]["profile_id"] == "chan_legacy"


def test_operator_service_keys_win_over_env_for_auth_and_scope(monkeypatch):
    with mock_buffer_server() as server:
        monkeypatch.setenv("BUFFER_API_KEY", "env-token")
        monkeypatch.setenv("BUFFER_BASE_URL", server["base_url"])
        monkeypatch.setenv("BUFFER_ORGANIZATION_ID", "org_1")
        payload = invoke_json(
            ["channel", "list"],
            obj={"service_keys": {"BUFFER_ACCESS_TOKEN": "operator-token", "BUFFER_ORGANIZATION_ID": "org_2"}},
        )
        assert payload["data"]["channel_count"] == 1
        assert payload["data"]["channels"][0]["id"] == "chan_3"
        assert server["requests"][0]["auth"] == "Bearer operator-token"
        assert server["requests"][1]["variables"]["organizationId"] == "org_2"


def test_operator_service_keys_win_over_env_for_base_url(monkeypatch):
    with mock_buffer_server() as server:
        monkeypatch.setenv("BUFFER_API_KEY", "env-token")
        monkeypatch.setenv("BUFFER_BASE_URL", "http://127.0.0.1:1")
        payload = invoke_json(
            ["account", "read"],
            obj={"service_keys": {"BUFFER_ACCESS_TOKEN": "operator-token", "BUFFER_BASE_URL": server["base_url"]}},
        )
        assert payload["data"]["account"]["name"] == "Argent Buffer"
        assert server["requests"][0]["path"] == "/"
        assert server["requests"][0]["auth"] == "Bearer operator-token"


def test_operator_service_keys_support_tool_scoped_aliases(monkeypatch):
    monkeypatch.setenv("BUFFER_ORGANIZATION_ID", "env-org")
    monkeypatch.setenv("BUFFER_CHANNEL_ID", "env-channel")
    payload = invoke_json(
        ["config", "show"],
        obj={
            "service_keys": {
                "aos-buffer": {
                    "access_token": "operator-token",
                    "organization_id": "operator-org",
                    "channel_id": "operator-channel",
                    "profile_id": "operator-profile",
                    "post_id": "operator-post",
                }
            }
        },
    )
    data = payload["data"]
    assert data["auth"]["service_keys"] == ["BUFFER_API_KEY", "BUFFER_ACCESS_TOKEN"]
    assert data["auth"]["required_one_of_service_keys"] == [["BUFFER_API_KEY", "BUFFER_ACCESS_TOKEN"]]
    assert data["auth"]["optional_service_keys"] == [
        "BUFFER_BASE_URL",
        "BUFFER_ORGANIZATION_ID",
        "BUFFER_CHANNEL_ID",
        "BUFFER_PROFILE_ID",
        "BUFFER_POST_ID",
    ]
    assert data["runtime"]["implementation_mode"] == "live_graphql_read_only"
    assert data["runtime"]["picker_scopes"]["channel"]["selected"]["organization_id"] == "operator-org"
    assert data["runtime"]["picker_scopes"]["channel"]["selected"]["channel_id"] == "operator-channel"
    assert data["runtime"]["picker_scopes"]["profile"]["selected"]["profile_id"] == "operator-profile"
    assert data["runtime"]["picker_scopes"]["post"]["selected"]["post_id"] == "operator-post"


def test_encrypted_repo_service_key_decrypts_with_master_key(monkeypatch, tmp_path):
    encrypted = encrypt_secret(tmp_path, "buffer-token-encrypted")
    path = write_service_keys(tmp_path, {"BUFFER_API_KEY": encrypted})
    monkeypatch.setattr(service_keys, "SERVICE_KEYS_PATH", path)
    monkeypatch.setenv("HOME", str(tmp_path / "home"))

    details = service_keys.service_key_details("BUFFER_API_KEY")

    assert details["value"] == "buffer-token-encrypted"
    assert details["source"] == "repo-service-key"


def test_unreadable_encrypted_repo_service_key_falls_back_to_env_like_core_resolver(monkeypatch, tmp_path):
    path = write_service_keys(tmp_path, {"BUFFER_API_KEY": "enc:v1:bad:bad:bad"})
    monkeypatch.setattr(service_keys, "SERVICE_KEYS_PATH", path)
    monkeypatch.setenv("BUFFER_API_KEY", "env-token")

    details = service_keys.service_key_details("BUFFER_API_KEY")

    assert details["value"] == "env-token"
    assert details["source"] == "env_fallback"


def test_scoped_repo_service_key_blocks_env_fallback(monkeypatch, tmp_path):
    path = write_service_keys(
        tmp_path,
        {"BUFFER_API_KEY": "scoped-token"},
        extra={"allowedRoles": ["operator"]},
    )
    monkeypatch.setattr(service_keys, "SERVICE_KEYS_PATH", path)
    monkeypatch.setenv("BUFFER_API_KEY", "env-token")

    details = service_keys.service_key_details("BUFFER_API_KEY")

    assert details["value"] == ""
    assert details["source"] == "repo-service-key-scoped"
    assert details["blocked"] is True


def test_account_read_returns_organizations(monkeypatch):
    with mock_buffer_server() as server:
        monkeypatch.setenv("BUFFER_API_KEY", "secret-token")
        monkeypatch.setenv("BUFFER_BASE_URL", server["base_url"])
        payload = invoke_json(["account", "read"])
        assert payload["data"]["account"]["name"] == "Argent Buffer"
        assert payload["data"]["organization_count"] == 2
        assert payload["data"]["scope_preview"]["command_id"] == "account.read"


def test_channel_and_profile_reads_are_live(monkeypatch):
    with mock_buffer_server() as server:
        monkeypatch.setenv("BUFFER_API_KEY", "secret-token")
        monkeypatch.setenv("BUFFER_BASE_URL", server["base_url"])
        monkeypatch.setenv("BUFFER_ORGANIZATION_ID", "org_1")
        channel_payload = invoke_json(["channel", "list", "--limit", "1"])
        assert channel_payload["data"]["channel_count"] == 1
        assert channel_payload["data"]["picker"]["kind"] == "channel"
        profile_payload = invoke_json(["profile", "read", "chan_1"])
        assert profile_payload["data"]["profile"]["id"] == "chan_1"
        assert profile_payload["data"]["legacy_alias"] == "profile -> channel"


def test_post_list_is_live(monkeypatch):
    with mock_buffer_server() as server:
        monkeypatch.setenv("BUFFER_API_KEY", "secret-token")
        monkeypatch.setenv("BUFFER_BASE_URL", server["base_url"])
        monkeypatch.setenv("BUFFER_ORGANIZATION_ID", "org_1")
        payload = invoke_json(["post", "list", "--channel-id", "chan_1", "--status", "scheduled,draft"])
        assert payload["data"]["post_count"] == 2
        assert payload["data"]["posts"][0]["channelId"] == "chan_1"
        assert payload["data"]["scope_preview"]["channel_id"] == "chan_1"


def test_post_read_scans_accessible_scope(monkeypatch):
    with mock_buffer_server() as server:
        monkeypatch.setenv("BUFFER_API_KEY", "secret-token")
        monkeypatch.setenv("BUFFER_BASE_URL", server["base_url"])
        monkeypatch.setenv("BUFFER_ORGANIZATION_ID", "org_1")
        payload = invoke_json(["post", "read", "post_3"])
        assert payload["data"]["post"]["id"] == "post_3"
        assert payload["data"]["scope_preview"]["command_id"] == "post.read"
