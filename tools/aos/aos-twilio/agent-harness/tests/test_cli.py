from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from click.testing import CliRunner

from cli_aos.twilio.cli import cli
import cli_aos.twilio.runtime as runtime


AGENT_HARNESS_ROOT = Path(__file__).resolve().parents[1]
CONNECTOR_PATH = AGENT_HARNESS_ROOT.parent / "connector.json"
PERMISSIONS_PATH = AGENT_HARNESS_ROOT / "permissions.json"


class FakeTwilioClient:
    def read_account(self) -> dict[str, Any]:
        return {
            "sid": "AC_test_123",
            "friendly_name": "ArgentOS Test",
            "status": "active",
            "type": "Full",
            "date_created": "2025-01-01T00:00:00Z",
        }

    def send_sms(self, *, from_number: str, to_number: str, body: str, status_callback: str | None = None) -> dict[str, Any]:
        return {
            "sid": "SM_test_001",
            "from": from_number,
            "to": to_number,
            "body": body,
            "status": "queued",
            "direction": "outbound-api",
            "date_sent": None,
            "date_created": "2026-03-26T12:00:00Z",
        }

    def list_messages(self, *, limit: int = 20, from_number: str | None = None) -> dict[str, Any]:
        messages = [
            {
                "sid": "SM_test_001",
                "from": "+17372046310",
                "to": "+15125551234",
                "body": "Hello from test",
                "status": "delivered",
                "direction": "outbound-api",
                "date_sent": "2026-03-26T12:00:00Z",
            },
            {
                "sid": "SM_test_002",
                "from": "+15125551234",
                "to": "+17372046310",
                "body": "Reply from test",
                "status": "received",
                "direction": "inbound",
                "date_sent": "2026-03-26T12:01:00Z",
            },
        ]
        return {"messages": messages[:limit]}

    def read_message(self, message_sid: str) -> dict[str, Any]:
        return {
            "sid": message_sid,
            "from": "+17372046310",
            "to": "+15125551234",
            "body": "Hello from test",
            "status": "delivered",
            "direction": "outbound-api",
            "date_sent": "2026-03-26T12:00:00Z",
        }

    def create_call(self, *, from_number: str, to_number: str, voice_url: str | None = None, say_text: str | None = None, status_callback: str | None = None) -> dict[str, Any]:
        return {
            "sid": "CA_test_001",
            "from": from_number,
            "to": to_number,
            "status": "queued",
            "direction": "outbound-api",
            "start_time": None,
            "duration": None,
        }

    def list_calls(self, *, limit: int = 20) -> dict[str, Any]:
        calls = [
            {
                "sid": "CA_test_001",
                "from": "+17372046310",
                "to": "+15125551234",
                "status": "completed",
                "direction": "outbound-api",
                "start_time": "2026-03-26T12:00:00Z",
                "duration": "42",
            },
        ]
        return {"calls": calls[:limit]}

    def get_call(self, call_sid: str) -> dict[str, Any]:
        return {
            "sid": call_sid,
            "from": "+17372046310",
            "to": "+15125551234",
            "status": "completed",
            "direction": "outbound-api",
            "start_time": "2026-03-26T12:00:00Z",
            "duration": "42",
        }

    def send_whatsapp(self, *, from_number: str, to_number: str, body: str, status_callback: str | None = None) -> dict[str, Any]:
        return {
            "sid": "SM_wa_001",
            "from": f"whatsapp:{from_number}" if not from_number.startswith("whatsapp:") else from_number,
            "to": f"whatsapp:{to_number}" if not to_number.startswith("whatsapp:") else to_number,
            "body": body,
            "status": "queued",
            "direction": "outbound-api",
            "date_sent": None,
        }

    def list_whatsapp_messages(self, *, limit: int = 20, from_number: str | None = None) -> dict[str, Any]:
        messages = [
            {
                "sid": "SM_wa_001",
                "from": "whatsapp:+17372046310",
                "to": "whatsapp:+15125551234",
                "body": "WhatsApp test",
                "status": "delivered",
                "date_sent": "2026-03-26T12:00:00Z",
            },
        ]
        return {"messages": messages[:limit]}

    def lookup_phone(self, phone_number: str) -> dict[str, Any]:
        return {
            "phone_number": phone_number,
            "country_code": "US",
            "national_format": "(512) 555-1234",
            "carrier_name": "T-Mobile",
            "carrier_type": "mobile",
            "caller_name": "John Doe",
            "caller_type": "CONSUMER",
            "line_type": "mobile",
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
    assert manifest["scope"]["kind"] == "communications"


def test_capabilities_exposes_manifest():
    payload = invoke_json(["capabilities"])
    assert payload["tool"] == "aos-twilio"
    assert payload["data"]["backend"] == "twilio-api"
    assert "sms.send" in json.dumps(payload["data"])
    assert "call.create" in json.dumps(payload["data"])
    assert "whatsapp.send" in json.dumps(payload["data"])


def test_health_requires_credentials(monkeypatch):
    monkeypatch.delenv("TWILIO_ACCOUNT_SID", raising=False)
    monkeypatch.delenv("TWILIO_AUTH_TOKEN", raising=False)
    payload = invoke_json(["health"])
    assert payload["data"]["status"] == "needs_setup"
    assert "TWILIO_ACCOUNT_SID" in json.dumps(payload["data"])


def test_health_ready_with_fake_client(monkeypatch):
    monkeypatch.setenv("TWILIO_ACCOUNT_SID", "AC_test_123")
    monkeypatch.setenv("TWILIO_AUTH_TOKEN", "test_token_abc")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeTwilioClient())
    payload = invoke_json(["health"])
    assert payload["data"]["status"] == "ready"
    assert payload["data"]["probe"]["ok"] is True
    assert payload["data"]["probe"]["details"]["account"]["sid"] == "AC_test_123"


