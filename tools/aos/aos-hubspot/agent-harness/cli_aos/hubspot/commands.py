from __future__ import annotations

from typing import Any

import click

from .bridge import config_snapshot, health_snapshot
from .constants import AUTH_DESCRIPTOR, COMMAND_SPECS, CONNECTOR_DESCRIPTOR, MANIFEST_SCHEMA_VERSION, MODE_ORDER
from .errors import CliError
from .permissions import require_mode
from .runtime import (
    assign_owner,
    create_note,
    create_object,
    list_objects,
    list_owners,
    list_pipelines,
    read_object,
    search_objects,
    update_deal_stage,
    update_object,
    update_ticket_status,
)


def _set_result(ctx: click.Context, command_id: str, data: dict[str, Any]) -> None:
    ctx.obj["_result"] = data
    ctx.obj["_command_id"] = command_id


def _parse_properties(values: tuple[str, ...], *, flag_name: str) -> dict[str, str]:
    parsed: dict[str, str] = {}
    for entry in values:
        if "=" not in entry:
            raise CliError(
                code="INVALID_USAGE",
                message=f"{flag_name} entries must use key=value",
                exit_code=2,
                details={"value": entry, "flag": flag_name},
            )
        key, value = entry.split("=", 1)
        key = key.strip()
        value = value.strip()
        if not key:
            raise CliError(
                code="INVALID_USAGE",
                message=f"{flag_name} keys must be non-empty",
                exit_code=2,
                details={"value": entry, "flag": flag_name},
            )
        parsed[key] = value
    return parsed


@click.group("owner")
def owner_group() -> None:
    pass


@owner_group.command("list")
@click.option("--team-id", default="", help="Optional HubSpot team identifier")
@click.option("--email", default="", help="Optional owner email filter")
@click.option("--limit", type=int, default=50, show_default=True)
@click.option("--after", default="", help="Pagination cursor")
@click.pass_context
def owner_list(ctx: click.Context, team_id: str, email: str, limit: int, after: str) -> None:
    require_mode(ctx.obj["mode"], "owner.list")
    _set_result(
        ctx,
        "owner.list",
        list_owners(
            ctx.obj,
            limit=limit,
            after=after or None,
            team_id=team_id or None,
            email=email or None,
        ),
    )


@owner_group.command("assign")
@click.argument("record_type", type=click.Choice(["contact", "company", "deal", "ticket"]))
@click.argument("record_id")
@click.option("--owner-id", required=True, help="HubSpot owner identifier")
@click.pass_context
def owner_assign(ctx: click.Context, record_type: str, record_id: str, owner_id: str) -> None:
    require_mode(ctx.obj["mode"], "owner.assign")
    _set_result(
        ctx,
        "owner.assign",
        assign_owner(
            ctx.obj,
            record_type=record_type,
            record_id=record_id,
            owner_id=owner_id,
        ),
    )


@click.group("pipeline")
def pipeline_group() -> None:
    pass


@pipeline_group.command("list")
@click.option("--object-type", type=click.Choice(["deal", "ticket"]), default="deal", show_default=True)
@click.pass_context
def pipeline_list(ctx: click.Context, object_type: str) -> None:
    require_mode(ctx.obj["mode"], "pipeline.list")
    _set_result(ctx, "pipeline.list", list_pipelines(ctx.obj, object_type=object_type))


@click.group("contact")
def contact_group() -> None:
    pass


@contact_group.command("list")
@click.option("--property", "properties", multiple=True, help="Repeated property name to request")
@click.option("--limit", type=int, default=25, show_default=True)
@click.option("--after", default="", help="Pagination cursor")
@click.pass_context
def contact_list(ctx: click.Context, properties: tuple[str, ...], limit: int, after: str) -> None:
    require_mode(ctx.obj["mode"], "contact.list")
    _set_result(
        ctx,
        "contact.list",
        list_objects(ctx.obj, resource="contact", limit=limit, after=after or None, properties=list(properties)),
    )


@contact_group.command("search")
@click.option("--query", default="", help="Freeform HubSpot query")
@click.option("--property", "properties", multiple=True, help="Repeated property name to request")
@click.option("--limit", type=int, default=25, show_default=True)
@click.option("--after", default="", help="Pagination cursor")
@click.pass_context
def contact_search(ctx: click.Context, query: str, properties: tuple[str, ...], limit: int, after: str) -> None:
    require_mode(ctx.obj["mode"], "contact.search")
    _set_result(
        ctx,
        "contact.search",
        search_objects(
            ctx.obj,
            resource="contact",
            query_text=query or None,
            limit=limit,
            after=after or None,
            properties=list(properties),
        ),
    )


