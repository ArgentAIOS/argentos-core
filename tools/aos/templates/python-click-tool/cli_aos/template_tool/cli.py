from __future__ import annotations

import json
import time
from datetime import datetime, timezone
from pathlib import Path

import click

from . import __version__

MODE_ORDER = ["readonly", "write", "full", "admin"]
PERMISSIONS_PATH = Path(__file__).resolve().parents[2] / "permissions.json"


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
        click.echo("OK")
    else:
        click.echo(f"ERROR: {payload['error']['message']}")


def _result(*, ok: bool, command: str, mode: str, started: float, data: dict | None = None, error: dict | None = None) -> dict:
    base = {
        "ok": ok,
        "tool": "aos-template-tool",
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
    permissions = _load_permissions()
    payload = {
        "tool": "aos-template-tool",
        "version": __version__,
        "manifest_schema_version": "1.0.0",
        "modes": MODE_ORDER,
        "commands": [
            {"id": command_id, "required_mode": required_mode, "supports_json": True}
            for command_id, required_mode in sorted(permissions.items())
        ],
    }
    _emit(payload, True if ctx.obj["json"] else True)


@cli.group("config")
def config_group() -> None:
    pass


@config_group.command("show")
@click.pass_context
def config_show(ctx: click.Context) -> None:
    payload = _result(ok=True, command="config.show", mode=ctx.obj["mode"], started=ctx.obj["started"], data={"example": "value"})
    _emit(payload, ctx.obj["json"])


@cli.command("health")
@click.pass_context
def health(ctx: click.Context) -> None:
    payload = _result(ok=True, command="health", mode=ctx.obj["mode"], started=ctx.obj["started"], data={"status": "healthy"})
    _emit(payload, ctx.obj["json"])


@cli.group("example")
def example_group() -> None:
    pass


@example_group.command("read")
@click.pass_context
def example_read(ctx: click.Context) -> None:
    require_mode(ctx, "example.read")
    payload = _result(ok=True, command="example.read", mode=ctx.obj["mode"], started=ctx.obj["started"], data={"message": "read path"})
    _emit(payload, ctx.obj["json"])


@example_group.command("delete")
@click.pass_context
def example_delete(ctx: click.Context) -> None:
    require_mode(ctx, "example.delete")
    payload = _result(ok=True, command="example.delete", mode=ctx.obj["mode"], started=ctx.obj["started"], data={"deleted": True})
    _emit(payload, ctx.obj["json"])


if __name__ == "__main__":
    cli()
