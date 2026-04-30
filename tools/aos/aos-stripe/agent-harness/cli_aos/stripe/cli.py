from __future__ import annotations

import json
import time
from typing import Any

import click

from . import __version__
from .bridge import capabilities_snapshot, config_snapshot, doctor_snapshot, health_snapshot
from .constants import MODE_ORDER
from .errors import CliError
from .output import emit, failure, success
from .runtime import (
    cancel_subscription,
    create_customer,
    create_payment,
    create_subscription,
    list_customers,
    list_invoices,
    list_payments,
    list_subscriptions,
    read_account,
    read_balance,
    read_customer,
    read_invoice,
    read_payment,
    read_subscription,
    send_invoice,
)


def _mode_allows(actual: str, required: str) -> bool:
    return MODE_ORDER.index(actual) >= MODE_ORDER.index(required)


def _permissions() -> dict[str, str]:
    from .bridge import _permissions as load_permissions

    return load_permissions()


COMMAND_PERMISSION_ALIASES = {
    "account.read": "readonly",
    "balance.read": "balance.get",
    "customer.read": "customer.get",
    "payment.read": "payment.get",
    "invoice.read": "invoice.get",
}


def require_mode(ctx: click.Context, command_id: str) -> None:
    permissions = _permissions()
    alias = COMMAND_PERMISSION_ALIASES.get(command_id)
    required = alias if alias in MODE_ORDER else permissions.get(command_id) or permissions.get(str(alias), "admin")
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


def _emit_success(ctx: click.Context, command_id: str, data: dict[str, Any]) -> None:
    emit(
        success(command=command_id, mode=ctx.obj["mode"], started=ctx.obj["started"], data=data),
        as_json=ctx.obj["json"],
    )


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
    require_mode(ctx, "capabilities")
    emit(capabilities_snapshot(), as_json=True)


@cli.command("health")
@click.pass_context
def health(ctx: click.Context) -> None:
    _set_command(ctx, "health")
    require_mode(ctx, "health")
    _emit_success(ctx, "health", health_snapshot(ctx.obj))


@cli.command("doctor")
@click.pass_context
def doctor(ctx: click.Context) -> None:
    _set_command(ctx, "doctor")
    require_mode(ctx, "doctor")
    _emit_success(ctx, "doctor", doctor_snapshot(ctx.obj))


@cli.group("config")
def config_group() -> None:
    pass


@config_group.command("show")
@click.pass_context
def config_show(ctx: click.Context) -> None:
    _set_command(ctx, "config.show")
    require_mode(ctx, "config.show")
    _emit_success(ctx, "config.show", config_snapshot(ctx.obj))


@cli.group("balance")
def balance_group() -> None:
    pass


@balance_group.command("get")
@click.pass_context
def balance_get(ctx: click.Context) -> None:
    _set_command(ctx, "balance.get")
    require_mode(ctx, "balance.get")
    _emit_success(ctx, "balance.get", read_balance(ctx.obj))


@balance_group.command("read")
@click.pass_context
def balance_read(ctx: click.Context) -> None:
    _set_command(ctx, "balance.read")
    require_mode(ctx, "balance.read")
    _emit_success(ctx, "balance.read", read_balance(ctx.obj))


@cli.group("account")
def account_group() -> None:
    pass


@account_group.command("read")
@click.pass_context
def account_read(ctx: click.Context) -> None:
    _set_command(ctx, "account.read")
    require_mode(ctx, "account.read")
    _emit_success(ctx, "account.read", read_account(ctx.obj))


@cli.group("customer")
def customer_group() -> None:
    pass


@customer_group.command("list")
@click.option("--limit", default=10, show_default=True, type=click.IntRange(1, 100))
@click.option("--email", default="", show_default=False)
@click.option("--starting-after", default="", show_default=False)
@click.pass_context
def customer_list(ctx: click.Context, limit: int, email: str, starting_after: str) -> None:
    _set_command(ctx, "customer.list")
    require_mode(ctx, "customer.list")
    _emit_success(
        ctx,
        "customer.list",
        list_customers(
            ctx.obj,
            limit=limit,
            email=email or None,
            starting_after=starting_after or None,
        ),
    )


