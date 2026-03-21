from click.testing import CliRunner

from cli_aos.quickbooks.cli import cli


def test_capabilities_json_contains_quickbooks_metadata():
    result = CliRunner().invoke(cli, ["--json", "capabilities"])
    assert result.exit_code == 0
    assert '"tool": "aos-quickbooks"' in result.output
    assert '"invoice.create"' in result.output
    assert '"resource": "invoice"' in result.output


def test_health_reports_needs_setup_without_oauth_material():
    result = CliRunner().invoke(
        cli,
        ["--json", "health"],
        env={
            "QBO_CLIENT_ID": "",
            "QBO_CLIENT_SECRET": "",
            "QBO_REFRESH_TOKEN": "",
            "QBO_ACCESS_TOKEN": "",
            "QBO_REALM_ID": "",
            "AOS_QUICKBOOKS_ACCOUNT": "",
            "AOS_QUICKBOOKS_ENVIRONMENT": "sandbox",
            "AOS_QUICKBOOKS_API_BASE": "https://quickbooks.api.intuit.com",
        },
    )
    assert result.exit_code == 0
    assert '"status": "needs_setup"' in result.output


def test_invoice_create_is_permission_gated_in_readonly_mode():
    result = CliRunner().invoke(
        cli,
        ["--json", "--mode", "readonly", "invoice", "create", "--customer-id", "123", "--amount", "99.95"],
    )
    assert result.exit_code == 3
    assert '"PERMISSION_DENIED"' in result.output


def test_config_show_redacts_secret_values():
    result = CliRunner().invoke(
        cli,
        ["--json", "config", "show"],
        env={
            "QBO_CLIENT_ID": "client-id",
            "QBO_CLIENT_SECRET": "super-secret",
            "QBO_REFRESH_TOKEN": "refresh-token",
            "QBO_ACCESS_TOKEN": "",
            "QBO_REALM_ID": "12345",
            "AOS_QUICKBOOKS_ACCOUNT": "books-primary",
            "AOS_QUICKBOOKS_ENVIRONMENT": "production",
            "AOS_QUICKBOOKS_API_BASE": "https://quickbooks.api.intuit.com",
        },
    )
    assert result.exit_code == 0
    assert "super-secret" not in result.output
    assert "refresh-token" not in result.output
    assert '"oauth_client_configured": true' in result.output
