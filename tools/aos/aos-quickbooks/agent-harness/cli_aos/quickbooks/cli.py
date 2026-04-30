from __future__ import annotations

import json
import time
from typing import Any

import click

from . import __version__
from .runtime import (
    ALL_COMMAND_SPECS,
    COMMAND_SPECS,
    CONNECTOR_AUTH,
    CONNECTOR_CATEGORY,
    CONNECTOR_CATEGORIES,
    CONNECTOR_LABEL,
    CONNECTOR_RESOURCES,
    ConnectorError,
    GLOBAL_COMMAND_SPECS,
    MODE_ORDER,
    config_snapshot,
    doctor_snapshot,
    health_snapshot,
    run_read_command,
    run_write_command,
)

TOOL_NAME = "aos-quickbooks"


def _load_permissions() -> dict[str, str]:
    from pathlib import Path

    permissions_path = Path(__file__).resolve().parents[2] / "permissions.json"
    payload = json.loads(permissions_path.read_text())
    return payload.get("permissions", {})


def _mode_allows(actual: str, required: str) -> bool:
    return MODE_ORDER.index(actual) >= MODE_ORDER.index(required)


def _emit(payload: dict[str, Any], as_json: bool) -> None:
    if as_json:
        click.echo(json.dumps(payload, indent=2, sort_keys=True))
        return
    if payload.get("ok"):
        data = payload.get("data", {})
        preview = data.get("scope_preview")
        click.echo(preview or data.get("summary") or "OK")
    else:
        click.echo(f"ERROR: {payload['error']['message']}")


def _result(
    *,
    ok: bool,
    command: str,
    mode: str,
    started: float,
    data: dict[str, Any] | None = None,
    error: dict[str, Any] | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "ok": ok,
        "tool": TOOL_NAME,
        "command": command,
        "meta": {
            "mode": mode,
            "duration_ms": int((time.time() - started) * 1000),
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "version": __version__,
        },
    }
    if ok:
        payload["data"] = data or {}
    else:
        payload["error"] = error or {"code": "INTERNAL_ERROR", "message": "Unknown error"}
    return payload


def require_mode(ctx: click.Context, command_id: str) -> None:
    required = _load_permissions().get(command_id, "admin")
    mode = ctx.obj["mode"]
    if _mode_allows(mode, required):
        return
    payload = _result(
        ok=False,
        command=command_id,
        mode=mode,
        started=ctx.obj["started"],
        error={
            "code": "PERMISSION_DENIED",
            "message": f"Command requires mode={required}",
            "details": {"required_mode": required, "actual_mode": mode},
        },
    )
    _emit(payload, ctx.obj["json"])
    raise SystemExit(3)


def _run_read(ctx: click.Context, command_id: str, items: tuple[str, ...]) -> None:
    require_mode(ctx, command_id)
    try:
        data = run_read_command(command_id, items)
    except ConnectorError as exc:
        payload = _result(
            ok=False,
            command=command_id,
            mode=ctx.obj["mode"],
            started=ctx.obj["started"],
            error=exc.to_error(),
        )
        _emit(payload, ctx.obj["json"])
        raise SystemExit(exc.exit_code) from exc
    payload = _result(
        ok=True,
        command=command_id,
        mode=ctx.obj["mode"],
        started=ctx.obj["started"],
        data=data,
    )
    _emit(payload, ctx.obj["json"])


def _run_write(ctx: click.Context, command_id: str, items: tuple[str, ...]) -> None:
    require_mode(ctx, command_id)
    try:
        data = run_write_command(command_id, items)
    except ConnectorError as exc:
        payload = _result(
            ok=False,
            command=command_id,
            mode=ctx.obj["mode"],
            started=ctx.obj["started"],
            error=exc.to_error(),
        )
        _emit(payload, ctx.obj["json"])
        raise SystemExit(exc.exit_code) from exc
    payload = _result(
        ok=True,
        command=command_id,
        mode=ctx.obj["mode"],
        started=ctx.obj["started"],
        data=data,
    )
    _emit(payload, ctx.obj["json"])