@customer_group.command("get")
@click.argument("customer_id", required=False)
@click.pass_context
def customer_get(ctx: click.Context, customer_id: str | None) -> None:
    _set_command(ctx, "customer.get")
    require_mode(ctx, "customer.get")
    _emit_success(ctx, "customer.get", read_customer(ctx.obj, customer_id=customer_id))


@customer_group.command("read")
@click.argument("customer_id")
@click.pass_context
def customer_read(ctx: click.Context, customer_id: str) -> None:
    _set_command(ctx, "customer.read")
    require_mode(ctx, "customer.read")
    _emit_success(ctx, "customer.read", read_customer(ctx.obj, customer_id=customer_id))


@customer_group.command("create")
@click.option("--email", default="", show_default=False)
@click.option("--name", default="", show_default=False)
@click.option("--description", default="", show_default=False)
@click.option("--metadata-json", default="", show_default=False)
@click.pass_context
def customer_create(
    ctx: click.Context,
    email: str,
    name: str,
    description: str,
    metadata_json: str,
) -> None:
    _set_command(ctx, "customer.create")
    require_mode(ctx, "customer.create")
    _emit_success(
        ctx,
        "customer.create",
        create_customer(
            ctx.obj,
            email=email or None,
            name=name or None,
            description=description or None,
            metadata_json=metadata_json or None,
        ),
    )


@cli.group("payment")
def payment_group() -> None:
    pass


@payment_group.command("list")
@click.option("--limit", default=10, show_default=True, type=click.IntRange(1, 100))
@click.option("--customer-id", default="", show_default=False)
@click.option("--starting-after", default="", show_default=False)
@click.option("--created-after", default="", show_default=False)
@click.option("--created-before", default="", show_default=False)
@click.pass_context
def payment_list(
    ctx: click.Context,
    limit: int,
    customer_id: str,
    starting_after: str,
    created_after: str,
    created_before: str,
) -> None:
    _set_command(ctx, "payment.list")
    require_mode(ctx, "payment.list")
    _emit_success(
        ctx,
        "payment.list",
        list_payments(
            ctx.obj,
            limit=limit,
            customer_id=customer_id or None,
            starting_after=starting_after or None,
            created_after=created_after or None,
            created_before=created_before or None,
        ),
    )


@payment_group.command("get")
@click.argument("payment_intent_id", required=False)
@click.pass_context
def payment_get(ctx: click.Context, payment_intent_id: str | None) -> None:
    _set_command(ctx, "payment.get")
    require_mode(ctx, "payment.get")
    _emit_success(ctx, "payment.get", read_payment(ctx.obj, payment_id=payment_intent_id))


@payment_group.command("read")
@click.argument("payment_intent_id")
@click.pass_context
def payment_read(ctx: click.Context, payment_intent_id: str) -> None:
    _set_command(ctx, "payment.read")
    require_mode(ctx, "payment.read")
    _emit_success(ctx, "payment.read", read_payment(ctx.obj, payment_id=payment_intent_id))


@payment_group.command("create")
@click.option("--amount", required=True, type=click.IntRange(1, 99999999))
@click.option("--currency", required=True)
@click.option("--customer-id", default="", show_default=False)
@click.option("--payment-method", default="", show_default=False, type=click.Choice(["card", "bank_transfer", "us_bank_account"]))
@click.option("--description", default="", show_default=False)
@click.option("--metadata-json", default="", show_default=False)
@click.pass_context
def payment_create(
    ctx: click.Context,
    amount: int,
    currency: str,
    customer_id: str,
    payment_method: str,
    description: str,
    metadata_json: str,
) -> None:
    _set_command(ctx, "payment.create")
    require_mode(ctx, "payment.create")
    _emit_success(
        ctx,
        "payment.create",
        create_payment(
            ctx.obj,
            amount=amount,
            currency=currency,
            customer_id=customer_id or None,
            payment_method=payment_method or None,
            description=description or None,
            metadata_json=metadata_json or None,
        ),
    )


@cli.group("subscription")
def subscription_group() -> None:
    pass