@contact_group.command("read")
@click.argument("contact_id")
@click.option("--property", "properties", multiple=True, help="Repeated property name to request")
@click.pass_context
def contact_read(ctx: click.Context, contact_id: str, properties: tuple[str, ...]) -> None:
    require_mode(ctx.obj["mode"], "contact.read")
    _set_result(
        ctx,
        "contact.read",
        read_object(ctx.obj, resource="contact", object_id=contact_id, properties=list(properties)),
    )


@contact_group.command("create")
@click.option("--property", "properties", multiple=True, required=True, help="Repeated key=value property pair")
@click.pass_context
def contact_create(ctx: click.Context, properties: tuple[str, ...]) -> None:
    require_mode(ctx.obj["mode"], "contact.create")
    _set_result(
        ctx,
        "contact.create",
        create_object(
            ctx.obj,
            resource="contact",
            properties=_parse_properties(properties, flag_name="--property"),
            command_id="contact.create",
        ),
    )


@contact_group.command("update")
@click.argument("contact_id")
@click.option("--property", "properties", multiple=True, required=True, help="Repeated key=value property pair")
@click.pass_context
def contact_update(ctx: click.Context, contact_id: str, properties: tuple[str, ...]) -> None:
    require_mode(ctx.obj["mode"], "contact.update")
    _set_result(
        ctx,
        "contact.update",
        update_object(
            ctx.obj,
            resource="contact",
            object_id=contact_id,
            properties=_parse_properties(properties, flag_name="--property"),
            command_id="contact.update",
        ),
    )


@click.group("company")
def company_group() -> None:
    pass


@company_group.command("list")
@click.option("--property", "properties", multiple=True, help="Repeated property name to request")
@click.option("--limit", type=int, default=25, show_default=True)
@click.option("--after", default="", help="Pagination cursor")
@click.pass_context
def company_list(ctx: click.Context, properties: tuple[str, ...], limit: int, after: str) -> None:
    require_mode(ctx.obj["mode"], "company.list")
    _set_result(
        ctx,
        "company.list",
        list_objects(ctx.obj, resource="company", limit=limit, after=after or None, properties=list(properties)),
    )


@company_group.command("search")
@click.option("--query", default="", help="Freeform HubSpot query")
@click.option("--property", "properties", multiple=True, help="Repeated property name to request")
@click.option("--limit", type=int, default=25, show_default=True)
@click.option("--after", default="", help="Pagination cursor")
@click.pass_context
def company_search(ctx: click.Context, query: str, properties: tuple[str, ...], limit: int, after: str) -> None:
    require_mode(ctx.obj["mode"], "company.search")
    _set_result(
        ctx,
        "company.search",
        search_objects(
            ctx.obj,
            resource="company",
            query_text=query or None,
            limit=limit,
            after=after or None,
            properties=list(properties),
        ),
    )


@company_group.command("read")
@click.argument("company_id")
@click.option("--property", "properties", multiple=True, help="Repeated property name to request")
@click.pass_context
def company_read(ctx: click.Context, company_id: str, properties: tuple[str, ...]) -> None:
    require_mode(ctx.obj["mode"], "company.read")
    _set_result(
        ctx,
        "company.read",
        read_object(ctx.obj, resource="company", object_id=company_id, properties=list(properties)),
    )


@company_group.command("create")
@click.option("--property", "properties", multiple=True, required=True, help="Repeated key=value property pair")
@click.pass_context
def company_create(ctx: click.Context, properties: tuple[str, ...]) -> None:
    require_mode(ctx.obj["mode"], "company.create")
    _set_result(
        ctx,
        "company.create",
        create_object(
            ctx.obj,
            resource="company",
            properties=_parse_properties(properties, flag_name="--property"),
            command_id="company.create",
        ),
    )


@company_group.command("update")
@click.argument("company_id")
@click.option("--property", "properties", multiple=True, required=True, help="Repeated key=value property pair")
@click.pass_context
def company_update(ctx: click.Context, company_id: str, properties: tuple[str, ...]) -> None:
    require_mode(ctx.obj["mode"], "company.update")
    _set_result(
        ctx,
        "company.update",
        update_object(
            ctx.obj,
            resource="company",
            object_id=company_id,
            properties=_parse_properties(properties, flag_name="--property"),
            command_id="company.update",
        ),
    )


@click.group("deal")
def deal_group() -> None:
    pass


