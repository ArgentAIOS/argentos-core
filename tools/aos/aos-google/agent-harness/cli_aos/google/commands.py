from __future__ import annotations

import json

import click

from .bridge import ensure_gws_exists, probe_gws, run_gws
from .errors import CliError
from .permissions import require_mode


def _sanitize_opts(ctx: click.Context, command_id: str) -> list[str]:
    # Only Gmail read/search operations should be sanitized automatically.
    if not command_id.startswith("gmail."):
        return []
    sanitize_template = ctx.obj.get("sanitize_template")
    sanitize_mode = ctx.obj.get("sanitize_mode")
    opts: list[str] = []
    if sanitize_template:
        opts.extend(["--sanitize", sanitize_template])
    if sanitize_mode:
        opts.extend(["--sanitize-mode", sanitize_mode])
    return opts


def _account_opts(ctx: click.Context) -> list[str]:
    account = ctx.obj.get("account")
    if not account:
        return []
    return ["--account", account]


@click.group("gmail")
def gmail_group() -> None:
    pass


@gmail_group.command("search")
@click.argument("query")
@click.option("--max-results", type=int, default=10, show_default=True)
@click.pass_context
def gmail_search(ctx: click.Context, query: str, max_results: int) -> None:
    require_mode(ctx.obj["mode"], "gmail.search")
    params = {"userId": "me", "q": query, "maxResults": max_results}
    args = [
        "gmail",
        "users",
        "messages",
        "list",
        "--params",
        json.dumps(params),
        *_sanitize_opts(ctx, "gmail.search"),
        *_account_opts(ctx),
    ]
    ctx.obj["_result"] = run_gws(ctx.obj["gws_bin"], args)
    ctx.obj["_command_id"] = "gmail.search"


@gmail_group.command("read")
@click.argument("message_id")
@click.option("--format", "fmt", type=click.Choice(["minimal", "full", "raw", "metadata"]), default="full", show_default=True)
@click.pass_context
def gmail_read(ctx: click.Context, message_id: str, fmt: str) -> None:
    require_mode(ctx.obj["mode"], "gmail.read")
    params = {"userId": "me", "id": message_id, "format": fmt}
    args = [
        "gmail",
        "users",
        "messages",
        "get",
        "--params",
        json.dumps(params),
        *_sanitize_opts(ctx, "gmail.read"),
        *_account_opts(ctx),
    ]
    ctx.obj["_result"] = run_gws(ctx.obj["gws_bin"], args)
    ctx.obj["_command_id"] = "gmail.read"


@click.group("drive")
def drive_group() -> None:
    pass


@drive_group.command("list")
@click.option("--page-size", type=int, default=10, show_default=True)
@click.option("--query", default="", help="Drive API q filter")
@click.pass_context
def drive_list(ctx: click.Context, page_size: int, query: str) -> None:
    require_mode(ctx.obj["mode"], "drive.list")
    params = {"pageSize": page_size}
    if query:
        params["q"] = query
    args = ["drive", "files", "list", "--params", json.dumps(params), *_account_opts(ctx)]
    ctx.obj["_result"] = run_gws(ctx.obj["gws_bin"], args)
    ctx.obj["_command_id"] = "drive.list"


@click.group("calendar")
def calendar_group() -> None:
    pass


@calendar_group.command("list")
@click.option("--calendar-id", default="primary", show_default=True)
@click.option("--max-results", type=int, default=10, show_default=True)
@click.pass_context
def calendar_list(ctx: click.Context, calendar_id: str, max_results: int) -> None:
    require_mode(ctx.obj["mode"], "calendar.list")
    params = {"calendarId": calendar_id, "maxResults": max_results, "singleEvents": True, "orderBy": "startTime"}
    args = ["calendar", "events", "list", "--params", json.dumps(params), *_account_opts(ctx)]
    ctx.obj["_result"] = run_gws(ctx.obj["gws_bin"], args)
    ctx.obj["_command_id"] = "calendar.list"