@subscription_group.command("list")
@click.option("--limit", default=10, show_default=True, type=click.IntRange(1, 100))
@click.option("--customer-id", default="", show_default=False)
@click.option("--starting-after", default="", show_default=False)
@click.pass_context
def subscription_list(ctx: click.Context, limit: int, customer_id: str, starting_after: str) -> None:
    _set_command(ctx, "subscription.list")
    require_mode(ctx, "subscription.list")
    _emit_success(
        ctx,
        "subscription.list",
        list_subscriptions(
            ctx.obj,
            limit=limit,
            customer_id=customer_id or None,
            starting_after=starting_after or None,
        ),
    )


@subscription_group.command("get")
@click.argument("subscription_id", required=False)
@click.pass_context
def subscription_get(ctx: click.Context, subscription_id: str | None) -> None:
    _set_command(ctx, "subscription.get")
    require_mode(ctx, "subscription.get")
    _emit_success(ctx, "subscription.get", read_subscription(ctx.obj, subscription_id=subscription_id))


@subscription_group.command("create")
@click.option("--customer-id", default="", show_default=False)
@click.option("--price-id", default="", show_default=False)
@click.option("--metadata-json", default="", show_default=False)
@click.pass_context
def subscription_create(ctx: click.Context, customer_id: str, price_id: str, metadata_json: str) -> None:
    _set_command(ctx, "subscription.create")
    require_mode(ctx, "subscription.create")
    _emit_success(
        ctx,
        "subscription.create",
        create_subscription(
            ctx.obj,
            customer_id=customer_id or None,
            price_id=price_id or None,
            metadata_json=metadata_json or None,
        ),
    )


@subscription_group.command("cancel")
@click.argument("subscription_id", required=False)
@click.pass_context
def subscription_cancel(ctx: click.Context, subscription_id: str | None) -> None:
    _set_command(ctx, "subscription.cancel")
    require_mode(ctx, "subscription.cancel")
    _emit_success(ctx, "subscription.cancel", cancel_subscription(ctx.obj, subscription_id=subscription_id))


@cli.group("invoice")
def invoice_group() -> None:
    pass


@invoice_group.command("list")
@click.option("--limit", default=10, show_default=True, type=click.IntRange(1, 100))
@click.option("--customer-id", default="", show_default=False)
@click.option("--status", default="", show_default=False, type=click.Choice(["draft", "open", "paid", "uncollectible", "void"]))
@click.option("--starting-after", default="", show_default=False)
@click.option("--created-after", default="", show_default=False)
@click.option("--created-before", default="", show_default=False)
@click.pass_context
def invoice_list(
    ctx: click.Context,
    limit: int,
    customer_id: str,
    status: str,
    starting_after: str,
    created_after: str,
    created_before: str,
) -> None:
    _set_command(ctx, "invoice.list")
    require_mode(ctx, "invoice.list")
    _emit_success(
        ctx,
        "invoice.list",
        list_invoices(
            ctx.obj,
            limit=limit,
            customer_id=customer_id or None,
            status=status or None,
            starting_after=starting_after or None,
            created_after=created_after or None,
            created_before=created_before or None,
        ),
    )


@invoice_group.command("get")
@click.argument("invoice_id", required=False)
@click.pass_context
def invoice_get(ctx: click.Context, invoice_id: str | None) -> None:
    _set_command(ctx, "invoice.get")
    require_mode(ctx, "invoice.get")
    _emit_success(ctx, "invoice.get", read_invoice(ctx.obj, invoice_id=invoice_id))


@invoice_group.command("read")
@click.argument("invoice_id")
@click.pass_context
def invoice_read(ctx: click.Context, invoice_id: str) -> None:
    _set_command(ctx, "invoice.read")
    require_mode(ctx, "invoice.read")
    _emit_success(ctx, "invoice.read", read_invoice(ctx.obj, invoice_id=invoice_id))


@invoice_group.command("send")
@click.argument("invoice_id", required=False)
@click.pass_context
def invoice_send(ctx: click.Context, invoice_id: str | None) -> None:
    _set_command(ctx, "invoice.send")
    require_mode(ctx, "invoice.send")
    _emit_success(ctx, "invoice.send", send_invoice(ctx.obj, invoice_id=invoice_id))


if __name__ == "__main__":
    cli()
