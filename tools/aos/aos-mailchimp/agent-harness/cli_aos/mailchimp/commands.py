from __future__ import annotations

from typing import Any

import click

from .bridge import config_snapshot, doctor_snapshot, health_snapshot, scaffold_result
from .constants import CONNECTOR_AUTH, CONNECTOR_CATEGORY, CONNECTOR_CATEGORIES, CONNECTOR_LABEL, CONNECTOR_RESOURCES, MANIFEST_SCHEMA_VERSION
from .permissions import load_connector_manifest, load_manifest, require_mode
from .runtime import _client


def _set_result(ctx: click.Context, command_id: str, data: dict[str, Any]) -> None:
    ctx.obj["_result"] = data
    ctx.obj["_command_id"] = command_id


def _command_entry(command_id: str) -> dict[str, Any]:
    manifest = load_manifest()
    for command in manifest.get("commands", []):
        if command.get("id") == command_id:
            return command
    return {
        "id": command_id,
        "required_mode": "admin",
        "supports_json": True,
    }


@click.command("capabilities")
@click.pass_context
def capabilities(ctx: click.Context) -> None:
    manifest = load_connector_manifest()
    permissions = load_manifest().get("permissions", {})
    commands = []
    for command in manifest.get("commands", []):
        commands.append(
            {
                **command,
                "required_mode": permissions.get(command["id"], command.get("required_mode", "admin")),
            }
        )

    _set_result(
        ctx,
        "capabilities",
        {
            "tool": manifest.get("tool", "aos-mailchimp"),
            "backend": manifest.get("backend", "mailchimp-marketing"),
            "version": ctx.obj["version"],
            "manifest_schema_version": MANIFEST_SCHEMA_VERSION,
            "connector": {
                "label": CONNECTOR_LABEL,
                "category": CONNECTOR_CATEGORY,
                "categories": CONNECTOR_CATEGORIES,
                "resources": CONNECTOR_RESOURCES,
            },
            "auth": CONNECTOR_AUTH,
            "modes": ["readonly", "write", "full", "admin"],
            "commands": commands,
        },
    )


@click.command("health")
@click.pass_context
def health(ctx: click.Context) -> None:
    _set_result(ctx, "health", health_snapshot(ctx.obj))


@click.command("doctor")
@click.pass_context
def doctor(ctx: click.Context) -> None:
    require_mode(ctx.obj["mode"], "doctor")
    _set_result(ctx, "doctor", doctor_snapshot(ctx.obj))


@click.group("config")
def config_group() -> None:
    pass


@config_group.command("show")
@click.pass_context
def config_show(ctx: click.Context) -> None:
    require_mode(ctx.obj["mode"], "config.show")
    _set_result(ctx, "config.show", config_snapshot(ctx.obj))


@click.group("audience")
def audience_group() -> None:
    pass


@audience_group.command("list")
@click.option("--count", type=int, default=10, show_default=True)
@click.option("--offset", type=int, default=0, show_default=True)
@click.pass_context
def audience_list(ctx: click.Context, count: int, offset: int) -> None:
    require_mode(ctx.obj["mode"], "audience.list")
    _set_result(ctx, "audience.list", _client(ctx.obj).list_audiences(count=count, offset=offset))


@audience_group.command("read")
@click.argument("audience_id")
@click.pass_context
def audience_read(ctx: click.Context, audience_id: str) -> None:
    require_mode(ctx.obj["mode"], "audience.read")
    _set_result(ctx, "audience.read", _client(ctx.obj).read_audience(audience_id))


@audience_group.command("create")
@click.option("--name", required=True, help="Audience name")
@click.option("--reminder", default="", help="Permission reminder text")
@click.pass_context
def audience_create(ctx: click.Context, name: str, reminder: str) -> None:
    require_mode(ctx.obj["mode"], "audience.create")
    _set_result(
        ctx,
        "audience.create",
        scaffold_result(ctx.obj, command_id="audience.create", resource="audience", operation="create", inputs={"name": name, "reminder": reminder}),
    )


@click.group("campaign")
def campaign_group() -> None:
    pass


@campaign_group.command("list")
@click.option("--count", type=int, default=10, show_default=True)
@click.option("--offset", type=int, default=0, show_default=True)
@click.pass_context
def campaign_list(ctx: click.Context, count: int, offset: int) -> None:
    require_mode(ctx.obj["mode"], "campaign.list")
    _set_result(ctx, "campaign.list", _client(ctx.obj).list_campaigns(count=count, offset=offset))


@campaign_group.command("read")
@click.argument("campaign_id")
@click.pass_context
def campaign_read(ctx: click.Context, campaign_id: str) -> None:
    require_mode(ctx.obj["mode"], "campaign.read")
    _set_result(ctx, "campaign.read", _client(ctx.obj).read_campaign(campaign_id))


@campaign_group.command("create")
@click.option("--subject-line", required=True, help="Campaign subject line")
@click.option("--title", default="", help="Campaign title")
@click.pass_context
def campaign_create(ctx: click.Context, subject_line: str, title: str) -> None:
    require_mode(ctx.obj["mode"], "campaign.create")
    _set_result(
        ctx,
        "campaign.create",
        scaffold_result(
            ctx.obj,
            command_id="campaign.create",
            resource="campaign",
            operation="create",
            inputs={"subject_line": subject_line, "title": title},
        ),
    )


@click.group("member")
def member_group() -> None:
    pass


@member_group.command("list")
@click.argument("audience_id")
@click.option("--count", type=int, default=10, show_default=True)
@click.option("--offset", type=int, default=0, show_default=True)
@click.pass_context
def member_list(ctx: click.Context, audience_id: str, count: int, offset: int) -> None:
    require_mode(ctx.obj["mode"], "member.list")
    _set_result(ctx, "member.list", _client(ctx.obj).list_members(audience_id, count=count, offset=offset))


@member_group.command("read")
@click.argument("audience_id")
@click.argument("subscriber_hash")
@click.pass_context
def member_read(ctx: click.Context, audience_id: str, subscriber_hash: str) -> None:
    require_mode(ctx.obj["mode"], "member.read")
    _set_result(ctx, "member.read", _client(ctx.obj).read_member(audience_id, subscriber_hash))


def register(cli: click.Group) -> None:
    cli.add_command(capabilities)
    cli.add_command(health)
    cli.add_command(doctor)
    cli.add_command(config_group)
    cli.add_command(audience_group)
    cli.add_command(campaign_group)
    cli.add_command(member_group)
