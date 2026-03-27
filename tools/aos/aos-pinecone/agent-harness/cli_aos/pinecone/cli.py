from __future__ import annotations

import json
import time
from typing import Any

import click

from . import __version__
from .constants import MODE_ORDER, PERMISSIONS_PATH
from .errors import CliError
from .output import emit, failure, success
from .runtime import (
    capabilities_snapshot,
    config_snapshot,
    doctor_snapshot,
    health_snapshot,
    index_create_result,
    index_delete_result,
    index_describe_result,
    index_list_result,
    namespace_list_result,
    vector_delete_result,
    vector_fetch_result,
    vector_query_result,
    vector_upsert_result,
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
                    error=err.to_error(),
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


def _emit_success(ctx: click.Context, command_id: str, data: dict[str, Any]) -> None:
    emit(success(command=command_id, mode=ctx.obj["mode"], started=ctx.obj["started"], data=data), as_json=ctx.obj["json"])


@click.group(cls=AosGroup)
@click.option("--json", "as_json", is_flag=True, help="Emit JSON output")
@click.option("--mode", type=click.Choice(MODE_ORDER), default="readonly", show_default=True)
@click.option("--verbose", is_flag=True, help="Verbose diagnostics")
@click.version_option(__version__)
@click.pass_context
def cli(ctx: click.Context, as_json: bool, mode: str, verbose: bool) -> None:
    ctx.ensure_object(dict)
    ctx.obj.update({"json": as_json, "mode": mode, "verbose": verbose, "started": time.time(), "version": __version__, "_command_id": "unknown"})


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
    _emit_success(ctx, "config.show", config_snapshot(ctx.obj))


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


@cli.group("index")
def index_group() -> None:
    pass


@index_group.command("list")
@click.option("--limit", default=None, type=int)
@click.pass_context
def index_list(ctx: click.Context, limit: int | None) -> None:
    _set_command(ctx, "index.list")
    require_mode(ctx, "index.list")
    _emit_success(ctx, "index.list", index_list_result(ctx.obj, limit=limit))


@index_group.command("create")
@click.option("--index-name", default=None)
@click.option("--dimension", default=None, type=int)
@click.option("--metric", default=None)
@click.option("--cloud", default=None)
@click.option("--region", default=None)
@click.pass_context
def index_create(ctx: click.Context, index_name: str | None, dimension: int | None, metric: str | None, cloud: str | None, region: str | None) -> None:
    _set_command(ctx, "index.create")
    require_mode(ctx, "index.create")
    _emit_success(ctx, "index.create", index_create_result(ctx.obj, index_name=index_name, dimension=dimension, metric=metric, cloud=cloud, region=region))


@index_group.command("describe")
@click.option("--index-name", default=None)
@click.pass_context
def index_describe(ctx: click.Context, index_name: str | None) -> None:
    _set_command(ctx, "index.describe")
    require_mode(ctx, "index.describe")
    _emit_success(ctx, "index.describe", index_describe_result(ctx.obj, index_name=index_name))


@index_group.command("delete")
@click.option("--index-name", default=None)
@click.pass_context
def index_delete(ctx: click.Context, index_name: str | None) -> None:
    _set_command(ctx, "index.delete")
    require_mode(ctx, "index.delete")
    _emit_success(ctx, "index.delete", index_delete_result(ctx.obj, index_name=index_name))


@cli.group("vector")
def vector_group() -> None:
    pass


@vector_group.command("upsert")
@click.option("--index-name", default=None)
@click.option("--namespace", default=None)
@click.option("--vector-id", default=None)
@click.option("--values-json", default=None)
@click.option("--metadata-json", default=None)
@click.pass_context
def vector_upsert(
    ctx: click.Context,
    index_name: str | None,
    namespace: str | None,
    vector_id: str | None,
    values_json: str | None,
    metadata_json: str | None,
) -> None:
    _set_command(ctx, "vector.upsert")
    require_mode(ctx, "vector.upsert")
    _emit_success(
        ctx,
        "vector.upsert",
        vector_upsert_result(
            ctx.obj,
            index_name=index_name,
            namespace=namespace,
            vector_id=vector_id,
            values_json=values_json,
            metadata_json=metadata_json,
        ),
    )


@vector_group.command("query")
@click.option("--index-name", default=None)
@click.option("--namespace", default=None)
@click.option("--query-vector-json", default=None)
@click.option("--top-k", default=None, type=int)
@click.option("--filter-json", default=None)
@click.pass_context
def vector_query(
    ctx: click.Context,
    index_name: str | None,
    namespace: str | None,
    query_vector_json: str | None,
    top_k: int | None,
    filter_json: str | None,
) -> None:
    _set_command(ctx, "vector.query")
    require_mode(ctx, "vector.query")
    _emit_success(
        ctx,
        "vector.query",
        vector_query_result(
            ctx.obj,
            index_name=index_name,
            namespace=namespace,
            query_vector_json=query_vector_json,
            top_k=top_k,
            filter_json=filter_json,
        ),
    )


@vector_group.command("fetch")
@click.option("--index-name", default=None)
@click.option("--namespace", default=None)
@click.option("--vector-id", default=None)
@click.pass_context
def vector_fetch(ctx: click.Context, index_name: str | None, namespace: str | None, vector_id: str | None) -> None:
    _set_command(ctx, "vector.fetch")
    require_mode(ctx, "vector.fetch")
    _emit_success(ctx, "vector.fetch", vector_fetch_result(ctx.obj, index_name=index_name, namespace=namespace, vector_id=vector_id))


@vector_group.command("delete")
@click.option("--index-name", default=None)
@click.option("--namespace", default=None)
@click.option("--vector-id", default=None)
@click.option("--filter-json", default=None)
@click.option("--delete-all", is_flag=True)
@click.pass_context
def vector_delete(
    ctx: click.Context,
    index_name: str | None,
    namespace: str | None,
    vector_id: str | None,
    filter_json: str | None,
    delete_all: bool,
) -> None:
    _set_command(ctx, "vector.delete")
    require_mode(ctx, "vector.delete")
    _emit_success(
        ctx,
        "vector.delete",
        vector_delete_result(
            ctx.obj,
            index_name=index_name,
            namespace=namespace,
            vector_id=vector_id,
            filter_json=filter_json,
            delete_all=delete_all,
        ),
    )


@cli.group("namespace")
def namespace_group() -> None:
    pass


@namespace_group.command("list")
@click.option("--index-name", default=None)
@click.option("--prefix", default=None)
@click.option("--limit", default=None, type=int)
@click.pass_context
def namespace_list(ctx: click.Context, index_name: str | None, prefix: str | None, limit: int | None) -> None:
    _set_command(ctx, "namespace.list")
    require_mode(ctx, "namespace.list")
    _emit_success(ctx, "namespace.list", namespace_list_result(ctx.obj, index_name=index_name, prefix=prefix, limit=limit))
