from __future__ import annotations

import os
import time

import click

from . import __version__
from .commands import register
from .constants import MODE_ORDER
from .errors import CliError
from .output import emit, failure, success


class AosGroup(click.Group):
    def invoke(self, ctx: click.Context):
        try:
            return super().invoke(ctx)
        except CliError as err:
            payload = failure(
                tool="aos-mailchimp",
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
                tool="aos-mailchimp",
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
@click.option(
    "--api-key",
    default=lambda: os.getenv("MAILCHIMP_API_KEY") or os.getenv("AOS_MAILCHIMP_API_KEY", ""),
    help="Mailchimp API key",
)
@click.option(
    "--server-prefix",
    default=lambda: os.getenv("MAILCHIMP_SERVER_PREFIX") or os.getenv("AOS_MAILCHIMP_SERVER_PREFIX", ""),
    help="Mailchimp datacenter/server prefix",
)
@click.version_option(__version__)
@click.pass_context
def cli(
    ctx: click.Context,
    as_json: bool,
    mode: str,
    verbose: bool,
    api_key: str,
    server_prefix: str,
) -> None:
    ctx.ensure_object(dict)
    ctx.obj.update(
        {
            "json": as_json,
            "mode": mode,
            "verbose": verbose,
            "api_key": api_key or None,
            "server_prefix": server_prefix or None,
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
        tool="aos-mailchimp",
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

