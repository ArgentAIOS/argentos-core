from __future__ import annotations

import json
import time

import click

from . import __version__
from .config import config_snapshot
from .constants import MODE_ORDER, PERMISSIONS_PATH, TOOL_NAME
from .errors import CliError
from .output import emit, failure, success
from .runtime import (
    account_read_result,
    audience_list_result,
    audience_read_result,
    campaign_list_result,
    campaign_read_result,
    capabilities_snapshot,
    doctor_snapshot,
    health_snapshot,
    member_list_result,
    member_read_result,
    report_list_result,
    report_read_result,
    scaffold_write_result,
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


@cli.group("account")
def account_group() -> None:
    pass


@account_group.command("read")
@click.pass_context
def account_read(ctx: click.Context) -> None:
    _set_command(ctx, "account.read")
    require_mode(ctx, "account.read")
    _emit_success(ctx, "account.read", account_read_result(ctx.obj))


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


@cli.group("audience")
def audience_group() -> None:
    pass


@audience_group.command("list")
@click.option("--limit", default=10, show_default=True, type=int)
@click.pass_context
def audience_list(ctx: click.Context, limit: int) -> None:
    _set_command(ctx, "audience.list")
    require_mode(ctx, "audience.list")
    _emit_success(ctx, "audience.list", audience_list_result(ctx.obj, limit=limit))


@audience_group.command("read")
@click.argument("audience_id", required=False)
@click.pass_context
def audience_read(ctx: click.Context, audience_id: str | None) -> None:
    _set_command(ctx, "audience.read")
    require_mode(ctx, "audience.read")
    _emit_success(ctx, "audience.read", audience_read_result(ctx.obj, audience_id))


@cli.group("member")
def member_group() -> None:
    pass


@member_group.command("list")
@click.argument("audience_id", required=False)
@click.option("--limit", default=10, show_default=True, type=int)
@click.pass_context
def member_list(ctx: click.Context, audience_id: str | None, limit: int) -> None:
    _set_command(ctx, "member.list")
    require_mode(ctx, "member.list")
    _emit_success(ctx, "member.list", member_list_result(ctx.obj, audience_id, limit=limit))


@member_group.command("read")
@click.argument("audience_id", required=False)
@click.argument("email", required=False)
@click.pass_context
def member_read(ctx: click.Context, audience_id: str | None, email: str | None) -> None:
    _set_command(ctx, "member.read")
    require_mode(ctx, "member.read")
    _emit_success(ctx, "member.read", member_read_result(ctx.obj, audience_id, email))


@member_group.command("upsert")
@click.argument("audience_id", required=False)
@click.argument("email", required=False)
@click.pass_context
def member_upsert(ctx: click.Context, audience_id: str | None, email: str | None) -> None:
    _set_command(ctx, "member.upsert")
    require_mode(ctx, "member.upsert")
    _emit_success(
        ctx,
        "member.upsert",
        scaffold_write_result(ctx.obj, command_id="member.upsert", inputs={"audience_id": audience_id, "email": email}),
    )


@cli.group("campaign")
def campaign_group() -> None:
    pass


@campaign_group.command("list")
@click.option("--limit", default=10, show_default=True, type=int)
@click.option("--status", default=None, help="Optional Mailchimp campaign status filter")
@click.pass_context
def campaign_list(ctx: click.Context, limit: int, status: str | None) -> None:
    _set_command(ctx, "campaign.list")
    require_mode(ctx, "campaign.list")
    _emit_success(ctx, "campaign.list", campaign_list_result(ctx.obj, limit=limit, status=status))


@campaign_group.command("read")
@click.argument("campaign_id", required=False)
@click.pass_context
def campaign_read(ctx: click.Context, campaign_id: str | None) -> None:
    _set_command(ctx, "campaign.read")
    require_mode(ctx, "campaign.read")
    _emit_success(ctx, "campaign.read", campaign_read_result(ctx.obj, campaign_id))


@campaign_group.command("create-draft")
@click.argument("title")
@click.pass_context
def campaign_create_draft(ctx: click.Context, title: str) -> None:
    _set_command(ctx, "campaign.create_draft")
    require_mode(ctx, "campaign.create_draft")
    _emit_success(
        ctx,
        "campaign.create_draft",
        scaffold_write_result(ctx.obj, command_id="campaign.create_draft", inputs={"title": title}),
    )


@cli.group("report")
def report_group() -> None:
    pass


@report_group.command("list")
@click.option("--limit", default=10, show_default=True, type=int)
@click.pass_context
def report_list(ctx: click.Context, limit: int) -> None:
    _set_command(ctx, "report.list")
    require_mode(ctx, "report.list")
    _emit_success(ctx, "report.list", report_list_result(ctx.obj, limit=limit))


@report_group.command("read")
@click.argument("campaign_id", required=False)
@click.pass_context
def report_read(ctx: click.Context, campaign_id: str | None) -> None:
    _set_command(ctx, "report.read")
    require_mode(ctx, "report.read")
    _emit_success(ctx, "report.read", report_read_result(ctx.obj, campaign_id))


if __name__ == "__main__":
    cli()
