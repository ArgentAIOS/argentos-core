from __future__ import annotations

import json
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import click

from . import __version__
from .config import redacted_config_snapshot
from .constants import MANIFEST_SCHEMA_VERSION, MODE_ORDER, TOOL_NAME
from .errors import CliError
from .output import emit, failure, success
from .runtime import (
    customer_list_snapshot,
    customer_read_snapshot,
    doctor_snapshot,
    health_snapshot,
    order_list_snapshot,
    order_read_snapshot,
    product_list_snapshot,
    product_read_snapshot,
    scaffold_result,
    shop_read_snapshot,
)


def _permissions() -> dict[str, str]:
    payload = json.loads((Path(__file__).resolve().parents[2] / "permissions.json").read_text())
    return payload.get("permissions", {})


def _mode_allows(actual: str, required: str) -> bool:
    return MODE_ORDER.index(actual) >= MODE_ORDER.index(required)


def require_mode(ctx: click.Context, command_id: str) -> None:
    required = _permissions().get(command_id, "admin")
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
                tool=TOOL_NAME,
                command=ctx.obj.get("_command_id", "unknown") if ctx.obj else "unknown",
                mode=ctx.obj.get("mode", "unknown") if ctx.obj else "unknown",
                started=ctx.obj.get("started", time.time()) if ctx.obj else time.time(),
                version=ctx.obj.get("version", __version__) if ctx.obj else __version__,
                error={"code": err.code, "message": err.message, "details": err.details},
            )
            emit(payload, as_json=ctx.obj.get("json", True) if ctx.obj else True)
            ctx.exit(err.exit_code)
        except click.ClickException as err:
            payload = failure(
                tool=TOOL_NAME,
                command=ctx.obj.get("_command_id", "unknown") if ctx.obj else "unknown",
                mode=ctx.obj.get("mode", "unknown") if ctx.obj else "unknown",
                started=ctx.obj.get("started", time.time()) if ctx.obj else time.time(),
                version=ctx.obj.get("version", __version__) if ctx.obj else __version__,
                error={"code": "INVALID_USAGE", "message": str(err), "details": {}},
            )
            emit(payload, as_json=ctx.obj.get("json", True) if ctx.obj else True)
            ctx.exit(2)


def _set_command(ctx: click.Context, command_id: str) -> None:
    ctx.obj["_command_id"] = command_id


def _result(ctx: click.Context, *, command: str, data: dict[str, Any]) -> dict[str, Any]:
    return success(
        tool=TOOL_NAME,
        command=command,
        mode=ctx.obj["mode"],
        started=ctx.obj["started"],
        version=ctx.obj["version"],
        data=data,
    )


def _scaffold_command(
    ctx: click.Context,
    *,
    command_id: str,
    resource: str,
    operation: str,
    inputs: dict[str, Any],
    consequential: bool = False,
) -> None:
    _set_command(ctx, command_id)
    require_mode(ctx, command_id)
    emit(
        _result(
            ctx,
            command=command_id,
            data=scaffold_result(
                ctx.obj,
                command_id=command_id,
                resource=resource,
                operation=operation,
                inputs=inputs,
                consequential=consequential,
            ),
        ),
        as_json=ctx.obj["json"],
    )


def _live_command(ctx: click.Context, *, command_id: str, reader) -> None:
    _set_command(ctx, command_id)
    require_mode(ctx, command_id)
    emit(_result(ctx, command=command_id, data=reader()), as_json=ctx.obj["json"])


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
    manifest = json.loads((Path(__file__).resolve().parents[3] / "connector.json").read_text())
    payload = {
        "tool": manifest["tool"],
        "version": __version__,
        "manifest_schema_version": MANIFEST_SCHEMA_VERSION,
        "backend": manifest["backend"],
        "connector": manifest["connector"],
        "scope": manifest.get("scope"),
        "auth": manifest["auth"],
        "commands": manifest["commands"],
    }
    emit(payload, as_json=True)


@cli.group("config")
def config_group() -> None:
    pass


@config_group.command("show")
@click.pass_context
def config_show(ctx: click.Context) -> None:
    _set_command(ctx, "config.show")
    require_mode(ctx, "config.show")
    emit(_result(ctx, command="config.show", data=redacted_config_snapshot()), as_json=ctx.obj["json"])


@cli.command("health")
@click.pass_context
def health(ctx: click.Context) -> None:
    _set_command(ctx, "health")
    require_mode(ctx, "health")
    emit(_result(ctx, command="health", data=health_snapshot(ctx.obj)), as_json=ctx.obj["json"])