@click.group()
@click.option("--json", "as_json", is_flag=True, help="Emit JSON output")
@click.option("--mode", type=click.Choice(MODE_ORDER), default="readonly", show_default=True)
@click.option("--verbose", is_flag=True, help="Verbose diagnostic output")
@click.version_option(__version__)
@click.pass_context
def cli(ctx: click.Context, as_json: bool, mode: str, verbose: bool) -> None:
    ctx.ensure_object(dict)
    ctx.obj.update({"json": as_json, "mode": mode, "verbose": verbose, "started": time.time()})


@cli.command("capabilities")
@click.pass_context
def capabilities(ctx: click.Context) -> None:
    require_mode(ctx, "capabilities")
    payload = {
        "tool": TOOL_NAME,
        "version": __version__,
        "manifest_schema_version": "1.0.0",
        "backend": "quickbooks-online",
        "modes": MODE_ORDER,
        "connector": {
            "label": CONNECTOR_LABEL,
            "category": CONNECTOR_CATEGORY,
            "categories": CONNECTOR_CATEGORIES,
            "resources": CONNECTOR_RESOURCES,
        },
        "auth": CONNECTOR_AUTH,
        "commands": ALL_COMMAND_SPECS,
    }
    _emit(payload, True)


@cli.group("config")
def config_group() -> None:
    pass


@config_group.command("show")
@click.pass_context
def config_show(ctx: click.Context) -> None:
    require_mode(ctx, "config.show")
    payload = _result(
        ok=True,
        command="config.show",
        mode=ctx.obj["mode"],
        started=ctx.obj["started"],
        data=config_snapshot(),
    )
    _emit(payload, ctx.obj["json"])


@cli.command("health")
@click.pass_context
def health(ctx: click.Context) -> None:
    require_mode(ctx, "health")
    payload = _result(
        ok=True,
        command="health",
        mode=ctx.obj["mode"],
        started=ctx.obj["started"],
        data=health_snapshot(),
    )
    _emit(payload, ctx.obj["json"])


@cli.command("doctor")
@click.pass_context
def doctor(ctx: click.Context) -> None:
    require_mode(ctx, "doctor")
    payload = _result(
        ok=True,
        command="doctor",
        mode=ctx.obj["mode"],
        started=ctx.obj["started"],
        data=doctor_snapshot(),
    )
    _emit(payload, ctx.obj["json"])


@cli.group("company")
def company_group() -> None:
    pass


@company_group.command("read")
@click.argument("items", nargs=-1)
@click.pass_context
def company_read(ctx: click.Context, items: tuple[str, ...]) -> None:
    _run_read(ctx, "company.read", items)


@cli.group("customer")
def customer_group() -> None:
    pass


@customer_group.command("list")
@click.argument("items", nargs=-1)
@click.pass_context
def customer_list(ctx: click.Context, items: tuple[str, ...]) -> None:
    _run_read(ctx, "customer.list", items)


@customer_group.command("search")
@click.argument("items", nargs=-1)
@click.pass_context
def customer_search(ctx: click.Context, items: tuple[str, ...]) -> None:
    _run_read(ctx, "customer.search", items)


@customer_group.command("read")
@click.argument("items", nargs=-1)
@click.pass_context
def customer_read(ctx: click.Context, items: tuple[str, ...]) -> None:
    _run_read(ctx, "customer.read", items)


@cli.group("vendor")
def vendor_group() -> None:
    pass


@vendor_group.command("list")
@click.argument("items", nargs=-1)
@click.pass_context
def vendor_list(ctx: click.Context, items: tuple[str, ...]) -> None:
    _run_read(ctx, "vendor.list", items)


