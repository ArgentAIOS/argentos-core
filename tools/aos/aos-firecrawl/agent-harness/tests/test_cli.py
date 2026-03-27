from click.testing import CliRunner

from cli_aos.firecrawl.cli import cli


def test_capabilities_json() -> None:
    runner = CliRunner()
    result = runner.invoke(cli, ["--json", "capabilities"])
    assert result.exit_code == 0
    assert "aos-firecrawl" in result.output


def test_config_show_json() -> None:
    runner = CliRunner()
    result = runner.invoke(cli, ["--json", "config", "show"])
    assert result.exit_code == 0
    assert "proxy_base_url" in result.output
