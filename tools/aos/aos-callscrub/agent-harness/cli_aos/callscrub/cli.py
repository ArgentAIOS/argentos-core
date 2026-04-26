from __future__ import annotations

import json
import time

import click

from . import __version__
from .config import config_snapshot
from .constants import MODE_ORDER, PERMISSIONS_PATH
from .errors import ConnectorError
from .output import emit, failure, success
from .runtime import (
    agent_list_result,
    agent_scorecard_result,
    agent_stats_result,
    call_get_result,
    call_list_result,
    capabilities_snapshot,
    coaching_get_result,
    coaching_list_result,
    doctor_snapshot,
    health_snapshot,
    report_list_result,
    team_list_result,
    team_stats_result,
    transcript_get_result,
    transcript_search_result,
)


def _mode_allows(actual: str, required: str) -> bool:
    return MODE_ORDER.index(actual) >= MODE_ORDER.index(required)


def _load_permissions() -> dict[str, str]:
    return json.loads(PERMISSIONS_PATH.read_text()).get("permissions", {})


def require_mode(ctx: click.Context, command_id: str) -> None:
    required = _load_permissions().get(command_id, "admin")
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
            emit(
                failure(
                    command=ctx.obj.get("_command_id", "unknown") if ctx.obj else "unknown",
                    mode=ctx.obj.get("mode", "unknown") if ctx.obj else "unknown",
                    started=ctx.obj.get("started", time.time()) if ctx.obj else time.time(),
                    version=ctx.obj.get("version", __version__) if ctx.obj else __version__,
                    error={"code": err.code, "message": err.message, "details": err.details or {}},
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
                    version=ctx.obj.get("version", __version__) if ctx.obj else __version__,
                    error={"code": "INVALID_USAGE", "message": str(err), "details": {}},
                ),
                as_json=ctx.obj.get("json", True) if ctx.obj else True,
            )
            ctx.exit(2)


def _set_command(ctx: click.Context, command_id: str) -> None:
    ctx.obj["_command_id"] = command_id


def _emit_success(ctx: click.Context, command_id: str, data: dict) -> None:
    emit(success(command=command_id, mode=ctx.obj["mode"], started=ctx.obj["started"], version=ctx.obj["version"], data=data), as_json=ctx.obj["json"])


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
    _emit_success(ctx, "capabilities", capabilities_snapshot())


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


@cli.group("config")
def config_group() -> None:
    pass


@config_group.command("show")
@click.pass_context
def config_show(ctx: click.Context) -> None:
    _set_command(ctx, "config.show")
    require_mode(ctx, "config.show")
    _emit_success(ctx, "config.show", config_snapshot(ctx.obj))


@cli.group("call")
def call_group() -> None:
    pass


@call_group.command("list")
@click.option("--team-id", default=None)
@click.option("--agent-name", default=None)
@click.option("--date-range", default=None)
@click.option("--limit", default=25, show_default=True, type=int)
@click.pass_context
def call_list(ctx: click.Context, team_id: str | None, agent_name: str | None, date_range: str | None, limit: int) -> None:
    _set_command(ctx, "call.list")
    require_mode(ctx, "call.list")
    _emit_success(ctx, "call.list", call_list_result(ctx.obj, team_id=team_id, agent_name=agent_name, date_range=date_range, limit=limit))


@call_group.command("get")
@click.argument("call_id", required=False)
@click.pass_context
def call_get(ctx: click.Context, call_id: str | None) -> None:
    _set_command(ctx, "call.get")
    require_mode(ctx, "call.get")
    _emit_success(ctx, "call.get", call_get_result(ctx.obj, call_id))


@cli.group("transcript")
def transcript_group() -> None:
    pass


@transcript_group.command("get")
@click.argument("call_id", required=False)
@click.pass_context
def transcript_get(ctx: click.Context, call_id: str | None) -> None:
    _set_command(ctx, "transcript.get")
    require_mode(ctx, "transcript.get")
    _emit_success(ctx, "transcript.get", transcript_get_result(ctx.obj, call_id))


