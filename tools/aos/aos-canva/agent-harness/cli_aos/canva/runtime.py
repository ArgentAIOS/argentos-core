from __future__ import annotations

import json
from typing import Any

from .client import CanvaApiError, CanvaClient
from .config import config_snapshot, resolve_runtime_values
from .constants import BACKEND_NAME, CONNECTOR_PATH, TOOL_NAME
from .errors import CliError


def _load_manifest() -> dict[str, Any]:
    return json.loads(CONNECTOR_PATH.read_text())


def _scope_preview(command_id: str, surface: str, extra: dict[str, Any] | None = None) -> dict[str, Any]:
    payload = {"selection_surface": surface, "command_id": command_id, "backend": BACKEND_NAME}
    if extra:
        payload.update(extra)
    return payload


def _picker(items: list[dict[str, Any]], *, kind: str, label_key: str = "label") -> dict[str, Any]:
    return {"kind": kind, "items": items, "count": len(items), "label_key": label_key}


def _require_arg(value: str | None, *, code: str, message: str, env_name: str) -> str:
    resolved = (value or "").strip()
    if resolved:
        return resolved
    raise CliError(code=code, message=message, exit_code=4, details={"env": env_name})


def _parse_json_payload(value: str | None, *, env_name: str, code: str, message: str) -> dict[str, Any]:
    resolved = (value or "").strip()
    if not resolved:
        return {}
    try:
        parsed = json.loads(resolved)
    except json.JSONDecodeError as err:
        raise CliError(code=code, message=message, exit_code=4, details={"env": env_name, "error": str(err)}) from err
    if not isinstance(parsed, dict):
        raise CliError(code=code, message=message, exit_code=4, details={"env": env_name})
    return parsed


def capabilities_snapshot() -> dict[str, Any]:
    manifest = _load_manifest()
    read_support: dict[str, bool] = {}
    write_support: dict[str, bool] = {}
    for command in manifest["commands"]:
        target = read_support if command["required_mode"] == "readonly" else write_support
        target[command["id"]] = True
    return {
        "tool": manifest["tool"],
        "backend": manifest["backend"],
        "manifest_schema_version": manifest.get("manifest_schema_version", "1.0.0"),
        "connector": manifest["connector"],
        "auth": manifest["auth"],
        "scope": manifest.get("scope", {}),
        "commands": manifest["commands"],
        "read_support": read_support,
        "write_support": write_support,
    }


def create_client(ctx_obj: dict[str, Any]) -> CanvaClient:
    runtime = resolve_runtime_values(ctx_obj)
    if not runtime["access_token_present"]:
        raise CliError(
            code="CANVA_SETUP_REQUIRED",
            message="Canva connector is missing a required access token",
            exit_code=4,
            details={"missing_keys": [runtime["access_token_env"]]},
        )
    return CanvaClient(access_token=runtime["access_token"])


