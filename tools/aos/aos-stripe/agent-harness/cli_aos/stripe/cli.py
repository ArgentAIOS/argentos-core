from __future__ import annotations

import time
from typing import Any

import click

from . import __version__
from .bridge import capabilities_snapshot, config_snapshot, doctor_snapshot, health_snapshot
from .constants import MODE_ORDER
from .errors import CliError
from .output import emit, failure, success
from .runtime import run_read_command, scaffold_write_command


def _permissions() -> dict[str, str]:
    from .bridge import _permissions as load_permissions

    return load_permissions()


def _mode_allows(actual: str, required: str) -> bool:
    return MODE_ORDER.index(actual) >= MODE_ORDER.index(required)


COMMAND_PERMISSION_ALIASES = {
    "account.read": "readonly",
    "balance.read": "balance.get",
    "customer.read": "customer.get",
    "customer.search": "customer.list",
    "payment.read": "payment.get",
    "invoice.read": "invoice.get",
}


def require_mode(ctx: click.Context, command_id: str) -> None:
    permissions = _permissions()
    alias = COMMAND_PERMISSION_ALIASES.get(command_id)
    if alias in MODE_ORDER:
        required = alias
    else:
        required = permissions.get(alias or command_id, "admin")
    mode = ctx.obj["mode"]
    if _mode_allows(mode, required):
        return
    raise CliError(
        code="PERMISSION_DENIED",
        message=f"Command requires mode={required}",
        exit_code=3,
        details={"required_mode": required, "actual_mode": mode},
    )


class AosGroup(click.Group):
    def invoke(self, ctx: click.Context):
        try:
            return super().invoke(ctx)
        except CliError as err:
            payload = failure(
                command=ctx.obj.get("_command_id", "unknown") if ctx.obj else "unknown",
                mode=ctx.obj.get("mode", "unknown") if ctx.obj else "unknown",
                started=ctx.obj.get("started", time.time()) if ctx.obj else time.time(),
                error={"code": err.code, "message": err.message, "details": err.details},
            )
            emit(payload, as_json=ctx.obj.get("json", True) if ctx.obj else True)
            ctx.exit(err.exit_code)
        except click.ClickException as err:
            payload = failure(
                command=ctx.obj.get("_command_id", "unknown") if ctx.obj else "unknown",
                mode=ctx.obj.get("mode", "unknown") if ctx.obj else "unknown",
                started=ctx.obj.get("started", time.time()) if ctx.obj else time.time(),
                error={"code": "INVALID_USAGE", "message": str(err), "details": {}},
            )
            emit(payload, as_json=ctx.obj.get("json", True) if ctx.obj else True)
            ctx.exit(2)


def _set_command(ctx: click.Context, command_id: str) -> None:
    ctx.obj["_command_id"] = command_id


@click.group(cls=AosGroup)
@click.option("--json", "as_json", is_flag=True, help="Emit JSON output")
@click.option("--mode", type=click.Choice(MODE_ORDER), default="readonly", show_default=True)
@click.option("--verbose", is_flag=True, help="Verbose diagnostics")
@click.version_option(__version__)
@click.pass_context
def cli(ctx: click.Context, as_json: bool, mode: str, verbose: bool) -> None:
    ctx.ensure_object(dict)
    ctx.obj.update(
        {
            "json": as_json,
            "mode": mode,
            "verbose": verbose,
            "started": time.time(),
            "version": __version__,
            "_command_id": "unknown",
        }
    )


@cli.command("capabilities")
@click.pass_context
def capabilities(ctx: click.Context) -> None:
    _set_command(ctx, "capabilities")
    emit(capabilities_snapshot(), as_json=True)


@cli.command("health")
@click.pass_context
def health(ctx: click.Context) -> None:
    _set_command(ctx, "health")
    payload = success(command="health", mode=ctx.obj["mode"], started=ctx.obj["started"], data=health_snapshot(ctx.obj))
    emit(payload, as_json=ctx.obj["json"])


