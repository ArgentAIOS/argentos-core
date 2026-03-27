from __future__ import annotations

import json
import time

import click

from . import __version__
from .constants import MODE_ORDER, PERMISSIONS_PATH
from .errors import CliError
from .output import emit, failure, success
from .runtime import (
    asset_list_result,
    asset_upload_result,
    autofill_create_result,
    brand_template_create_design_result,
    brand_template_list_result,
    capabilities_snapshot,
    config_show_result,
    design_clone_result,
    design_create_result,
    design_get_result,
    design_list_result,
    doctor_snapshot,
    export_download_result,
    export_start_result,
    export_status_result,
    folder_create_result,
    folder_get_result,
    folder_list_result,
    health_snapshot,
    template_get_result,
    template_list_result,
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


@cli.group("design")
def design_group() -> None:
    pass


@design_group.command("list")
@click.option("--folder-id", default=None)
@click.option("--limit", default=10, show_default=True, type=int)
@click.pass_context
def design_list(ctx: click.Context, folder_id: str | None, limit: int) -> None:
    _set_command(ctx, "design.list")
    require_mode(ctx, "design.list")
    _emit_success(ctx, "design.list", design_list_result(ctx.obj, folder_id=folder_id, limit=limit))


@design_group.command("get")
@click.argument("design_id", required=False)
@click.pass_context
def design_get(ctx: click.Context, design_id: str | None) -> None:
    _set_command(ctx, "design.get")
    require_mode(ctx, "design.get")
    _emit_success(ctx, "design.get", design_get_result(ctx.obj, design_id=design_id))


@design_group.command("create")
@click.option("--title", default=None)
@click.option("--template-id", default=None)
@click.option("--asset-id", default=None)
@click.pass_context
def design_create(ctx: click.Context, title: str | None, template_id: str | None, asset_id: str | None) -> None:
    _set_command(ctx, "design.create")
    require_mode(ctx, "design.create")
    _emit_success(ctx, "design.create", design_create_result(ctx.obj, title=title, template_id=template_id, asset_id=asset_id))


@design_group.command("clone")
@click.argument("design_id", required=False)
@click.option("--title", default=None)
@click.pass_context
def design_clone(ctx: click.Context, design_id: str | None, title: str | None) -> None:
    _set_command(ctx, "design.clone")
    require_mode(ctx, "design.clone")
    _emit_success(ctx, "design.clone", design_clone_result(ctx.obj, design_id=design_id, title=title))


@cli.group("template")
def template_group() -> None:
    pass


@template_group.command("list")
@click.option("--limit", default=10, show_default=True, type=int)
@click.pass_context
def template_list(ctx: click.Context, limit: int) -> None:
    _set_command(ctx, "template.list")
    require_mode(ctx, "template.list")
    _emit_success(ctx, "template.list", template_list_result(ctx.obj, limit=limit))


@template_group.command("get")
@click.argument("template_id", required=False)
@click.pass_context
def template_get(ctx: click.Context, template_id: str | None) -> None:
    _set_command(ctx, "template.get")
    require_mode(ctx, "template.get")
    _emit_success(ctx, "template.get", template_get_result(ctx.obj, template_id=template_id))


@cli.group("brand-template")
def brand_template_group() -> None:
    pass


@brand_template_group.command("list")
@click.option("--limit", default=10, show_default=True, type=int)
@click.pass_context
def brand_template_list(ctx: click.Context, limit: int) -> None:
    _set_command(ctx, "brand_template.list")
    require_mode(ctx, "brand_template.list")
    _emit_success(ctx, "brand_template.list", brand_template_list_result(ctx.obj, limit=limit))


@brand_template_group.command("create-design")
@click.option("--brand-template-id", default=None)
@click.option("--title", default=None)
@click.option("--autofill-data", default=None)
@click.pass_context
def brand_template_create_design(ctx: click.Context, brand_template_id: str | None, title: str | None, autofill_data: str | None) -> None:
    _set_command(ctx, "brand_template.create_design")
    require_mode(ctx, "brand_template.create_design")
    _emit_success(
        ctx,
        "brand_template.create_design",
        brand_template_create_design_result(ctx.obj, brand_template_id=brand_template_id, title=title, autofill_data=autofill_data),
    )


@cli.group("asset")
def asset_group() -> None:
    pass


@asset_group.command("list")
@click.option("--folder-id", default=None)
@click.option("--limit", default=10, show_default=True, type=int)
@click.pass_context
def asset_list(ctx: click.Context, folder_id: str | None, limit: int) -> None:
    _set_command(ctx, "asset.list")
    require_mode(ctx, "asset.list")
    _emit_success(ctx, "asset.list", asset_list_result(ctx.obj, folder_id=folder_id, limit=limit))


@asset_group.command("upload")
@click.option("--asset-file", default=None)
@click.option("--asset-url", default=None)
@click.option("--name", default=None)
@click.pass_context
def asset_upload(ctx: click.Context, asset_file: str | None, asset_url: str | None, name: str | None) -> None:
    _set_command(ctx, "asset.upload")
    require_mode(ctx, "asset.upload")
    _emit_success(ctx, "asset.upload", asset_upload_result(ctx.obj, asset_file=asset_file, asset_url=asset_url, name=name))


@cli.group("folder")
def folder_group() -> None:
    pass


@folder_group.command("list")
@click.option("--folder-id", default=None)
@click.option("--limit", default=10, show_default=True, type=int)
@click.pass_context
def folder_list(ctx: click.Context, folder_id: str | None, limit: int) -> None:
    _set_command(ctx, "folder.list")
    require_mode(ctx, "folder.list")
    _emit_success(ctx, "folder.list", folder_list_result(ctx.obj, folder_id=folder_id, limit=limit))


@folder_group.command("get")
@click.argument("folder_id", required=False)
@click.pass_context
def folder_get(ctx: click.Context, folder_id: str | None) -> None:
    _set_command(ctx, "folder.get")
    require_mode(ctx, "folder.get")
    _emit_success(ctx, "folder.get", folder_get_result(ctx.obj, folder_id=folder_id))


@folder_group.command("create")
@click.option("--name", default=None)
@click.option("--parent-folder-id", default=None)
@click.pass_context
def folder_create(ctx: click.Context, name: str | None, parent_folder_id: str | None) -> None:
    _set_command(ctx, "folder.create")
    require_mode(ctx, "folder.create")
    _emit_success(ctx, "folder.create", folder_create_result(ctx.obj, name=name, parent_folder_id=parent_folder_id))


@cli.group("export")
def export_group() -> None:
    pass


@export_group.command("start")
@click.argument("design_id", required=False)
@click.option("--format", "export_format", default=None)
@click.pass_context
def export_start(ctx: click.Context, design_id: str | None, export_format: str | None) -> None:
    _set_command(ctx, "export.start")
    require_mode(ctx, "export.start")
    _emit_success(ctx, "export.start", export_start_result(ctx.obj, design_id=design_id, export_format=export_format))


@export_group.command("status")
@click.argument("export_job_id", required=False)
@click.pass_context
def export_status(ctx: click.Context, export_job_id: str | None) -> None:
    _set_command(ctx, "export.status")
    require_mode(ctx, "export.status")
    _emit_success(ctx, "export.status", export_status_result(ctx.obj, export_job_id=export_job_id))


@export_group.command("download")
@click.argument("export_job_id", required=False)
@click.pass_context
def export_download(ctx: click.Context, export_job_id: str | None) -> None:
    _set_command(ctx, "export.download")
    require_mode(ctx, "export.download")
    _emit_success(ctx, "export.download", export_download_result(ctx.obj, export_job_id=export_job_id))


@cli.command("autofill-create")
@click.option("--brand-template-id", default=None)
@click.option("--autofill-data", default=None)
@click.option("--title", default=None)
@click.pass_context
def autofill_create(ctx: click.Context, brand_template_id: str | None, autofill_data: str | None, title: str | None) -> None:
    _set_command(ctx, "autofill.create")
    require_mode(ctx, "autofill.create")
    _emit_success(ctx, "autofill.create", autofill_create_result(ctx.obj, brand_template_id=brand_template_id, autofill_data=autofill_data, title=title))