@calendar_group.command("create")
@click.option("--calendar-id", default="primary", show_default=True)
@click.option("--summary", required=True)
@click.option("--start", "start_time", required=True, help="RFC3339 time")
@click.option("--end", "end_time", required=True, help="RFC3339 time")
@click.pass_context
def calendar_create(ctx: click.Context, calendar_id: str, summary: str, start_time: str, end_time: str) -> None:
    require_mode(ctx.obj["mode"], "calendar.create")
    params = {
        "calendarId": calendar_id,
        "requestBody": {
            "summary": summary,
            "start": {"dateTime": start_time},
            "end": {"dateTime": end_time},
        },
    }
    args = ["calendar", "events", "insert", "--params", json.dumps(params), *_account_opts(ctx)]
    ctx.obj["_result"] = run_gws(ctx.obj["gws_bin"], args)
    ctx.obj["_command_id"] = "calendar.create"


@click.command("health")
@click.pass_context
def health(ctx: click.Context) -> None:
    ensure_gws_exists(ctx.obj["gws_bin"])
    result = run_gws(ctx.obj["gws_bin"], ["version"])
    ctx.obj["_result"] = {"status": "healthy", "backend": "gws", "backend_info": result}
    ctx.obj["_command_id"] = "health"


@click.command("doctor")
@click.pass_context
def doctor(ctx: click.Context) -> None:
    require_mode(ctx.obj["mode"], "doctor")

    try:
        ensure_gws_exists(ctx.obj["gws_bin"])
    except CliError as err:
        err.details = {
            **err.details,
            "install_hint": "Install upstream with: npm install -g @googleworkspace/cli",
            "upstream_repo": "https://github.com/googleworkspace/cli",
        }
        raise

    version_probe = probe_gws(ctx.obj["gws_bin"], ["--version"])
    auth_probe = probe_gws(ctx.obj["gws_bin"], ["auth", "status", "--json"])

    checks = [
        {
            "name": "gws_binary",
            "ok": True,
            "details": {"bin": ctx.obj["gws_bin"]},
        },
        {
            "name": "gws_version",
            "ok": version_probe["ok"],
            "details": version_probe,
        },
        {
            "name": "gws_auth_status",
            "ok": auth_probe["ok"],
            "details": auth_probe,
        },
        {
            "name": "sanitize_template",
            "ok": bool(ctx.obj.get("sanitize_template")),
            "details": {
                "configured": bool(ctx.obj.get("sanitize_template")),
                "mode": ctx.obj.get("sanitize_mode"),
            },
        },
    ]

    overall_ok = all(check["ok"] for check in checks[:2])
    status = "healthy" if overall_ok else "degraded"
    ctx.obj["_result"] = {
        "status": status,
        "backend": "gws",
        "required_backend": "@googleworkspace/cli",
        "upstream_repo": "https://github.com/googleworkspace/cli",
        "checks": checks,
        "recommendations": [
            "Install/update upstream gws: npm install -g @googleworkspace/cli",
            "Run auth if needed: gws auth login -s drive,gmail,calendar,sheets,docs",
        ],
    }
    ctx.obj["_command_id"] = "doctor"


@click.group("config")
def config_group() -> None:
    pass


@config_group.command("show")
@click.pass_context
def config_show(ctx: click.Context) -> None:
    require_mode(ctx.obj["mode"], "config.show")
    # Keep output safe: expose only non-secret config values.
    ctx.obj["_result"] = {
        "tool": "aos-google",
        "backend": "gws",
        "gws_bin": ctx.obj["gws_bin"],
        "account": ctx.obj.get("account"),
        "sanitize_enabled": bool(ctx.obj.get("sanitize_template")),
        "sanitize_mode": ctx.obj.get("sanitize_mode"),
    }
    ctx.obj["_command_id"] = "config.show"


@click.command("capabilities")
@click.pass_context
def capabilities(ctx: click.Context) -> None:
    from .permissions import load_manifest
    manifest = load_manifest()
    permissions = manifest.get("permissions", {})
    ctx.obj["_result"] = {
        "tool": "aos-google",
        "backend": manifest.get("backend", "gws"),
        "version": ctx.obj["version"],
        "manifest_schema_version": "1.0.0",
        "modes": ["readonly", "write", "full", "admin"],
        "commands": [
            {
                "id": cmd,
                "required_mode": required,
                "supports_json": True,
            }
            for cmd, required in sorted(permissions.items())
        ],
    }
    ctx.obj["_command_id"] = "capabilities"


def register(cli: click.Group) -> None:
    cli.add_command(capabilities)
    cli.add_command(health)
    cli.add_command(doctor)
    cli.add_command(config_group)
    cli.add_command(gmail_group)
    cli.add_command(drive_group)
    cli.add_command(calendar_group)
