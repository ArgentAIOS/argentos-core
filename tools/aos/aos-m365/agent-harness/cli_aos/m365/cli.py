from __future__ import annotations

import json
import time
from datetime import datetime, timezone
from typing import Any

import click

from . import __version__
from .bridge import config_snapshot
from .constants import COMMAND_SPECS, CONNECTOR_AUTH, CONNECTOR_CATEGORY, CONNECTOR_CATEGORIES, CONNECTOR_LABEL, CONNECTOR_RESOURCES, GLOBAL_COMMAND_SPECS, MANIFEST_SCHEMA_VERSION, MODE_ORDER, TOOL_NAME
from .runtime import doctor_snapshot, health_snapshot, run_read_command, scaffold_write_command
from .errors import ConnectorError


def _mode_allows(actual: str, required: str) -> bool:
    return MODE_ORDER.index(actual) >= MODE_ORDER.index(required)


def _load_permissions() -> dict[str, str]:
    from pathlib import Path

    permissions_path = Path(__file__).resolve().parents[2] / "permissions.json"
    payload = json.loads(permissions_path.read_text())
    return payload.get("permissions", {})


def _emit(payload: dict[str, Any], as_json: bool) -> None:
    if as_json:
        click.echo(json.dumps(payload, indent=2, sort_keys=True))
        return
    if payload.get("ok"):
        summary = payload.get("data", {}).get("summary")
        click.echo(summary or "OK")
    else:
        error = payload.get("error", {})
        click.echo(f"ERROR: {error.get('message', 'Unknown error')}")


def _result(
    *,
    ok: bool,
    command: str,
    mode: str,
    started: float,
    data: dict[str, Any] | None = None,
    error: dict[str, Any] | None = None,
) -> dict[str, Any]:
    base = {
        "ok": ok,
        "tool": TOOL_NAME,
        "command": command,
        "meta": {
            "mode": mode,
            "duration_ms": int((time.time() - started) * 1000),
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "version": __version__,
        },
    }
    if ok:
        base["data"] = data or {}
    else:
        base["error"] = error or {"code": "INTERNAL_ERROR", "message": "Unknown error"}
    return base


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


def _run_scaffold(ctx: click.Context, command_id: str, items: tuple[str, ...]) -> None:
    require_mode(ctx, command_id)
    scaffold = scaffold_write_command(command_id, items)
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
    payload = {
        "tool": TOOL_NAME,
        "version": __version__,
        "manifest_schema_version": MANIFEST_SCHEMA_VERSION,
        "backend": "microsoft-graph",
        "modes": MODE_ORDER,
        "connector": {
            "label": CONNECTOR_LABEL,
            "category": CONNECTOR_CATEGORY,
            "categories": CONNECTOR_CATEGORIES,
            "resources": CONNECTOR_RESOURCES,
        },
        "auth": CONNECTOR_AUTH,
        "commands": [*GLOBAL_COMMAND_SPECS, *COMMAND_SPECS],
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


@cli.group("mail")
def mail_group() -> None:
    pass


@mail_group.command("search")
@click.argument("items", nargs=-1)
@click.pass_context
def mail_search(ctx: click.Context, items: tuple[str, ...]) -> None:
    _run_read(ctx, "mail.search", items)


@mail_group.command("read")
@click.argument("items", nargs=-1)
@click.pass_context
def mail_read(ctx: click.Context, items: tuple[str, ...]) -> None:
    _run_read(ctx, "mail.read", items)


@mail_group.command("reply")
@click.argument("items", nargs=-1)
@click.pass_context
def mail_reply(ctx: click.Context, items: tuple[str, ...]) -> None:
    _run_scaffold(ctx, "mail.reply", items)


@mail_group.command("send")
@click.argument("items", nargs=-1)
@click.pass_context
def mail_send(ctx: click.Context, items: tuple[str, ...]) -> None:
    _run_scaffold(ctx, "mail.send", items)


@cli.group("calendar")
def calendar_group() -> None:
    pass


@calendar_group.command("list")
@click.argument("items", nargs=-1)
@click.pass_context
def calendar_list(ctx: click.Context, items: tuple[str, ...]) -> None:
    _run_read(ctx, "calendar.list", items)


@calendar_group.command("create")
@click.argument("items", nargs=-1)
@click.pass_context
def calendar_create(ctx: click.Context, items: tuple[str, ...]) -> None:
    _run_scaffold(ctx, "calendar.create", items)


@cli.group("file")
def file_group() -> None:
    pass


@file_group.command("list")
@click.argument("items", nargs=-1)
@click.pass_context
def file_list(ctx: click.Context, items: tuple[str, ...]) -> None:
    _run_read(ctx, "file.list", items)


@cli.group("excel")
def excel_group() -> None:
    pass


@excel_group.command("list-workbooks")
@click.argument("items", nargs=-1)
@click.pass_context
def excel_list_workbooks(ctx: click.Context, items: tuple[str, ...]) -> None:
    _run_read(ctx, "excel.list_workbooks", items)


@excel_group.command("list-worksheets")
@click.argument("items", nargs=-1)
@click.pass_context
def excel_list_worksheets(ctx: click.Context, items: tuple[str, ...]) -> None:
    _run_read(ctx, "excel.list_worksheets", items)


@excel_group.command("used-range")
@click.argument("items", nargs=-1)
@click.pass_context
def excel_used_range(ctx: click.Context, items: tuple[str, ...]) -> None:
    _run_read(ctx, "excel.used_range", items)


@excel_group.command("read-rows")
@click.argument("items", nargs=-1)
@click.pass_context
def excel_read_rows(ctx: click.Context, items: tuple[str, ...]) -> None:
    _run_read(ctx, "excel.read_rows", items)


@excel_group.command("append-rows")
@click.argument("items", nargs=-1)
@click.pass_context
def excel_append_rows(ctx: click.Context, items: tuple[str, ...]) -> None:
    _run_scaffold(ctx, "excel.append_rows", items)


@cli.group("teams")
def teams_group() -> None:
    pass


@teams_group.command("list-messages")
@click.argument("items", nargs=-1)
@click.pass_context
def teams_list_messages(ctx: click.Context, items: tuple[str, ...]) -> None:
    _run_read(ctx, "teams.list_messages", items)


@teams_group.command("list-teams")
@click.argument("items", nargs=-1)
@click.pass_context
def teams_list_teams(ctx: click.Context, items: tuple[str, ...]) -> None:
    _run_read(ctx, "teams.list_teams", items)


@teams_group.command("list-channels")
@click.argument("items", nargs=-1)
@click.pass_context
def teams_list_channels(ctx: click.Context, items: tuple[str, ...]) -> None:
    _run_read(ctx, "teams.list_channels", items)


@teams_group.command("reply-message")
@click.argument("items", nargs=-1)
@click.pass_context
def teams_reply_message(ctx: click.Context, items: tuple[str, ...]) -> None:
    _run_scaffold(ctx, "teams.reply_message", items)


if __name__ == "__main__":
    cli()