@transcript_group.command("search")
@click.option("--query", default=None)
@click.option("--limit", default=20, show_default=True, type=int)
@click.pass_context
def transcript_search(ctx: click.Context, query: str | None, limit: int) -> None:
    _set_command(ctx, "transcript.search")
    require_mode(ctx, "transcript.search")
    _emit_success(ctx, "transcript.search", transcript_search_result(ctx.obj, query=query, limit=limit))


@cli.group("coaching")
def coaching_group() -> None:
    pass


@coaching_group.command("list")
@click.option("--limit", default=10, show_default=True, type=int)
@click.pass_context
def coaching_list(ctx: click.Context, limit: int) -> None:
    _set_command(ctx, "coaching.list")
    require_mode(ctx, "coaching.list")
    _emit_success(ctx, "coaching.list", coaching_list_result(ctx.obj, limit=limit))


@coaching_group.command("get")
@click.argument("coaching_id", required=False)
@click.pass_context
def coaching_get(ctx: click.Context, coaching_id: str | None) -> None:
    _set_command(ctx, "coaching.get")
    require_mode(ctx, "coaching.get")
    _emit_success(ctx, "coaching.get", coaching_get_result(ctx.obj, coaching_id))


@cli.group("agent")
def agent_group() -> None:
    pass


@agent_group.command("list")
@click.option("--limit", default=50, show_default=True, type=int)
@click.pass_context
def agent_list(ctx: click.Context, limit: int) -> None:
    _set_command(ctx, "agent.list")
    require_mode(ctx, "agent.list")
    _emit_success(ctx, "agent.list", agent_list_result(ctx.obj, limit=limit))


@agent_group.command("stats")
@click.option("--agent-name", default=None)
@click.option("--date-range", default=None)
@click.pass_context
def agent_stats(ctx: click.Context, agent_name: str | None, date_range: str | None) -> None:
    _set_command(ctx, "agent.stats")
    require_mode(ctx, "agent.stats")
    _emit_success(ctx, "agent.stats", agent_stats_result(ctx.obj, agent_name=agent_name, date_range=date_range))


@agent_group.command("scorecard")
@click.option("--agent-name", default=None)
@click.pass_context
def agent_scorecard(ctx: click.Context, agent_name: str | None) -> None:
    _set_command(ctx, "agent.scorecard")
    require_mode(ctx, "agent.scorecard")
    _emit_success(ctx, "agent.scorecard", agent_scorecard_result(ctx.obj, agent_name=agent_name))


@cli.group("team")
def team_group() -> None:
    pass


@team_group.command("list")
@click.option("--limit", default=20, show_default=True, type=int)
@click.pass_context
def team_list(ctx: click.Context, limit: int) -> None:
    _set_command(ctx, "team.list")
    require_mode(ctx, "team.list")
    _emit_success(ctx, "team.list", team_list_result(ctx.obj, limit=limit))


@team_group.command("stats")
@click.option("--team-id", default=None)
@click.option("--date-range", default=None)
@click.pass_context
def team_stats(ctx: click.Context, team_id: str | None, date_range: str | None) -> None:
    _set_command(ctx, "team.stats")
    require_mode(ctx, "team.stats")
    _emit_success(ctx, "team.stats", team_stats_result(ctx.obj, team_id=team_id, date_range=date_range))


@cli.group("report")
def report_group() -> None:
    pass


@report_group.command("list")
@click.option("--report-type", default=None)
@click.option("--date-range", default=None)
@click.option("--limit", default=10, show_default=True, type=int)
@click.pass_context
def report_list(ctx: click.Context, report_type: str | None, date_range: str | None, limit: int) -> None:
    _set_command(ctx, "report.list")
    require_mode(ctx, "report.list")
    _emit_success(ctx, "report.list", report_list_result(ctx.obj, report_type=report_type, date_range=date_range, limit=limit))
