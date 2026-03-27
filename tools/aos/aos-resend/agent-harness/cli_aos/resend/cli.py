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
    audiences_create_result,
    audiences_list_result,
    capabilities_snapshot,
    contacts_create_result,
    contacts_list_result,
    contacts_remove_result,
    doctor_snapshot,
    domains_list_result,
    domains_verify_result,
    email_batch_send_result,
    email_send_result,
    health_snapshot,
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


# ── Email ──────────────────────────────────────────────────────

@cli.group("email")
def email_group() -> None:
    pass


@email_group.command("send")
@click.argument("to")
@click.option("--subject", required=True, help="Email subject")
@click.option("--html", required=True, help="HTML body")
@click.pass_context
def email_send(ctx: click.Context, to: str, subject: str, html: str) -> None:
    _set_command(ctx, "email.send")
    require_mode(ctx, "email.send")
    _emit_success(ctx, "email.send", email_send_result(ctx.obj, to=to, subject=subject, html=html))


@email_group.command("batch_send")
@click.argument("to_list", nargs=-1, required=True)
@click.option("--subject", required=True, help="Email subject")
@click.option("--html", required=True, help="HTML body")
@click.pass_context
def email_batch_send(ctx: click.Context, to_list: tuple[str, ...], subject: str, html: str) -> None:
    _set_command(ctx, "email.batch_send")
    require_mode(ctx, "email.batch_send")
    _emit_success(ctx, "email.batch_send", email_batch_send_result(ctx.obj, to_list=list(to_list), subject=subject, html=html))


# ── Domains ────────────────────────────────────────────────────

@cli.group("domains")
def domains_group() -> None:
    pass


@domains_group.command("list")
@click.pass_context
def domains_list(ctx: click.Context) -> None:
    _set_command(ctx, "domains.list")
    require_mode(ctx, "domains.list")
    _emit_success(ctx, "domains.list", domains_list_result(ctx.obj))


@domains_group.command("verify")
@click.argument("domain_id", required=False)
@click.pass_context
def domains_verify(ctx: click.Context, domain_id: str | None) -> None:
    _set_command(ctx, "domains.verify")
    require_mode(ctx, "domains.verify")
    _emit_success(ctx, "domains.verify", domains_verify_result(ctx.obj, domain_id=domain_id))


# ── Audiences ──────────────────────────────────────────────────

@cli.group("audiences")
def audiences_group() -> None:
    pass


@audiences_group.command("list")
@click.pass_context
def audiences_list(ctx: click.Context) -> None:
    _set_command(ctx, "audiences.list")
    require_mode(ctx, "audiences.list")
    _emit_success(ctx, "audiences.list", audiences_list_result(ctx.obj))


@audiences_group.command("create")
@click.argument("name")
@click.pass_context
def audiences_create(ctx: click.Context, name: str) -> None:
    _set_command(ctx, "audiences.create")
    require_mode(ctx, "audiences.create")
    _emit_success(ctx, "audiences.create", audiences_create_result(ctx.obj, name=name))


# ── Contacts ───────────────────────────────────────────────────

@cli.group("contacts")
def contacts_group() -> None:
    pass


@contacts_group.command("list")
@click.option("--audience-id", default=None, help="Target audience ID")
@click.pass_context
def contacts_list(ctx: click.Context, audience_id: str | None) -> None:
    _set_command(ctx, "contacts.list")
    require_mode(ctx, "contacts.list")
    _emit_success(ctx, "contacts.list", contacts_list_result(ctx.obj, audience_id=audience_id))


@contacts_group.command("create")
@click.argument("email")
@click.option("--audience-id", default=None, help="Target audience ID")
@click.option("--first-name", default=None)
@click.option("--last-name", default=None)
@click.pass_context
def contacts_create(ctx: click.Context, email: str, audience_id: str | None, first_name: str | None, last_name: str | None) -> None:
    _set_command(ctx, "contacts.create")
    require_mode(ctx, "contacts.create")
    _emit_success(ctx, "contacts.create", contacts_create_result(ctx.obj, audience_id=audience_id, email=email, first_name=first_name, last_name=last_name))


@contacts_group.command("remove")
@click.argument("contact_id")
@click.option("--audience-id", default=None, help="Target audience ID")
@click.pass_context
def contacts_remove(ctx: click.Context, contact_id: str, audience_id: str | None) -> None:
    _set_command(ctx, "contacts.remove")
    require_mode(ctx, "contacts.remove")
    _emit_success(ctx, "contacts.remove", contacts_remove_result(ctx.obj, audience_id=audience_id, contact_id=contact_id))
