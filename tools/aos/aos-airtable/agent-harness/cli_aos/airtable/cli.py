from __future__ import annotations

import json
import time
from typing import Any

import click

from . import __version__
from .constants import MODE_ORDER, PERMISSIONS_PATH, TOOL_NAME
from .errors import CliError
from .output import emit, failure, success
from .runtime import capabilities_snapshot, config_snapshot, doctor_snapshot, health_snapshot, live_read_result, live_write_result


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
            payload = failure(
                tool=TOOL_NAME,
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
                tool=TOOL_NAME,
                command=ctx.obj.get("_command_id", "unknown") if ctx.obj else "unknown",
                error={"code": "INVALID_USAGE", "message": str(err), "details": {}},
                started=ctx.obj.get("started", time.time()) if ctx.obj else time.time(),
                mode=ctx.obj.get("mode", "unknown") if ctx.obj else "unknown",
                version=ctx.obj.get("version", __version__) if ctx.obj else __version__,
            )
            emit(payload, as_json=ctx.obj.get("json", True) if ctx.obj else True)
            ctx.exit(2)


def _set_command(ctx: click.Context, command_id: str) -> None:
    ctx.obj["_command_id"] = command_id


def _parse_fields(fields: tuple[str, ...], fields_json: str | None) -> dict[str, Any]:
    parsed: dict[str, Any] = {}
    if fields_json:
        try:
            json_payload = json.loads(fields_json)
        except json.JSONDecodeError as err:
            raise click.BadParameter(f"fields JSON is invalid: {err}") from err
        if not isinstance(json_payload, dict):
            raise click.BadParameter("fields JSON must be an object")
        parsed.update(json_payload)
    for item in fields:
        if "=" not in item:
            raise click.BadParameter("--field entries must use field=value syntax")
        key, value = item.split("=", 1)
        key = key.strip()
        if not key:
            raise click.BadParameter("--field entries must include a field name")
        parsed[key] = value
    return parsed


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
    emit(capabilities_snapshot(), as_json=True)


@cli.group("config")
def config_group() -> None:
    pass


@config_group.command("show")
@click.pass_context
def config_show(ctx: click.Context) -> None:
    _set_command(ctx, "config.show")
    require_mode(ctx, "config.show")
    payload = success(
        tool=TOOL_NAME,
        command="config.show",
        data=config_snapshot(ctx.obj),
        started=ctx.obj["started"],
        mode=ctx.obj["mode"],
        version=ctx.obj["version"],
    )
    emit(payload, as_json=ctx.obj["json"])


@cli.command("health")
@click.pass_context
def health(ctx: click.Context) -> None:
    _set_command(ctx, "health")
    require_mode(ctx, "health")
    payload = success(
        tool=TOOL_NAME,
        command="health",
        data=health_snapshot(ctx.obj),
        started=ctx.obj["started"],
        mode=ctx.obj["mode"],
        version=ctx.obj["version"],
    )
    emit(payload, as_json=ctx.obj["json"])


@cli.command("doctor")
@click.pass_context
def doctor(ctx: click.Context) -> None:
    _set_command(ctx, "doctor")
    require_mode(ctx, "doctor")
    payload = success(
        tool=TOOL_NAME,
        command="doctor",
        data=doctor_snapshot(ctx.obj),
        started=ctx.obj["started"],
        mode=ctx.obj["mode"],
        version=ctx.obj["version"],
    )
    emit(payload, as_json=ctx.obj["json"])


def _live_read_command(
    ctx: click.Context,
    *,
    command_id: str,
    resource: str,
    operation: str,
    inputs: dict[str, Any],
    fetcher,
    consequential: bool = False,
) -> None:
    _set_command(ctx, command_id)
    require_mode(ctx, command_id)
    payload = success(
        tool=TOOL_NAME,
        command=command_id,
        data=live_read_result(
            ctx.obj,
            command_id=command_id,
            resource=resource,
            operation=operation,
            inputs=inputs,
            fetcher=fetcher,
            consequential=consequential,
        ),
        started=ctx.obj["started"],
        mode=ctx.obj["mode"],
        version=ctx.obj["version"],
    )
    emit(payload, as_json=ctx.obj["json"])


def _live_write_command(
    ctx: click.Context,
    *,
    command_id: str,
    resource: str,
    operation: str,
    inputs: dict[str, Any],
    fetcher,
) -> None:
    _set_command(ctx, command_id)
    require_mode(ctx, command_id)
    payload = success(
        tool=TOOL_NAME,
        command=command_id,
        data=live_write_result(
            ctx.obj,
            command_id=command_id,
            resource=resource,
            operation=operation,
            inputs=inputs,
            fetcher=fetcher,
        ),
        started=ctx.obj["started"],
        mode=ctx.obj["mode"],
        version=ctx.obj["version"],
    )
    emit(payload, as_json=ctx.obj["json"])


@cli.group("base")
def base_group() -> None:
    pass


@base_group.command("list")
@click.option("--limit", default=10, show_default=True, type=int)
@click.pass_context
def base_list(ctx: click.Context, limit: int) -> None:
    _live_read_command(
        ctx,
        command_id="base.list",
        resource="base",
        operation="list",
        inputs={"limit": limit},
        fetcher=lambda client: client.list_bases(limit=limit),
    )


