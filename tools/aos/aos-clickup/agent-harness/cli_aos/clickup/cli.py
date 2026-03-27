from __future__ import annotations

import json
import time
from typing import Any

import click

from . import __version__
from .constants import MODE_ORDER, PERMISSIONS_PATH, TOOL_NAME, BACKEND_NAME
from .errors import ClickUpError, ClickUpPermissionError
from .output import emit, failure, success
from .runtime import (
    build_capabilities_payload,
    build_config_show_payload,
    build_doctor_payload,
    build_folder_list_payload,
    build_folder_read_payload,
    build_health_payload,
    build_list_list_payload,
    build_list_read_payload,
    build_space_list_payload,
    build_space_read_payload,
    build_task_create_draft_payload,
    build_task_list_payload,
    build_task_read_payload,
    build_task_update_draft_payload,
    build_workspace_list_payload,
    build_workspace_read_payload,
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
    raise ClickUpPermissionError(
        f"Command requires mode={required}",
        details={"required_mode": required, "actual_mode": mode},
    )


class AosGroup(click.Group):
    def invoke(self, ctx: click.Context):
        try:
            return super().invoke(ctx)
        except ClickUpError as err:
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
    payload = success(
        tool=TOOL_NAME,
        backend=BACKEND_NAME,
        command="config.show",
        data=build_config_show_payload()["data"],
        started=ctx.obj["started"],
        mode=ctx.obj["mode"],
        version=ctx.obj["version"],
    )
    emit(payload, as_json=ctx.obj["json"])


@cli.command("health")
@click.pass_context
def health(ctx: click.Context) -> None:
    _set_command(ctx, "health")
    require_mode(ctx, "health")
    payload = success(
        tool=TOOL_NAME,
        backend=BACKEND_NAME,
        command="health",
        data=build_health_payload()["data"],
        started=ctx.obj["started"],
        mode=ctx.obj["mode"],
        version=ctx.obj["version"],
    )
    emit(payload, as_json=ctx.obj["json"])


@cli.command("doctor")
@click.pass_context
def doctor(ctx: click.Context) -> None:
    _set_command(ctx, "doctor")
    require_mode(ctx, "doctor")
    payload = success(
        tool=TOOL_NAME,
        backend=BACKEND_NAME,
        command="doctor",
        data=build_doctor_payload()["data"],
        started=ctx.obj["started"],
        mode=ctx.obj["mode"],
        version=ctx.obj["version"],
    )
    emit(payload, as_json=ctx.obj["json"])


@cli.group("workspace")
def workspace_group() -> None:
    pass


@workspace_group.command("list")
@click.option("--limit", default=25, show_default=True, type=int)
@click.pass_context
def workspace_list(ctx: click.Context, limit: int) -> None:
    _set_command(ctx, "workspace.list")
    require_mode(ctx, "workspace.list")
    payload = success(
        tool=TOOL_NAME,
        backend=BACKEND_NAME,
        command="workspace.list",
        data=build_workspace_list_payload(limit=limit)["data"],
        started=ctx.obj["started"],
        mode=ctx.obj["mode"],
        version=ctx.obj["version"],
    )
    emit(payload, as_json=ctx.obj["json"])


@workspace_group.command("read")
@click.argument("workspace_id", required=False)
@click.pass_context
def workspace_read(ctx: click.Context, workspace_id: str | None) -> None:
    _set_command(ctx, "workspace.read")
    require_mode(ctx, "workspace.read")
    payload = success(
        tool=TOOL_NAME,
        backend=BACKEND_NAME,
        command="workspace.read",
        data=build_workspace_read_payload(workspace_id=workspace_id)["data"],
        started=ctx.obj["started"],
        mode=ctx.obj["mode"],
        version=ctx.obj["version"],
    )
    emit(payload, as_json=ctx.obj["json"])


@cli.group("space")
def space_group() -> None:
    pass


@space_group.command("list")
@click.option("--limit", default=25, show_default=True, type=int)
@click.argument("workspace_id", required=False)
@click.pass_context
def space_list(ctx: click.Context, limit: int, workspace_id: str | None) -> None:
    _set_command(ctx, "space.list")
    require_mode(ctx, "space.list")
    payload = success(
        tool=TOOL_NAME,
        backend=BACKEND_NAME,
        command="space.list",
        data=build_space_list_payload(workspace_id=workspace_id, limit=limit)["data"],
        started=ctx.obj["started"],
        mode=ctx.obj["mode"],
        version=ctx.obj["version"],
    )
    emit(payload, as_json=ctx.obj["json"])


@space_group.command("read")
@click.argument("space_id", required=False)
@click.pass_context
def space_read(ctx: click.Context, space_id: str | None) -> None:
    _set_command(ctx, "space.read")
    require_mode(ctx, "space.read")
    payload = success(
        tool=TOOL_NAME,
        backend=BACKEND_NAME,
        command="space.read",
        data=build_space_read_payload(space_id=space_id)["data"],
        started=ctx.obj["started"],
        mode=ctx.obj["mode"],
        version=ctx.obj["version"],
    )
    emit(payload, as_json=ctx.obj["json"])


@cli.group("folder")
def folder_group() -> None:
    pass


@folder_group.command("list")
@click.option("--limit", default=25, show_default=True, type=int)
@click.argument("space_id", required=False)
@click.pass_context
def folder_list(ctx: click.Context, limit: int, space_id: str | None) -> None:
    _set_command(ctx, "folder.list")
    require_mode(ctx, "folder.list")
    payload = success(
        tool=TOOL_NAME,
        backend=BACKEND_NAME,
        command="folder.list",
        data=build_folder_list_payload(space_id=space_id, limit=limit)["data"],
        started=ctx.obj["started"],
        mode=ctx.obj["mode"],
        version=ctx.obj["version"],
    )
    emit(payload, as_json=ctx.obj["json"])


@folder_group.command("read")
@click.argument("folder_id", required=False)
@click.pass_context
def folder_read(ctx: click.Context, folder_id: str | None) -> None:
    _set_command(ctx, "folder.read")
    require_mode(ctx, "folder.read")
    payload = success(
        tool=TOOL_NAME,
        backend=BACKEND_NAME,
        command="folder.read",
        data=build_folder_read_payload(folder_id=folder_id)["data"],
        started=ctx.obj["started"],
        mode=ctx.obj["mode"],
        version=ctx.obj["version"],
    )
    emit(payload, as_json=ctx.obj["json"])


@cli.group("list")
def list_group() -> None:
    pass


@list_group.command("list")
@click.option("--limit", default=25, show_default=True, type=int)
@click.option("--space-id", default=None)
@click.option("--folder-id", default=None)
@click.pass_context
def list_list(ctx: click.Context, limit: int, space_id: str | None, folder_id: str | None) -> None:
    _set_command(ctx, "list.list")
    require_mode(ctx, "list.list")
    payload = success(
        tool=TOOL_NAME,
        backend=BACKEND_NAME,
        command="list.list",
        data=build_list_list_payload(space_id=space_id, folder_id=folder_id, limit=limit)["data"],
        started=ctx.obj["started"],
        mode=ctx.obj["mode"],
        version=ctx.obj["version"],
    )
    emit(payload, as_json=ctx.obj["json"])


@list_group.command("read")
@click.argument("list_id", required=False)
@click.pass_context
def list_read(ctx: click.Context, list_id: str | None) -> None:
    _set_command(ctx, "list.read")
    require_mode(ctx, "list.read")
    payload = success(
        tool=TOOL_NAME,
        backend=BACKEND_NAME,
        command="list.read",
        data=build_list_read_payload(list_id=list_id)["data"],
        started=ctx.obj["started"],
        mode=ctx.obj["mode"],
        version=ctx.obj["version"],
    )
    emit(payload, as_json=ctx.obj["json"])


@cli.group("task")
def task_group() -> None:
    pass


@task_group.command("list")
@click.option("--limit", default=25, show_default=True, type=int)
@click.argument("list_id", required=False)
@click.pass_context
def task_list(ctx: click.Context, limit: int, list_id: str | None) -> None:
    _set_command(ctx, "task.list")
    require_mode(ctx, "task.list")
    payload = success(
        tool=TOOL_NAME,
        backend=BACKEND_NAME,
        command="task.list",
        data=build_task_list_payload(list_id=list_id, limit=limit)["data"],
        started=ctx.obj["started"],
        mode=ctx.obj["mode"],
        version=ctx.obj["version"],
    )
    emit(payload, as_json=ctx.obj["json"])


@task_group.command("read")
@click.argument("task_id", required=False)
@click.pass_context
def task_read(ctx: click.Context, task_id: str | None) -> None:
    _set_command(ctx, "task.read")
    require_mode(ctx, "task.read")
    payload = success(
        tool=TOOL_NAME,
        backend=BACKEND_NAME,
        command="task.read",
        data=build_task_read_payload(task_id=task_id)["data"],
        started=ctx.obj["started"],
        mode=ctx.obj["mode"],
        version=ctx.obj["version"],
    )
    emit(payload, as_json=ctx.obj["json"])


@task_group.command("create-draft")
@click.argument("name")
@click.option("--list-id", default=None)
@click.option("--description", default=None)
@click.option("--due-date", default=None)
@click.pass_context
def task_create_draft(ctx: click.Context, name: str, list_id: str | None, description: str | None, due_date: str | None) -> None:
    _set_command(ctx, "task.create_draft")
    require_mode(ctx, "task.create_draft")
    payload = success(
        tool=TOOL_NAME,
        backend=BACKEND_NAME,
        command="task.create_draft",
        data=build_task_create_draft_payload(list_id=list_id, name=name, description=description, due_date=due_date)["data"],
        started=ctx.obj["started"],
        mode=ctx.obj["mode"],
        version=ctx.obj["version"],
    )
    emit(payload, as_json=ctx.obj["json"])


@task_group.command("update-draft")
@click.argument("task_id", required=False)
@click.option("--name", default=None)
@click.option("--description", default=None)
@click.option("--list-id", default=None)
@click.option("--due-date", default=None)
@click.option("--status", default=None)
@click.pass_context
def task_update_draft(
    ctx: click.Context,
    task_id: str | None,
    name: str | None,
    description: str | None,
    list_id: str | None,
    due_date: str | None,
    status: str | None,
) -> None:
    _set_command(ctx, "task.update_draft")
    require_mode(ctx, "task.update_draft")
    payload = success(
        tool=TOOL_NAME,
        backend=BACKEND_NAME,
        command="task.update_draft",
        data=build_task_update_draft_payload(
            task_id=task_id,
            name=name,
            description=description,
            list_id=list_id,
            due_date=due_date,
            status=status,
        )["data"],
        started=ctx.obj["started"],
        mode=ctx.obj["mode"],
        version=ctx.obj["version"],
    )
    emit(payload, as_json=ctx.obj["json"])


if __name__ == "__main__":
    cli()