def test_config_show_redacts_credentials(monkeypatch):
    monkeypatch.setenv("TWILIO_ACCOUNT_SID", "AC_secret_sid_value")
    monkeypatch.setenv("TWILIO_AUTH_TOKEN", "secret_auth_token_value")
    monkeypatch.setenv("TWILIO_FROM_NUMBER", "+17372046310")
    payload = invoke_json(["config", "show"])
    data = payload["data"]
    assert "AC_secret_sid_value" not in json.dumps(data)
    assert "secret_auth_token_value" not in json.dumps(data)
    assert data["scope"]["from_number"] == "+17372046310"
    assert data["runtime"]["implementation_mode"] == "live_read_write"


def test_sms_send_requires_write_mode(monkeypatch):
    monkeypatch.setenv("TWILIO_ACCOUNT_SID", "AC_test_123")
    monkeypatch.setenv("TWILIO_AUTH_TOKEN", "test_token")
    monkeypatch.setenv("TWILIO_FROM_NUMBER", "+17372046310")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeTwilioClient())
    result = CliRunner().invoke(cli, ["--json", "--mode", "readonly", "sms", "send", "--to", "+15125551234", "--body", "Hi"])
    payload = json.loads(result.output)
    assert payload["ok"] is False
    assert payload["error"]["code"] == "PERMISSION_DENIED"


def test_sms_send_succeeds_in_write_mode(monkeypatch):
    monkeypatch.setenv("TWILIO_ACCOUNT_SID", "AC_test_123")
    monkeypatch.setenv("TWILIO_AUTH_TOKEN", "test_token")
    monkeypatch.setenv("TWILIO_FROM_NUMBER", "+17372046310")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeTwilioClient())
    payload = invoke_json_with_mode("write", ["sms", "send", "--to", "+15125551234", "--body", "Hello test"])
    assert payload["data"]["status"] == "live_write"
    assert payload["data"]["message"]["sid"] == "SM_test_001"
    assert payload["data"]["scope_preview"]["command_id"] == "sms.send"


def test_sms_list_returns_picker_metadata(monkeypatch):
    monkeypatch.setenv("TWILIO_ACCOUNT_SID", "AC_test_123")
    monkeypatch.setenv("TWILIO_AUTH_TOKEN", "test_token")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeTwilioClient())
    payload = invoke_json(["sms", "list", "--limit", "1"])
    data = payload["data"]
    assert data["message_count"] == 1
    assert data["picker"]["kind"] == "sms"
    assert data["scope_preview"]["command_id"] == "sms.list"