@cli.command("doctor")
@click.pass_context
def doctor(ctx: click.Context) -> None:
    _set_command(ctx, "doctor")
    require_mode(ctx, "doctor")
    emit(_result(ctx, command="doctor", data=doctor_snapshot(ctx.obj)), as_json=ctx.obj["json"])


@cli.group("shop")
def shop_group() -> None:
    pass


@shop_group.command("read")
@click.pass_context
def shop_read(ctx: click.Context) -> None:
    _live_command(ctx, command_id="shop.read", reader=shop_read_snapshot)


@cli.group("product")
def product_group() -> None:
    pass


@product_group.command("list")
@click.option("--limit", default=10, show_default=True, type=click.IntRange(1, 250))
@click.option("--status", default="", show_default=False)
@click.pass_context
def product_list(ctx: click.Context, limit: int, status: str) -> None:
    _live_command(
        ctx,
        command_id="product.list",
        reader=lambda: product_list_snapshot(limit=limit, status=status or None),
    )


@product_group.command("read")
@click.argument("product_id")
@click.pass_context
def product_read(ctx: click.Context, product_id: str) -> None:
    _live_command(ctx, command_id="product.read", reader=lambda: product_read_snapshot(product_id=product_id))


@product_group.command("update")
@click.argument("product_id")
@click.option("--title", default="", show_default=False)
@click.option("--status", default="", show_default=False)
@click.pass_context
def product_update(ctx: click.Context, product_id: str, title: str, status: str) -> None:
    _scaffold_command(
        ctx,
        command_id="product.update",
        resource="product",
        operation="update",
        inputs={"product_id": product_id, "title": title or None, "status": status or None},
        consequential=True,
    )


@cli.group("order")
def order_group() -> None:
    pass


@order_group.command("list")
@click.option("--limit", default=10, show_default=True, type=click.IntRange(1, 250))
@click.option("--status", default="", show_default=False)
@click.option("--created-after", default="", show_default=False)
@click.option("--created-before", default="", show_default=False)
@click.pass_context
def order_list(
    ctx: click.Context,
    limit: int,
    status: str,
    created_after: str,
    created_before: str,
) -> None:
    _live_command(
        ctx,
        command_id="order.list",
        reader=lambda: order_list_snapshot(
            limit=limit,
            status=status or None,
            created_after=created_after or None,
            created_before=created_before or None,
        ),
    )


@order_group.command("read")
@click.argument("order_id")
@click.pass_context
def order_read(ctx: click.Context, order_id: str) -> None:
    _live_command(ctx, command_id="order.read", reader=lambda: order_read_snapshot(order_id=order_id))


@order_group.command("cancel")
@click.argument("order_id")
@click.option("--reason", default="", show_default=False)
@click.pass_context
def order_cancel(ctx: click.Context, order_id: str, reason: str) -> None:
    _scaffold_command(
        ctx,
        command_id="order.cancel",
        resource="order",
        operation="cancel",
        inputs={"order_id": order_id, "reason": reason or None},
        consequential=True,
    )


@cli.group("customer")
def customer_group() -> None:
    pass


@customer_group.command("list")
@click.option("--limit", default=10, show_default=True, type=click.IntRange(1, 250))
@click.option("--email", default="", show_default=False)
@click.option("--created-after", default="", show_default=False)
@click.option("--created-before", default="", show_default=False)
@click.pass_context
def customer_list(
    ctx: click.Context,
    limit: int,
    email: str,
    created_after: str,
    created_before: str,
) -> None:
    _live_command(
        ctx,
        command_id="customer.list",
        reader=lambda: customer_list_snapshot(
            limit=limit,
            email=email or None,
            created_after=created_after or None,
            created_before=created_before or None,
        ),
    )


@customer_group.command("read")
@click.argument("customer_id")
@click.pass_context
def customer_read(ctx: click.Context, customer_id: str) -> None:
    _live_command(ctx, command_id="customer.read", reader=lambda: customer_read_snapshot(customer_id=customer_id))


@cli.group("fulfillment")
def fulfillment_group() -> None:
    pass


@fulfillment_group.command("create")
@click.argument("order_id")
@click.option("--tracking-number", default="", show_default=False)
@click.pass_context
def fulfillment_create(ctx: click.Context, order_id: str, tracking_number: str) -> None:
    _scaffold_command(
        ctx,
        command_id="fulfillment.create",
        resource="fulfillment",
        operation="create",
        inputs={"order_id": order_id, "tracking_number": tracking_number or None},
        consequential=True,
    )


if __name__ == "__main__":
    cli()
