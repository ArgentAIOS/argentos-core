from __future__ import annotations

import time
from typing import Any

import click

from . import __version__
from .bridge import capabilities_snapshot, config_snapshot, doctor_snapshot, health_snapshot
from .constants import MODE_ORDER
from .errors import ConnectorError
from .output import emit, failure, success
from .runtime import run_read_command, run_trigger_command


def _mode_allows(actual: str, required: str) -> bool:
    return MODE_ORDER.index(actual) >= MODE_ORDER.index(required)


def _load_permissions() -> dict[str, str]:
    from pathlib import Path
    import json

    permissions_path = Path(__file__).resolve().parents[2] / "permissions.json"
    payload = json.loads(permissions_path.read_text())
    return payload.get("permissions", {})


def require_mode(ctx: click.Context, command_id: str) -> None:
    required = _load_permissions().get(command_id, "admin")
    mode = ctx.obj["mode"]
    if _mode_allows(mode, required):
        return
    payload = failure(
        command=command_id,
        mode=mode,
        started=ctx.obj["started"],
        error={
            "code": "PERMISSION_DENIED",
            "message": f"Command requires mode={required}",
            "details": {"required_mode": required, "actual_mode": mode},
        },
    )
    emit(payload, as_json=ctx.obj["json"])
    raise SystemExit(3)


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


@click.group(cls=AosGroup)
@click.option("--json", "as_json", is_flag=True, help="Emit JSON output")
@click.option("--mode", type=click.Choice(MODE_ORDER), default="readonly", show_default=True)
@click.option("--verbose", is_flag=True, help="Verbose diagnostics")
@click.version_option(__version__)
@click.pass_context
def cli(ctx: click.Context, as_json: bool, mode: str, verbose: bool) -> None:
    ctx.ensure_object(dict)
    ctx.obj.update({"json": as_json, "mode": mode, "verbose": verbose, "started": time.time(), "version": __version__, "_command_id": "unknown"})


def _set_command(ctx: click.Context, command_id: str) -> None:
    ctx.obj["_command_id"] = command_id


def _run_read(ctx: click.Context, command_id: str, items: tuple[str, ...]) -> None:
    _set_command(ctx, command_id)
    require_mode(ctx, command_id)
    data = run_read_command(command_id, items)
    payload = success(command=command_id, mode=ctx.obj["mode"], started=ctx.obj["started"], data=data)
    emit(payload, as_json=ctx.obj["json"])


def _run_write(ctx: click.Context, command_id: str, inputs: dict[str, Any]) -> None:
    _set_command(ctx, command_id)
    require_mode(ctx, command_id)
    data = run_trigger_command(inputs)
    payload = success(
        command=command_id,
        mode=ctx.obj["mode"],
        started=ctx.obj["started"],
        data=data,
    )
    emit(payload, as_json=ctx.obj["json"])


@cli.command("capabilities")
@click.pass_context
def capabilities(ctx: click.Context) -> None:
    _set_command(ctx, "capabilities")
    emit(success(command="capabilities", mode=ctx.obj["mode"], started=ctx.obj["started"], data=capabilities_snapshot()), as_json=True)


@cli.command("health")
@click.pass_context
def health(ctx: click.Context) -> None:
    _set_command(ctx, "health")
    require_mode(ctx, "health")
    emit(success(command="health", mode=ctx.obj["mode"], started=ctx.obj["started"], data=health_snapshot(ctx.obj)), as_json=ctx.obj["json"])


@cli.command("doctor")
@click.pass_context
def doctor(ctx: click.Context) -> None:
    _set_command(ctx, "doctor")
    require_mode(ctx, "doctor")
    emit(success(command="doctor", mode=ctx.obj["mode"], started=ctx.obj["started"], data=doctor_snapshot(ctx.obj)), as_json=ctx.obj["json"])


@cli.group("config")
def config_group() -> None:
    pass


@config_group.command("show")
@click.pass_context
def config_show(ctx: click.Context) -> None:
    _set_command(ctx, "config.show")
    require_mode(ctx, "config.show")
    emit(success(command="config.show", mode=ctx.obj["mode"], started=ctx.obj["started"], data=config_snapshot(ctx.obj)), as_json=ctx.obj["json"])


@cli.group("workflow")
def workflow_group() -> None:
    pass


@workflow_group.command("list")
@click.option("--limit", default=10, show_default=True, type=int)
@click.option("--status", default="", show_default=False)
@click.pass_context
def workflow_list(ctx: click.Context, limit: int, status: str) -> None:
    items = [f"limit={limit}"]
    if status:
        items.append(f"status={status}")
    _run_read(ctx, "workflow.list", tuple(items))


@workflow_group.command("status")
@click.argument("workflow_id", required=False)
@click.option("--status", default="", show_default=False)
@click.pass_context
def workflow_status(ctx: click.Context, workflow_id: str | None, status: str) -> None:
    items = []
    if workflow_id:
        items.append(workflow_id)
    if status:
        items.append(f"status={status}")
    _run_read(ctx, "workflow.status", tuple(items))


@workflow_group.command("trigger")
@click.argument("workflow_id", required=False)
@click.option("--event", default="manual", show_default=True)
@click.option("--payload", "payload_items", multiple=True, help="Repeated key=value payload field")
@click.pass_context
def workflow_trigger(ctx: click.Context, workflow_id: str | None, event: str, payload_items: tuple[str, ...]) -> None:
    inputs: dict[str, Any] = {"event": event}
    if workflow_id:
        inputs["workflow_id"] = workflow_id
    if payload_items:
        parsed: dict[str, str] = {}
        for item in payload_items:
            if "=" not in item:
                raise click.ClickException("--payload entries must use key=value")
            key, value = item.split("=", 1)
            parsed[key.strip()] = value.strip()
        inputs["payload"] = parsed
    _run_write(ctx, "workflow.trigger", inputs)


if __name__ == "__main__":
    cli()
