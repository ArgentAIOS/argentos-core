from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import click

from .output import dumps
from . import runtime

MODE_ORDER = ("readonly", "write")
PERMISSIONS_PATH = Path(__file__).resolve().parents[2] / "permissions.json"


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


def _mode_allows(actual: str, required: str) -> bool:
    return MODE_ORDER.index(actual) >= MODE_ORDER.index(required)


def _load_permissions() -> dict[str, str]:
    payload = json.loads(PERMISSIONS_PATH.read_text())
    return payload.get("permissions", {})


def require_mode(ctx: click.Context, command_id: str) -> None:
    required = _load_permissions().get(command_id, "readonly")
    actual = ctx.obj.get("mode", "readonly")
    if _mode_allows(actual, required):
        return
    emit(
        ctx,
        {
            "tool": runtime.TOOL_NAME,
            "backend": runtime.BACKEND_NAME,
            "command": command_id,
            "error": {
                "code": "PERMISSION_DENIED",
                "message": f"Command requires mode={required}",
                "details": {
                    "required_mode": required,
                    "actual_mode": actual,
                },
            },
        },
        exit_code=3,
    )


@cli.command()
@click.pass_context
def capabilities(ctx: click.Context) -> None:
    require_mode(ctx, "capabilities")
    emit(ctx, runtime.build_capabilities_payload())


@cli.group()
@click.pass_context
def config(ctx: click.Context) -> None:
    del ctx


@config.command(name="show")
@click.pass_context
def config_show(ctx: click.Context) -> None:
    require_mode(ctx, "config.show")
    emit(ctx, runtime.build_config_show_payload())


@cli.command()
@click.pass_context
def health(ctx: click.Context) -> None:
    require_mode(ctx, "health")
    emit(ctx, runtime.build_health_payload())


@cli.command()
@click.pass_context
def doctor(ctx: click.Context) -> None:
    require_mode(ctx, "doctor")
    emit(ctx, runtime.build_doctor_payload())


@cli.group()
@click.pass_context
def location(ctx: click.Context) -> None:
    del ctx


@location.command(name="list")
@click.option("--limit", type=int, default=10, show_default=True)
@click.pass_context
def location_list(ctx: click.Context, limit: int) -> None:
    require_mode(ctx, "location.list")
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
    require_mode(ctx, "payment.list")
    emit(ctx, runtime.build_payment_list_payload(location_id=location_id, limit=limit))


@payment.command(name="get")
@click.option("--payment-id", type=str, default=None)
@click.pass_context
def payment_get(ctx: click.Context, payment_id: str | None) -> None:
    require_mode(ctx, "payment.get")
    emit(ctx, runtime.build_payment_get_payload(payment_id=payment_id))


@cli.group()
@click.pass_context
def customer(ctx: click.Context) -> None:
    del ctx


@customer.command(name="list")
@click.option("--limit", type=int, default=10, show_default=True)
@click.pass_context
def customer_list(ctx: click.Context, limit: int) -> None:
    require_mode(ctx, "customer.list")
    emit(ctx, runtime.build_customer_list_payload(limit=limit))


@customer.command(name="get")
@click.option("--customer-id", type=str, default=None)
@click.pass_context
def customer_get(ctx: click.Context, customer_id: str | None) -> None:
    require_mode(ctx, "customer.get")
    emit(ctx, runtime.build_customer_get_payload(customer_id=customer_id))


@cli.group()
@click.pass_context
def order(ctx: click.Context) -> None:
    del ctx


@order.command(name="list")
@click.option("--location-id", type=str, default=None)
@click.option("--limit", type=int, default=10, show_default=True)
@click.pass_context
def order_list(ctx: click.Context, location_id: str | None, limit: int) -> None:
    require_mode(ctx, "order.list")
    emit(ctx, runtime.build_order_list_payload(location_id=location_id, limit=limit))


@order.command(name="get")
@click.option("--order-id", type=str, default=None)
@click.pass_context
def order_get(ctx: click.Context, order_id: str | None) -> None:
    require_mode(ctx, "order.get")
    emit(ctx, runtime.build_order_get_payload(order_id=order_id))


@cli.group()
@click.pass_context
def item(ctx: click.Context) -> None:
    del ctx


@item.command(name="list")
@click.option("--limit", type=int, default=10, show_default=True)
@click.pass_context
def item_list(ctx: click.Context, limit: int) -> None:
    require_mode(ctx, "item.list")
    emit(ctx, runtime.build_item_list_payload(limit=limit))


@item.command(name="get")
@click.option("--item-id", type=str, default=None)
@click.pass_context
def item_get(ctx: click.Context, item_id: str | None) -> None:
    require_mode(ctx, "item.get")
    emit(ctx, runtime.build_item_get_payload(item_id=item_id))


@cli.group()
@click.pass_context
def invoice(ctx: click.Context) -> None:
    del ctx


@invoice.command(name="list")
@click.option("--location-id", type=str, default=None)
@click.option("--limit", type=int, default=10, show_default=True)
@click.pass_context
def invoice_list(ctx: click.Context, location_id: str | None, limit: int) -> None:
    require_mode(ctx, "invoice.list")
    emit(ctx, runtime.build_invoice_list_payload(location_id=location_id, limit=limit))


if __name__ == "__main__":
    cli()
