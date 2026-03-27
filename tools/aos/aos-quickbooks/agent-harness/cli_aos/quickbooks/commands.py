from __future__ import annotations

import click

from .errors import CliError
from .permissions import load_connector_manifest, load_permissions, require_mode
from .runtime import current_config, health_snapshot


def _not_implemented(ctx: click.Context, command_id: str, resource: str, scope_hint: str) -> None:
    ctx.obj["_command_id"] = command_id
    raise CliError(
        code="NOT_IMPLEMENTED",
        message="QuickBooks backend bridge is not implemented in this scaffold yet.",
        details={
            "resource": resource,
            "scope_hint": scope_hint,
            "recommended_next_step": "Implement the QuickBooks Online API client and wire this command to live transport.",
        },
    )


@click.command("capabilities")
@click.pass_context
def capabilities(ctx: click.Context) -> None:
    manifest = load_connector_manifest()
    permissions = load_permissions()
    command_entries = []
    for command in manifest.get("commands", []):
        if not isinstance(command, dict):
            continue
        command_id = command.get("id")
        if not isinstance(command_id, str):
            continue
        command_entries.append(
            {
                "id": command_id,
                "summary": command.get("summary"),
                "required_mode": permissions.get(command_id, command.get("required_mode", "admin")),
                "supports_json": bool(command.get("supports_json", True)),
                "resource": command.get("resource"),
                "action_class": command.get("action_class"),
            }
        )

    ctx.obj["_result"] = {
        "tool": "aos-quickbooks",
        "backend": manifest.get("backend", "quickbooks-online"),
        "version": ctx.obj["version"],
        "manifest_schema_version": "1.0.0",
        "modes": ["readonly", "write", "full", "admin"],
        "delivery_model": manifest.get("delivery_model", "poll"),
        "risk_tier": manifest.get("risk_tier", "bounded-write"),
        "connector": manifest.get("connector", {}),
        "auth": manifest.get("auth", {}),
        "commands": command_entries,
    }
    ctx.obj["_command_id"] = "capabilities"


@click.command("health")
@click.pass_context
def health(ctx: click.Context) -> None:
    ctx.obj["_result"] = health_snapshot(
        account=ctx.obj.get("account"),
        environment=ctx.obj.get("environment"),
        realm_id=ctx.obj.get("realm_id"),
        api_base=ctx.obj.get("api_base"),
    )
    ctx.obj["_command_id"] = "health"


@click.group("config")
def config_group() -> None:
    pass


@config_group.command("show")
@click.pass_context
def config_show(ctx: click.Context) -> None:
    require_mode(ctx.obj["mode"], "config.show")
    ctx.obj["_result"] = current_config(
        account=ctx.obj.get("account"),
        environment=ctx.obj.get("environment"),
        realm_id=ctx.obj.get("realm_id"),
        api_base=ctx.obj.get("api_base"),
    )
    ctx.obj["_command_id"] = "config.show"


@click.group("company")
def company_group() -> None:
    pass


@company_group.command("read")
@click.pass_context
def company_read(ctx: click.Context) -> None:
    require_mode(ctx.obj["mode"], "company.read")
    _not_implemented(ctx, "company.read", "company", "realm/company")


@click.group("customer")
def customer_group() -> None:
    pass


@customer_group.command("list")
@click.option("--query", default="", help="Customer name or email filter")
@click.option("--max-results", type=int, default=25, show_default=True)
@click.pass_context
def customer_list(ctx: click.Context, query: str, max_results: int) -> None:
    require_mode(ctx.obj["mode"], "customer.list")
    _ = (query, max_results)
    _not_implemented(ctx, "customer.list", "customer", "realm/company")


@customer_group.command("read")
@click.argument("customer_id")
@click.pass_context
def customer_read(ctx: click.Context, customer_id: str) -> None:
    require_mode(ctx.obj["mode"], "customer.read")
    _ = customer_id
    _not_implemented(ctx, "customer.read", "customer", "realm/company")


