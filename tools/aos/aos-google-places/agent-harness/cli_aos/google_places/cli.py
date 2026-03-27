from __future__ import annotations

import json
import time
from datetime import datetime, timezone

import click

from . import __version__
from .client import get_place, resolve_location, search_places
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
@click.option("--api-key", "api_key_override", default="", help="Override Google Places API key")
@click.option("--base-url", default="", help="Override Google Places API base URL")
@click.version_option(__version__)
@click.pass_context
def cli(ctx: click.Context, as_json: bool, mode: str, verbose: bool, api_key_override: str, base_url: str) -> None:
    ctx.ensure_object(dict)
    ctx.obj.update(
        {
            "json": as_json,
            "mode": mode,
            "verbose": verbose,
            "started": time.time(),
            "api_key_override": api_key_override.strip(),
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
        "backend": "google-places",
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
        "auth_ready": config["api_key_present"],
    }
    _emit(_result(ok=True, command="health", mode=ctx.obj["mode"], started=ctx.obj["started"], data=data), ctx.obj["json"])


@cli.command("doctor")
@click.pass_context
def doctor(ctx: click.Context) -> None:
    require_mode(ctx, "doctor")
    config = runtime_config(ctx.obj)
    checks = [
        {
            "name": "google_places_api_key",
            "ok": bool(config["api_key_present"]),
            "detail": config["api_key_source"] or "missing",
        }
    ]
    data = {
        "checks": checks,
        "recommended_path": "direct" if config["api_key_present"] else "setup-required",
        "config": redacted_config_snapshot(ctx.obj),
    }
    _emit(_result(ok=True, command="doctor", mode=ctx.obj["mode"], started=ctx.obj["started"], data=data), ctx.obj["json"])


@cli.command("search")
@click.option("--query", required=True, help="Search text query")
@click.option("--limit", type=int, default=10, show_default=True)
@click.option("--type", "type_filter", default="", help="Single Google Places includedType filter")
@click.option("--min-rating", type=float, default=None)
@click.option("--keyword", default="", help="Extra keyword appended to the text query")
@click.option("--open-now/--no-open-now", default=None)
@click.option("--page-token", default="")
@click.pass_context
def search(ctx: click.Context, query: str, limit: int, type_filter: str, min_rating: float | None, keyword: str, open_now: bool | None, page_token: str) -> None:
    require_mode(ctx, "search")
    try:
        data = search_places(
            query,
            limit=limit,
            type_filter=type_filter,
            min_rating=min_rating,
            keyword=keyword,
            open_now=open_now,
            page_token=page_token,
            ctx_obj=ctx.obj,
        )
    except CliError as err:
        _emit_error(ctx, "search", err)
    _emit(_result(ok=True, command="search", mode=ctx.obj["mode"], started=ctx.obj["started"], data=data), ctx.obj["json"])


@cli.command("place")
@click.option("--place-id", required=True, help="Google Place id")
@click.pass_context
def place(ctx: click.Context, place_id: str) -> None:
    require_mode(ctx, "place")
    try:
        data = get_place(place_id, ctx.obj)
    except CliError as err:
        _emit_error(ctx, "place", err)
    _emit(_result(ok=True, command="place", mode=ctx.obj["mode"], started=ctx.obj["started"], data=data), ctx.obj["json"])


@cli.command("resolve")
@click.option("--location-text", required=True, help="Freeform location text")
@click.option("--limit", type=int, default=5, show_default=True)
@click.pass_context
def resolve(ctx: click.Context, location_text: str, limit: int) -> None:
    require_mode(ctx, "resolve")
    try:
        data = resolve_location(location_text, limit=limit, ctx_obj=ctx.obj)
    except CliError as err:
        _emit_error(ctx, "resolve", err)
    _emit(_result(ok=True, command="resolve", mode=ctx.obj["mode"], started=ctx.obj["started"], data=data), ctx.obj["json"])


if __name__ == "__main__":
    cli()
