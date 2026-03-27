from __future__ import annotations

import json
import time

import click

from . import __version__
from .constants import MODE_ORDER, PERMISSIONS_PATH
from .errors import CliError
from .output import emit, failure, success
from .runtime import (
    capabilities_snapshot,
    config_get_result,
    config_set_result,
    config_snapshot,
    doctor_snapshot,
    health_snapshot,
    hook_create_result,
    hook_list_result,
    mcp_call_result,
    mcp_list_result,
    prompt_send_result,
    session_list_result,
    session_resume_result,
)


def _mode_allows(actual: str, required: str) -> bool:
    return MODE_ORDER.index(actual) >= MODE_ORDER.index(required)


def _load_permissions() -> dict[str, str]:
    payload = json.loads(PERMISSIONS_PATH.read_text())
    return payload.get("permissions", {})


def require_mode(ctx: click.Context, command_id: str) -> None:
    required = _load_permissions().get(command_id, "admin")
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
            emit(
                failure(
                    command=ctx.obj.get("_command_id", "unknown") if ctx.obj else "unknown",
                    mode=ctx.obj.get("mode", "unknown") if ctx.obj else "unknown",
                    started=ctx.obj.get("started", time.time()) if ctx.obj else time.time(),
                    error={"code": err.code, "message": err.message, "details": err.details},
                ),
                as_json=ctx.obj.get("json", True) if ctx.obj else True,
            )
            ctx.exit(err.exit_code)


def _set_command(ctx: click.Context, command_id: str) -> None:
    ctx.obj["_command_id"] = command_id


def _emit_success(ctx: click.Context, command_id: str, data: dict) -> None:
    emit(success(command=command_id, mode=ctx.obj["mode"], started=ctx.obj["started"], data=data), as_json=ctx.obj["json"])


@click.group(cls=AosGroup)
@click.option("--json", "as_json", is_flag=True, help="Emit JSON output")
@click.option("--mode", type=click.Choice(MODE_ORDER), default="readonly", show_default=True)
@click.option("--verbose", is_flag=True, help="Verbose diagnostics")
@click.version_option(__version__)
@click.pass_context
def cli(ctx: click.Context, as_json: bool, mode: str, verbose: bool) -> None:
    ctx.ensure_object(dict)
    ctx.obj.update({"json": as_json, "mode": mode, "verbose": verbose, "started": time.time(), "_command_id": "unknown"})


@cli.command("capabilities")
@click.pass_context
def capabilities(ctx: click.Context) -> None:
    _set_command(ctx, "capabilities")
    require_mode(ctx, "capabilities")
    _emit_success(ctx, "capabilities", capabilities_snapshot())


@cli.group("config")
def config_group() -> None:
    pass


@config_group.command("show")
@click.pass_context
def config_show(ctx: click.Context) -> None:
    _set_command(ctx, "config.show")
    require_mode(ctx, "config.show")
    _emit_success(ctx, "config.show", config_snapshot(ctx.obj))


@cli.command("health")
@click.pass_context
def health(ctx: click.Context) -> None:
    _set_command(ctx, "health")
    require_mode(ctx, "health")
    _emit_success(ctx, "health", health_snapshot(ctx.obj))


@cli.command("doctor")
@click.pass_context
def doctor(ctx: click.Context) -> None:
    _set_command(ctx, "doctor")
    require_mode(ctx, "doctor")
    _emit_success(ctx, "doctor", doctor_snapshot(ctx.obj))


@cli.group("prompt")
def prompt_group() -> None:
    pass


@prompt_group.command("send")
@click.option("--prompt", default=None)
@click.option("--session-id", default=None)
@click.option("--model", default=None)
@click.option("--project-dir", default=None)
@click.pass_context
def prompt_send(
    ctx: click.Context,
    prompt: str | None,
    session_id: str | None,
    model: str | None,
    project_dir: str | None,
) -> None:
    _set_command(ctx, "prompt.send")
    require_mode(ctx, "prompt.send")
    _emit_success(
        ctx,
        "prompt.send",
        prompt_send_result(
            ctx.obj,
            prompt=prompt,
            session_id=session_id,
            model=model,
            project_dir=project_dir,
            stream=False,
        ),
    )


