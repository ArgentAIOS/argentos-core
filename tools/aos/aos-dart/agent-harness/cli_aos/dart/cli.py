from __future__ import annotations

import json
import time
from typing import Any

import click

from . import __version__
from .constants import MODE_ORDER, PERMISSIONS_PATH, TOOL_NAME, BACKEND_NAME
from .errors import DartError, DartPermissionError
from .output import emit, failure, success
from .runtime import (
    build_capabilities_payload,
    build_comment_create_payload,
    build_comment_list_payload,
    build_config_show_payload,
    build_dartboard_get_payload,
    build_dartboard_list_payload,
    build_doc_create_payload,
    build_doc_get_payload,
    build_doc_list_payload,
    build_doctor_payload,
    build_health_payload,
    build_property_list_payload,
    build_task_create_payload,
    build_task_delete_payload,
    build_task_get_payload,
    build_task_list_payload,
    build_task_update_payload,
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
    raise DartPermissionError(
        f"Command requires mode={required}",
        details={"required_mode": required, "actual_mode": mode},
    )


def _emit_success(ctx: click.Context, command: str, data: Any) -> None:
    payload = success(
        tool=TOOL_NAME,
        backend=BACKEND_NAME,
        command=command,
        data=data,
        started=ctx.obj["started"],
        mode=ctx.obj["mode"],
        version=ctx.obj["version"],
    )
    emit(payload, as_json=ctx.obj["json"])


class AosGroup(click.Group):
    def invoke(self, ctx: click.Context):
        try:
            return super().invoke(ctx)
        except DartError as err:
            payload = failure(
                tool=TOOL_NAME,
                backend=BACKEND_NAME,
                command=ctx.obj.get("_command_id", "unknown") if ctx.obj else "unknown",
                error={"code": err.code, "message": err.message, "details": err.details},
                started=ctx.obj.get("started", time.time()) if ctx.obj else time.time(),
                mode=ctx.obj.get("mode", "unknown") if ctx.obj else "unknown",
                version=ctx.obj.get("version", __version__) if ctx.obj else __version__,
            )
            emit(payload, as_json=ctx.obj.get("json", True) if ctx.obj else True)
            ctx.exit(err.exit_code)
        except click.ClickException as err:
            payload = failure(
                tool=TOOL_NAME,
                backend=BACKEND_NAME,
                command=ctx.obj.get("_command_id", "unknown") if ctx.obj else "unknown",
                error={"code": "INVALID_USAGE", "message": str(err), "details": {}},
                started=ctx.obj.get("started", time.time()) if ctx.obj else time.time(),
                mode=ctx.obj.get("mode", "unknown") if ctx.obj else "unknown",
                version=ctx.obj.get("version", __version__) if ctx.obj else __version__,
            )
            emit(payload, as_json=ctx.obj.get("json", True) if ctx.obj else True)
            ctx.exit(2)


def _set_command(ctx: click.Context, command_id: str) -> None:
    ctx.obj["_command_id"] = command_id


@click.group(cls=AosGroup)
@click.option("--json", "as_json", is_flag=True, help="Emit JSON output")
@click.option("--mode", type=click.Choice(MODE_ORDER), default="readonly", show_default=True)
@click.option("--verbose", is_flag=True, help="Verbose diagnostics")
@click.version_option(__version__)
@click.pass_context
def cli(ctx: click.Context, as_json: bool, mode: str, verbose: bool) -> None:
    ctx.ensure_object(dict)
    ctx.obj.update({"json": as_json, "mode": mode, "verbose": verbose, "started": time.time(), "version": __version__, "_command_id": "unknown"})


@cli.command("capabilities")
@click.pass_context
def capabilities(ctx: click.Context) -> None:
    _set_command(ctx, "capabilities")
    require_mode(ctx, "capabilities")
    emit(build_capabilities_payload(), as_json=True)


@cli.group("config")
def config_group() -> None:
    pass


@config_group.command("show")
@click.pass_context
def config_show(ctx: click.Context) -> None:
    _set_command(ctx, "config.show")
    require_mode(ctx, "config.show")
    _emit_success(ctx, "config.show", build_config_show_payload()["data"])


@cli.command("health")
@click.pass_context
def health(ctx: click.Context) -> None:
    _set_command(ctx, "health")
    require_mode(ctx, "health")
    _emit_success(ctx, "health", build_health_payload()["data"])


@cli.command("doctor")
@click.pass_context
def doctor(ctx: click.Context) -> None:
    _set_command(ctx, "doctor")
    require_mode(ctx, "doctor")
    _emit_success(ctx, "doctor", build_doctor_payload()["data"])


# --- Dartboard ---

@cli.group("dartboard")
def dartboard_group() -> None:
    pass


@dartboard_group.command("list")
@click.option("--limit", default=25, show_default=True, type=int)
@click.pass_context
def dartboard_list(ctx: click.Context, limit: int) -> None:
    _set_command(ctx, "dartboard.list")
    require_mode(ctx, "dartboard.list")
    _emit_success(ctx, "dartboard.list", build_dartboard_list_payload(limit=limit)["data"])


@dartboard_group.command("get")
@click.argument("dartboard_id", required=False)
@click.pass_context
def dartboard_get(ctx: click.Context, dartboard_id: str | None) -> None:
    _set_command(ctx, "dartboard.get")
    require_mode(ctx, "dartboard.get")
    _emit_success(ctx, "dartboard.get", build_dartboard_get_payload(dartboard_id=dartboard_id)["data"])


# --- Task ---

@cli.group("task")
def task_group() -> None:
    pass


@task_group.command("list")
@click.option("--limit", default=25, show_default=True, type=int)
@click.option("--dartboard-id", default=None)
@click.option("--assignee", default=None)
@click.option("--status", default=None)
@click.pass_context
def task_list(ctx: click.Context, limit: int, dartboard_id: str | None, assignee: str | None, status: str | None) -> None:
    _set_command(ctx, "task.list")
    require_mode(ctx, "task.list")
    _emit_success(ctx, "task.list", build_task_list_payload(dartboard_id=dartboard_id, assignee=assignee, status=status, limit=limit)["data"])


@task_group.command("get")
@click.argument("task_id", required=False)
@click.pass_context
def task_get(ctx: click.Context, task_id: str | None) -> None:
    _set_command(ctx, "task.get")
    require_mode(ctx, "task.get")
    _emit_success(ctx, "task.get", build_task_get_payload(task_id=task_id)["data"])


@task_group.command("create")
@click.argument("title")
@click.option("--dartboard-id", default=None)
@click.option("--description", default=None)
@click.option("--assignee", default=None)
@click.option("--priority", default=None)
@click.pass_context
def task_create(ctx: click.Context, title: str, dartboard_id: str | None, description: str | None, assignee: str | None, priority: str | None) -> None:
    _set_command(ctx, "task.create")
    require_mode(ctx, "task.create")
    _emit_success(ctx, "task.create", build_task_create_payload(dartboard_id=dartboard_id, title=title, description=description, assignee=assignee, priority=priority)["data"])


@task_group.command("update")
@click.argument("task_id", required=False)
@click.option("--title", default=None)
@click.option("--description", default=None)
@click.option("--status", default=None)
@click.option("--assignee", default=None)
@click.option("--priority", default=None)
@click.pass_context
def task_update(ctx: click.Context, task_id: str | None, title: str | None, description: str | None, status: str | None, assignee: str | None, priority: str | None) -> None:
    _set_command(ctx, "task.update")
    require_mode(ctx, "task.update")
    _emit_success(ctx, "task.update", build_task_update_payload(task_id=task_id, title=title, description=description, status=status, assignee=assignee, priority=priority)["data"])


@task_group.command("delete")
@click.argument("task_id", required=False)
@click.pass_context
def task_delete(ctx: click.Context, task_id: str | None) -> None:
    _set_command(ctx, "task.delete")
    require_mode(ctx, "task.delete")
    _emit_success(ctx, "task.delete", build_task_delete_payload(task_id=task_id)["data"])


# --- Doc ---

@cli.group("doc")
def doc_group() -> None:
    pass


@doc_group.command("list")
@click.option("--limit", default=25, show_default=True, type=int)
@click.pass_context
def doc_list(ctx: click.Context, limit: int) -> None:
    _set_command(ctx, "doc.list")
    require_mode(ctx, "doc.list")
    _emit_success(ctx, "doc.list", build_doc_list_payload(limit=limit)["data"])


@doc_group.command("get")
@click.argument("doc_id")
@click.pass_context
def doc_get(ctx: click.Context, doc_id: str) -> None:
    _set_command(ctx, "doc.get")
    require_mode(ctx, "doc.get")
    _emit_success(ctx, "doc.get", build_doc_get_payload(doc_id=doc_id)["data"])


@doc_group.command("create")
@click.argument("title")
@click.option("--content", default=None)
@click.pass_context
def doc_create(ctx: click.Context, title: str, content: str | None) -> None:
    _set_command(ctx, "doc.create")
    require_mode(ctx, "doc.create")
    _emit_success(ctx, "doc.create", build_doc_create_payload(title=title, content=content)["data"])


# --- Comment ---

@cli.group("comment")
def comment_group() -> None:
    pass


@comment_group.command("list")
@click.argument("task_id", required=False)
@click.pass_context
def comment_list(ctx: click.Context, task_id: str | None) -> None:
    _set_command(ctx, "comment.list")
    require_mode(ctx, "comment.list")
    _emit_success(ctx, "comment.list", build_comment_list_payload(task_id=task_id)["data"])


@comment_group.command("create")
@click.argument("text")
@click.option("--task-id", default=None)
@click.pass_context
def comment_create(ctx: click.Context, text: str, task_id: str | None) -> None:
    _set_command(ctx, "comment.create")
    require_mode(ctx, "comment.create")
    _emit_success(ctx, "comment.create", build_comment_create_payload(task_id=task_id, text=text)["data"])


# --- Property ---

@cli.group("property")
def property_group() -> None:
    pass


@property_group.command("list")
@click.pass_context
def property_list(ctx: click.Context) -> None:
    _set_command(ctx, "property.list")
    require_mode(ctx, "property.list")
    _emit_success(ctx, "property.list", build_property_list_payload()["data"])


if __name__ == "__main__":
    cli()
