from __future__ import annotations

import json
from typing import Any

from .client import BlacksmithApiError, BlacksmithClient
from .config import config_snapshot, resolve_runtime_values
from .constants import BACKEND_NAME, CONNECTOR_PATH
from .errors import CliError


def _load_manifest() -> dict[str, Any]:
    return json.loads(CONNECTOR_PATH.read_text())


def _scope_preview(command_id: str, resource: str, extra: dict[str, Any] | None = None) -> dict[str, Any]:
    payload = {"selection_surface": resource, "command_id": command_id, "backend": BACKEND_NAME}
    if extra:
        payload.update(extra)
    return payload


def _picker(items: list[dict[str, Any]], *, kind: str, label_key: str = "label") -> dict[str, Any]:
    return {"kind": kind, "items": items, "count": len(items), "label_key": label_key}


def _require_arg(value: str | None, *, code: str, message: str, detail_key: str, detail_value: str) -> str:
    resolved = (value or "").strip()
    if resolved:
        return resolved
    raise CliError(code=code, message=message, exit_code=4, details={detail_key: detail_value})


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


def create_client(ctx_obj: dict[str, Any]) -> BlacksmithClient:
    runtime = resolve_runtime_values(ctx_obj)
    if not runtime["api_key_present"]:
        raise CliError(
            code="BLACKSMITH_SETUP_REQUIRED",
            message="Blacksmith connector is missing required credentials",
            exit_code=4,
            details={"missing_keys": [runtime["api_key_env"]]},
        )
    return BlacksmithClient(api_key=runtime["api_key"], base_url=runtime["base_url"])


