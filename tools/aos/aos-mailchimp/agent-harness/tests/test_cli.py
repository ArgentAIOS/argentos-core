from click.testing import CliRunner

import cli_aos.mailchimp.runtime as runtime
from cli_aos.mailchimp.cli import cli


def test_capabilities_json():
    result = CliRunner().invoke(cli, ["--json", "capabilities"])
    assert result.exit_code == 0
    assert '"tool": "aos-mailchimp"' in result.output
    assert '"label": "Mailchimp"' in result.output
    assert '"id": "audience.read"' in result.output


def test_health_reports_needs_setup_without_api_key():
    result = CliRunner().invoke(cli, ["--json", "health"])
    assert result.exit_code == 0
    assert '"status": "needs_setup"' in result.output


def test_config_show_redacts_api_key(monkeypatch):
    monkeypatch.setenv("MAILCHIMP_API_KEY", "super-secret-key-us1")
    result = CliRunner().invoke(cli, ["--json", "config", "show"])
    assert result.exit_code == 0
    assert "super-secret-key-us1" not in result.output
    assert '"api_key_present": true' in result.output


def test_audience_list_uses_runtime(monkeypatch):
    monkeypatch.setattr(
        runtime.MailchimpClient,
        "list_audiences",
        lambda self, *, count=10, offset=0: {"status": "ok", "resource": "audience", "operation": "list", "results": [{"id": "list_1"}]},
    )
    result = CliRunner().invoke(
        cli,
        ["--json", "--api-key", "key-us1", "audience", "list", "--count", "1"],
    )
    assert result.exit_code == 0
    assert '"resource": "audience"' in result.output
    assert '"id": "list_1"' in result.output


def test_campaign_read_uses_runtime(monkeypatch):
    monkeypatch.setattr(
        runtime.MailchimpClient,
        "read_campaign",
        lambda self, campaign_id: {"status": "ok", "resource": "campaign", "operation": "read", "result": {"id": campaign_id}},
    )
    result = CliRunner().invoke(
        cli,
        ["--json", "--api-key", "key-us1", "campaign", "read", "cmp_123"],
    )
    assert result.exit_code == 0
    assert '"resource": "campaign"' in result.output
    assert '"id": "cmp_123"' in result.output


def test_member_read_uses_runtime(monkeypatch):
    monkeypatch.setattr(
        runtime.MailchimpClient,
        "read_member",
        lambda self, audience_id, subscriber_hash: {
            "status": "ok",
            "resource": "member",
            "operation": "read",
            "result": {"list_id": audience_id, "id": subscriber_hash},
        },
    )
    result = CliRunner().invoke(
        cli,
        ["--json", "--api-key", "key-us1", "member", "read", "list_1", "abc123"],
    )
    assert result.exit_code == 0
    assert '"resource": "member"' in result.output
    assert '"list_id": "list_1"' in result.output


def test_write_command_stays_stubbed():
    result = CliRunner().invoke(
        cli,
        ["--json", "--mode", "write", "--api-key", "key-us1", "audience", "create", "--name", "Test"],
    )
    assert result.exit_code == 0
    assert '"status": "scaffold"' in result.output
    assert '"executed": false' in result.output


def test_runtime_infers_server_prefix_from_api_key():
    config = runtime.runtime_config({"api_key": "abc-us7", "server_prefix": None})
    assert config["resolved_server_prefix"] == "us7"
    assert config["base_url"] == "https://us7.api.mailchimp.com/3.0"

