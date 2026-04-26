from __future__ import annotations

import os
import time

import click

from . import __version__
from .commands import register
from .constants import (
    DEFAULT_ACCESS_TOKEN_ENV,
    DEFAULT_ACCOUNT_ALIAS_ENV,
    DEFAULT_APP_ID_ENV,
    DEFAULT_BASE_URL,
    DEFAULT_PORTAL_ID_ENV,
    DEFAULT_WEBHOOK_SECRET_ENV,
    LEGACY_ACCOUNT_ALIAS_ENV,
    LEGACY_PORTAL_ID_ENV,
    MODE_ORDER,
)
from .errors import CliError
from .output import emit, failure, success


class AosGroup(click.Group):
    def invoke(self, ctx: click.Context):
        try:
            return super().invoke(ctx)
        except CliError as err:
            payload = failure(
                tool="aos-hubspot",
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
                tool="aos-hubspot",
                command=ctx.obj.get("_command_id", "unknown") if ctx.obj else "unknown",
                error={"code": "INVALID_USAGE", "message": str(err), "details": {}},
                started=ctx.obj.get("started", time.time()) if ctx.obj else time.time(),
                mode=ctx.obj.get("mode", "unknown") if ctx.obj else "unknown",
                version=ctx.obj.get("version", __version__) if ctx.obj else __version__,
            )
            emit(payload, as_json=ctx.obj.get("json", True) if ctx.obj else True)
            ctx.exit(2)


@click.group(cls=AosGroup)
@click.option("--json", "as_json", is_flag=True, help="Emit JSON output")
@click.option("--mode", type=click.Choice(MODE_ORDER), default="readonly", show_default=True)
@click.option("--verbose", is_flag=True, help="Verbose diagnostics")
@click.option("--base-url", default=lambda: os.getenv("HUBSPOT_BASE_URL") or os.getenv("AOS_HUBSPOT_BASE_URL") or DEFAULT_BASE_URL, show_default=True)
@click.option(
    "--portal-id",
    default="",
    help="HubSpot portal/account id",
)
@click.option(
    "--account-alias",
    default="",
    help="Human-friendly account alias",
)
@click.option(
    "--access-token-env",
    default=lambda: os.getenv("HUBSPOT_ACCESS_TOKEN_ENV", DEFAULT_ACCESS_TOKEN_ENV),
    show_default=True,
    help="Environment variable that stores the HubSpot access token",
)
@click.option(
    "--app-id-env",
    default=lambda: os.getenv("HUBSPOT_APP_ID_ENV", DEFAULT_APP_ID_ENV),
    show_default=True,
    help="Environment variable that stores the HubSpot app id",
)
@click.option(
    "--webhook-secret-env",
    default=lambda: os.getenv("HUBSPOT_WEBHOOK_SECRET_ENV", DEFAULT_WEBHOOK_SECRET_ENV),
    show_default=True,
    help="Environment variable that stores the HubSpot webhook secret",
)
@click.version_option(__version__)
@click.pass_context
def cli(
    ctx: click.Context,
    as_json: bool,
    mode: str,
    verbose: bool,
    base_url: str,
    portal_id: str,
    account_alias: str,
    access_token_env: str,
    app_id_env: str,
    webhook_secret_env: str,
) -> None:
    ctx.ensure_object(dict)
    ctx.obj.update(
        {
            "json": as_json,
            "mode": mode,
            "verbose": verbose,
            "base_url": base_url,
            "portal_id": portal_id or None,
            "account_alias": account_alias or None,
            "access_token_env": access_token_env,
            "app_id_env": app_id_env,
            "webhook_secret_env": webhook_secret_env,
            "started": time.time(),
            "version": __version__,
            "_result": None,
            "_command_id": "unknown",
        }
    )


@cli.result_callback()
@click.pass_context
def handle_result(ctx: click.Context, _result, **_kwargs) -> None:
    if ctx.obj.get("_result") is None:
        return
    payload = success(
        tool="aos-hubspot",
        command=ctx.obj.get("_command_id", "unknown"),
        data=ctx.obj["_result"],
        started=ctx.obj["started"],
        mode=ctx.obj["mode"],
        version=ctx.obj["version"],
    )
    emit(payload, as_json=ctx.obj["json"])


register(cli)


if __name__ == "__main__":
    cli()