@base_group.command("read")
@click.argument("base_id", required=False)
@click.pass_context
def base_read(ctx: click.Context, base_id: str | None) -> None:
    _live_read_command(
        ctx,
        command_id="base.read",
        resource="base",
        operation="read",
        inputs={"base_id": base_id or "AIRTABLE_BASE_ID"},
        fetcher=lambda client: client.read_base_schema(base_id),
    )


@cli.group("table")
def table_group() -> None:
    pass


@table_group.command("list")
@click.pass_context
def table_list(ctx: click.Context) -> None:
    _live_read_command(
        ctx,
        command_id="table.list",
        resource="table",
        operation="list",
        inputs={},
        fetcher=lambda client: client.list_tables(),
    )


@table_group.command("read")
@click.argument("table_id", required=False)
@click.pass_context
def table_read(ctx: click.Context, table_id: str | None) -> None:
    _live_read_command(
        ctx,
        command_id="table.read",
        resource="table",
        operation="read",
        inputs={"table_id": table_id or "AIRTABLE_TABLE_NAME"},
        fetcher=lambda client: client.read_table(table_id),
    )


@cli.group("record")
def record_group() -> None:
    pass


@record_group.command("list")
@click.option("--limit", default=10, show_default=True, type=int)
@click.option(
    "--table",
    "table_name",
    required=False,
    default=None,
    help="Target table name (defaults to AIRTABLE_TABLE_NAME when omitted)",
)
@click.pass_context
def record_list(ctx: click.Context, limit: int, table_name: str | None) -> None:
    _live_read_command(
        ctx,
        command_id="record.list",
        resource="record",
        operation="list",
        inputs={"limit": limit, "table": table_name or "AIRTABLE_TABLE_NAME"},
        fetcher=lambda client: client.list_records(table_name, limit=limit),
    )


@record_group.command("search")
@click.option("--query", required=True, help="Search text")
@click.option(
    "--table",
    "table_name",
    required=False,
    default=None,
    help="Target table name (defaults to AIRTABLE_TABLE_NAME when omitted)",
)
@click.pass_context
def record_search(ctx: click.Context, query: str, table_name: str | None) -> None:
    _live_read_command(
        ctx,
        command_id="record.search",
        resource="record",
        operation="search",
        inputs={"query": query, "table": table_name or "AIRTABLE_TABLE_NAME"},
        fetcher=lambda client: client.search_records(table_name, query),
    )


@record_group.command("read")
@click.argument("record_id")
@click.option(
    "--table",
    "table_name",
    required=False,
    default=None,
    help="Target table name (defaults to AIRTABLE_TABLE_NAME when omitted)",
)
@click.pass_context
def record_read(ctx: click.Context, record_id: str, table_name: str | None) -> None:
    _live_read_command(
        ctx,
        command_id="record.read",
        resource="record",
        operation="read",
        inputs={"record_id": record_id, "table": table_name or "AIRTABLE_TABLE_NAME"},
        fetcher=lambda client: client.read_record(table_name, record_id),
    )


@record_group.command("create")
@click.option(
    "--table",
    "table_name",
    required=False,
    default=None,
    help="Target table name (defaults to AIRTABLE_TABLE_NAME when omitted)",
)
@click.option("--field", "fields", multiple=True, help="Repeated field=value entries")
@click.option("--fields-json", required=False, default=None, help="JSON object of Airtable field values")
@click.option("--typecast", is_flag=True, help="Ask Airtable to typecast compatible field values")
@click.pass_context
def record_create(
    ctx: click.Context,
    table_name: str | None,
    fields: tuple[str, ...],
    fields_json: str | None,
    typecast: bool,
) -> None:
    parsed_fields = _parse_fields(fields, fields_json)
    _live_write_command(
        ctx,
        command_id="record.create",
        resource="record",
        operation="create",
        inputs={"table": table_name or "AIRTABLE_TABLE_NAME", "fields": parsed_fields, "typecast": typecast},
        fetcher=lambda client: client.create_record(table_name, parsed_fields, typecast=typecast),
    )


@record_group.command("update")
@click.argument("record_id")
@click.option(
    "--table",
    "table_name",
    required=False,
    default=None,
    help="Target table name (defaults to AIRTABLE_TABLE_NAME when omitted)",
)
@click.option("--field", "fields", multiple=True, help="Repeated field=value entries")
@click.option("--fields-json", required=False, default=None, help="JSON object of Airtable field values")
@click.option("--typecast", is_flag=True, help="Ask Airtable to typecast compatible field values")
@click.pass_context
def record_update(
    ctx: click.Context,
    record_id: str,
    table_name: str | None,
    fields: tuple[str, ...],
    fields_json: str | None,
    typecast: bool,
) -> None:
    parsed_fields = _parse_fields(fields, fields_json)
    _live_write_command(
        ctx,
        command_id="record.update",
        resource="record",
        operation="update",
        inputs={"record_id": record_id, "table": table_name or "AIRTABLE_TABLE_NAME", "fields": parsed_fields, "typecast": typecast},
        fetcher=lambda client: client.update_record(table_name, record_id, parsed_fields, typecast=typecast),
    )


if __name__ == "__main__":
    cli()
