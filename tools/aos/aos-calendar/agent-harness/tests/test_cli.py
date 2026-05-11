from __future__ import annotations

import json

from click.testing import CliRunner

from cli_aos.calendar.cli import cli


def test_health_check_stays_blocked_until_provider_contract_is_live():
    result = CliRunner().invoke(cli, ["--json", "health.check"])

    assert result.exit_code == 0
    payload = json.loads(result.output)
    assert payload["command"] == "health.check"
    assert payload["data"]["status"] == "blocked"
    assert payload["data"]["runtime_ready"] is False
    assert payload["data"]["alias_contract"]["status"] == "blocked"


def test_event_upcoming_reports_alias_blocker():
    result = CliRunner().invoke(cli, ["--json", "event", "upcoming"])

    assert result.exit_code == 0
    payload = json.loads(result.output)
    assert payload["command"] == "event.upcoming"
    assert payload["data"]["status"] == "blocked"