def probe_runtime(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    if not runtime["access_token_present"]:
        return {
            "ok": False,
            "code": "CANVA_SETUP_REQUIRED",
            "message": "Canva connector is missing a required access token",
            "details": {"missing_keys": [runtime["access_token_env"]], "live_backend_available": False},
        }
    try:
        client = create_client(ctx_obj)
        designs = client.list_designs(limit=1)
    except CliError as err:
        return {"ok": False, "code": err.code, "message": err.message, "details": err.details}
    except CanvaApiError as err:
        code = "CANVA_AUTH_FAILED" if err.status_code in {401, 403} else "CANVA_API_ERROR"
        return {
            "ok": False,
            "code": code,
            "message": err.message,
            "details": {**(err.details or {}), "status_code": err.status_code, "live_backend_available": False},
        }
    return {
        "ok": True,
        "code": "OK",
        "message": "Canva live runtime is ready",
        "details": {"live_backend_available": True, "designs": designs},
    }


def health_snapshot(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    probe = probe_runtime(ctx_obj)
    status = "ready" if probe["ok"] else ("needs_setup" if probe["code"] == "CANVA_SETUP_REQUIRED" else "degraded")
    return {
        "status": status,
        "summary": probe["message"],
        "connector": {
            "tool": TOOL_NAME,
            "backend": BACKEND_NAME,
            "live_backend_available": bool(probe["ok"]),
            "live_read_available": bool(probe["ok"]),
            "write_bridge_available": bool(probe["ok"]),
            "scaffold_only": False,
        },
        "auth": {
            "access_token_env": runtime["access_token_env"],
            "access_token_present": runtime["access_token_present"],
            "access_token_source": runtime["access_token_source"],
        },
        "scope": {
            "folder_id": runtime["folder_id"],
            "design_id": runtime["design_id"],
            "brand_template_id": runtime["brand_template_id"],
            "export_format": runtime["export_format"],
        },
        "checks": [
            {
                "name": "required_env",
                "ok": runtime["access_token_present"],
                "details": {"missing_keys": [] if runtime["access_token_present"] else [runtime["access_token_env"]]},
            },
            {"name": "live_backend", "ok": bool(probe["ok"]), "details": probe.get("details", {})},
        ],
        "runtime_ready": bool(probe["ok"]),
        "probe": probe,
        "next_steps": [
            f"Set {runtime['access_token_env']} in API Keys after completing the Canva OAuth token exchange.",
            f"Optionally set {runtime['folder_id_env']} to scope design and asset listings.",
            "Use design.list or brand-template list to confirm the live backend responds.",
        ],
    }


def doctor_snapshot(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    probe = probe_runtime(ctx_obj)
    ready = bool(probe["ok"])
    return {
        "status": "ready" if ready else ("needs_setup" if probe["code"] == "CANVA_SETUP_REQUIRED" else "degraded"),
        "summary": "Canva connector diagnostics.",
        "runtime": {
            "implementation_mode": "live_read_with_live_writes" if runtime["access_token_present"] else "configuration_only",
            "command_readiness": {
                "design.list": ready,
                "design.get": ready and bool(runtime["design_id"]),
                "design.create": ready,
                "brand_template.list": ready,
                "brand_template.get": ready and bool(runtime["brand_template_id"]),
                "brand_template.create_design": ready and bool(runtime["brand_template_id"]),
                "asset.upload": ready and bool(runtime["asset_file"] or runtime["asset_url"]),
                "asset.list": ready,
                "folder.list": ready,
                "folder.get": ready and bool(runtime["folder_id"]),
                "folder.create": ready and bool(runtime["folder_name"]),
                "export.start": ready and bool(runtime["design_id"]),
                "export.status": ready and bool(runtime["export_job_id"]),
                "export.download": ready and bool(runtime["export_job_id"]),
                "autofill.create": ready and bool(runtime["brand_template_id"] and runtime["autofill_data"]),
            },
        },
        "checks": [
            {"name": "required_env", "ok": runtime["access_token_present"], "details": {"missing_keys": [] if runtime["access_token_present"] else [runtime["access_token_env"]]}},
            {"name": "live_backend", "ok": ready, "details": probe.get("details", {})},
        ],
        "supported_read_commands": [
            "design.list",
            "design.get",
            "brand_template.list",
            "brand_template.get",
            "asset.list",
            "folder.list",
            "folder.get",
            "export.status",
            "export.download",
        ],
        "supported_write_commands": [
            "design.create",
            "brand_template.create_design",
            "asset.upload",
            "folder.create",
            "export.start",
            "autofill.create",
        ],
        "scaffolded_commands": [],
        "next_steps": [
            f"Set {runtime['access_token_env']} in API Keys to enable live Canva calls.",
            "Provide a folder default if you want folder-scoped design and asset listings.",
            "Set brand template and autofill data defaults for automation flows.",
        ],
    }


def config_show_result(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    return config_snapshot(ctx_obj)


def _design_item_to_picker(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "value": item["id"],
        "label": item.get("title") or item["id"],
        "subtitle": f"{item.get('page_count') or 0} pages",
        "selected": False,
    }


def _folder_item_to_picker(item: dict[str, Any]) -> dict[str, Any]:
    title = item.get("folder", {}).get("name") or item.get("design", {}).get("title") or item.get("image", {}).get("name") or item.get("id")
    return {"value": item.get("id") or title, "label": title, "subtitle": item.get("type"), "selected": False}


def design_list_result(ctx_obj: dict[str, Any], *, folder_id: str | None, limit: int) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    client = create_client(ctx_obj)
    if folder_id or runtime["folder_id"]:
        resolved_folder = folder_id or runtime["folder_id"] or "root"
        listing = client.list_folder_items(resolved_folder, limit=limit, item_types=["design"])
        items = [item["design"] for item in listing["items"] if item.get("type") == "design" and isinstance(item.get("design"), dict)]
        picker_items = [_design_item_to_picker(item) for item in items]
        return {
            "status": "live_read",
            "backend": BACKEND_NAME,
            "summary": f"Listed {len(items)} design(s) in folder {resolved_folder}.",
            "designs": items,
            "picker": _picker(picker_items, kind="canva_design"),
            "scope_preview": _scope_preview("design.list", "design", {"folder_id": resolved_folder}),
        }
    listing = client.list_designs(limit=limit)
    items = listing["items"]
    picker_items = [_design_item_to_picker(item) for item in items]
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Listed {len(items)} design(s).",
        "designs": items,
        "picker": _picker(picker_items, kind="canva_design"),
        "scope_preview": _scope_preview("design.list", "design"),
    }


def design_get_result(ctx_obj: dict[str, Any], *, design_id: str | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved_design_id = _require_arg(design_id or runtime["design_id"], code="CANVA_DESIGN_ID_REQUIRED", message="design_id is required", env_name=runtime["design_id_env"])
    client = create_client(ctx_obj)
    design = client.get_design(resolved_design_id)
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Fetched design {resolved_design_id}.",
        "design": design,
        "scope_preview": _scope_preview("design.get", "design", {"design_id": resolved_design_id}),
    }


def design_create_result(ctx_obj: dict[str, Any], *, title: str | None, asset_id: str | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved_title = title or runtime["title"] or "Untitled Canva design"
    client = create_client(ctx_obj)
    design = client.create_design(title=resolved_title, design_type={"type": "preset", "name": "doc"}, asset_id=asset_id or runtime["asset_id"])
    return {
        "status": "live_write",
        "backend": BACKEND_NAME,
        "summary": f"Created blank design {design.get('id') or resolved_title}.",
        "design": design,
        "scope_preview": _scope_preview("design.create", "design", {"title": resolved_title}),
    }


def brand_template_list_result(ctx_obj: dict[str, Any], *, limit: int) -> dict[str, Any]:
    client = create_client(ctx_obj)
    listing = client.list_brand_templates(limit=limit)
    items = listing["items"]
    picker_items = [{"value": item["id"], "label": item.get("title") or item["id"], "subtitle": item.get("create_url"), "selected": False} for item in items]
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Listed {len(items)} brand template(s).",
        "brand_templates": items,
        "picker": _picker(picker_items, kind="canva_brand_template"),
        "scope_preview": _scope_preview("brand_template.list", "brand_template"),
    }


def brand_template_create_design_result(ctx_obj: dict[str, Any], *, brand_template_id: str | None, title: str | None, autofill_data: str | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved_brand_template_id = _require_arg(brand_template_id or runtime["brand_template_id"], code="CANVA_BRAND_TEMPLATE_ID_REQUIRED", message="brand_template_id is required", env_name=runtime["brand_template_id_env"])
    data = _parse_json_payload(autofill_data or runtime["autofill_data"], env_name=runtime["autofill_data_env"], code="CANVA_AUTOFILL_DATA_INVALID", message="autofill_data must be valid JSON")
    client = create_client(ctx_obj)
    job = client.create_design_autofill_job(brand_template_id=resolved_brand_template_id, data=data, title=title or runtime["title"])
    return {
        "status": "live_write",
        "backend": BACKEND_NAME,
        "summary": f"Started autofill for brand template {resolved_brand_template_id}.",
        "job": job,
        "scope_preview": _scope_preview("brand_template.create_design", "brand_template", {"brand_template_id": resolved_brand_template_id}),
    }


def brand_template_get_result(ctx_obj: dict[str, Any], *, brand_template_id: str | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved_id = _require_arg(brand_template_id or runtime["brand_template_id"], code="CANVA_BRAND_TEMPLATE_ID_REQUIRED", message="brand_template_id is required", env_name=runtime["brand_template_id_env"])
    client = create_client(ctx_obj)
    template = client.get_brand_template(resolved_id)
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Fetched brand template {resolved_id}.",
        "brand_template": template,
        "scope_preview": _scope_preview("brand_template.get", "brand_template", {"brand_template_id": resolved_id}),
    }


def asset_list_result(ctx_obj: dict[str, Any], *, folder_id: str | None, limit: int) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved_folder = folder_id or runtime["folder_id"] or "uploads"
    client = create_client(ctx_obj)
    listing = client.list_folder_items(resolved_folder, limit=limit, item_types=["image"])
    assets = [item["image"] for item in listing["items"] if item.get("type") == "image" and isinstance(item.get("image"), dict)]
    picker_items = [{"value": item["id"], "label": item.get("name") or item["id"], "subtitle": item.get("type"), "selected": False} for item in assets]
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Listed {len(assets)} asset(s) in folder {resolved_folder}.",
        "assets": assets,
        "picker": _picker(picker_items, kind="canva_asset"),
        "scope_preview": _scope_preview("asset.list", "asset", {"folder_id": resolved_folder}),
    }


def asset_upload_result(ctx_obj: dict[str, Any], *, asset_file: str | None, asset_url: str | None, name: str | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    client = create_client(ctx_obj)
    resolved_name = name or runtime["asset_name"]
    if asset_file or runtime["asset_file"]:
        resolved_path = _require_arg(asset_file or runtime["asset_file"], code="CANVA_ASSET_FILE_REQUIRED", message="asset_file is required", env_name=runtime["asset_file_env"])
        upload = client.create_asset_upload_job(file_path=resolved_path, name=resolved_name)
    elif asset_url or runtime["asset_url"]:
        resolved_url = _require_arg(asset_url or runtime["asset_url"], code="CANVA_ASSET_URL_REQUIRED", message="asset_url is required", env_name=runtime["asset_url_env"])
        resolved_asset_name = _require_arg(resolved_name, code="CANVA_ASSET_NAME_REQUIRED", message="asset name is required for URL uploads", env_name=runtime["asset_name_env"])
        upload = client.create_url_asset_upload_job(name=resolved_asset_name, url=resolved_url)
    else:
        raise CliError(code="CANVA_ASSET_FILE_REQUIRED", message="asset_file or asset_url is required", exit_code=4, details={"env": runtime["asset_file_env"]})
    return {
        "status": "live_write",
        "backend": BACKEND_NAME,
        "summary": "Started Canva asset upload.",
        "upload": upload,
        "scope_preview": _scope_preview("asset.upload", "asset"),
    }


def folder_list_result(ctx_obj: dict[str, Any], *, folder_id: str | None, limit: int) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved_folder = folder_id or runtime["folder_id"] or "root"
    client = create_client(ctx_obj)
    listing = client.list_folder_items(resolved_folder, limit=limit)
    items = listing["items"]
    picker_items = [_folder_item_to_picker(item) for item in items]
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Listed {len(items)} item(s) in folder {resolved_folder}.",
        "items": items,
        "picker": _picker(picker_items, kind="canva_folder_item"),
        "scope_preview": _scope_preview("folder.list", "folder", {"folder_id": resolved_folder}),
    }


def folder_get_result(ctx_obj: dict[str, Any], *, folder_id: str | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved_folder_id = _require_arg(folder_id or runtime["folder_id"], code="CANVA_FOLDER_ID_REQUIRED", message="folder_id is required", env_name=runtime["folder_id_env"])
    client = create_client(ctx_obj)
    folder = client.get_folder(resolved_folder_id)
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Fetched folder {resolved_folder_id}.",
        "folder": folder,
        "scope_preview": _scope_preview("folder.get", "folder", {"folder_id": resolved_folder_id}),
    }


def folder_create_result(ctx_obj: dict[str, Any], *, name: str | None, parent_folder_id: str | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved_name = name or runtime["folder_name"]
    resolved_name = _require_arg(resolved_name, code="CANVA_FOLDER_NAME_REQUIRED", message="folder name is required", env_name=runtime["folder_name_env"])
    client = create_client(ctx_obj)
    folder = client.create_folder(name=resolved_name, parent_folder_id=parent_folder_id or runtime["folder_id"] or "root")
    return {
        "status": "live_write",
        "backend": BACKEND_NAME,
        "summary": f"Created folder {resolved_name}.",
        "folder": folder,
        "scope_preview": _scope_preview("folder.create", "folder", {"name": resolved_name}),
    }


def export_start_result(ctx_obj: dict[str, Any], *, design_id: str | None, export_format: str | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved_design_id = _require_arg(design_id or runtime["design_id"], code="CANVA_DESIGN_ID_REQUIRED", message="design_id is required", env_name=runtime["design_id_env"])
    resolved_format = export_format or runtime["export_format"] or "png"
    client = create_client(ctx_obj)
    job = client.create_export_job(design_id=resolved_design_id, export_format=resolved_format)
    return {
        "status": "live_write",
        "backend": BACKEND_NAME,
        "summary": f"Started export job for design {resolved_design_id}.",
        "job": job,
        "scope_preview": _scope_preview("export.start", "export", {"design_id": resolved_design_id, "format": resolved_format}),
    }


def export_status_result(ctx_obj: dict[str, Any], *, export_job_id: str | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved_job_id = _require_arg(export_job_id or runtime["export_job_id"], code="CANVA_EXPORT_JOB_ID_REQUIRED", message="export_job_id is required", env_name=runtime["export_job_id_env"])
    client = create_client(ctx_obj)
    job = client.get_export_job(resolved_job_id)
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Fetched export job {resolved_job_id}.",
        "job": job,
        "scope_preview": _scope_preview("export.status", "export", {"export_job_id": resolved_job_id}),
    }


def export_download_result(ctx_obj: dict[str, Any], *, export_job_id: str | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved_job_id = _require_arg(export_job_id or runtime["export_job_id"], code="CANVA_EXPORT_JOB_ID_REQUIRED", message="export_job_id is required", env_name=runtime["export_job_id_env"])
    client = create_client(ctx_obj)
    job = client.get_export_job(resolved_job_id)
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Fetched export downloads for job {resolved_job_id}.",
        "job": job,
        "downloads": job.get("job", {}).get("urls") or job.get("urls") or [],
        "scope_preview": _scope_preview("export.download", "export", {"export_job_id": resolved_job_id}),
    }


def autofill_create_result(ctx_obj: dict[str, Any], *, brand_template_id: str | None, autofill_data: str | None, title: str | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved_brand_template_id = _require_arg(brand_template_id or runtime["brand_template_id"], code="CANVA_BRAND_TEMPLATE_ID_REQUIRED", message="brand_template_id is required", env_name=runtime["brand_template_id_env"])
    data = _parse_json_payload(autofill_data or runtime["autofill_data"], env_name=runtime["autofill_data_env"], code="CANVA_AUTOFILL_DATA_INVALID", message="autofill_data must be valid JSON")
    client = create_client(ctx_obj)
    job = client.create_design_autofill_job(brand_template_id=resolved_brand_template_id, data=data, title=title or runtime["title"])
    return {
        "status": "live_write",
        "backend": BACKEND_NAME,
        "summary": f"Created autofill job for brand template {resolved_brand_template_id}.",
        "job": job,
        "scope_preview": _scope_preview("autofill.create", "brand_template", {"brand_template_id": resolved_brand_template_id}),
    }
