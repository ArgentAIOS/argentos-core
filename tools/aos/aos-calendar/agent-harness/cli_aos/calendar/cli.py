from __future__ import annotations

import json
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import click

from . import __version__

TOOL_NAME = "aos-calendar"
MODE_ORDER = ["readonly", "write", "full", "admin"]
HARNESS_DIR = Path(__file__).resolve().parents[2]
CONNECTOR_PATH = HARNESS_DIR.parent / "connector.json"
PERMISSIONS_PATH = HARNESS_DIR / "permissions.json"


def _permissions() -> dict[str, str]:
    return json.loads(PERMISSIONS_PATH.read_text()).get("permissions", {})


def _manifest() -> dict[str, Any]:
    return json.loads(CONNECTOR_PATH.read_text())


def _mode_allows(actual: str, required: str) -> bool:
    return MODE_ORDER.index(actual) >= MODE_ORDER.index(required)


def _require_mode(ctx: click.Context, command_id: str) -> None:
    required = _permissions().get(command_id, "admin")
    if _mode_allows(ctx.obj["mode"], required):
        return
    raise click.ClickException(f"Command requires mode={required}")


def _result(command: str, mode: str, started: float, data: dict[str, Any]) -> dict[str, Any]:
    return {
        "ok": True,
        "tool": TOOL_NAME,
        "command": command,
        "data": data,
        "meta": {
            "mode": mode,
            "duration_ms": int((time.time() - started) * 1000),
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "version": __version__,
        },
    }


def _emit(ctx: click.Context, payload: dict[str, Any]) -> None:
    if ctx.obj.get("json"):
        click.echo(json.dumps(payload, indent=2, sort_keys=True))
        return
    data = payload.get("data", {})
    click.echo(str(data.get("summary") or "OK") if isinstance(data, dict) else "OK")


def _blocked_status() -> dict[str, Any]:
    manifest = _manifest()
    return {
        "status": "blocked",
        "runtime_ready": False,
        "summary": "aos-calendar is a provider-alias contract, not a live provider connector.",
        "alias_contract": manifest.get("alias_contract"),
        "provider_surfaces": manifest.get("scope", {}).get("known_provider_surfaces", []),
        "next_steps": [
            "Pick a provider-specific connector such as aos-google or aos-m365.",
            "Define an explicit event.upcoming mapping before Workflows live enablement.",
            "Keep aos-calendar scaffold_only=true until the alias mapping is implemented and smoke tested.",
        ],
    }


@click.group()
@click.option("--json", "as_json", is_flag=True, help="Emit JSON output")
@click.option("--mode", type=click.Choice(MODE_ORDER), default="readonly", show_default=True)
@click.pass_context
def cli(ctx: click.Context, as_json: bool, mode: str) -> None:
    ctx.ensure_object(dict)
    ctx.obj.update({"json": as_json, "mode": mode, "started": time.time()})


@cli.command("capabilities")
@click.pass_context
def capabilities(ctx: click.Context) -> None:
    _require_mode(ctx, "capabilities")
    manifest = _manifest()
    _emit(ctx, {"ok": True, "tool": TOOL_NAME, "data": {**manifest, "version": __version__, "modes": MODE_ORDER}})


def _emit_blocked(ctx: click.Context, command_id: str) -> None:
    _require_mode(ctx, command_id)
    _emit(ctx, _result(command_id, ctx.obj["mode"], ctx.obj["started"], _blocked_status()))


@cli.command("health")
@click.pass_context
def health(ctx: click.Context) -> None:
    _emit_blocked(ctx, "health")


@cli.command("health.check")
@click.pass_context
def health_check(ctx: click.Context) -> None:
    _emit_blocked(ctx, "health.check")


@cli.group("config")
def config_group() -> None:
    pass


@config_group.command("show")
@click.pass_context
def config_show(ctx: click.Context) -> None:
    _require_mode(ctx, "config.show")
    _emit(ctx, _result("config.show", ctx.obj["mode"], ctx.obj["started"], {"summary": "Calendar alias contract is blocked pending provider selection.", "alias_contract": _manifest().get("alias_contract")}))


@cli.command("doctor")
@click.pass_context
def doctor(ctx: click.Context) -> None:
    _emit_blocked(ctx, "doctor")


@cli.group("event")
def event_group() -> None:
    pass


@event_group.command("upcoming")
@click.pass_context
def event_upcoming(ctx: click.Context) -> None:
    _emit_blocked(ctx, "event.upcoming")


@event_group.command("list")
@click.pass_context
def event_list(ctx: click.Context) -> None:
    _emit_blocked(ctx, "event.list")


if __name__ == "__main__":
    cli()