@prompt_group.command("stream")
@click.option("--prompt", default=None)
@click.option("--session-id", default=None)
@click.option("--model", default=None)
@click.option("--project-dir", default=None)
@click.pass_context
def prompt_stream(
    ctx: click.Context,
    prompt: str | None,
    session_id: str | None,
    model: str | None,
    project_dir: str | None,
) -> None:
    _set_command(ctx, "prompt.stream")
    require_mode(ctx, "prompt.stream")
    _emit_success(
        ctx,
        "prompt.stream",
        prompt_send_result(
            ctx.obj,
            prompt=prompt,
            session_id=session_id,
            model=model,
            project_dir=project_dir,
            stream=True,
        ),
    )


@cli.group("session")
def session_group() -> None:
    pass


@session_group.command("list")
@click.option("--limit", default=10, show_default=True, type=int)
@click.pass_context
def session_list(ctx: click.Context, limit: int) -> None:
    _set_command(ctx, "session.list")
    require_mode(ctx, "session.list")
    _emit_success(ctx, "session.list", session_list_result(ctx.obj, limit=limit))


@session_group.command("resume")
@click.option("--session-id", default=None)
@click.option("--prompt", default=None)
@click.option("--model", default=None)
@click.option("--project-dir", default=None)
@click.pass_context
def session_resume(
    ctx: click.Context,
    session_id: str | None,
    prompt: str | None,
    model: str | None,
    project_dir: str | None,
) -> None:
    _set_command(ctx, "session.resume")
    require_mode(ctx, "session.resume")
    _emit_success(
        ctx,
        "session.resume",
        session_resume_result(
            ctx.obj,
            session_id=session_id,
            prompt=prompt,
            model=model,
            project_dir=project_dir,
        ),
    )


@cli.group("hook")
def hook_group() -> None:
    pass


@hook_group.command("list")
@click.pass_context
def hook_list(ctx: click.Context) -> None:
    _set_command(ctx, "hook.list")
    require_mode(ctx, "hook.list")
    _emit_success(ctx, "hook.list", hook_list_result(ctx.obj))


@hook_group.command("create")
@click.option("--event", default=None)
@click.option("--matcher", default=None)
@click.option("--command", "hook_command", default=None)
@click.option("--project-dir", default=None)
@click.pass_context
def hook_create(
    ctx: click.Context,
    event: str | None,
    matcher: str | None,
    hook_command: str | None,
    project_dir: str | None,
) -> None:
    _set_command(ctx, "hook.create")
    require_mode(ctx, "hook.create")
    _emit_success(
        ctx,
        "hook.create",
        hook_create_result(
            ctx.obj,
            event=event,
            matcher=matcher,
            command=hook_command,
            project_dir=project_dir,
        ),
    )


@config_group.command("get")
@click.option("--key", default=None)
@click.pass_context
def config_get(ctx: click.Context, key: str | None) -> None:
    _set_command(ctx, "config.get")
    require_mode(ctx, "config.get")
    _emit_success(ctx, "config.get", config_get_result(ctx.obj, key=key))


@config_group.command("set")
@click.option("--key", default=None)
@click.option("--value", default=None)
@click.pass_context
def config_set(ctx: click.Context, key: str | None, value: str | None) -> None:
    _set_command(ctx, "config.set")
    require_mode(ctx, "config.set")
    _emit_success(ctx, "config.set", config_set_result(ctx.obj, key=key, value=value))


@cli.group("mcp")
def mcp_group() -> None:
    pass


@mcp_group.command("list")
@click.pass_context
def mcp_list(ctx: click.Context) -> None:
    _set_command(ctx, "mcp.list")
    require_mode(ctx, "mcp.list")
    _emit_success(ctx, "mcp.list", mcp_list_result(ctx.obj))


@mcp_group.command("call")
@click.option("--server", default=None)
@click.option("--tool", default=None)
@click.option("--input-json", default=None)
@click.pass_context
def mcp_call(ctx: click.Context, server: str | None, tool: str | None, input_json: str | None) -> None:
    _set_command(ctx, "mcp.call")
    require_mode(ctx, "mcp.call")
    _emit_success(ctx, "mcp.call", mcp_call_result(ctx.obj, server=server, tool=tool, input_json=input_json))
