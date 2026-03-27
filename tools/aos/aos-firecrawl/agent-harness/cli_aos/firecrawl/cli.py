from __future__ import annotations

import json
import time
from datetime import datetime, timezone

import click

from . import __version__
from .client import check_proxy, scrape_url
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
@click.option("--proxy-base-url", default="", help="Override local Argent dashboard proxy base URL")
@click.option("--api-key", default="", help="Override Firecrawl API key for direct fallback")
@click.version_option(__version__)
@click.pass_context
def cli(ctx: click.Context, as_json: bool, mode: str, verbose: bool, proxy_base_url: str, api_key: str) -> None:
    ctx.ensure_object(dict)
    ctx.obj.update({
        "json": as_json,
        "mode": mode,
        "verbose": verbose,
        "started": time.time(),
        "proxy_base_url": proxy_base_url.strip(),
        "api_key": api_key.strip(),
    })


@cli.command("capabilities")
@click.pass_context
def capabilities(ctx: click.Context) -> None:
    payload = {
        "tool": TOOL_NAME,
        "version": __version__,
        "manifest_schema_version": MANIFEST_SCHEMA_VERSION,
        "backend": "firecrawl",
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
    proxy_ok = False
    proxy_error = None
    if config["proxy_enabled"]:
        try:
            check_proxy(ctx.obj)
            proxy_ok = True
        except CliError as err:
            proxy_error = err.to_payload()
    data = {
        "proxy_enabled": config["proxy_enabled"],
        "proxy_base_url": config["proxy_base_url"],
        "proxy_ok": proxy_ok,
        "direct_api_ready": config["api_key_present"],
        "auth_ready": proxy_ok or config["api_key_present"],
        "api_key_present": config["api_key_present"],
    }
    if proxy_error:
        data["proxy_error"] = proxy_error
    _emit(
        _result(ok=True, command="health", mode=ctx.obj["mode"], started=ctx.obj["started"], data=data),
        ctx.obj["json"],
    )


@cli.command("doctor")
@click.pass_context
def doctor(ctx: click.Context) -> None:
    require_mode(ctx, "doctor")
    config = runtime_config(ctx.obj)
    checks = []
    proxy_ok = False
    if config["proxy_enabled"]:
        try:
            check_proxy(ctx.obj)
            proxy_ok = True
            checks.append({"name": "local_proxy", "ok": True, "detail": config["proxy_base_url"]})
        except CliError as err:
            checks.append({"name": "local_proxy", "ok": False, "detail": err.message})
    else:
        checks.append({"name": "local_proxy", "ok": False, "detail": "proxy disabled"})
    checks.append({"name": "direct_api_key", "ok": bool(config["api_key_present"]), "detail": config["api_key_source"] or "missing"})
    data = {
        "checks": checks,
        "recommended_path": "proxy" if proxy_ok else "direct" if config["api_key_present"] else "setup-required",
        "config": redacted_config_snapshot(ctx.obj),
    }
    _emit(
        _result(ok=True, command="doctor", mode=ctx.obj["mode"], started=ctx.obj["started"], data=data),
        ctx.obj["json"],
    )


@cli.command("scrape")
@click.option("--url", required=True, help="Public URL to scrape")
@click.option("--main-content/--all-content", default=True, show_default=True)
@click.option("--timeout-seconds", type=int, default=25, show_default=True)
@click.option("--max-age-ms", type=int, default=172800000, show_default=True)
@click.option("--proxy", "proxy_mode", type=click.Choice(["auto", "basic", "stealth"]), default="auto", show_default=True)
@click.option("--store-in-cache/--no-store-in-cache", default=True, show_default=True)
@click.pass_context
def scrape(ctx: click.Context, url: str, main_content: bool, timeout_seconds: int, max_age_ms: int, proxy_mode: str, store_in_cache: bool) -> None:
    require_mode(ctx, "scrape")
    try:
        data = scrape_url(
            url,
            only_main_content=main_content,
            timeout_seconds=timeout_seconds,
            max_age_ms=max_age_ms,
            proxy_mode=proxy_mode,
            store_in_cache=store_in_cache,
            ctx_obj=ctx.obj,
        )
    except CliError as err:
        _emit_error(ctx, "scrape", err)
    _emit(
        _result(ok=True, command="scrape", mode=ctx.obj["mode"], started=ctx.obj["started"], data=data),
        ctx.obj["json"],
    )


if __name__ == "__main__":
    cli()