@deal_group.command("list")
@click.option("--property", "properties", multiple=True, help="Repeated property name to request")
@click.option("--limit", type=int, default=25, show_default=True)
@click.option("--after", default="", help="Pagination cursor")
@click.pass_context
def deal_list(ctx: click.Context, properties: tuple[str, ...], limit: int, after: str) -> None:
    require_mode(ctx.obj["mode"], "deal.list")
    _set_result(
        ctx,
        "deal.list",
        list_objects(ctx.obj, resource="deal", limit=limit, after=after or None, properties=list(properties)),
    )


@deal_group.command("search")
@click.option("--query", default="", help="Freeform HubSpot query")
@click.option("--pipeline-id", default="", help="Optional pipeline identifier")
@click.option("--stage-id", default="", help="Optional stage identifier")
@click.option("--property", "properties", multiple=True, help="Repeated property name to request")
@click.option("--limit", type=int, default=25, show_default=True)
@click.option("--after", default="", help="Pagination cursor")
@click.pass_context
def deal_search(
    ctx: click.Context,
    query: str,
    pipeline_id: str,
    stage_id: str,
    properties: tuple[str, ...],
    limit: int,
    after: str,
) -> None:
    require_mode(ctx.obj["mode"], "deal.search")
    filters = []
    if pipeline_id:
        filters.append({"propertyName": "pipeline", "operator": "EQ", "value": pipeline_id})
    if stage_id:
        filters.append({"propertyName": "dealstage", "operator": "EQ", "value": stage_id})
    _set_result(
        ctx,
        "deal.search",
        search_objects(
            ctx.obj,
            resource="deal",
            query_text=query or None,
            limit=limit,
            after=after or None,
            properties=list(properties),
            filters=filters or None,
        ),
    )


@deal_group.command("read")
@click.argument("deal_id")
@click.option("--property", "properties", multiple=True, help="Repeated property name to request")
@click.pass_context
def deal_read(ctx: click.Context, deal_id: str, properties: tuple[str, ...]) -> None:
    require_mode(ctx.obj["mode"], "deal.read")
    _set_result(ctx, "deal.read", read_object(ctx.obj, resource="deal", object_id=deal_id, properties=list(properties)))


@deal_group.command("create")
@click.option("--property", "properties", multiple=True, required=True, help="Repeated key=value property pair")
@click.pass_context
def deal_create(ctx: click.Context, properties: tuple[str, ...]) -> None:
    require_mode(ctx.obj["mode"], "deal.create")
    _set_result(
        ctx,
        "deal.create",
        create_object(
            ctx.obj,
            resource="deal",
            properties=_parse_properties(properties, flag_name="--property"),
            command_id="deal.create",
        ),
    )


@deal_group.command("update-stage")
@click.argument("deal_id")
@click.option("--stage-id", required=True, help="Destination stage identifier")
@click.option("--pipeline-id", default="", help="Optional pipeline identifier")
@click.pass_context
def deal_update_stage(ctx: click.Context, deal_id: str, stage_id: str, pipeline_id: str) -> None:
    require_mode(ctx.obj["mode"], "deal.update_stage")
    _set_result(
        ctx,
        "deal.update_stage",
        update_deal_stage(
            ctx.obj,
            deal_id=deal_id,
            stage_id=stage_id,
            pipeline_id=pipeline_id or None,
        ),
    )


@click.group("ticket")
def ticket_group() -> None:
    pass


@ticket_group.command("list")
@click.option("--property", "properties", multiple=True, help="Repeated property name to request")
@click.option("--limit", type=int, default=25, show_default=True)
@click.option("--after", default="", help="Pagination cursor")
@click.pass_context
def ticket_list(ctx: click.Context, properties: tuple[str, ...], limit: int, after: str) -> None:
    require_mode(ctx.obj["mode"], "ticket.list")
    _set_result(
        ctx,
        "ticket.list",
        list_objects(ctx.obj, resource="ticket", limit=limit, after=after or None, properties=list(properties)),
    )


@ticket_group.command("search")
@click.option("--query", default="", help="Freeform HubSpot query")
@click.option("--pipeline-id", default="", help="Optional pipeline identifier")
@click.option("--stage-id", default="", help="Optional status/stage identifier")
@click.option("--property", "properties", multiple=True, help="Repeated property name to request")
@click.option("--limit", type=int, default=25, show_default=True)
@click.option("--after", default="", help="Pagination cursor")
@click.pass_context
def ticket_search(
    ctx: click.Context,
    query: str,
    pipeline_id: str,
    stage_id: str,
    properties: tuple[str, ...],
    limit: int,
    after: str,
) -> None:
    require_mode(ctx.obj["mode"], "ticket.search")
    filters = []
    if pipeline_id:
        filters.append({"propertyName": "hs_pipeline", "operator": "EQ", "value": pipeline_id})
    if stage_id:
        filters.append({"propertyName": "hs_pipeline_stage", "operator": "EQ", "value": stage_id})
    _set_result(
        ctx,
        "ticket.search",
        search_objects(
            ctx.obj,
            resource="ticket",
            query_text=query or None,
            limit=limit,
            after=after or None,
            properties=list(properties),
            filters=filters or None,
        ),
    )


