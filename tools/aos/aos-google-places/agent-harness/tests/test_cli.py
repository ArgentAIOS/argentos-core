from click.testing import CliRunner

from cli_aos.google_places.cli import cli


def test_capabilities_json() -> None:
    runner = CliRunner()
    result = runner.invoke(cli, ["--json", "capabilities"])
    assert result.exit_code == 0
    assert "aos-google-places" in result.output


def test_config_show_json() -> None:
    runner = CliRunner()
    result = runner.invoke(cli, ["--json", "config", "show"])
    assert result.exit_code == 0
    assert "api_key_present" in result.output