@click.group("invoice")
def invoice_group() -> None:
    pass


@invoice_group.command("list")
@click.option("--status", default="", help="Invoice status filter")
@click.option("--customer-id", default="", help="QuickBooks customer id")
@click.option("--max-results", type=int, default=25, show_default=True)
@click.pass_context
def invoice_list(ctx: click.Context, status: str, customer_id: str, max_results: int) -> None:
    require_mode(ctx.obj["mode"], "invoice.list")
    _ = (status, customer_id, max_results)
    _not_implemented(ctx, "invoice.list", "invoice", "realm/company")


@invoice_group.command("read")
@click.argument("invoice_id")
@click.pass_context
def invoice_read(ctx: click.Context, invoice_id: str) -> None:
    require_mode(ctx.obj["mode"], "invoice.read")
    _ = invoice_id
    _not_implemented(ctx, "invoice.read", "invoice", "realm/company")


@invoice_group.command("create")
@click.option("--customer-id", required=True, help="QuickBooks customer id")
@click.option("--amount", type=float, required=True, help="Invoice total amount")
@click.option("--due-date", default="", help="Due date in YYYY-MM-DD format")
@click.option("--memo", default="", help="Memo or private note")
@click.pass_context
def invoice_create(ctx: click.Context, customer_id: str, amount: float, due_date: str, memo: str) -> None:
    require_mode(ctx.obj["mode"], "invoice.create")
    _ = (customer_id, amount, due_date, memo)
    _not_implemented(ctx, "invoice.create", "invoice", "realm/company")


@invoice_group.command("update")
@click.argument("invoice_id")
@click.option("--memo", default="", help="Updated memo or private note")
@click.option("--due-date", default="", help="Updated due date in YYYY-MM-DD format")
@click.pass_context
def invoice_update(ctx: click.Context, invoice_id: str, memo: str, due_date: str) -> None:
    require_mode(ctx.obj["mode"], "invoice.update")
    _ = (invoice_id, memo, due_date)
    _not_implemented(ctx, "invoice.update", "invoice", "realm/company")


@click.group("payment")
def payment_group() -> None:
    pass


@payment_group.command("list")
@click.option("--customer-id", default="", help="QuickBooks customer id")
@click.option("--max-results", type=int, default=25, show_default=True)
@click.pass_context
def payment_list(ctx: click.Context, customer_id: str, max_results: int) -> None:
    require_mode(ctx.obj["mode"], "payment.list")
    _ = (customer_id, max_results)
    _not_implemented(ctx, "payment.list", "payment", "realm/company")


@payment_group.command("read")
@click.argument("payment_id")
@click.pass_context
def payment_read(ctx: click.Context, payment_id: str) -> None:
    require_mode(ctx.obj["mode"], "payment.read")
    _ = payment_id
    _not_implemented(ctx, "payment.read", "payment", "realm/company")


@payment_group.command("create")
@click.option("--customer-id", required=True, help="QuickBooks customer id")
@click.option("--amount", type=float, required=True, help="Payment amount")
@click.option("--invoice-id", default="", help="Invoice id to apply the payment to")
@click.option("--payment-date", default="", help="Payment date in YYYY-MM-DD format")
@click.pass_context
def payment_create(
    ctx: click.Context,
    customer_id: str,
    amount: float,
    invoice_id: str,
    payment_date: str,
) -> None:
    require_mode(ctx.obj["mode"], "payment.create")
    _ = (customer_id, amount, invoice_id, payment_date)
    _not_implemented(ctx, "payment.create", "payment", "realm/company")


@click.group("bill")
def bill_group() -> None:
    pass