@ticket_group.command("read")
@click.argument("ticket_id")
@click.option("--property", "properties", multiple=True, help="Repeated property name to request")
@click.pass_context
def ticket_read(ctx: click.Context, ticket_id: str, properties: tuple[str, ...]) -> None:
    require_mode(ctx.obj["mode"], "ticket.read")
    _set_result(
        ctx,
        "ticket.read",
        read_object(ctx.obj, resource="ticket", object_id=ticket_id, properties=list(properties)),
    )


@ticket_group.command("create")
@click.option("--property", "properties", multiple=True, required=True, help="Repeated key=value property pair")
@click.pass_context
def ticket_create(ctx: click.Context, properties: tuple[str, ...]) -> None:
    require_mode(ctx.obj["mode"], "ticket.create")
    _set_result(
        ctx,
        "ticket.create",
        create_object(
            ctx.obj,
            resource="ticket",
            properties=_parse_properties(properties, flag_name="--property"),
            command_id="ticket.create",
        ),
    )


@ticket_group.command("update-status")
@click.argument("ticket_id")
@click.option("--stage-id", required=True, help="Destination ticket status/stage identifier")
@click.option("--pipeline-id", default="", help="Optional pipeline identifier")
@click.pass_context
def ticket_update_status(ctx: click.Context, ticket_id: str, stage_id: str, pipeline_id: str) -> None:
    require_mode(ctx.obj["mode"], "ticket.update_status")
    _set_result(
        ctx,
        "ticket.update_status",
        update_ticket_status(
            ctx.obj,
            ticket_id=ticket_id,
            stage_id=stage_id,
            pipeline_id=pipeline_id or None,
        ),
    )


@click.group("note")
def note_group() -> None:
    pass


@note_group.command("create")
@click.option(
    "--object-type",
    type=click.Choice(["contact", "company", "deal", "ticket"]),
    required=True,
    help="Associated HubSpot object type",
)
@click.option("--object-id", required=True, help="Associated HubSpot object identifier")
@click.option("--body", required=True, help="Note body")
@click.pass_context
def note_create(ctx: click.Context, object_type: str, object_id: str, body: str) -> None:
    require_mode(ctx.obj["mode"], "note.create")
    _set_result(
        ctx,
        "note.create",
        create_note(
            ctx.obj,
            object_type=object_type,
            object_id=object_id,
            body=body,
        ),
    )


@click.command("health")
@click.pass_context
def health(ctx: click.Context) -> None:
    _set_result(ctx, "health", health_snapshot(ctx.obj))


@click.command("doctor")
@click.pass_context
def doctor(ctx: click.Context) -> None:
    require_mode(ctx.obj["mode"], "doctor")
    snapshot = health_snapshot(ctx.obj)
    _set_result(
        ctx,
        "doctor",
        {
            **snapshot,
            "backend": "hubspot",
            "required_backend": "HubSpot REST API",
            "delivery_model": "hybrid",
            "recommendations": snapshot["next_steps"],
        },
    )


@click.group("config")
def config_group() -> None:
    pass


@config_group.command("show")
@click.pass_context
def config_show(ctx: click.Context) -> None:
    require_mode(ctx.obj["mode"], "config.show")
    _set_result(ctx, "config.show", config_snapshot(ctx.obj))


@click.command("capabilities")
@click.pass_context
def capabilities(ctx: click.Context) -> None:
    _set_result(
        ctx,
        "capabilities",
        {
            "tool": "aos-hubspot",
            "backend": "hubspot",
            "version": ctx.obj["version"],
            "manifest_schema_version": MANIFEST_SCHEMA_VERSION,
            "modes": MODE_ORDER,
            "connector": CONNECTOR_DESCRIPTOR,
            "auth": AUTH_DESCRIPTOR,
            "delivery_model": "hybrid",
            "commands": COMMAND_SPECS,
        },
    )


def register(cli: click.Group) -> None:
    cli.add_command(capabilities)
    cli.add_command(health)
    cli.add_command(doctor)
    cli.add_command(config_group)
    cli.add_command(owner_group)
    cli.add_command(pipeline_group)
    cli.add_command(contact_group)
    cli.add_command(company_group)
    cli.add_command(deal_group)
    cli.add_command(ticket_group)
    cli.add_command(note_group)
