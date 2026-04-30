from __future__ import annotations

from functools import lru_cache
import json
from pathlib import Path
from typing import Any

import click

from .output import dumps
from . import runtime

MODE_ORDER = ["readonly", "write"]
PERMISSIONS_PATH = Path(__file__).resolve().parents[2] / "permissions.json"


@click.group(context_settings={"help_option_names": ["-h", "--help"]})
@click.option("--json/--no-json", "json_output", default=True, show_default=True)
@click.option("--mode", type=click.Choice(MODE_ORDER), default="readonly", show_default=True)
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


@lru_cache(maxsize=1)
def load_permissions() -> dict[str, str]:
    return json.loads(PERMISSIONS_PATH.read_text()).get("permissions", {})


def require_mode(ctx: click.Context, command_id: str) -> None:
    required_mode = load_permissions().get(command_id, "write")
    actual_mode = ctx.obj.get("mode", "readonly")
    if MODE_ORDER.index(actual_mode) >= MODE_ORDER.index(required_mode):
        return
    emit(
        ctx,
        {
            "tool": "aos-woocommerce",
            "backend": "woocommerce-rest-api",
            "error": {
                "code": "PERMISSION_DENIED",
                "message": f"Command requires mode={required_mode}",
                "details": {"required_mode": required_mode, "actual_mode": actual_mode},
            },
        },
        exit_code=3,
    )


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
def order(ctx: click.Context) -> None:
    del ctx


@order.command(name="list")
@click.option("--status", type=str, default=None)
@click.option("--customer-id", type=str, default=None)
@click.option("--limit", type=int, default=10, show_default=True)
@click.pass_context
def order_list(ctx: click.Context, status: str | None, customer_id: str | None, limit: int) -> None:
    emit(ctx, runtime.build_order_list_payload(status=status, customer_id=customer_id, limit=limit))


@order.command(name="get")
@click.option("--order-id", type=str, default=None)
@click.pass_context
def order_get(ctx: click.Context, order_id: str | None) -> None:
    emit(ctx, runtime.build_order_get_payload(order_id=order_id))


@cli.group()
@click.pass_context
def product(ctx: click.Context) -> None:
    del ctx


@product.command(name="list")
@click.option("--status", type=str, default=None)
@click.option("--sku", type=str, default=None)
@click.option("--limit", type=int, default=10, show_default=True)
@click.pass_context
def product_list(ctx: click.Context, status: str | None, sku: str | None, limit: int) -> None:
    emit(ctx, runtime.build_product_list_payload(status=status, sku=sku, limit=limit))


@product.command(name="get")
@click.option("--product-id", type=str, default=None)
@click.pass_context
def product_get(ctx: click.Context, product_id: str | None) -> None:
    emit(ctx, runtime.build_product_get_payload(product_id=product_id))


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


@cli.group()
@click.pass_context
def coupon(ctx: click.Context) -> None:
    del ctx


@coupon.command(name="list")
@click.option("--limit", type=int, default=10, show_default=True)
@click.pass_context
def coupon_list(ctx: click.Context, limit: int) -> None:
    emit(ctx, runtime.build_coupon_list_payload(limit=limit))


@cli.group()
@click.pass_context
def report(ctx: click.Context) -> None:
    del ctx


@report.command(name="sales")
@click.pass_context
def report_sales(ctx: click.Context) -> None:
    emit(ctx, runtime.build_report_sales_payload())


@report.command(name="top-sellers")
@click.pass_context
def report_top_sellers(ctx: click.Context) -> None:
    emit(ctx, runtime.build_report_top_sellers_payload())


if __name__ == "__main__":
    cli()
