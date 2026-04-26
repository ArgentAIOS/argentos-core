from __future__ import annotations

import json
import time

import click

from . import __version__
from .constants import MODE_ORDER, PERMISSIONS_PATH
from .errors import CliError
from .output import emit, failure, success
from .runtime import (
    account_list_result,
    account_whoami_result,
    capabilities_snapshot,
    config_snapshot,
    doctor_snapshot,
    health_snapshot,
    item_get_result,
    item_list_result,
    item_reveal_result,
    vault_list_result,
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
    emit(success(command=command_id, mode=ctx.obj["mode"], started=ctx.obj["started"], data=data), as_json=ctx.obj["json"])


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


@cli.group("account")
def account_group() -> None:
    pass


@account_group.command("whoami")
@click.pass_context
def account_whoami(ctx: click.Context) -> None:
    _set_command(ctx, "account.whoami")
    require_mode(ctx, "account.whoami")
    _emit_success(ctx, "account.whoami", account_whoami_result(ctx.obj))


@account_group.command("list")
@click.pass_context
def account_list(ctx: click.Context) -> None:
    _set_command(ctx, "account.list")
    require_mode(ctx, "account.list")
    _emit_success(ctx, "account.list", account_list_result(ctx.obj))


@cli.group("vault")
def vault_group() -> None:
    pass


@vault_group.command("list")
@click.pass_context
def vault_list(ctx: click.Context) -> None:
    _set_command(ctx, "vault.list")
    require_mode(ctx, "vault.list")
    _emit_success(ctx, "vault.list", vault_list_result(ctx.obj))


@cli.group("item")
def item_group() -> None:
    pass


@item_group.command("list")
@click.option("--vault", default=None)
@click.option("--limit", default=50, show_default=True, type=int)
@click.pass_context
def item_list(ctx: click.Context, vault: str | None, limit: int) -> None:
    _set_command(ctx, "item.list")
    require_mode(ctx, "item.list")
    _emit_success(ctx, "item.list", item_list_result(ctx.obj, vault=vault, limit=limit))


@item_group.command("get")
@click.argument("item", required=False)
@click.option("--vault", default=None)
@click.pass_context
def item_get(ctx: click.Context, item: str | None, vault: str | None) -> None:
    _set_command(ctx, "item.get")
    require_mode(ctx, "item.get")
    _emit_success(ctx, "item.get", item_get_result(ctx.obj, item=item, vault=vault))


@item_group.command("reveal")
@click.argument("item", required=False)
@click.option("--vault", default=None)
@click.option("--field", default=None)
@click.pass_context
def item_reveal(ctx: click.Context, item: str | None, vault: str | None, field: str | None) -> None:
    _set_command(ctx, "item.reveal")
    require_mode(ctx, "item.reveal")
    _emit_success(ctx, "item.reveal", item_reveal_result(ctx.obj, item=item, vault=vault, field=field))
