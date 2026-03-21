from __future__ import annotations

import click

from .errors import CliError
from .permissions import load_connector_manifest, permission_map, require_mode
from .runtime import auth_kind, health_summary, request_json


def _command_entry(command_id: str) -> dict:
    manifest = load_connector_manifest()
    permissions = permission_map()
    for command in manifest.get("commands", []):
        if command.get("id") == command_id:
            return {
                **command,
                "required_mode": permissions.get(command_id, command.get("required_mode", "admin")),
            }
    raise CliError(
        code="NOT_FOUND",
        message=f"Unknown command metadata for {command_id}",
        exit_code=6,
        details={"command_id": command_id},
    )


def _configured_site_url(ctx: click.Context) -> str | None:
    return ctx.obj.get("site_url")


@click.command("capabilities")
@click.pass_context
def capabilities(ctx: click.Context) -> None:
    manifest = load_connector_manifest()
    permissions = permission_map()
    worker_commands = []
    for command in manifest.get("commands", []):
        worker_commands.append(
            {
                **command,
                "required_mode": permissions.get(command["id"], command.get("required_mode", "admin")),
            }
        )
    maintenance_ids = ["capabilities", "health", "config.show"]
    ctx.obj["_result"] = {
        "tool": manifest.get("tool", "aos-wordpress"),
        "backend": manifest.get("backend", "wordpress-rest"),
        "version": ctx.obj["version"],
        "manifest_schema_version": manifest.get("manifest_schema_version", "1.0.0"),
        "modes": ["readonly", "write", "full", "admin"],
        "connector": manifest.get("connector", {}),
        "auth": manifest.get("auth", {}),
        "delivery_model": manifest.get("delivery_model", "poll"),
        "risk_tier": manifest.get("risk_tier", "bounded-write"),
        "scope_model": manifest.get("scope_model", []),
        "commands": worker_commands,
        "maintenance_commands": [
            {
                "id": command_id,
                "required_mode": permissions.get(command_id, "readonly"),
                "supports_json": True,
            }
            for command_id in maintenance_ids
        ],
    }
    ctx.obj["_command_id"] = "capabilities"


@click.command("health")
@click.pass_context
def health(ctx: click.Context) -> None:
    ctx.obj["_result"] = health_summary(ctx.obj)
    ctx.obj["_command_id"] = "health"


@click.group("config")
def config_group() -> None:
    pass


@config_group.command("show")
@click.pass_context
def config_show(ctx: click.Context) -> None:
    require_mode(ctx.obj["mode"], "config.show")
    ctx.obj["_result"] = {
        "tool": "aos-wordpress",
        "backend": "wordpress-rest",
        "site_url": _configured_site_url(ctx),
        "auth_kind": auth_kind(ctx.obj),
        "username": ctx.obj.get("username"),
        "timeout_seconds": ctx.obj.get("timeout"),
        "has_app_password": bool(ctx.obj.get("app_password")),
        "has_bearer_token": bool(ctx.obj.get("bearer_token")),
    }
    ctx.obj["_command_id"] = "config.show"


@click.group("site")
def site_group() -> None:
    pass


@site_group.command("info")
@click.pass_context
def site_info(ctx: click.Context) -> None:
    require_mode(ctx.obj["mode"], "site.info")
    ctx.obj["_command_id"] = "site.info"
    ctx.obj["_result"] = request_json(ctx.obj, method="GET", path="")


@click.group("post")
def post_group() -> None:
    pass


@post_group.command("list")
@click.option("--search", default="", help="Search term")
@click.option("--status", default="publish", help="Post status filter")
@click.option("--per-page", type=int, default=10, show_default=True)
@click.pass_context
def post_list(ctx: click.Context, search: str, status: str, per_page: int) -> None:
    require_mode(ctx.obj["mode"], "post.list")
    ctx.obj["_command_id"] = "post.list"
    ctx.obj["_result"] = request_json(
        ctx.obj,
        method="GET",
        path="/wp/v2/posts",
        query={"search": search or None, "status": status or None, "per_page": per_page},
    )


@post_group.command("read")
@click.argument("post_id", type=int)
@click.pass_context
def post_read(ctx: click.Context, post_id: int) -> None:
    require_mode(ctx.obj["mode"], "post.read")
    ctx.obj["_command_id"] = "post.read"
    ctx.obj["_result"] = request_json(ctx.obj, method="GET", path=f"/wp/v2/posts/{post_id}")


