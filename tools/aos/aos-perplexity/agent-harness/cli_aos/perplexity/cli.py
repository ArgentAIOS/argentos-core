from __future__ import annotations

import json
import time

import click

from . import __version__
from .constants import MODE_ORDER, PERMISSIONS_PATH
from .errors import CliError
from .output import emit, failure, success
from .runtime import (
    capabilities_snapshot,
    chat_complete_result,
    chat_stream_result,
    config_show_result,
    doctor_snapshot,
    health_snapshot,
    search_chat_result,
    search_query_result,
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


def _search_domain_options(func):
    func = click.option("--search-domain", "search_domains", multiple=True, help="Restrict search to a domain")(func)
    return func


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
    _emit_success(ctx, "config.show", config_show_result(ctx.obj))


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


@cli.group("search")
def search_group() -> None:
    pass


@search_group.command("query")
@click.argument("query")
@click.option("--model", default=None)
@click.option("--max-results", default=None, type=int)
@click.option("--search-domain", "search_domains", multiple=True, help="Restrict search to a domain")
@click.pass_context
def search_query(
    ctx: click.Context,
    query: str,
    model: str | None,
    max_results: int | None,
    search_domains: tuple[str, ...],
) -> None:
    _set_command(ctx, "search.query")
    require_mode(ctx, "search.query")
    _emit_success(
        ctx,
        "search.query",
        search_query_result(
            ctx.obj,
            query=query,
            model=model,
            search_domains=list(search_domains),
            max_results=max_results,
        ),
    )


@search_group.command("chat")
@click.argument("query")
@click.option("--model", default=None)
@click.option("--system-prompt", default=None)
@click.option("--temperature", default=None, type=float)
@click.option("--max-tokens", default=None, type=int)
@click.option("--search-domain", "search_domains", multiple=True, help="Restrict search to a domain")
@click.pass_context
def search_chat(
    ctx: click.Context,
    query: str,
    model: str | None,
    system_prompt: str | None,
    temperature: float | None,
    max_tokens: int | None,
    search_domains: tuple[str, ...],
) -> None:
    _set_command(ctx, "search.chat")
    require_mode(ctx, "search.chat")
    _emit_success(
        ctx,
        "search.chat",
        search_chat_result(
            ctx.obj,
            query=query,
            model=model,
            search_domains=list(search_domains),
            system_prompt=system_prompt,
            temperature=temperature,
            max_tokens=max_tokens,
        ),
    )


@cli.group("chat")
def chat_group() -> None:
    pass


@chat_group.command("complete")
@click.option("--model", default=None)
@click.option("--prompt", default=None)
@click.option("--messages-json", default=None)
@click.option("--system-prompt", default=None)
@click.option("--temperature", default=None, type=float)
@click.option("--max-tokens", default=None, type=int)
@click.option("--search-domain", "search_domains", multiple=True, help="Restrict search to a domain")
@click.pass_context
def chat_complete(
    ctx: click.Context,
    model: str | None,
    prompt: str | None,
    messages_json: str | None,
    system_prompt: str | None,
    temperature: float | None,
    max_tokens: int | None,
    search_domains: tuple[str, ...],
) -> None:
    _set_command(ctx, "chat.complete")
    require_mode(ctx, "chat.complete")
    _emit_success(
        ctx,
        "chat.complete",
        chat_complete_result(
            ctx.obj,
            model=model,
            prompt=prompt,
            messages_json=messages_json,
            system_prompt=system_prompt,
            temperature=temperature,
            max_tokens=max_tokens,
            search_domains=list(search_domains),
        ),
    )


@chat_group.command("stream")
@click.option("--model", default=None)
@click.option("--prompt", default=None)
@click.option("--messages-json", default=None)
@click.option("--system-prompt", default=None)
@click.option("--temperature", default=None, type=float)
@click.option("--max-tokens", default=None, type=int)
@click.option("--search-domain", "search_domains", multiple=True, help="Restrict search to a domain")
@click.pass_context
def chat_stream(
    ctx: click.Context,
    model: str | None,
    prompt: str | None,
    messages_json: str | None,
    system_prompt: str | None,
    temperature: float | None,
    max_tokens: int | None,
    search_domains: tuple[str, ...],
) -> None:
    _set_command(ctx, "chat.stream")
    require_mode(ctx, "chat.stream")
    _emit_success(
        ctx,
        "chat.stream",
        chat_stream_result(
            ctx.obj,
            model=model,
            prompt=prompt,
            messages_json=messages_json,
            system_prompt=system_prompt,
            temperature=temperature,
            max_tokens=max_tokens,
            search_domains=list(search_domains),
        ),
    )


if __name__ == "__main__":
    cli()
