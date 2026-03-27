from __future__ import annotations

import json
import time
from datetime import datetime, timezone

import click

from . import __version__
from .client import create_issue, get_issue, list_issues, list_projects, search_issues, update_issue
from .config import redacted_config_snapshot, runtime_config
from .constants import (
    COMMAND_SPECS,
    CONNECTOR_AUTH,
    CONNECTOR_CATEGORIES,
    CONNECTOR_CATEGORY,
    CONNECTOR_LABEL,
    CONNECTOR_RESOURCES,
    MANIFEST_SCHEMA_VERSION,
    MODE_ORDER,
    PERMISSIONS_PATH,
    TOOL_NAME,
)
from .errors import CliError


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
        error = payload.get("error", {})
        click.echo(f"ERROR: {error.get('message', 'Unknown error')}")


def _result(*, ok: bool, command: str, mode: str, started: float, data: dict | None = None, error: dict | None = None) -> dict:
    base = {
        "ok": ok,
        "tool": TOOL_NAME,
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
    _emit(
        _result(
            ok=False,
            command=command_id,
            mode=mode,
            started=ctx.obj["started"],
            error={
                "code": "PERMISSION_DENIED",
                "message": f"Command requires mode={required}",
                "details": {"required_mode": required, "actual_mode": mode},
            },
        ),
        ctx.obj["json"],
    )
    raise SystemExit(3)


def _emit_error(ctx: click.Context, command_id: str, err: CliError) -> None:
    _emit(
        _result(
            ok=False,
            command=command_id,
            mode=ctx.obj["mode"],
            started=ctx.obj["started"],
            error=err.to_payload(),
        ),
        ctx.obj["json"],
    )
    raise SystemExit(err.exit_code)


@click.group()
@click.option("--json", "as_json", is_flag=True, help="Emit JSON output")
@click.option("--mode", type=click.Choice(MODE_ORDER), default="readonly", show_default=True)
@click.option("--verbose", is_flag=True, help="Verbose diagnostic output")
@click.option("--api-key", default="", help="Override Linear API key for direct fallback")
@click.option("--team-key", default="", help="Override the Linear team key (default: WEB)")
@click.option("--team-id", default="", help="Override the Linear team UUID")
@click.option("--base-url", default="", help="Override Linear GraphQL endpoint")
@click.version_option(__version__)
@click.pass_context
def cli(ctx: click.Context, as_json: bool, mode: str, verbose: bool, api_key: str, team_key: str, team_id: str, base_url: str) -> None:
    ctx.ensure_object(dict)
    ctx.obj.update(
        {
            "json": as_json,
            "mode": mode,
            "verbose": verbose,
            "started": time.time(),
            "api_key_override": api_key.strip(),
            "team_key": team_key.strip(),
            "team_id": team_id.strip(),
            "base_url": base_url.strip(),
        }
    )


@cli.command("capabilities")
@click.pass_context
def capabilities(ctx: click.Context) -> None:
    payload = {
        "tool": TOOL_NAME,
        "version": __version__,
        "manifest_schema_version": MANIFEST_SCHEMA_VERSION,
        "backend": "linear",
        "modes": MODE_ORDER,
        "connector": {
            "label": CONNECTOR_LABEL,
            "category": CONNECTOR_CATEGORY,
            "categories": CONNECTOR_CATEGORIES,
            "resources": CONNECTOR_RESOURCES,
        },
        "auth": CONNECTOR_AUTH,
        "commands": COMMAND_SPECS,
    }
    _emit(payload, True)


@cli.group("config")
def config_group() -> None:
    pass


@config_group.command("show")
@click.pass_context
def config_show(ctx: click.Context) -> None:
    require_mode(ctx, "config.show")
    _emit(
        _result(
            ok=True,
            command="config.show",
            mode=ctx.obj["mode"],
            started=ctx.obj["started"],
            data=redacted_config_snapshot(ctx.obj),
        ),
        ctx.obj["json"],
    )


@cli.command("health")
@click.pass_context
def health(ctx: click.Context) -> None:
    require_mode(ctx, "health")
    config = runtime_config(ctx.obj)
    data = {
        "base_url": config["base_url"],
        "api_key_present": config["api_key_present"],
        "api_key_source": config["api_key_source"],
        "team_key": config["team_key"],
        "team_key_source": config["team_key_source"],
        "team_id_present": config["team_id_present"],
        "team_id_source": config["team_id_source"],
        "auth_ready": config["auth_ready"],
    }
    _emit(_result(ok=True, command="health", mode=ctx.obj["mode"], started=ctx.obj["started"], data=data), ctx.obj["json"])


@cli.command("doctor")
@click.pass_context
def doctor(ctx: click.Context) -> None:
    require_mode(ctx, "doctor")
    config = runtime_config(ctx.obj)
    checks = [
        {"name": "linear_api_key", "ok": bool(config["api_key_present"]), "detail": config["api_key_source"] or "missing"},
        {"name": "team_scope", "ok": bool(config["team_key"] or config["team_id"]), "detail": config["team_id"] or config["team_key"] or "missing"},
    ]
    data = {
        "checks": checks,
        "recommended_path": "connected" if config["auth_ready"] else "setup-required",
        "config": redacted_config_snapshot(ctx.obj),
    }
    _emit(_result(ok=True, command="doctor", mode=ctx.obj["mode"], started=ctx.obj["started"], data=data), ctx.obj["json"])


@cli.command("list-projects")
@click.option("--limit", type=int, default=100, show_default=True)
@click.pass_context
def list_projects_cmd(ctx: click.Context, limit: int) -> None:
    require_mode(ctx, "list-projects")
    try:
        data = list_projects(limit=limit, ctx_obj=ctx.obj)
    except CliError as err:
        _emit_error(ctx, "list-projects", err)
    _emit(_result(ok=True, command="list-projects", mode=ctx.obj["mode"], started=ctx.obj["started"], data=data), ctx.obj["json"])


@cli.command("list-issues")
@click.option("--project", default="", help="Filter by project id or name")
@click.option("--status", default="", help="Filter by status name, id, or type")
@click.option("--assignee", default="", help="Filter by assignee id, name, or email")
@click.option("--query", default="", help="Full-text search filter")
@click.option("--limit", type=int, default=20, show_default=True)
@click.option("--include-archived/--no-include-archived", default=False, show_default=True)
@click.option("--cursor", default="", help="Pagination cursor")
@click.pass_context
def list_issues_cmd(ctx: click.Context, project: str, status: str, assignee: str, query: str, limit: int, include_archived: bool, cursor: str) -> None:
    require_mode(ctx, "list-issues")
    try:
        data = list_issues(
            project=project or None,
            status=status or None,
            assignee=assignee or None,
            query=query or None,
            limit=limit,
            include_archived=include_archived,
            cursor=cursor or None,
            ctx_obj=ctx.obj,
        )
    except CliError as err:
        _emit_error(ctx, "list-issues", err)
    _emit(_result(ok=True, command="list-issues", mode=ctx.obj["mode"], started=ctx.obj["started"], data=data), ctx.obj["json"])


@cli.command("search")
@click.option("--query", required=True, help="Search query")
@click.option("--project", default="", help="Filter by project id or name")
@click.option("--status", default="", help="Filter by status name, id, or type")
@click.option("--assignee", default="", help="Filter by assignee id, name, or email")
@click.option("--limit", type=int, default=20, show_default=True)
@click.option("--include-archived/--no-include-archived", default=False, show_default=True)
@click.pass_context
def search_cmd(ctx: click.Context, query: str, project: str, status: str, assignee: str, limit: int, include_archived: bool) -> None:
    require_mode(ctx, "search")
    try:
        data = search_issues(
            query=query,
            project=project or None,
            status=status or None,
            assignee=assignee or None,
            limit=limit,
            include_archived=include_archived,
            ctx_obj=ctx.obj,
        )
    except CliError as err:
        _emit_error(ctx, "search", err)
    _emit(_result(ok=True, command="search", mode=ctx.obj["mode"], started=ctx.obj["started"], data=data), ctx.obj["json"])


@cli.command("get-issue")
@click.argument("issue_id")
@click.pass_context
def get_issue_cmd(ctx: click.Context, issue_id: str) -> None:
    require_mode(ctx, "get-issue")
    try:
        data = get_issue(issue_id, ctx.obj)
    except CliError as err:
        _emit_error(ctx, "get-issue", err)
    _emit(_result(ok=True, command="get-issue", mode=ctx.obj["mode"], started=ctx.obj["started"], data=data), ctx.obj["json"])


@cli.command("create-issue")
@click.option("--title", required=True, help="Issue title")
@click.option("--description", default="", help="Issue description")
@click.option("--project", default="", help="Project id or name")
@click.option("--priority", type=int, default=None, help="Priority value")
@click.option("--status", default="", help="Initial workflow state")
@click.option("--assignee", default="", help="Assignee id, name, or email")
@click.option("--team-key", default="", help="Override the Linear team key")
@click.pass_context
def create_issue_cmd(ctx: click.Context, title: str, description: str, project: str, priority: int | None, status: str, assignee: str, team_key: str) -> None:
    require_mode(ctx, "create-issue")
    try:
        data = create_issue(
            title=title,
            description=description or None,
            project=project or None,
            priority=priority,
            status=status or None,
            assignee=assignee or None,
            team_key=team_key or None,
            ctx_obj=ctx.obj,
        )
    except CliError as err:
        _emit_error(ctx, "create-issue", err)
    _emit(_result(ok=True, command="create-issue", mode=ctx.obj["mode"], started=ctx.obj["started"], data=data), ctx.obj["json"])


@cli.command("update-issue")
@click.argument("issue_id")
@click.option("--title", default="", help="Updated issue title")
@click.option("--description", default="", help="Updated issue description")
@click.option("--project", default="", help="Project id or name")
@click.option("--priority", type=int, default=None, help="Priority value")
@click.option("--status", default="", help="Workflow state")
@click.option("--assignee", default="", help="Assignee id, name, or email")
@click.option("--team-key", default="", help="Override the Linear team key")
@click.pass_context
def update_issue_cmd(ctx: click.Context, issue_id: str, title: str, description: str, project: str, priority: int | None, status: str, assignee: str, team_key: str) -> None:
    require_mode(ctx, "update-issue")
    try:
        data = update_issue(
            issue_id=issue_id,
            title=title or None,
            description=description or None,
            project=project or None,
            priority=priority,
            status=status or None,
            assignee=assignee or None,
            team_key=team_key or None,
            ctx_obj=ctx.obj,
        )
    except CliError as err:
        _emit_error(ctx, "update-issue", err)
    _emit(_result(ok=True, command="update-issue", mode=ctx.obj["mode"], started=ctx.obj["started"], data=data), ctx.obj["json"])


if __name__ == "__main__":
    cli()
