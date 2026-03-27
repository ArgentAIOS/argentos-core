from __future__ import annotations

import json
import time

import click

from . import __version__
from .config import config_snapshot
from .constants import MODE_ORDER, PERMISSIONS_PATH
from .errors import CliError
from .output import emit, failure, success
from .runtime import (
    board_get_result,
    board_list_result,
    capabilities_snapshot,
    doctor_snapshot,
    health_snapshot,
    issue_comment_result,
    issue_create_result,
    issue_get_result,
    issue_list_result,
    issue_transition_result,
    issue_update_result,
    project_get_result,
    project_list_result,
    search_jql_result,
    sprint_get_result,
    sprint_issues_result,
    sprint_list_result,
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
        except click.ClickException as err:
            emit(
                failure(
                    command=ctx.obj.get("_command_id", "unknown") if ctx.obj else "unknown",
                    mode=ctx.obj.get("mode", "unknown") if ctx.obj else "unknown",
                    started=ctx.obj.get("started", time.time()) if ctx.obj else time.time(),
                    error={"code": "INVALID_USAGE", "message": str(err), "details": {}},
                ),
                as_json=ctx.obj.get("json", True) if ctx.obj else True,
            )
            ctx.exit(2)


def _set_command(ctx: click.Context, command_id: str) -> None:
    ctx.obj["_command_id"] = command_id


def _emit_success(ctx: click.Context, command_id: str, data: dict) -> None:
    emit(
        success(command=command_id, mode=ctx.obj["mode"], started=ctx.obj["started"], data=data),
        as_json=ctx.obj["json"],
    )


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


# --- Project commands ---

@cli.group("project")
def project_group() -> None:
    pass


@project_group.command("list")
@click.option("--limit", default=50, show_default=True, type=int)
@click.pass_context
def project_list(ctx: click.Context, limit: int) -> None:
    _set_command(ctx, "project.list")
    require_mode(ctx, "project.list")
    _emit_success(ctx, "project.list", project_list_result(ctx.obj, limit=limit))


@project_group.command("get")
@click.argument("project_key", required=False)
@click.pass_context
def project_get(ctx: click.Context, project_key: str | None) -> None:
    _set_command(ctx, "project.get")
    require_mode(ctx, "project.get")
    _emit_success(ctx, "project.get", project_get_result(ctx.obj, project_key))


# --- Issue commands ---

@cli.group("issue")
def issue_group() -> None:
    pass


@issue_group.command("list")
@click.option("--project", "project_key", default=None, help="Project key")
@click.option("--limit", default=50, show_default=True, type=int)
@click.pass_context
def issue_list(ctx: click.Context, project_key: str | None, limit: int) -> None:
    _set_command(ctx, "issue.list")
    require_mode(ctx, "issue.list")
    _emit_success(ctx, "issue.list", issue_list_result(ctx.obj, project_key, limit=limit))


@issue_group.command("get")
@click.argument("issue_key", required=False)
@click.pass_context
def issue_get(ctx: click.Context, issue_key: str | None) -> None:
    _set_command(ctx, "issue.get")
    require_mode(ctx, "issue.get")
    _emit_success(ctx, "issue.get", issue_get_result(ctx.obj, issue_key))


@issue_group.command("create")
@click.option("--project", "project_key", default=None, help="Project key")
@click.option("--summary", required=True, help="Issue summary")
@click.option("--type", "issue_type", default="Task", show_default=True, help="Issue type")
@click.option("--description", default=None, help="Issue description")
@click.pass_context
def issue_create(ctx: click.Context, project_key: str | None, summary: str, issue_type: str, description: str | None) -> None:
    _set_command(ctx, "issue.create")
    require_mode(ctx, "issue.create")
    _emit_success(ctx, "issue.create", issue_create_result(ctx.obj, project_key, summary=summary, issue_type=issue_type, description=description))


@issue_group.command("update")
@click.argument("issue_key")
@click.option("--summary", default=None)
@click.option("--description", default=None)
@click.pass_context
def issue_update(ctx: click.Context, issue_key: str, summary: str | None, description: str | None) -> None:
    _set_command(ctx, "issue.update")
    require_mode(ctx, "issue.update")
    _emit_success(ctx, "issue.update", issue_update_result(ctx.obj, issue_key, summary=summary, description=description))


@issue_group.command("transition")
@click.argument("issue_key")
@click.option("--status", required=True, help="Target status name")
@click.pass_context
def issue_transition(ctx: click.Context, issue_key: str, status: str) -> None:
    _set_command(ctx, "issue.transition")
    require_mode(ctx, "issue.transition")
    _emit_success(ctx, "issue.transition", issue_transition_result(ctx.obj, issue_key, status=status))


@issue_group.command("comment")
@click.argument("issue_key")
@click.option("--body", required=True, help="Comment body")
@click.pass_context
def issue_comment(ctx: click.Context, issue_key: str, body: str) -> None:
    _set_command(ctx, "issue.comment")
    require_mode(ctx, "issue.comment")
    _emit_success(ctx, "issue.comment", issue_comment_result(ctx.obj, issue_key, body=body))


# --- Board commands ---

@cli.group("board")
def board_group() -> None:
    pass


@board_group.command("list")
@click.option("--project", "project_key", default=None, help="Filter by project key")
@click.option("--limit", default=50, show_default=True, type=int)
@click.pass_context
def board_list(ctx: click.Context, project_key: str | None, limit: int) -> None:
    _set_command(ctx, "board.list")
    require_mode(ctx, "board.list")
    _emit_success(ctx, "board.list", board_list_result(ctx.obj, project_key, limit=limit))


@board_group.command("get")
@click.argument("board_id", required=False, type=int)
@click.pass_context
def board_get(ctx: click.Context, board_id: int | None) -> None:
    _set_command(ctx, "board.get")
    require_mode(ctx, "board.get")
    _emit_success(ctx, "board.get", board_get_result(ctx.obj, board_id))


# --- Sprint commands ---

@cli.group("sprint")
def sprint_group() -> None:
    pass


@sprint_group.command("list")
@click.argument("board_id", required=False, type=int)
@click.option("--limit", default=50, show_default=True, type=int)
@click.pass_context
def sprint_list(ctx: click.Context, board_id: int | None, limit: int) -> None:
    _set_command(ctx, "sprint.list")
    require_mode(ctx, "sprint.list")
    _emit_success(ctx, "sprint.list", sprint_list_result(ctx.obj, board_id, limit=limit))


@sprint_group.command("get")
@click.argument("sprint_id", required=False, type=int)
@click.pass_context
def sprint_get(ctx: click.Context, sprint_id: int | None) -> None:
    _set_command(ctx, "sprint.get")
    require_mode(ctx, "sprint.get")
    _emit_success(ctx, "sprint.get", sprint_get_result(ctx.obj, sprint_id))


@sprint_group.command("issues")
@click.argument("sprint_id", required=False, type=int)
@click.option("--limit", default=50, show_default=True, type=int)
@click.pass_context
def sprint_issues(ctx: click.Context, sprint_id: int | None, limit: int) -> None:
    _set_command(ctx, "sprint.issues")
    require_mode(ctx, "sprint.issues")
    _emit_success(ctx, "sprint.issues", sprint_issues_result(ctx.obj, sprint_id, limit=limit))


# --- Search commands ---

@cli.group("search")
def search_group() -> None:
    pass


@search_group.command("jql")
@click.option("--jql", required=True, help="JQL query string")
@click.option("--limit", default=50, show_default=True, type=int)
@click.pass_context
def search_jql(ctx: click.Context, jql: str, limit: int) -> None:
    _set_command(ctx, "search.jql")
    require_mode(ctx, "search.jql")
    _emit_success(ctx, "search.jql", search_jql_result(ctx.obj, jql=jql, limit=limit))
