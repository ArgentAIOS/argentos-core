from __future__ import annotations

import json
import time
from datetime import datetime, timezone

import click

from . import __version__
from .bridge import config_snapshot, doctor_snapshot, health_snapshot
from .constants import COMMAND_SPECS, CONNECTOR_AUTH, CONNECTOR_CATEGORY, CONNECTOR_CATEGORIES, CONNECTOR_LABEL, CONNECTOR_RESOURCES, MANIFEST_SCHEMA_VERSION, MODE_ORDER, PERMISSIONS_PATH, TOOL_NAME
from .errors import CliError
from .runtime import (
    assign_taxonomy_terms,
    create_draft_content,
    list_content,
    list_media,
    list_taxonomy_terms,
    publish_content,
    publish_post,
    read_content,
    read_site,
    schedule_post,
    search_content,
    update_draft_content,
    upload_media,
)


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


def _result(
    *,
    ok: bool,
    command: str,
    mode: str,
    started: float,
    data: dict | None = None,
    error: dict | None = None,
) -> dict:
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


def _emit_error(ctx: click.Context, command_id: str, err: CliError) -> None:
    payload = _result(
        ok=False,
        command=command_id,
        mode=ctx.obj["mode"],
        started=ctx.obj["started"],
        error=err.to_payload(),
    )
    _emit(payload, ctx.obj["json"])
    raise SystemExit(err.exit_code)


def _run(ctx: click.Context, command_id: str, fn, *args, **kwargs) -> None:
    require_mode(ctx, command_id)
    try:
        data = fn(*args, **kwargs)
    except CliError as err:
        _emit_error(ctx, command_id, err)
    payload = _result(
        ok=True,
        command=command_id,
        mode=ctx.obj["mode"],
        started=ctx.obj["started"],
        data=data,
    )
    _emit(payload, ctx.obj["json"])


def require_mode(ctx: click.Context, command_id: str) -> None:
    required = _load_permissions().get(command_id, "admin")
    mode = ctx.obj["mode"]
    if _mode_allows(mode, required):
        return
    payload = _result(
        ok=False,
        command=command_id,
        mode=mode,
        started=ctx.obj["started"],
        error={
            "code": "PERMISSION_DENIED",
            "message": f"Command requires mode={required}",
            "details": {"required_mode": required, "actual_mode": mode},
        },
    )
    _emit(payload, ctx.obj["json"])
    raise SystemExit(3)


@click.group()
@click.option("--json", "as_json", is_flag=True, help="Emit JSON output")
@click.option("--mode", type=click.Choice(MODE_ORDER), default="readonly", show_default=True)
@click.option("--verbose", is_flag=True, help="Verbose diagnostic output")
@click.version_option(__version__)
@click.pass_context
def cli(ctx: click.Context, as_json: bool, mode: str, verbose: bool) -> None:
    ctx.ensure_object(dict)
    ctx.obj.update({"json": as_json, "mode": mode, "verbose": verbose, "started": time.time()})


