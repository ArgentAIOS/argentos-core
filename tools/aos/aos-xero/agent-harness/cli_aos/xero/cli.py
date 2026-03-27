from __future__ import annotations

import json
import time
from typing import Any

import click

from . import __version__
from .runtime import (
    BACKEND_NAME,
    capabilities_snapshot,
    config_snapshot,
    doctor_snapshot,
    health_snapshot,
    run_read_command,
    scaffold_write_command,
)
from .constants import MODE_ORDER, PERMISSIONS_PATH
from .errors import CliError

TOOL_NAME = "aos-xero"


def _load_permissions() -> dict[str, str]:
    payload = json.loads(PERMISSIONS_PATH.read_text())
    return payload.get("permissions", {})


def _mode_allows(actual: str, required: str) -> bool:
    return MODE_ORDER.index(actual) >= MODE_ORDER.index(required)


def _emit(payload: dict[str, Any], as_json: bool) -> None:
    if as_json:
        click.echo(json.dumps(payload, indent=2, sort_keys=True))
        return
    if payload.get("ok"):
        data = payload.get("data", {})
        click.echo(data.get("summary") or payload.get("command") or "OK")
        return
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
        data = run_read_command(command_id, items, ctx.obj)
    except CliError as exc:
        payload = _result(
            ok=False,
            command=command_id,
            mode=ctx.obj["mode"],
            started=ctx.obj["started"],
            error={"code": exc.code, "message": exc.message, "details": exc.details},
        )
        _emit(payload, ctx.obj["json"])
        raise SystemExit(exc.exit_code) from exc
    payload = _result(ok=True, command=command_id, mode=ctx.obj["mode"], started=ctx.obj["started"], data=data)
    _emit(payload, ctx.obj["json"])


def _run_scaffold(ctx: click.Context, command_id: str, items: tuple[str, ...]) -> None:
    require_mode(ctx, command_id)
    scaffold = scaffold_write_command(command_id, items, ctx.obj)
    payload = _result(
        ok=False,
        command=command_id,
        mode=ctx.obj["mode"],
        started=ctx.obj["started"],
        error={
            "code": "NOT_IMPLEMENTED",
            "message": f"{command_id} is scaffolded but not implemented yet",
            "details": scaffold,
        },
    )
    _emit(payload, ctx.obj["json"])
    raise SystemExit(10)


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
    _emit(_result(ok=True, command="capabilities", mode=ctx.obj["mode"], started=ctx.obj["started"], data=capabilities_snapshot()), ctx.obj["json"])


@cli.group("config")
def config_group() -> None:
    pass


@config_group.command("show")
@click.pass_context
def config_show(ctx: click.Context) -> None:
    require_mode(ctx, "config.show")
    _emit(_result(ok=True, command="config.show", mode=ctx.obj["mode"], started=ctx.obj["started"], data=config_snapshot(ctx.obj)), ctx.obj["json"])


@cli.command("health")
@click.pass_context
def health(ctx: click.Context) -> None:
    require_mode(ctx, "health")
    _emit(_result(ok=True, command="health", mode=ctx.obj["mode"], started=ctx.obj["started"], data=health_snapshot(ctx.obj)), ctx.obj["json"])


@cli.command("doctor")
@click.pass_context
def doctor(ctx: click.Context) -> None:
    require_mode(ctx, "doctor")
    _emit(_result(ok=True, command="doctor", mode=ctx.obj["mode"], started=ctx.obj["started"], data=doctor_snapshot(ctx.obj)), ctx.obj["json"])


@cli.group("invoice")
def invoice_group() -> None:
    pass


@invoice_group.command("list")
@click.argument("items", nargs=-1)
@click.pass_context
def invoice_list(ctx: click.Context, items: tuple[str, ...]) -> None:
    _run_read(ctx, "invoice.list", items)