@post_group.command("create")
@click.option("--title", required=True)
@click.option("--content", required=True)
@click.option("--status", default="draft", show_default=True)
@click.pass_context
def post_create(ctx: click.Context, title: str, content: str, status: str) -> None:
    require_mode(ctx.obj["mode"], "post.create")
    ctx.obj["_command_id"] = "post.create"
    ctx.obj["_result"] = request_json(
        ctx.obj,
        method="POST",
        path="/wp/v2/posts",
        body={"title": title, "content": content, "status": status},
        require_auth=True,
    )


@post_group.command("update")
@click.argument("post_id", type=int)
@click.option("--title", default=None)
@click.option("--content", default=None)
@click.option("--excerpt", default=None)
@click.option("--status", default=None)
@click.pass_context
def post_update(ctx: click.Context, post_id: int, title: str | None, content: str | None, excerpt: str | None, status: str | None) -> None:
    require_mode(ctx.obj["mode"], "post.update")
    ctx.obj["_command_id"] = "post.update"
    body = {key: value for key, value in {"title": title, "content": content, "excerpt": excerpt, "status": status}.items() if value is not None}
    if not body:
        raise CliError(code="INVALID_USAGE", message="Provide at least one field to update", exit_code=2, details={})
    ctx.obj["_result"] = request_json(
        ctx.obj,
        method="POST",
        path=f"/wp/v2/posts/{post_id}",
        body=body,
        require_auth=True,
    )


@post_group.command("publish")
@click.argument("post_id", type=int)
@click.pass_context
def post_publish(ctx: click.Context, post_id: int) -> None:
    require_mode(ctx.obj["mode"], "post.publish")
    ctx.obj["_command_id"] = "post.publish"
    ctx.obj["_result"] = request_json(
        ctx.obj,
        method="POST",
        path=f"/wp/v2/posts/{post_id}",
        body={"status": "publish"},
        require_auth=True,
    )


@click.group("page")
def page_group() -> None:
    pass


@page_group.command("list")
@click.option("--search", default="", help="Search term")
@click.option("--status", default="publish", help="Page status filter")
@click.option("--per-page", type=int, default=10, show_default=True)
@click.pass_context
def page_list(ctx: click.Context, search: str, status: str, per_page: int) -> None:
    require_mode(ctx.obj["mode"], "page.list")
    ctx.obj["_command_id"] = "page.list"
    ctx.obj["_result"] = request_json(
        ctx.obj,
        method="GET",
        path="/wp/v2/pages",
        query={"search": search or None, "status": status or None, "per_page": per_page},
    )


@page_group.command("read")
@click.argument("page_id", type=int)
@click.pass_context
def page_read(ctx: click.Context, page_id: int) -> None:
    require_mode(ctx.obj["mode"], "page.read")
    ctx.obj["_command_id"] = "page.read"
    ctx.obj["_result"] = request_json(ctx.obj, method="GET", path=f"/wp/v2/pages/{page_id}")


@page_group.command("create")
@click.option("--title", required=True)
@click.option("--content", required=True)
@click.option("--status", default="draft", show_default=True)
@click.pass_context
def page_create(ctx: click.Context, title: str, content: str, status: str) -> None:
    require_mode(ctx.obj["mode"], "page.create")
    ctx.obj["_command_id"] = "page.create"
    ctx.obj["_result"] = request_json(
        ctx.obj,
        method="POST",
        path="/wp/v2/pages",
        body={"title": title, "content": content, "status": status},
        require_auth=True,
    )


@page_group.command("update")
@click.argument("page_id", type=int)
@click.option("--title", default=None)
@click.option("--content", default=None)
@click.option("--status", default=None)
@click.pass_context
def page_update(ctx: click.Context, page_id: int, title: str | None, content: str | None, status: str | None) -> None:
    require_mode(ctx.obj["mode"], "page.update")
    ctx.obj["_command_id"] = "page.update"
    body = {key: value for key, value in {"title": title, "content": content, "status": status}.items() if value is not None}
    if not body:
        raise CliError(code="INVALID_USAGE", message="Provide at least one field to update", exit_code=2, details={})
    ctx.obj["_result"] = request_json(
        ctx.obj,
        method="POST",
        path=f"/wp/v2/pages/{page_id}",
        body=body,
        require_auth=True,
    )