@cli.command("capabilities")
@click.pass_context
def capabilities(ctx: click.Context) -> None:
    payload = {
        "tool": TOOL_NAME,
        "version": __version__,
        "manifest_schema_version": MANIFEST_SCHEMA_VERSION,
        "backend": "wordpress-rest-api",
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
    payload = _result(
        ok=True,
        command="config.show",
        mode=ctx.obj["mode"],
        started=ctx.obj["started"],
        data=config_snapshot(ctx.obj),
    )
    _emit(payload, ctx.obj["json"])


@cli.command("health")
@click.pass_context
def health(ctx: click.Context) -> None:
    require_mode(ctx, "health")
    payload = _result(
        ok=True,
        command="health",
        mode=ctx.obj["mode"],
        started=ctx.obj["started"],
        data=health_snapshot(ctx.obj),
    )
    _emit(payload, ctx.obj["json"])


@cli.command("doctor")
@click.pass_context
def doctor(ctx: click.Context) -> None:
    require_mode(ctx, "doctor")
    payload = _result(
        ok=True,
        command="doctor",
        mode=ctx.obj["mode"],
        started=ctx.obj["started"],
        data=doctor_snapshot(ctx.obj),
    )
    _emit(payload, ctx.obj["json"])


@cli.group("site")
def site_group() -> None:
    pass


@site_group.command("read")
@click.pass_context
def site_read(ctx: click.Context) -> None:
    _run(ctx, "site.read", read_site)


@cli.group("post")
def post_group() -> None:
    pass


@post_group.command("list")
@click.option("--per-page", type=int, default=10, show_default=True)
@click.option("--page", type=int, default=1, show_default=True)
@click.option("--search", default="", help="Search text")
@click.option("--status", "statuses", multiple=True, help="Repeated status filter")
@click.option("--orderby", default="date", show_default=True)
@click.option("--order", type=click.Choice(["asc", "desc"]), default="desc", show_default=True)
@click.pass_context
def post_list(
    ctx: click.Context,
    per_page: int,
    page: int,
    search: str,
    statuses: tuple[str, ...],
    orderby: str,
    order: str,
) -> None:
    _run(
        ctx,
        "post.list",
        list_content,
        "post",
        per_page=per_page,
        page=page,
        search=search or None,
        statuses=list(statuses) or None,
        orderby=orderby,
        order=order,
    )


@post_group.command("search")
@click.option("--query", required=True, help="Search text")
@click.option("--per-page", type=int, default=10, show_default=True)
@click.option("--page", type=int, default=1, show_default=True)
@click.option("--status", "statuses", multiple=True, help="Repeated status filter")
@click.option("--orderby", default="date", show_default=True)
@click.option("--order", type=click.Choice(["asc", "desc"]), default="desc", show_default=True)
@click.pass_context
def post_search(
    ctx: click.Context,
    query: str,
    per_page: int,
    page: int,
    statuses: tuple[str, ...],
    orderby: str,
    order: str,
) -> None:
    _run(
        ctx,
        "post.search",
        search_content,
        "post",
        query_text=query,
        per_page=per_page,
        page=page,
        statuses=list(statuses) or None,
        orderby=orderby,
        order=order,
    )


@post_group.command("read")
@click.argument("post_id")
@click.pass_context
def post_read(ctx: click.Context, post_id: str) -> None:
    _run(ctx, "post.read", read_content, "post", object_id=post_id)


@post_group.command("create_draft")
@click.option("--title", required=True, help="Post title")
@click.option("--content", default=None, help="Post body")
@click.option("--excerpt", default=None, help="Excerpt text")
@click.option("--slug", default=None, help="Post slug")
@click.pass_context
def post_create_draft(ctx: click.Context, title: str, content: str | None, excerpt: str | None, slug: str | None) -> None:
    _run(
        ctx,
        "post.create_draft",
        create_draft_content,
        "post",
        title=title,
        content=content,
        excerpt=excerpt,
        slug=slug,
    )


@post_group.command("update_draft")
@click.argument("post_id")
@click.option("--title", default=None, help="Post title")
@click.option("--content", default=None, help="Post body")
@click.option("--excerpt", default=None, help="Excerpt text")
@click.option("--slug", default=None, help="Post slug")
@click.pass_context
def post_update_draft(
    ctx: click.Context,
    post_id: str,
    title: str | None,
    content: str | None,
    excerpt: str | None,
    slug: str | None,
) -> None:
    _run(
        ctx,
        "post.update_draft",
        update_draft_content,
        "post",
        object_id=post_id,
        title=title,
        content=content,
        excerpt=excerpt,
        slug=slug,
    )


@post_group.command("schedule")
@click.option("--title", default=None, help="Post title")
@click.option("--content", default=None, help="Post body")
@click.option("--excerpt", default=None, help="Excerpt text")
@click.option("--slug", default=None, help="Post slug")
@click.option("--publish-at", required=True, help="RFC3339 date/time to publish")
@click.argument("post_id", required=False)
@click.pass_context
def post_schedule(
    ctx: click.Context,
    title: str | None,
    content: str | None,
    excerpt: str | None,
    slug: str | None,
    publish_at: str,
    post_id: str | None,
) -> None:
    _run(
        ctx,
        "post.schedule",
        schedule_post,
        title=title,
        content=content,
        excerpt=excerpt,
        slug=slug,
        publish_at=publish_at,
        post_id=post_id,
    )


@post_group.command("publish")
@click.argument("post_id")
@click.pass_context
def post_publish(ctx: click.Context, post_id: str) -> None:
    _run(ctx, "post.publish", publish_post, post_id=post_id)


@cli.group("page")
def page_group() -> None:
    pass


@page_group.command("list")
@click.option("--per-page", type=int, default=10, show_default=True)
@click.option("--page", type=int, default=1, show_default=True)
@click.option("--search", default="", help="Search text")
@click.option("--status", "statuses", multiple=True, help="Repeated status filter")
@click.option("--orderby", default="date", show_default=True)
@click.option("--order", type=click.Choice(["asc", "desc"]), default="desc", show_default=True)
@click.pass_context
def page_list(
    ctx: click.Context,
    per_page: int,
    page: int,
    search: str,
    statuses: tuple[str, ...],
    orderby: str,
    order: str,
) -> None:
    _run(
        ctx,
        "page.list",
        list_content,
        "page",
        per_page=per_page,
        page=page,
        search=search or None,
        statuses=list(statuses) or None,
        orderby=orderby,
        order=order,
    )


@page_group.command("search")
@click.option("--query", required=True, help="Search text")
@click.option("--per-page", type=int, default=10, show_default=True)
@click.option("--page", type=int, default=1, show_default=True)
@click.option("--status", "statuses", multiple=True, help="Repeated status filter")
@click.option("--orderby", default="date", show_default=True)
@click.option("--order", type=click.Choice(["asc", "desc"]), default="desc", show_default=True)
@click.pass_context
def page_search(
    ctx: click.Context,
    query: str,
    per_page: int,
    page: int,
    statuses: tuple[str, ...],
    orderby: str,
    order: str,
) -> None:
    _run(
        ctx,
        "page.search",
        search_content,
        "page",
        query_text=query,
        per_page=per_page,
        page=page,
        statuses=list(statuses) or None,
        orderby=orderby,
        order=order,
    )


@page_group.command("read")
@click.argument("page_id")
@click.pass_context
def page_read(ctx: click.Context, page_id: str) -> None:
    _run(ctx, "page.read", read_content, "page", object_id=page_id)


@page_group.command("create_draft")
@click.option("--title", required=True, help="Page title")
@click.option("--content", default=None, help="Page body")
@click.option("--excerpt", default=None, help="Excerpt text")
@click.option("--slug", default=None, help="Page slug")
@click.pass_context
def page_create_draft(
    ctx: click.Context,
    title: str,
    content: str | None,
    excerpt: str | None,
    slug: str | None,
) -> None:
    _run(
        ctx,
        "page.create_draft",
        create_draft_content,
        "page",
        title=title,
        content=content,
        excerpt=excerpt,
        slug=slug,
    )


@page_group.command("update_draft")
@click.argument("page_id")
@click.option("--title", default=None, help="Page title")
@click.option("--content", default=None, help="Page body")
@click.option("--excerpt", default=None, help="Excerpt text")
@click.option("--slug", default=None, help="Page slug")
@click.pass_context
def page_update_draft(
    ctx: click.Context,
    page_id: str,
    title: str | None,
    content: str | None,
    excerpt: str | None,
    slug: str | None,
) -> None:
    _run(
        ctx,
        "page.update_draft",
        update_draft_content,
        "page",
        object_id=page_id,
        title=title,
        content=content,
        excerpt=excerpt,
        slug=slug,
    )


@page_group.command("publish")
@click.argument("page_id")
@click.pass_context
def page_publish(ctx: click.Context, page_id: str) -> None:
    _run(ctx, "page.publish", publish_content, "page", object_id=page_id)


@cli.group("media")
def media_group() -> None:
    pass


@media_group.command("list")
@click.option("--per-page", type=int, default=10, show_default=True)
@click.option("--page", type=int, default=1, show_default=True)
@click.option("--search", default="", help="Search text")
@click.option("--media-type", default="", help="Optional media type filter such as image or file")
@click.option("--mime-type", default="", help="Optional MIME type filter such as image/jpeg")
@click.pass_context
def media_list_cmd(
    ctx: click.Context,
    per_page: int,
    page: int,
    search: str,
    media_type: str,
    mime_type: str,
) -> None:
    _run(
        ctx,
        "media.list",
        list_media,
        per_page=per_page,
        page=page,
        search=search or None,
        media_type=media_type or None,
        mime_type=mime_type or None,
    )


@media_group.command("upload")
@click.argument("items", nargs=-1)
@click.pass_context
def media_upload(ctx: click.Context, items: tuple[str, ...]) -> None:
    _run(ctx, "media.upload", upload_media, items)


@cli.group("taxonomy")
def taxonomy_group() -> None:
    pass


@taxonomy_group.command("list")
@click.option("--per-page", type=int, default=25, show_default=True)
@click.option("--page", type=int, default=1, show_default=True)
@click.option("--search", default="", help="Search category or tag text")
@click.pass_context
def taxonomy_list_cmd(ctx: click.Context, per_page: int, page: int, search: str) -> None:
    _run(
        ctx,
        "taxonomy.list",
        list_taxonomy_terms,
        per_page=per_page,
        page=page,
        search=search or None,
    )


@taxonomy_group.command("assign_terms")
@click.argument("items", nargs=-1)
@click.pass_context
def taxonomy_assign_terms(ctx: click.Context, items: tuple[str, ...]) -> None:
    _run(ctx, "taxonomy.assign_terms", assign_taxonomy_terms, items)


if __name__ == "__main__":
    cli()
