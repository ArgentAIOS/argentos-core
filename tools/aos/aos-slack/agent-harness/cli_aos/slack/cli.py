from __future__ import annotations

import json
import time
from datetime import datetime, timezone

import click

from . import __version__
from .constants import COMMAND_SPECS, CONNECTOR_AUTH, CONNECTOR_CATEGORY, CONNECTOR_CATEGORIES, CONNECTOR_LABEL, CONNECTOR_RESOURCES, MANIFEST_SCHEMA_VERSION, MODE_ORDER, PERMISSIONS_PATH, TOOL_NAME
from .errors import CliError
from .runtime import config_snapshot, doctor_snapshot, health_snapshot, list_channels, list_people, list_reactions, mention_scan, reply_message, search_messages


def _mode_allows(actual: str, required: str) -> bool:
    return MODE_ORDER.index(actual) >= MODE_ORDER.index(required)


def _load_permissions() -> dict[str, str]:
    payload = json.loads(PERMISSIONS_PATH.read_text())
    return payload.get("permissions", {})


def _emit(payload: dict, as_json: bool) -> None:
    if as_json:
        click.echo(json.dumps(payload, indent=2, sort_keys=True))
        return
    if payload.get("ok"):
        data = payload.get("data", {})
        if isinstance(data, dict) and data.get("summary"):
            click.echo(str(data["summary"]))
        else:
            click.echo("OK")
    else:
        error = payload.get("error", {})
        click.echo(f"ERROR: {error.get('message', 'Unknown error')}")


def _result(
    *,
    ok: bool,
    command: str,
    mode: str,
    started: float,
    data: dict | None = None,
    error: dict | None = None,
) -> dict:
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


def _emit_error(ctx: click.Context, command_id: str, err: CliError) -> None:
    payload = _result(
        ok=False,
        command=command_id,
        mode=ctx.obj["mode"],
        started=ctx.obj["started"],
        error=err.to_payload(),
    )
    _emit(payload, ctx.obj["json"])
    raise SystemExit(err.exit_code)


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


def _run(ctx: click.Context, command_id: str, fn, /, *args, **kwargs) -> None:
    require_mode(ctx, command_id)
    try:
        data = fn(*args, **kwargs)
    except CliError as err:
        _emit_error(ctx, command_id, err)
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
    payload = {
        "tool": TOOL_NAME,
        "version": __version__,
        "manifest_schema_version": MANIFEST_SCHEMA_VERSION,
        "backend": "slack-web-api",
        "modes": MODE_ORDER,
        "connector": {
            "label": CONNECTOR_LABEL,
            "category": CONNECTOR_CATEGORY,
            "categories": CONNECTOR_CATEGORIES,
            "resources": CONNECTOR_RESOURCES,
        },
        "auth": CONNECTOR_AUTH,
        "commands": COMMAND_SPECS,
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
        data=config_snapshot(ctx.obj),
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
        data=health_snapshot(ctx.obj),
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
        data=doctor_snapshot(ctx.obj),
    )
    _emit(payload, ctx.obj["json"])


@cli.group("message")
def message_group() -> None:
    pass


@message_group.command("search")
@click.option("--query", required=True, help="Search text or query")
@click.option("--limit", type=int, default=10, show_default=True)
@click.pass_context
def message_search(ctx: click.Context, query: str, limit: int) -> None:
    _run(ctx, "message.search", search_messages, config=None, query=query, limit=limit)


@message_group.command("reply")
@click.argument("channel", required=False)
@click.option("--text", required=True, help="Reply text")
@click.option("--thread-ts", default=None, help="Thread timestamp to reply in")
@click.option("--broadcast", is_flag=True, help="Also broadcast the reply")
@click.pass_context
def message_reply(ctx: click.Context, channel: str | None, text: str, thread_ts: str | None, broadcast: bool) -> None:
    _run(
        ctx,
        "message.reply",
        reply_message,
        config=None,
        channel=channel,
        text=text,
        thread_ts=thread_ts,
        broadcast=broadcast,
    )


@cli.group("channel")
def channel_group() -> None:
    pass


@channel_group.command("list")
@click.option("--limit", type=int, default=25, show_default=True)
@click.option("--include-private", is_flag=True, help="Include private channels if permitted")
@click.pass_context
def channel_list(ctx: click.Context, limit: int, include_private: bool) -> None:
    _run(ctx, "channel.list", list_channels, config=None, limit=limit, include_private=include_private)


@cli.group("people")
def people_group() -> None:
    pass


@people_group.command("list")
@click.option("--limit", type=int, default=50, show_default=True)
@click.option("--user-id", default=None, help="Filter to one Slack user ID")
@click.pass_context
def people_list(ctx: click.Context, limit: int, user_id: str | None) -> None:
    _run(ctx, "people.list", list_people, config=None, limit=limit, user_id=user_id)


@cli.group("mention")
def mention_group() -> None:
    pass


@mention_group.command("scan")
@click.option("--query", default=None, help="Override the mention query")
@click.option("--user-id", default=None, help="Scan mentions for a specific Slack user ID")
@click.option("--limit", type=int, default=10, show_default=True)
@click.pass_context
def mention_scan_command(ctx: click.Context, query: str | None, user_id: str | None, limit: int) -> None:
    _run(ctx, "mention.scan", mention_scan, config=None, query=query, user_id=user_id, limit=limit)


@cli.group("reaction")
def reaction_group() -> None:
    pass


@reaction_group.command("list")
@click.option("--limit", type=int, default=25, show_default=True)
@click.pass_context
def reaction_list(ctx: click.Context, limit: int) -> None:
    _run(ctx, "reaction.list", list_reactions, config=None, limit=limit)

if __name__ == "__main__":
    cli()
