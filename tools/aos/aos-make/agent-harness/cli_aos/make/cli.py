from __future__ import annotations

import json
import time
from typing import Any

import click

from . import __version__
from .bridge import capabilities_snapshot, config_snapshot, doctor_snapshot, health_snapshot
from .constants import MODE_ORDER
from .errors import ConnectorError
from .output import emit, failure, success
from . import runtime as runtime_module


def _mode_allows(actual: str, required: str) -> bool:
    return MODE_ORDER.index(actual) >= MODE_ORDER.index(required)


def _load_permissions() -> dict[str, str]:
    from pathlib import Path

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
    data = runtime_module.run_read_command(ctx.obj, command_id, items)
    payload = success(command=command_id, mode=ctx.obj["mode"], started=ctx.obj["started"], data=data)
    emit(payload, as_json=ctx.obj["json"])


def _run_write(ctx: click.Context, command_id: str, inputs: dict[str, Any]) -> None:
    _set_command(ctx, command_id)
    require_mode(ctx, command_id)
    data = runtime_module.run_trigger_command(ctx.obj, command_id, inputs)
    payload = success(command=command_id, mode=ctx.obj["mode"], started=ctx.obj["started"], data=data)
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


@cli.group("organization")
def organization_group() -> None:
    pass


@organization_group.command("list")
@click.option("--limit", default=10, show_default=True, type=int)
@click.pass_context
def organization_list(ctx: click.Context, limit: int) -> None:
    _run_read(ctx, "organization.list", (f"limit={limit}",))


@cli.group("team")
def team_group() -> None:
    pass


@team_group.command("list")
@click.option("--limit", default=10, show_default=True, type=int)
@click.option("--organization-id", default="", show_default=False)
@click.option("--organization-name", default="", show_default=False)
@click.pass_context
def team_list(ctx: click.Context, limit: int, organization_id: str, organization_name: str) -> None:
    items = [f"limit={limit}"]
    if organization_id:
        items.append(f"organization_id={organization_id}")
    if organization_name:
        items.append(f"organization_name={organization_name}")
    _run_read(ctx, "team.list", tuple(items))


@cli.group("scenario")
def scenario_group() -> None:
    pass


@scenario_group.command("list")
@click.option("--limit", default=10, show_default=True, type=int)
@click.option("--status", default="", show_default=False)
@click.option("--organization-id", default="", show_default=False)
@click.option("--organization-name", default="", show_default=False)
@click.option("--team-id", default="", show_default=False)
@click.option("--team-name", default="", show_default=False)
@click.pass_context
def scenario_list(ctx: click.Context, limit: int, status: str, organization_id: str, organization_name: str, team_id: str, team_name: str) -> None:
    items = [f"limit={limit}"]
    if status:
        items.append(f"status={status}")
    if organization_id:
        items.append(f"organization_id={organization_id}")
    if organization_name:
        items.append(f"organization_name={organization_name}")
    if team_id:
        items.append(f"team_id={team_id}")
    if team_name:
        items.append(f"team_name={team_name}")
    _run_read(ctx, "scenario.list", tuple(items))


@scenario_group.command("status")
@click.argument("scenario_id", required=False)
@click.option("--scenario-name", default="", show_default=False)
@click.option("--status", default="", show_default=False)
@click.pass_context
def scenario_status(ctx: click.Context, scenario_id: str | None, scenario_name: str, status: str) -> None:
    items: list[str] = []
    if scenario_id:
        items.append(scenario_id)
    if scenario_name:
        items.append(f"scenario_name={scenario_name}")
    if status:
        items.append(f"status={status}")
    _run_read(ctx, "scenario.status", tuple(items))


@scenario_group.command("trigger")
@click.argument("scenario_id", required=False)
@click.option("--event", default="manual", show_default=True)
@click.option("--payload", "payload_items", multiple=True, help="Repeated key=value payload field")
@click.option("--payload-json", default="", help="JSON object payload forwarded to the bridge")
@click.option("--organization-name", default="", show_default=False)
@click.option("--team-name", default="", show_default=False)
@click.option("--connection-id", default="", show_default=False)
@click.pass_context
def scenario_trigger(ctx: click.Context, scenario_id: str | None, event: str, payload_items: tuple[str, ...], payload_json: str, organization_name: str, team_name: str, connection_id: str) -> None:
    inputs: dict[str, Any] = {"event": event}
    if scenario_id:
        inputs["scenario_id"] = scenario_id
    if organization_name:
        inputs["organization_name"] = organization_name
    if team_name:
        inputs["team_name"] = team_name
    if connection_id:
        inputs["connection_id"] = connection_id
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
    _run_write(ctx, "scenario.trigger", inputs)


@cli.group("connection")
def connection_group() -> None:
    pass


@connection_group.command("list")
@click.option("--limit", default=10, show_default=True, type=int)
@click.option("--organization-id", default="", show_default=False)
@click.option("--organization-name", default="", show_default=False)
@click.pass_context
def connection_list(ctx: click.Context, limit: int, organization_id: str, organization_name: str) -> None:
    items = [f"limit={limit}"]
    if organization_id:
        items.append(f"organization_id={organization_id}")
    if organization_name:
        items.append(f"organization_name={organization_name}")
    _run_read(ctx, "connection.list", tuple(items))


@cli.group("execution")
def execution_group() -> None:
    pass


@execution_group.command("list")
@click.option("--limit", default=10, show_default=True, type=int)
@click.option("--scenario-id", default="", show_default=False)
@click.option("--status", default="", show_default=False)
@click.pass_context
def execution_list(ctx: click.Context, limit: int, scenario_id: str, status: str) -> None:
    items = [f"limit={limit}"]
    if scenario_id:
        items.append(f"scenario_id={scenario_id}")
    if status:
        items.append(f"status={status}")
    _run_read(ctx, "execution.list", tuple(items))


@execution_group.command("status")
@click.argument("execution_id", required=False)
@click.option("--run-id", default="", show_default=False)
@click.option("--status", default="", show_default=False)
@click.pass_context
def execution_status(ctx: click.Context, execution_id: str | None, run_id: str, status: str) -> None:
    items: list[str] = []
    if execution_id:
        items.append(execution_id)
    if run_id:
        items.append(f"run_id={run_id}")
    if status:
        items.append(f"status={status}")
    _run_read(ctx, "execution.status", tuple(items))


@execution_group.command("run")
@click.argument("scenario_id", required=False)
@click.option("--event", default="manual", show_default=True)
@click.option("--payload", "payload_items", multiple=True, help="Repeated key=value payload field")
@click.option("--payload-json", default="", help="JSON object payload forwarded to the bridge")
@click.option("--organization-name", default="", show_default=False)
@click.option("--team-name", default="", show_default=False)
@click.option("--connection-id", default="", show_default=False)
@click.pass_context
def execution_run(ctx: click.Context, scenario_id: str | None, event: str, payload_items: tuple[str, ...], payload_json: str, organization_name: str, team_name: str, connection_id: str) -> None:
    inputs: dict[str, Any] = {"event": event}
    if scenario_id:
        inputs["scenario_id"] = scenario_id
    if organization_name:
        inputs["organization_name"] = organization_name
    if team_name:
        inputs["team_name"] = team_name
    if connection_id:
        inputs["connection_id"] = connection_id
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
    _run_write(ctx, "execution.run", inputs)


if __name__ == "__main__":
    cli()
