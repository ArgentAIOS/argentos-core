from __future__ import annotations

from typing import Any

import click

from .output import dumps
from . import runtime


@click.group(context_settings={"help_option_names": ["-h", "--help"]})
@click.option("--json/--no-json", "json_output", default=True, show_default=True)
@click.option("--mode", type=click.Choice(["readonly", "write"]), default="readonly", show_default=True)
@click.pass_context
def cli(ctx: click.Context, json_output: bool, mode: str) -> None:
    ctx.ensure_object(dict)
    ctx.obj["json_output"] = json_output
    ctx.obj["mode"] = mode


def emit(ctx: click.Context, payload: dict[str, Any], *, exit_code: int = 0) -> None:
    if ctx.obj.get("json_output", True):
        click.echo(dumps(payload))
    else:
        click.echo(payload)
    raise SystemExit(exit_code)


@cli.command()
@click.pass_context
def capabilities(ctx: click.Context) -> None:
    emit(ctx, runtime.build_capabilities_payload())


@cli.group()
@click.pass_context
def config(ctx: click.Context) -> None:
    del ctx


@config.command(name="show")
@click.pass_context
def config_show(ctx: click.Context) -> None:
    emit(ctx, runtime.build_config_show_payload())


@cli.command()
@click.pass_context
def health(ctx: click.Context) -> None:
    emit(ctx, runtime.build_health_payload())


@cli.command()
@click.pass_context
def doctor(ctx: click.Context) -> None:
    emit(ctx, runtime.build_doctor_payload())


@cli.group()
@click.pass_context
def location(ctx: click.Context) -> None:
    del ctx


@location.command(name="list")
@click.option("--limit", type=int, default=10, show_default=True)
@click.pass_context
def location_list(ctx: click.Context, limit: int) -> None:
    emit(ctx, runtime.build_location_list_payload(limit=limit))


@cli.group()
@click.pass_context
def payment(ctx: click.Context) -> None:
    del ctx


@payment.command(name="list")
@click.option("--location-id", type=str, default=None)
@click.option("--limit", type=int, default=10, show_default=True)
@click.pass_context
def payment_list(ctx: click.Context, location_id: str | None, limit: int) -> None:
    emit(ctx, runtime.build_payment_list_payload(location_id=location_id, limit=limit))


@payment.command(name="get")
@click.option("--payment-id", type=str, default=None)
@click.pass_context
def payment_get(ctx: click.Context, payment_id: str | None) -> None:
    emit(ctx, runtime.build_payment_get_payload(payment_id=payment_id))


@payment.command(name="create")
@click.option("--amount", type=str, default=None)
@click.option("--currency", type=str, default=None)
@click.option("--location-id", type=str, default=None)
@click.pass_context
def payment_create(ctx: click.Context, amount: str | None, currency: str | None, location_id: str | None) -> None:
    emit(ctx, runtime.build_payment_create_payload(amount=amount, currency=currency, location_id=location_id))


@cli.group()
@click.pass_context
def customer(ctx: click.Context) -> None:
    del ctx


@customer.command(name="list")
@click.option("--limit", type=int, default=10, show_default=True)
@click.pass_context
def customer_list(ctx: click.Context, limit: int) -> None:
    emit(ctx, runtime.build_customer_list_payload(limit=limit))


@customer.command(name="get")
@click.option("--customer-id", type=str, default=None)
@click.pass_context
def customer_get(ctx: click.Context, customer_id: str | None) -> None:
    emit(ctx, runtime.build_customer_get_payload(customer_id=customer_id))


@customer.command(name="create")
@click.option("--email", type=str, default=None)
@click.pass_context
def customer_create(ctx: click.Context, email: str | None) -> None:
    emit(ctx, runtime.build_customer_create_payload(email=email))


@customer.command(name="update")
@click.option("--customer-id", type=str, default=None)
@click.option("--email", type=str, default=None)
@click.pass_context
def customer_update(ctx: click.Context, customer_id: str | None, email: str | None) -> None:
    emit(ctx, runtime.build_customer_update_payload(customer_id=customer_id, email=email))


@cli.group()
@click.pass_context
def order(ctx: click.Context) -> None:
    del ctx


@order.command(name="list")
@click.option("--location-id", type=str, default=None)
@click.option("--limit", type=int, default=10, show_default=True)
@click.pass_context
def order_list(ctx: click.Context, location_id: str | None, limit: int) -> None:
    emit(ctx, runtime.build_order_list_payload(location_id=location_id, limit=limit))


@order.command(name="get")
@click.option("--order-id", type=str, default=None)
@click.pass_context
def order_get(ctx: click.Context, order_id: str | None) -> None:
    emit(ctx, runtime.build_order_get_payload(order_id=order_id))


@order.command(name="create")
@click.option("--location-id", type=str, default=None)
@click.pass_context
def order_create(ctx: click.Context, location_id: str | None) -> None:
    emit(ctx, runtime.build_order_create_payload(location_id=location_id))


@cli.group()
@click.pass_context
def item(ctx: click.Context) -> None:
    del ctx


@item.command(name="list")
@click.option("--limit", type=int, default=10, show_default=True)
@click.pass_context
def item_list(ctx: click.Context, limit: int) -> None:
    emit(ctx, runtime.build_item_list_payload(limit=limit))


@item.command(name="get")
@click.option("--item-id", type=str, default=None)
@click.pass_context
def item_get(ctx: click.Context, item_id: str | None) -> None:
    emit(ctx, runtime.build_item_get_payload(item_id=item_id))


@item.command(name="create")
@click.option("--item-name", type=str, default=None)
@click.pass_context
def item_create(ctx: click.Context, item_name: str | None) -> None:
    emit(ctx, runtime.build_item_create_payload(item_name=item_name))


@cli.group()
@click.pass_context
def invoice(ctx: click.Context) -> None:
    del ctx


@invoice.command(name="list")
@click.option("--location-id", type=str, default=None)
@click.option("--limit", type=int, default=10, show_default=True)
@click.pass_context
def invoice_list(ctx: click.Context, location_id: str | None, limit: int) -> None:
    emit(ctx, runtime.build_invoice_list_payload(location_id=location_id, limit=limit))


@invoice.command(name="create")
@click.option("--location-id", type=str, default=None)
@click.option("--customer-id", type=str, default=None)
@click.pass_context
def invoice_create(ctx: click.Context, location_id: str | None, customer_id: str | None) -> None:
    emit(ctx, runtime.build_invoice_create_payload(location_id=location_id, customer_id=customer_id))


@invoice.command(name="send")
@click.option("--invoice-id", type=str, default=None)
@click.pass_context
def invoice_send(ctx: click.Context, invoice_id: str | None) -> None:
    emit(ctx, runtime.build_invoice_send_payload(invoice_id=invoice_id))


if __name__ == "__main__":
    cli()