@page_group.command("publish")
@click.argument("page_id", type=int)
@click.pass_context
def page_publish(ctx: click.Context, page_id: int) -> None:
    require_mode(ctx.obj["mode"], "page.publish")
    ctx.obj["_command_id"] = "page.publish"
    ctx.obj["_result"] = request_json(
        ctx.obj,
        method="POST",
        path=f"/wp/v2/pages/{page_id}",
        body={"status": "publish"},
        require_auth=True,
    )


@click.group("media")
def media_group() -> None:
    pass


@media_group.command("list")
@click.option("--search", default="", help="Search term")
@click.option("--per-page", type=int, default=10, show_default=True)
@click.pass_context
def media_list(ctx: click.Context, search: str, per_page: int) -> None:
    require_mode(ctx.obj["mode"], "media.list")
    ctx.obj["_command_id"] = "media.list"
    ctx.obj["_result"] = request_json(
        ctx.obj,
        method="GET",
        path="/wp/v2/media",
        query={"search": search or None, "per_page": per_page},
    )


@media_group.command("read")
@click.argument("media_id", type=int)
@click.pass_context
def media_read(ctx: click.Context, media_id: int) -> None:
    require_mode(ctx.obj["mode"], "media.read")
    ctx.obj["_command_id"] = "media.read"
    ctx.obj["_result"] = request_json(ctx.obj, method="GET", path=f"/wp/v2/media/{media_id}")


@media_group.command("upload")
@click.option("--file", "file_path", required=True, help="Local file path to upload")
@click.option("--title", default=None, help="Optional media title")
@click.pass_context
def media_upload(ctx: click.Context, file_path: str, title: str | None) -> None:
    require_mode(ctx.obj["mode"], "media.upload")
    ctx.obj["_command_id"] = "media.upload"
    raise CliError(
        code="NOT_IMPLEMENTED",
        message="Media upload is not implemented in the first-pass scaffold",
        exit_code=10,
        details={"file": file_path, "title": title},
    )


@click.group("comment")
def comment_group() -> None:
    pass


@comment_group.command("list")
@click.option("--post-id", type=int, default=None)
@click.option("--status", default="approve", show_default=True)
@click.option("--per-page", type=int, default=10, show_default=True)
@click.pass_context
def comment_list(ctx: click.Context, post_id: int | None, status: str, per_page: int) -> None:
    require_mode(ctx.obj["mode"], "comment.list")
    ctx.obj["_command_id"] = "comment.list"
    ctx.obj["_result"] = request_json(
        ctx.obj,
        method="GET",
        path="/wp/v2/comments",
        query={"post": post_id, "status": status or None, "per_page": per_page},
    )


@comment_group.command("read")
@click.argument("comment_id", type=int)
@click.pass_context
def comment_read(ctx: click.Context, comment_id: int) -> None:
    require_mode(ctx.obj["mode"], "comment.read")
    ctx.obj["_command_id"] = "comment.read"
    ctx.obj["_result"] = request_json(ctx.obj, method="GET", path=f"/wp/v2/comments/{comment_id}")


@comment_group.command("reply")
@click.option("--post-id", type=int, required=True)
@click.option("--parent-id", type=int, default=None)
@click.option("--content", required=True)
@click.pass_context
def comment_reply(ctx: click.Context, post_id: int, parent_id: int | None, content: str) -> None:
    require_mode(ctx.obj["mode"], "comment.reply")
    ctx.obj["_command_id"] = "comment.reply"
    body = {"post": post_id, "content": content}
    if parent_id is not None:
        body["parent"] = parent_id
    ctx.obj["_result"] = request_json(
        ctx.obj,
        method="POST",
        path="/wp/v2/comments",
        body=body,
        require_auth=True,
    )


@comment_group.command("moderate")
@click.argument("comment_id", type=int)
@click.option("--status", type=click.Choice(["approve", "hold", "spam", "trash"]), required=True)
@click.pass_context
def comment_moderate(ctx: click.Context, comment_id: int, status: str) -> None:
    require_mode(ctx.obj["mode"], "comment.moderate")
    ctx.obj["_command_id"] = "comment.moderate"
    ctx.obj["_result"] = request_json(
        ctx.obj,
        method="POST",
        path=f"/wp/v2/comments/{comment_id}",
        body={"status": status},
        require_auth=True,
    )


def register(cli: click.Group) -> None:
    cli.add_command(capabilities)
    cli.add_command(health)
    cli.add_command(config_group)
    cli.add_command(site_group)
    cli.add_command(post_group)
    cli.add_command(page_group)
    cli.add_command(media_group)
    cli.add_command(comment_group)
