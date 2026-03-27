from __future__ import annotations

import json
import time
from typing import Any

import click

from . import __version__
from .constants import MODE_ORDER, PERMISSIONS_PATH, TOOL_NAME, BACKEND_NAME
from .errors import AsanaError, AsanaPermissionError
from .output import emit, failure, success
from .runtime import (
    build_capabilities_payload,
    build_comment_create_payload,
    build_comment_list_payload,
    build_config_show_payload,
    build_doctor_payload,
    build_health_payload,
    build_portfolio_get_payload,
    build_portfolio_list_payload,
    build_project_get_payload,
    build_project_list_payload,
    build_project_sections_payload,
    build_search_tasks_payload,
    build_section_list_payload,
    build_section_tasks_payload,
    build_task_create_payload,
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
    raise AsanaPermissionError(
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
        except AsanaError as err:
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


# --- Project ---

@cli.group("project")
def project_group() -> None:
    pass


@project_group.command("list")
@click.option("--limit", default=25, show_default=True, type=int)
@click.argument("workspace_gid", required=False)
@click.pass_context
def project_list(ctx: click.Context, limit: int, workspace_gid: str | None) -> None:
    _set_command(ctx, "project.list")
    require_mode(ctx, "project.list")
    _emit_success(ctx, "project.list", build_project_list_payload(workspace_gid=workspace_gid, limit=limit)["data"])


@project_group.command("get")
@click.argument("project_gid", required=False)
@click.pass_context
def project_get(ctx: click.Context, project_gid: str | None) -> None:
    _set_command(ctx, "project.get")
    require_mode(ctx, "project.get")
    _emit_success(ctx, "project.get", build_project_get_payload(project_gid=project_gid)["data"])


@project_group.command("sections")
@click.argument("project_gid", required=False)
@click.pass_context
def project_sections(ctx: click.Context, project_gid: str | None) -> None:
    _set_command(ctx, "project.sections")
    require_mode(ctx, "project.sections")
    _emit_success(ctx, "project.sections", build_project_sections_payload(project_gid=project_gid)["data"])


# --- Section ---

@cli.group("section")
def section_group() -> None:
    pass


@section_group.command("list")
@click.argument("project_gid", required=False)
@click.pass_context
def section_list(ctx: click.Context, project_gid: str | None) -> None:
    _set_command(ctx, "section.list")
    require_mode(ctx, "section.list")
    _emit_success(ctx, "section.list", build_section_list_payload(project_gid=project_gid)["data"])


@section_group.command("tasks")
@click.argument("section_gid")
@click.option("--limit", default=25, show_default=True, type=int)
@click.pass_context
def section_tasks(ctx: click.Context, section_gid: str, limit: int) -> None:
    _set_command(ctx, "section.tasks")
    require_mode(ctx, "section.tasks")
    _emit_success(ctx, "section.tasks", build_section_tasks_payload(section_gid=section_gid, limit=limit)["data"])


# --- Task ---

@cli.group("task")
def task_group() -> None:
    pass


@task_group.command("list")
@click.option("--limit", default=25, show_default=True, type=int)
@click.argument("project_gid", required=False)
@click.pass_context
def task_list(ctx: click.Context, limit: int, project_gid: str | None) -> None:
    _set_command(ctx, "task.list")
    require_mode(ctx, "task.list")
    _emit_success(ctx, "task.list", build_task_list_payload(project_gid=project_gid, limit=limit)["data"])


@task_group.command("get")
@click.argument("task_gid", required=False)
@click.pass_context
def task_get(ctx: click.Context, task_gid: str | None) -> None:
    _set_command(ctx, "task.get")
    require_mode(ctx, "task.get")
    _emit_success(ctx, "task.get", build_task_get_payload(task_gid=task_gid)["data"])


@task_group.command("create")
@click.argument("name")
@click.option("--project-gid", default=None)
@click.option("--notes", default=None)
@click.option("--assignee", default=None)
@click.option("--due-on", default=None)
@click.pass_context
def task_create(ctx: click.Context, name: str, project_gid: str | None, notes: str | None, assignee: str | None, due_on: str | None) -> None:
    _set_command(ctx, "task.create")
    require_mode(ctx, "task.create")
    _emit_success(ctx, "task.create", build_task_create_payload(project_gid=project_gid, name=name, notes=notes, assignee=assignee, due_on=due_on)["data"])


@task_group.command("update")
@click.argument("task_gid", required=False)
@click.option("--name", default=None)
@click.option("--notes", default=None)
@click.option("--assignee", default=None)
@click.option("--due-on", default=None)
@click.option("--completed", is_flag=True, default=None)
@click.pass_context
def task_update(ctx: click.Context, task_gid: str | None, name: str | None, notes: str | None, assignee: str | None, due_on: str | None, completed: bool | None) -> None:
    _set_command(ctx, "task.update")
    require_mode(ctx, "task.update")
    _emit_success(ctx, "task.update", build_task_update_payload(task_gid=task_gid, name=name, notes=notes, assignee=assignee, due_on=due_on, completed=completed)["data"])


# --- Comment ---

@cli.group("comment")
def comment_group() -> None:
    pass


@comment_group.command("list")
@click.argument("task_gid", required=False)
@click.pass_context
def comment_list(ctx: click.Context, task_gid: str | None) -> None:
    _set_command(ctx, "comment.list")
    require_mode(ctx, "comment.list")
    _emit_success(ctx, "comment.list", build_comment_list_payload(task_gid=task_gid)["data"])


@comment_group.command("create")
@click.argument("text")
@click.option("--task-gid", default=None)
@click.pass_context
def comment_create(ctx: click.Context, text: str, task_gid: str | None) -> None:
    _set_command(ctx, "comment.create")
    require_mode(ctx, "comment.create")
    _emit_success(ctx, "comment.create", build_comment_create_payload(task_gid=task_gid, text=text)["data"])


# --- Portfolio ---

@cli.group("portfolio")
def portfolio_group() -> None:
    pass


@portfolio_group.command("list")
@click.argument("workspace_gid", required=False)
@click.pass_context
def portfolio_list(ctx: click.Context, workspace_gid: str | None) -> None:
    _set_command(ctx, "portfolio.list")
    require_mode(ctx, "portfolio.list")
    _emit_success(ctx, "portfolio.list", build_portfolio_list_payload(workspace_gid=workspace_gid)["data"])


@portfolio_group.command("get")
@click.argument("portfolio_gid")
@click.pass_context
def portfolio_get(ctx: click.Context, portfolio_gid: str) -> None:
    _set_command(ctx, "portfolio.get")
    require_mode(ctx, "portfolio.get")
    _emit_success(ctx, "portfolio.get", build_portfolio_get_payload(portfolio_gid=portfolio_gid)["data"])


# --- Search ---

@cli.group("search")
def search_group() -> None:
    pass


@search_group.command("tasks")
@click.argument("query")
@click.option("--workspace-gid", default=None)
@click.pass_context
def search_tasks(ctx: click.Context, query: str, workspace_gid: str | None) -> None:
    _set_command(ctx, "search.tasks")
    require_mode(ctx, "search.tasks")
    _emit_success(ctx, "search.tasks", build_search_tasks_payload(workspace_gid=workspace_gid, query=query)["data"])


if __name__ == "__main__":
    cli()