@cli.command("doctor")
@click.pass_context
def doctor(ctx: click.Context) -> None:
    _set_command(ctx, "doctor")
    payload = success(command="doctor", mode=ctx.obj["mode"], started=ctx.obj["started"], data=doctor_snapshot(ctx.obj))
    emit(payload, as_json=ctx.obj["json"])


@cli.group("config")
def config_group() -> None:
    pass


@config_group.command("show")
@click.pass_context
def config_show(ctx: click.Context) -> None:
    _set_command(ctx, "config.show")
    require_mode(ctx, "config.show")
    payload = success(command="config.show", mode=ctx.obj["mode"], started=ctx.obj["started"], data=config_snapshot(ctx.obj))
    emit(payload, as_json=ctx.obj["json"])


@cli.group("account")
def account_group() -> None:
    pass


@account_group.command("read")
@click.pass_context
def account_read(ctx: click.Context) -> None:
    _set_command(ctx, "account.read")
    require_mode(ctx, "account.read")
    payload = success(
        command="account.read",
        mode=ctx.obj["mode"],
        started=ctx.obj["started"],
        data=run_read_command(ctx.obj, "account.read", {}),
    )
    emit(payload, as_json=ctx.obj["json"])


def _scaffold_command(
    ctx: click.Context,
    *,
    command_id: str,
    inputs: dict[str, Any],
) -> None:
    _set_command(ctx, command_id)
    require_mode(ctx, command_id)
    raise CliError(
        code="NOT_IMPLEMENTED",
        message=f"{command_id} is not implemented yet",
        exit_code=10,
        details=scaffold_write_command(command_id, inputs),
    )


@cli.group("balance")
def balance_group() -> None:
    pass


@balance_group.command("read")
@click.option("--limit", default=1, show_default=True, type=int)
@click.pass_context
def balance_read(ctx: click.Context, limit: int) -> None:
    _set_command(ctx, "balance.read")
    require_mode(ctx, "balance.read")
    payload = success(
        command="balance.read",
        mode=ctx.obj["mode"],
        started=ctx.obj["started"],
        data=run_read_command(ctx.obj, "balance.read", {"limit": limit}),
    )
    emit(payload, as_json=ctx.obj["json"])


@cli.group("customer")
def customer_group() -> None:
    pass


@customer_group.command("list")
@click.option("--limit", default=10, show_default=True, type=int)
@click.option("--email", default="", show_default=False)
@click.pass_context
def customer_list(ctx: click.Context, limit: int, email: str) -> None:
    _set_command(ctx, "customer.list")
    require_mode(ctx, "customer.list")
    payload = success(
        command="customer.list",
        mode=ctx.obj["mode"],
        started=ctx.obj["started"],
        data=run_read_command(
            ctx.obj,
            "customer.list",
            {
                "limit": limit,
                "email": email or None,
            },
        ),
    )
    emit(payload, as_json=ctx.obj["json"])


@customer_group.command("search")
@click.argument("query")
@click.pass_context
def customer_search(ctx: click.Context, query: str) -> None:
    _set_command(ctx, "customer.search")
    require_mode(ctx, "customer.search")
    payload = success(
        command="customer.search",
        mode=ctx.obj["mode"],
        started=ctx.obj["started"],
        data=run_read_command(ctx.obj, "customer.search", {"query": query}),
    )
    emit(payload, as_json=ctx.obj["json"])


@customer_group.command("read")
@click.argument("customer_id")
@click.pass_context
def customer_read(ctx: click.Context, customer_id: str) -> None:
    _set_command(ctx, "customer.read")
    require_mode(ctx, "customer.read")
    payload = success(
        command="customer.read",
        mode=ctx.obj["mode"],
        started=ctx.obj["started"],
        data=run_read_command(ctx.obj, "customer.read", {"customer_id": customer_id}),
    )
    emit(payload, as_json=ctx.obj["json"])