@invoice_group.command("get")
@click.argument("items", nargs=-1)
@click.pass_context
def invoice_get(ctx: click.Context, items: tuple[str, ...]) -> None:
    _run_read(ctx, "invoice.get", items)


@invoice_group.command("create")
@click.argument("items", nargs=-1)
@click.pass_context
def invoice_create(ctx: click.Context, items: tuple[str, ...]) -> None:
    _run_scaffold(ctx, "invoice.create", items)


@invoice_group.command("send")
@click.argument("items", nargs=-1)
@click.pass_context
def invoice_send(ctx: click.Context, items: tuple[str, ...]) -> None:
    _run_scaffold(ctx, "invoice.send", items)


@cli.group("contact")
def contact_group() -> None:
    pass


@contact_group.command("list")
@click.argument("items", nargs=-1)
@click.pass_context
def contact_list(ctx: click.Context, items: tuple[str, ...]) -> None:
    _run_read(ctx, "contact.list", items)


@contact_group.command("get")
@click.argument("items", nargs=-1)
@click.pass_context
def contact_get(ctx: click.Context, items: tuple[str, ...]) -> None:
    _run_read(ctx, "contact.get", items)


@contact_group.command("create")
@click.argument("items", nargs=-1)
@click.pass_context
def contact_create(ctx: click.Context, items: tuple[str, ...]) -> None:
    _run_scaffold(ctx, "contact.create", items)


@cli.group("payment")
def payment_group() -> None:
    pass


@payment_group.command("list")
@click.argument("items", nargs=-1)
@click.pass_context
def payment_list(ctx: click.Context, items: tuple[str, ...]) -> None:
    _run_read(ctx, "payment.list", items)


@payment_group.command("get")
@click.argument("items", nargs=-1)
@click.pass_context
def payment_get(ctx: click.Context, items: tuple[str, ...]) -> None:
    _run_read(ctx, "payment.get", items)


@payment_group.command("create")
@click.argument("items", nargs=-1)
@click.pass_context
def payment_create(ctx: click.Context, items: tuple[str, ...]) -> None:
    _run_scaffold(ctx, "payment.create", items)


@cli.group("account")
def account_group() -> None:
    pass


@account_group.command("list")
@click.argument("items", nargs=-1)
@click.pass_context
def account_list(ctx: click.Context, items: tuple[str, ...]) -> None:
    _run_read(ctx, "account.list", items)


@cli.group("bank_transaction")
def bank_transaction_group() -> None:
    pass


@bank_transaction_group.command("list")
@click.argument("items", nargs=-1)
@click.pass_context
def bank_transaction_list(ctx: click.Context, items: tuple[str, ...]) -> None:
    _run_read(ctx, "bank_transaction.list", items)


@bank_transaction_group.command("create")
@click.argument("items", nargs=-1)
@click.pass_context
def bank_transaction_create(ctx: click.Context, items: tuple[str, ...]) -> None:
    _run_scaffold(ctx, "bank_transaction.create", items)


@cli.group("report")
def report_group() -> None:
    pass


@report_group.command("profit-loss")
@click.argument("items", nargs=-1)
@click.pass_context
def report_profit_loss(ctx: click.Context, items: tuple[str, ...]) -> None:
    _run_read(ctx, "report.profit_loss", items)

@report_group.command("balance-sheet")
@click.argument("items", nargs=-1)
@click.pass_context
def report_balance_sheet(ctx: click.Context, items: tuple[str, ...]) -> None:
    _run_read(ctx, "report.balance_sheet", items)


@cli.group("quote")
def quote_group() -> None:
    pass


@quote_group.command("list")
@click.argument("items", nargs=-1)
@click.pass_context
def quote_list(ctx: click.Context, items: tuple[str, ...]) -> None:
    _run_read(ctx, "quote.list", items)


@quote_group.command("create")
@click.argument("items", nargs=-1)
@click.pass_context
def quote_create(ctx: click.Context, items: tuple[str, ...]) -> None:
    _run_scaffold(ctx, "quote.create", items)
