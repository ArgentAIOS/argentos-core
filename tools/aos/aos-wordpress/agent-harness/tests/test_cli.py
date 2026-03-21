from click.testing import CliRunner

from cli_aos.wordpress.cli import cli


def test_capabilities_json():
    result = CliRunner().invoke(cli, ["--json", "capabilities"])
    assert result.exit_code == 0
    assert '"tool": "aos-wordpress"' in result.output
    assert '"label": "WordPress"' in result.output
    assert '"id": "post.publish"' in result.output


def test_permission_gate_blocks_publish_for_readonly():
    result = CliRunner().invoke(cli, ["--json", "--mode", "readonly", "post", "publish", "42"])
    assert result.exit_code == 3
    assert "PERMISSION_DENIED" in result.output


def test_health_reports_needs_setup_without_site_url():
    result = CliRunner().invoke(cli, ["--json", "health"])
    assert result.exit_code == 0
    assert '"status": "needs_setup"' in result.output


def test_config_show_redacts_secrets():
    result = CliRunner().invoke(
        cli,
        [
            "--json",
            "--site-url",
            "https://example.com",
            "--username",
            "editor",
            "--app-password",
            "super-secret",
            "config",
            "show",
        ],
    )
    assert result.exit_code == 0
    assert '"auth_kind": "application-password"' in result.output
    assert '"has_app_password": true' in result.output
    assert "super-secret" not in result.output


def test_site_info_requires_site_url():
    result = CliRunner().invoke(cli, ["--json", "site", "info"])
    assert result.exit_code == 4
    assert "SETUP_REQUIRED" in result.output