def test_sms_read_returns_message(monkeypatch):
    monkeypatch.setenv("TWILIO_ACCOUNT_SID", "AC_test_123")
    monkeypatch.setenv("TWILIO_AUTH_TOKEN", "test_token")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeTwilioClient())
    payload = invoke_json(["sms", "read", "SM_test_001"])
    assert payload["data"]["message"]["sid"] == "SM_test_001"
    assert payload["data"]["scope_preview"]["command_id"] == "sms.read"


def test_call_create_succeeds_in_write_mode(monkeypatch):
    monkeypatch.setenv("TWILIO_ACCOUNT_SID", "AC_test_123")
    monkeypatch.setenv("TWILIO_AUTH_TOKEN", "test_token")
    monkeypatch.setenv("TWILIO_FROM_NUMBER", "+17372046310")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeTwilioClient())
    payload = invoke_json_with_mode("write", ["call", "create", "--to", "+15125551234"])
    assert payload["data"]["status"] == "live_write"
    assert payload["data"]["call"]["sid"] == "CA_test_001"


def test_call_list_returns_picker_metadata(monkeypatch):
    monkeypatch.setenv("TWILIO_ACCOUNT_SID", "AC_test_123")
    monkeypatch.setenv("TWILIO_AUTH_TOKEN", "test_token")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeTwilioClient())
    payload = invoke_json(["call", "list"])
    data = payload["data"]
    assert data["call_count"] == 1
    assert data["picker"]["kind"] == "call"


def test_call_status_returns_call(monkeypatch):
    monkeypatch.setenv("TWILIO_ACCOUNT_SID", "AC_test_123")
    monkeypatch.setenv("TWILIO_AUTH_TOKEN", "test_token")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeTwilioClient())
    payload = invoke_json(["call", "status", "CA_test_001"])
    assert payload["data"]["call"]["sid"] == "CA_test_001"
    assert payload["data"]["call"]["status"] == "completed"


def test_whatsapp_send_succeeds_in_write_mode(monkeypatch):
    monkeypatch.setenv("TWILIO_ACCOUNT_SID", "AC_test_123")
    monkeypatch.setenv("TWILIO_AUTH_TOKEN", "test_token")
    monkeypatch.setenv("TWILIO_FROM_NUMBER", "+14155238886")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeTwilioClient())
    payload = invoke_json_with_mode("write", ["whatsapp", "send", "--to", "+15125551234", "--body", "WhatsApp test"])
    assert payload["data"]["status"] == "live_write"
    assert payload["data"]["message"]["sid"] == "SM_wa_001"


def test_whatsapp_list_returns_picker_metadata(monkeypatch):
    monkeypatch.setenv("TWILIO_ACCOUNT_SID", "AC_test_123")
    monkeypatch.setenv("TWILIO_AUTH_TOKEN", "test_token")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeTwilioClient())
    payload = invoke_json(["whatsapp", "list"])
    data = payload["data"]
    assert data["picker"]["kind"] == "whatsapp"
    assert data["scope_preview"]["command_id"] == "whatsapp.list"


def test_lookup_phone_returns_carrier_info(monkeypatch):
    monkeypatch.setenv("TWILIO_ACCOUNT_SID", "AC_test_123")
    monkeypatch.setenv("TWILIO_AUTH_TOKEN", "test_token")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeTwilioClient())
    payload = invoke_json(["lookup", "phone", "+15125551234"])
    data = payload["data"]
    assert data["lookup"]["carrier_name"] == "T-Mobile"
    assert data["lookup"]["line_type"] == "mobile"
    assert data["scope_preview"]["command_id"] == "lookup.phone"


def test_doctor_reports_from_number_check(monkeypatch):
    monkeypatch.setenv("TWILIO_ACCOUNT_SID", "AC_test_123")
    monkeypatch.setenv("TWILIO_AUTH_TOKEN", "test_token")
    monkeypatch.delenv("TWILIO_FROM_NUMBER", raising=False)
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeTwilioClient())
    payload = invoke_json(["doctor"])
    checks = {c["name"]: c for c in payload["data"]["checks"]}
    assert checks["from_number"]["ok"] is False
