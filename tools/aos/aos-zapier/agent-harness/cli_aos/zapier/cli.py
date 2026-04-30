from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

import click

from . import __version__
from .bridge import capabilities_snapshot, config_snapshot, doctor_snapshot, health_snapshot
from .constants import MODE_ORDER, TOOL_NAME
from .errors import ConnectorError
from .output import emit, failure, success
from . import runtime as runtime_module


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
    raise ConnectorError(
        code="PERMISSION_DENIED",
        message=f"Command requires mode={required}",
        exit_code=3,
        details={"required_mode": required, "actual_mode": mode},
    )


class AosGroup(click.Group):
    def invoke(self, ctx: click.Context):
        try:
            return super().invoke(ctx)
        except ConnectorError as err:
            payload = failure(
                command=ctx.obj.get("_command_id", "unknown") if ctx.obj else "unknown",
                mode=ctx.obj.get("mode", "unknown") if ctx.obj else "unknown",
                started=ctx.obj.get("started", time.time()) if ctx.obj else time.time(),
                error={"code": err.code, "message": err.message, "details": err.details},
            )
            emit(payload, as_json=ctx.obj.get("json", True) if ctx.obj else True)
            ctx.exit(err.exit_code)
        except click.ClickException as err:
            payload = failure(
                command=ctx.obj.get("_command_id", "unknown") if ctx.obj else "unknown",
                mode=ctx.obj.get("mode", "unknown") if ctx.obj else "unknown",
                started=ctx.obj.get("started", time.time()) if ctx.obj else time.time(),
                error={"code": "INVALID_USAGE", "message": str(err), "details": {}},
            )
            emit(payload, as_json=ctx.obj.get("json", True) if ctx.obj else True)
            ctx.exit(2)


def _set_command(ctx: click.Context, command_id: str) -> None:
    ctx.obj["_command_id"] = command_id


def _result(ctx: click.Context, *, command: str, data: dict[str, Any]) -> dict[str, Any]:
    return success(command=command, mode=ctx.obj["mode"], started=ctx.obj["started"], data=data)


def _run_read(ctx: click.Context, command_id: str, items: tuple[str, ...]) -> None:
    _set_command(ctx, command_id)
    require_mode(ctx, command_id)
    data = runtime_module.run_read_command(command_id, items)
    emit(_result(ctx, command=command_id, data=data), as_json=ctx.obj["json"])


def _run_write(ctx: click.Context, command_id: str, inputs: dict[str, Any]) -> None:
    _set_command(ctx, command_id)
    require_mode(ctx, command_id)
    data = runtime_module.run_write_command(command_id, inputs)
    emit(_result(ctx, command=command_id, data=data), as_json=ctx.obj["json"])


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
    emit(_result(ctx, command="capabilities", data=capabilities_snapshot()), as_json=True)


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


@cli.group("config")
def config_group() -> None:
    pass


@config_group.command("show")
@click.pass_context
def config_show(ctx: click.Context) -> None:
    _set_command(ctx, "config.show")
    require_mode(ctx, "config.show")
    emit(_result(ctx, command="config.show", data=config_snapshot(ctx.obj)), as_json=ctx.obj["json"])


@cli.group("zap")
def zap_group() -> None:
    pass


@zap_group.command("list")
@click.option("--limit", default=10, show_default=True, type=int)
@click.option("--status", default="", show_default=False)
@click.pass_context
def zap_list(ctx: click.Context, limit: int, status: str) -> None:
    items = [f"limit={limit}"]
    if status:
        items.append(f"status={status}")
    _run_read(ctx, "zap.list", tuple(items))


@zap_group.command("status")
@click.argument("zap_id", required=False)
@click.option("--status", default="", show_default=False)
@click.pass_context
def zap_status(ctx: click.Context, zap_id: str | None, status: str) -> None:
    items = []
    if zap_id:
        items.append(zap_id)
    if status:
        items.append(f"status={status}")
    _run_read(ctx, "zap.status", tuple(items))


@zap_group.command("trigger")
@click.argument("zap_id", required=False)
@click.option(
    "--event",
    default="manual",
    show_default=True,
    help="Trigger label forwarded to the bridge. Suggested values: manual, scheduled, webhook, test.",
)
@click.option(
    "--payload",
    "payload_items",
    multiple=True,
    help="Repeated key=value payload field. Each item becomes a JSON object field.",
)
@click.option(
    "--payload-json",
    default="",
    help="JSON object payload forwarded to the bridge. Merged before repeated --payload fields.",
)
@click.pass_context
def zap_trigger(
    ctx: click.Context,
    zap_id: str | None,
    event: str,
    payload_items: tuple[str, ...],
    payload_json: str,
) -> None:
    inputs: dict[str, Any] = {"event": event}
    if zap_id:
        inputs["zap_id"] = zap_id
    if payload_json.strip():
        try:
            payload_value = json.loads(payload_json)
        except json.JSONDecodeError as exc:
            raise click.ClickException("--payload-json must be valid JSON") from exc
        if not isinstance(payload_value, dict):
            raise click.ClickException("--payload-json must decode to a JSON object")
        inputs["payload"] = payload_value
    if payload_items:
        parsed: dict[str, str] = {}
        for item in payload_items:
            if "=" not in item:
                raise click.ClickException("--payload entries must use key=value")
            key, value = item.split("=", 1)
            parsed[key.strip()] = value.strip()
        payload = dict(inputs.get("payload", {}))
        payload.update(parsed)
        inputs["payload"] = payload
    _run_write(ctx, "zap.trigger", inputs)


if __name__ == "__main__":
    cli()