def probe_runtime(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    if not runtime["api_key_present"]:
        return {
            "ok": False,
            "code": "BLACKSMITH_SETUP_REQUIRED",
            "message": "Blacksmith connector is missing required credentials",
            "details": {
                "missing_keys": [runtime["api_key_env"]],
                "live_backend_available": False,
                "live_read_available": True,
                "scaffold_only": True,
            },
        }
    return {
        "ok": True,
        "code": "OK",
        "message": "Blacksmith scaffold-only connector is configured",
        "details": {
            "live_backend_available": False,
            "live_read_available": True,
            "scaffold_only": True,
        },
    }


def health_snapshot(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    probe = probe_runtime(ctx_obj)
    status = "ready" if probe["ok"] else "needs_setup"
    manifest = _load_manifest()
    return {
        "status": status,
        "summary": probe["message"],
        "connector": {
            "backend": BACKEND_NAME,
            "live_backend_available": manifest["scope"]["live_backend_available"],
            "live_read_available": manifest["scope"]["live_read_available"],
            "write_bridge_available": manifest["scope"]["write_bridge_available"],
            "scaffold_only": manifest["scope"]["scaffold_only"],
        },
        "auth": {
            "api_key_env": runtime["api_key_env"],
            "api_key_present": runtime["api_key_present"],
        },
        "scope": {
            "base_url": runtime["base_url"],
            "repo": runtime["repo"] or None,
            "run_id": runtime["run_id"] or None,
            "workflow_name": runtime["workflow_name"] or None,
            "date_range": runtime["date_range"] or None,
        },
        "checks": [
            {
                "name": "required_env",
                "ok": runtime["api_key_present"],
                "details": {"missing_keys": [] if runtime["api_key_present"] else [runtime["api_key_env"]]},
            },
            {"name": "scaffold_only", "ok": True, "details": probe.get("details", {})},
        ],
        "runtime_ready": bool(probe.get("ok")),
        "probe": probe,
        "next_steps": [
            f"Set {runtime['api_key_env']} in API Keys.",
            f"Optionally set {runtime['repo_env']}, {runtime['run_id_env']}, {runtime['workflow_name_env']}, and {runtime['date_range_env']} for defaults.",
            "Use runner.list or build.list to confirm the connector responds.",
        ],
    }


def doctor_snapshot(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    probe = probe_runtime(ctx_obj)
    ready = bool(probe.get("ok"))
    manifest = _load_manifest()
    command_readiness = {command["id"]: ready for command in manifest["commands"]}
    return {
        "status": "ready" if ready else "needs_setup",
        "summary": "Blacksmith connector diagnostics.",
        "runtime": {
            "implementation_mode": "scaffold_only_live_read",
            "command_readiness": command_readiness,
        },
        "checks": [
            {"name": "required_env", "ok": runtime["api_key_present"]},
            {"name": "scaffold_only", "ok": True, "details": probe.get("details", {})},
        ],
        "supported_read_commands": list(command_readiness.keys()),
        "supported_write_commands": [],
    }


def runner_list_result(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    client = create_client(ctx_obj)
    runners = client.list_runners()
    picker_items = [
        {"value": item["id"], "label": item.get("name") or item["id"], "subtitle": item.get("status"), "selected": False}
        for item in runners["runners"]
    ]
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Listed {len(runners['runners'])} runner(s).",
        "runners": runners["runners"],
        "picker": _picker(picker_items, kind="blacksmith_runner"),
        "scope_preview": _scope_preview("runner.list", "runner"),
    }


def runner_status_result(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    client = create_client(ctx_obj)
    status = client.runner_status()
    picker_items = [
        {"value": item["id"], "label": item.get("name") or item["id"], "subtitle": item.get("status"), "selected": False}
        for item in status["runners"]
    ]
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": "Fetched runner status.",
        "runner_status": status,
        "picker": _picker(picker_items, kind="blacksmith_runner"),
        "scope_preview": _scope_preview("runner.status", "runner"),
    }


def build_list_result(ctx_obj: dict[str, Any], *, repo: str | None, workflow_name: str | None, limit: int) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved_repo = repo or runtime["repo"] or None
    resolved_workflow = workflow_name or runtime["workflow_name"] or None
    client = create_client(ctx_obj)
    listing = client.list_builds(repo=resolved_repo, workflow_name=resolved_workflow, limit=limit)
    picker_items = [
        {"value": item["id"], "label": item.get("workflow") or item["id"], "subtitle": item.get("status"), "selected": False}
        for item in listing["builds"]
    ]
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Listed {len(listing['builds'])} build(s).",
        "builds": listing["builds"],
        "picker": _picker(picker_items, kind="blacksmith_build"),
        "scope_preview": _scope_preview("build.list", "build", {"repo": resolved_repo, "workflow_name": resolved_workflow}),
    }


def build_get_result(ctx_obj: dict[str, Any], *, run_id: str | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved_run_id = _require_arg(run_id or runtime["run_id"], code="BLACKSMITH_RUN_ID_REQUIRED", message="run_id is required", detail_key="env", detail_value=runtime["run_id_env"])
    client = create_client(ctx_obj)
    build = client.get_build(run_id=resolved_run_id)
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Fetched build {resolved_run_id}.",
        "build": build["build"],
        "scope_preview": _scope_preview("build.get", "build", {"run_id": resolved_run_id}),
    }


def build_logs_result(ctx_obj: dict[str, Any], *, run_id: str | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved_run_id = _require_arg(run_id or runtime["run_id"], code="BLACKSMITH_RUN_ID_REQUIRED", message="run_id is required", detail_key="env", detail_value=runtime["run_id_env"])
    client = create_client(ctx_obj)
    logs = client.get_build_logs(run_id=resolved_run_id)
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Fetched logs for build {resolved_run_id}.",
        "run_id": resolved_run_id,
        "logs": logs,
        "scope_preview": _scope_preview("build.logs", "build", {"run_id": resolved_run_id}),
    }


def cache_list_result(ctx_obj: dict[str, Any], *, repo: str | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved_repo = repo or runtime["repo"] or None
    client = create_client(ctx_obj)
    listing = client.list_cache(repo=resolved_repo)
    picker_items = [
        {"value": item["id"], "label": item.get("name") or item["id"], "subtitle": item.get("status"), "selected": False}
        for item in listing["entries"]
    ]
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Listed {len(listing['entries'])} cache entry(ies).",
        "cache": listing["entries"],
        "picker": _picker(picker_items, kind="blacksmith_cache"),
        "scope_preview": _scope_preview("cache.list", "cache", {"repo": resolved_repo}),
    }


def cache_stats_result(ctx_obj: dict[str, Any], *, repo: str | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved_repo = repo or runtime["repo"] or None
    client = create_client(ctx_obj)
    stats = client.cache_stats(repo=resolved_repo)
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": "Fetched cache stats.",
        "stats": stats["stats"],
        "scope_preview": _scope_preview("cache.stats", "cache", {"repo": resolved_repo}),
    }


def usage_summary_result(ctx_obj: dict[str, Any], *, date_range: str | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved_range = date_range or runtime["date_range"] or None
    client = create_client(ctx_obj)
    summary = client.usage_summary(date_range=resolved_range)
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": "Fetched usage summary.",
        "usage_summary": summary["summary"],
        "scope_preview": _scope_preview("usage.summary", "usage", {"date_range": resolved_range}),
    }


def usage_billing_result(ctx_obj: dict[str, Any], *, date_range: str | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved_range = date_range or runtime["date_range"] or None
    client = create_client(ctx_obj)
    billing = client.usage_billing(date_range=resolved_range)
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": "Fetched billing details.",
        "billing": billing["billing"],
        "scope_preview": _scope_preview("usage.billing", "usage", {"date_range": resolved_range}),
    }


def config_show_result(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    probe = probe_runtime(ctx_obj)
    return config_snapshot(ctx_obj, probe=probe)
