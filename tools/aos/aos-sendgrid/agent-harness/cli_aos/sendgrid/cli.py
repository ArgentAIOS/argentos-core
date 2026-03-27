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
    capabilities_snapshot,
    contacts_add_result,
    contacts_list_result,
    contacts_search_result,
    doctor_snapshot,
    email_send_result,
    email_send_template_result,
    health_snapshot,
    lists_add_contacts_result,
    lists_create_result,
    lists_list_result,
    stats_category_result,
    stats_global_result,
    templates_get_result,
    templates_list_result,
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
@click.option("--body", required=True, help="HTML body")
@click.pass_context
def email_send(ctx: click.Context, to: str, subject: str, body: str) -> None:
    _set_command(ctx, "email.send")
    require_mode(ctx, "email.send")
    _emit_success(ctx, "email.send", email_send_result(ctx.obj, to=to, subject=subject, body=body))


@email_group.command("send_template")
@click.argument("to")
@click.option("--template-id", default=None, help="Dynamic template ID")
@click.pass_context
def email_send_template(ctx: click.Context, to: str, template_id: str | None) -> None:
    _set_command(ctx, "email.send_template")
    require_mode(ctx, "email.send_template")
    _emit_success(ctx, "email.send_template", email_send_template_result(ctx.obj, to=to, template_id=template_id))


# ── Contacts ───────────────────────────────────────────────────

@cli.group("contacts")
def contacts_group() -> None:
    pass


@contacts_group.command("list")
@click.option("--limit", default=50, show_default=True, type=int)
@click.pass_context
def contacts_list(ctx: click.Context, limit: int) -> None:
    _set_command(ctx, "contacts.list")
    require_mode(ctx, "contacts.list")
    _emit_success(ctx, "contacts.list", contacts_list_result(ctx.obj, limit=limit))


@contacts_group.command("add")
@click.argument("email")
@click.option("--first-name", default=None)
@click.option("--last-name", default=None)
@click.pass_context
def contacts_add(ctx: click.Context, email: str, first_name: str | None, last_name: str | None) -> None:
    _set_command(ctx, "contacts.add")
    require_mode(ctx, "contacts.add")
    _emit_success(ctx, "contacts.add", contacts_add_result(ctx.obj, email=email, first_name=first_name, last_name=last_name))


@contacts_group.command("search")
@click.argument("query")
@click.option("--limit", default=50, show_default=True, type=int)
@click.pass_context
def contacts_search(ctx: click.Context, query: str, limit: int) -> None:
    _set_command(ctx, "contacts.search")
    require_mode(ctx, "contacts.search")
    _emit_success(ctx, "contacts.search", contacts_search_result(ctx.obj, query=query, limit=limit))


# ── Lists ──────────────────────────────────────────────────────

@cli.group("lists")
def lists_group() -> None:
    pass


@lists_group.command("list")
@click.option("--limit", default=50, show_default=True, type=int)
@click.pass_context
def lists_list(ctx: click.Context, limit: int) -> None:
    _set_command(ctx, "lists.list")
    require_mode(ctx, "lists.list")
    _emit_success(ctx, "lists.list", lists_list_result(ctx.obj, limit=limit))


@lists_group.command("create")
@click.argument("name")
@click.pass_context
def lists_create(ctx: click.Context, name: str) -> None:
    _set_command(ctx, "lists.create")
    require_mode(ctx, "lists.create")
    _emit_success(ctx, "lists.create", lists_create_result(ctx.obj, name=name))


@lists_group.command("add_contacts")
@click.argument("contact_ids", nargs=-1, required=True)
@click.option("--list-id", default=None, help="Target list ID")
@click.pass_context
def lists_add_contacts(ctx: click.Context, contact_ids: tuple[str, ...], list_id: str | None) -> None:
    _set_command(ctx, "lists.add_contacts")
    require_mode(ctx, "lists.add_contacts")
    _emit_success(ctx, "lists.add_contacts", lists_add_contacts_result(ctx.obj, list_id=list_id, contact_ids=list(contact_ids)))


# ── Templates ──────────────────────────────────────────────────

@cli.group("templates")
def templates_group() -> None:
    pass


@templates_group.command("list")
@click.option("--limit", default=50, show_default=True, type=int)
@click.pass_context
def templates_list(ctx: click.Context, limit: int) -> None:
    _set_command(ctx, "templates.list")
    require_mode(ctx, "templates.list")
    _emit_success(ctx, "templates.list", templates_list_result(ctx.obj, limit=limit))


@templates_group.command("get")
@click.argument("template_id", required=False)
@click.pass_context
def templates_get(ctx: click.Context, template_id: str | None) -> None:
    _set_command(ctx, "templates.get")
    require_mode(ctx, "templates.get")
    _emit_success(ctx, "templates.get", templates_get_result(ctx.obj, template_id=template_id))


# ── Stats ──────────────────────────────────────────────────────

@cli.group("stats")
def stats_group() -> None:
    pass


@stats_group.command("global")
@click.option("--start-date", default="2024-01-01", show_default=True)
@click.pass_context
def stats_global(ctx: click.Context, start_date: str) -> None:
    _set_command(ctx, "stats.global")
    require_mode(ctx, "stats.global")
    _emit_success(ctx, "stats.global", stats_global_result(ctx.obj, start_date=start_date))


@stats_group.command("category")
@click.argument("category")
@click.option("--start-date", default="2024-01-01", show_default=True)
@click.pass_context
def stats_category(ctx: click.Context, category: str, start_date: str) -> None:
    _set_command(ctx, "stats.category")
    require_mode(ctx, "stats.category")
    _emit_success(ctx, "stats.category", stats_category_result(ctx.obj, category=category, start_date=start_date))
