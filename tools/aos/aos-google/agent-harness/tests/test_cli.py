from click.testing import CliRunner

from cli_aos.google.cli import cli


def test_capabilities_json():
    result = CliRunner().invoke(cli, ["--json", "capabilities"])
    assert result.exit_code == 0
    assert '"tool": "aos-google"' in result.output
    assert '"manifest_schema_version": "1.0.0"' in result.output


def test_permission_gate_blocks_write_for_readonly():
    result = CliRunner().invoke(
        cli,
        [
            "--json",
            "--mode",
            "readonly",
            "calendar",
            "create",
            "--summary",
            "Test",
            "--start",
            "2026-03-12T15:00:00Z",
            "--end",
            "2026-03-12T15:30:00Z",
        ],
    )
    assert result.exit_code == 3
    assert "PERMISSION_DENIED" in result.output


def test_health_fails_cleanly_without_gws():
    result = CliRunner().invoke(cli, ["--json", "--gws-bin", "definitely-not-a-real-gws", "health"])
    assert result.exit_code == 5
    assert "BACKEND_UNAVAILABLE" in result.output


def test_doctor_includes_install_hint_when_gws_missing():
    result = CliRunner().invoke(cli, ["--json", "--gws-bin", "definitely-not-a-real-gws", "doctor"])
    assert result.exit_code == 5
    assert "Install upstream with: npm install -g @googleworkspace/cli" in result.output
