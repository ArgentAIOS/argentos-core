from click.testing import CliRunner

from cli_aos.template_tool.cli import cli


def test_capabilities_json():
    result = CliRunner().invoke(cli, ["--json", "capabilities"])
    assert result.exit_code == 0
    assert '"tool": "aos-template-tool"' in result.output


def test_permission_denied_for_delete_in_readonly():
    result = CliRunner().invoke(cli, ["--json", "--mode", "readonly", "example", "delete"])
    assert result.exit_code == 3
    assert '"PERMISSION_DENIED"' in result.output