@vendor_group.command("search")
@click.argument("items", nargs=-1)
@click.pass_context
def vendor_search(ctx: click.Context, items: tuple[str, ...]) -> None:
    _run_read(ctx, "vendor.search", items)


@vendor_group.command("read")
@click.argument("items", nargs=-1)
@click.pass_context
def vendor_read(ctx: click.Context, items: tuple[str, ...]) -> None:
    _run_read(ctx, "vendor.read", items)


@cli.group("invoice")
def invoice_group() -> None:
    pass


@invoice_group.command("list")
@click.argument("items", nargs=-1)
@click.pass_context
def invoice_list(ctx: click.Context, items: tuple[str, ...]) -> None:
    _run_read(ctx, "invoice.list", items)


@invoice_group.command("search")
@click.argument("items", nargs=-1)
@click.pass_context
def invoice_search(ctx: click.Context, items: tuple[str, ...]) -> None:
    _run_read(ctx, "invoice.search", items)


@invoice_group.command("read")
@click.argument("items", nargs=-1)
@click.pass_context
def invoice_read(ctx: click.Context, items: tuple[str, ...]) -> None:
    _run_read(ctx, "invoice.read", items)


@invoice_group.command("create_draft")
@click.argument("items", nargs=-1)
@click.pass_context
def invoice_create_draft(ctx: click.Context, items: tuple[str, ...]) -> None:
    _run_write(ctx, "invoice.create_draft", items)


@cli.group("bill")
def bill_group() -> None:
    pass


@bill_group.command("list")
@click.argument("items", nargs=-1)
@click.pass_context
def bill_list(ctx: click.Context, items: tuple[str, ...]) -> None:
    _run_read(ctx, "bill.list", items)


@bill_group.command("search")
@click.argument("items", nargs=-1)
@click.pass_context
def bill_search(ctx: click.Context, items: tuple[str, ...]) -> None:
    _run_read(ctx, "bill.search", items)


@bill_group.command("read")
@click.argument("items", nargs=-1)
@click.pass_context
def bill_read(ctx: click.Context, items: tuple[str, ...]) -> None:
    _run_read(ctx, "bill.read", items)


@bill_group.command("create_draft")
@click.argument("items", nargs=-1)
@click.pass_context
def bill_create_draft(ctx: click.Context, items: tuple[str, ...]) -> None:
    _run_write(ctx, "bill.create_draft", items)


@cli.group("payment")
def payment_group() -> None:
    pass


@payment_group.command("list")
@click.argument("items", nargs=-1)
@click.pass_context
def payment_list(ctx: click.Context, items: tuple[str, ...]) -> None:
    _run_read(ctx, "payment.list", items)


@payment_group.command("read")
@click.argument("items", nargs=-1)
@click.pass_context
def payment_read(ctx: click.Context, items: tuple[str, ...]) -> None:
    _run_read(ctx, "payment.read", items)


@cli.group("account")
def account_group() -> None:
    pass


@account_group.command("list")
@click.argument("items", nargs=-1)
@click.pass_context
def account_list(ctx: click.Context, items: tuple[str, ...]) -> None:
    _run_read(ctx, "account.list", items)


@account_group.command("read")
@click.argument("items", nargs=-1)
@click.pass_context
def account_read(ctx: click.Context, items: tuple[str, ...]) -> None:
    _run_read(ctx, "account.read", items)


@cli.group("transaction")
def transaction_group() -> None:
    pass


@transaction_group.command("list")
@click.argument("items", nargs=-1)
@click.pass_context
def transaction_list(ctx: click.Context, items: tuple[str, ...]) -> None:
    _run_read(ctx, "transaction.list", items)


@transaction_group.command("read")
@click.argument("items", nargs=-1)
@click.pass_context
def transaction_read(ctx: click.Context, items: tuple[str, ...]) -> None:
    _run_read(ctx, "transaction.read", items)


if __name__ == "__main__":
    cli()