@cli.group("payment")
def payment_group() -> None:
    pass


@payment_group.command("list")
@click.option("--limit", default=10, show_default=True, type=int)
@click.option("--customer-id", default="", show_default=False)
@click.option("--created-after", default="", show_default=False)
@click.option("--created-before", default="", show_default=False)
@click.pass_context
def payment_list(
    ctx: click.Context,
    limit: int,
    customer_id: str,
    created_after: str,
    created_before: str,
) -> None:
    _set_command(ctx, "payment.list")
    require_mode(ctx, "payment.list")
    payload = success(
        command="payment.list",
        mode=ctx.obj["mode"],
        started=ctx.obj["started"],
        data=run_read_command(
            ctx.obj,
            "payment.list",
            {
                "limit": limit,
                "customer_id": customer_id or None,
                "created_after": created_after or None,
                "created_before": created_before or None,
            },
        ),
    )
    emit(payload, as_json=ctx.obj["json"])


@payment_group.command("read")
@click.argument("payment_id")
@click.pass_context
def payment_read(ctx: click.Context, payment_id: str) -> None:
    _set_command(ctx, "payment.read")
    require_mode(ctx, "payment.read")
    payload = success(
        command="payment.read",
        mode=ctx.obj["mode"],
        started=ctx.obj["started"],
        data=run_read_command(ctx.obj, "payment.read", {"payment_id": payment_id}),
    )
    emit(payload, as_json=ctx.obj["json"])


@cli.group("invoice")
def invoice_group() -> None:
    pass


@invoice_group.command("list")
@click.option("--limit", default=10, show_default=True, type=int)
@click.option("--customer-id", default="", show_default=False)
@click.option("--status", default="", show_default=False)
@click.option("--created-after", default="", show_default=False)
@click.option("--created-before", default="", show_default=False)
@click.pass_context
def invoice_list(
    ctx: click.Context,
    limit: int,
    customer_id: str,
    status: str,
    created_after: str,
    created_before: str,
) -> None:
    _set_command(ctx, "invoice.list")
    require_mode(ctx, "invoice.list")
    payload = success(
        command="invoice.list",
        mode=ctx.obj["mode"],
        started=ctx.obj["started"],
        data=run_read_command(
            ctx.obj,
            "invoice.list",
            {
                "limit": limit,
                "customer_id": customer_id or None,
                "status": status or None,
                "created_after": created_after or None,
                "created_before": created_before or None,
            },
        ),
    )
    emit(payload, as_json=ctx.obj["json"])


@invoice_group.command("read")
@click.argument("invoice_id")
@click.pass_context
def invoice_read(ctx: click.Context, invoice_id: str) -> None:
    _set_command(ctx, "invoice.read")
    require_mode(ctx, "invoice.read")
    payload = success(
        command="invoice.read",
        mode=ctx.obj["mode"],
        started=ctx.obj["started"],
        data=run_read_command(ctx.obj, "invoice.read", {"invoice_id": invoice_id}),
    )
    emit(payload, as_json=ctx.obj["json"])


@invoice_group.command("create-draft")
@click.option("--customer-id", default="", show_default=False)
@click.option("--amount", default="", show_default=False)
@click.pass_context
def invoice_create_draft(ctx: click.Context, customer_id: str, amount: str) -> None:
    _scaffold_command(
        ctx,
        command_id="invoice.create_draft",
        inputs={"customer_id": customer_id or None, "amount": amount or None},
    )


@cli.group("refund")
def refund_group() -> None:
    pass


@refund_group.command("create")
@click.option("--payment-id", required=True)
@click.option("--amount", required=True, type=int)
@click.pass_context
def refund_create(ctx: click.Context, payment_id: str, amount: int) -> None:
    _scaffold_command(
        ctx,
        command_id="refund.create",
        inputs={"payment_id": payment_id, "amount": amount},
    )


if __name__ == "__main__":
    cli()