@bill_group.command("list")
@click.option("--status", default="", help="Bill status filter")
@click.option("--vendor-id", default="", help="QuickBooks vendor id")
@click.option("--max-results", type=int, default=25, show_default=True)
@click.pass_context
def bill_list(ctx: click.Context, status: str, vendor_id: str, max_results: int) -> None:
    require_mode(ctx.obj["mode"], "bill.list")
    _ = (status, vendor_id, max_results)
    _not_implemented(ctx, "bill.list", "bill", "realm/company")


@bill_group.command("read")
@click.argument("bill_id")
@click.pass_context
def bill_read(ctx: click.Context, bill_id: str) -> None:
    require_mode(ctx.obj["mode"], "bill.read")
    _ = bill_id
    _not_implemented(ctx, "bill.read", "bill", "realm/company")


@bill_group.command("create")
@click.option("--vendor-id", required=True, help="QuickBooks vendor id")
@click.option("--amount", type=float, required=True, help="Bill amount")
@click.option("--due-date", default="", help="Due date in YYYY-MM-DD format")
@click.option("--memo", default="", help="Memo or private note")
@click.pass_context
def bill_create(ctx: click.Context, vendor_id: str, amount: float, due_date: str, memo: str) -> None:
    require_mode(ctx.obj["mode"], "bill.create")
    _ = (vendor_id, amount, due_date, memo)
    _not_implemented(ctx, "bill.create", "bill", "realm/company")


@click.group("vendor")
def vendor_group() -> None:
    pass


@vendor_group.command("list")
@click.option("--query", default="", help="Vendor display name filter")
@click.option("--max-results", type=int, default=25, show_default=True)
@click.pass_context
def vendor_list(ctx: click.Context, query: str, max_results: int) -> None:
    require_mode(ctx.obj["mode"], "vendor.list")
    _ = (query, max_results)
    _not_implemented(ctx, "vendor.list", "vendor", "realm/company")


@vendor_group.command("read")
@click.argument("vendor_id")
@click.pass_context
def vendor_read(ctx: click.Context, vendor_id: str) -> None:
    require_mode(ctx.obj["mode"], "vendor.read")
    _ = vendor_id
    _not_implemented(ctx, "vendor.read", "vendor", "realm/company")


@click.group("account")
def account_group() -> None:
    pass


@account_group.command("list")
@click.option("--classification", default="", help="Filter by account classification")
@click.option("--active-only/--include-inactive", default=True, show_default=True)
@click.pass_context
def account_list(ctx: click.Context, classification: str, active_only: bool) -> None:
    require_mode(ctx.obj["mode"], "account.list")
    _ = (classification, active_only)
    _not_implemented(ctx, "account.list", "account", "realm/company")


@click.group("report")
def report_group() -> None:
    pass


@report_group.command("profit-and-loss")
@click.option("--start-date", default="", help="Start date in YYYY-MM-DD format")
@click.option("--end-date", default="", help="End date in YYYY-MM-DD format")
@click.pass_context
def report_profit_and_loss(ctx: click.Context, start_date: str, end_date: str) -> None:
    require_mode(ctx.obj["mode"], "report.profit-and-loss")
    _ = (start_date, end_date)
    _not_implemented(ctx, "report.profit-and-loss", "report", "realm/company")


@report_group.command("ar-aging-summary")
@click.option("--as-of-date", default="", help="As-of date in YYYY-MM-DD format")
@click.pass_context
def report_ar_aging_summary(ctx: click.Context, as_of_date: str) -> None:
    require_mode(ctx.obj["mode"], "report.ar-aging-summary")
    _ = as_of_date
    _not_implemented(ctx, "report.ar-aging-summary", "report", "realm/company")


def register(cli: click.Group) -> None:
    cli.add_command(capabilities)
    cli.add_command(health)
    cli.add_command(config_group)
    cli.add_command(company_group)
    cli.add_command(customer_group)
    cli.add_command(invoice_group)
    cli.add_command(payment_group)
    cli.add_command(bill_group)
    cli.add_command(vendor_group)
    cli.add_command(account_group)
    cli.add_command(report_group)
