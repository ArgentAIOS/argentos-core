from __future__ import annotations

import json
from typing import Any

from .client import NeonApiError, NeonClient
from .config import resolve_runtime_values
from .constants import BACKEND_NAME, CONNECTOR_PATH
from .errors import CliError


def _load_manifest() -> dict[str, Any]:
    return json.loads(CONNECTOR_PATH.read_text())


def capabilities_snapshot() -> dict[str, Any]:
    manifest = _load_manifest()
    return {
        "tool": manifest["tool"],
        "backend": manifest["backend"],
        "manifest_schema_version": manifest.get("manifest_schema_version", "1.0.0"),
        "connector": manifest["connector"],
        "auth": manifest["auth"],
        "scope": manifest.get("scope", {}),
        "commands": manifest["commands"],
        "read_support": {
            "project.info": True,
            "sql.query": True,
            "branch.list": True,
        },
        "write_support": {
            "sql.execute": True,
            "branch.create": True,
            "branch.delete": True,
        },
    }


def create_client(ctx_obj: dict[str, Any]) -> NeonClient:
    runtime = resolve_runtime_values(ctx_obj)
    if not runtime["conn_present"]:
        raise CliError(
            code="NEON_SETUP_REQUIRED",
            message="Neon connector is missing the connection string",
            exit_code=4,
            details={"missing_keys": [runtime["conn_env"]]},
        )
    return NeonClient(
        api_key=runtime["api_key"],
        connection_string=runtime["connection_string"],
        project_id=runtime["project_id"] or None,
    )


def probe_runtime(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    if not runtime["conn_present"]:
        return {
            "ok": False,
            "code": "NEON_SETUP_REQUIRED",
            "message": "Neon connector is missing the connection string",
            "details": {"missing_keys": [runtime["conn_env"]], "live_backend_available": False},
        }
    try:
        client = create_client(ctx_obj)
        probe_result = client.probe()
    except CliError as err:
        return {"ok": False, "code": err.code, "message": err.message, "details": err.details}
    except NeonApiError as err:
        code = "NEON_AUTH_FAILED" if err.status_code in {401, 403} else "NEON_API_ERROR"
        return {
            "ok": False,
            "code": code,
            "message": err.message,
            "details": {
                **(err.details or {}),
                "status_code": err.status_code,
                "live_backend_available": False,
            },
        }
    return {
        "ok": True,
        "code": "OK",
        "message": "Neon live runtime is ready",
        "details": {
            "live_backend_available": True,
            "probe": probe_result,
        },
    }


def health_snapshot(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    probe = probe_runtime(ctx_obj)
    status = "ready" if probe["ok"] else ("needs_setup" if probe["code"] == "NEON_SETUP_REQUIRED" else "degraded")
    return {
        "status": status,
        "summary": probe["message"],
        "connector": {
            "backend": BACKEND_NAME,
            "live_backend_available": bool(probe.get("ok")),
            "live_read_available": bool(probe.get("ok")),
            "write_bridge_available": bool(probe.get("ok")),
            "scaffold_only": False,
        },
        "auth": {
            "api_key_env": runtime["api_key_env"],
            "api_key_present": runtime["api_key_present"],
            "conn_env": runtime["conn_env"],
            "conn_present": runtime["conn_present"],
            "project_id_env": runtime["project_id_env"],
            "project_id_present": runtime["project_id_present"],
        },
        "scope": {
            "branch": runtime["branch"] or None,
            "project_id": runtime["project_id"] or None,
        },
        "checks": [
            {
                "name": "required_env",
                "ok": runtime["conn_present"],
                "details": {
                    "missing_keys": [
                        k for k, present in [
                            (runtime["conn_env"], runtime["conn_present"]),
                        ] if not present
                    ],
                },
            },
            {"name": "live_backend", "ok": bool(probe.get("ok")), "details": probe.get("details", {})},
            {
                "name": "branch_management",
                "ok": runtime["api_key_present"] and runtime["project_id_present"],
                "details": {
                    "missing_keys": [
                        k for k, present in [
                            (runtime["api_key_env"], runtime["api_key_present"]),
                            (runtime["project_id_env"], runtime["project_id_present"]),
                        ] if not present
                    ],
                },
            },
        ],
        "runtime_ready": bool(probe.get("ok")),
        "live_backend_available": bool(probe.get("ok")),
        "live_read_available": bool(probe.get("ok")),
        "write_bridge_available": bool(probe.get("ok")),
        "scaffold_only": False,
        "probe": probe,
        "next_steps": [
            f"Set {runtime['conn_env']} with a Neon connection string.",
            f"Set {runtime['api_key_env']} and {runtime['project_id_env']} for branch management.",
            "Optionally set NEON_BRANCH to scope SQL operations to a specific branch.",
        ],
    }


def doctor_snapshot(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    probe = probe_runtime(ctx_obj)
    sql_ok = bool(probe.get("ok"))
    branch_ok = runtime["api_key_present"] and runtime["project_id_present"]
    return {
        "status": "ready" if sql_ok else ("needs_setup" if probe.get("code") == "NEON_SETUP_REQUIRED" else "degraded"),
        "summary": "Neon connector diagnostics.",
        "runtime": {
            "implementation_mode": "live_read_write",
            "command_readiness": {
                "project.info": branch_ok,
                "sql.query": sql_ok,
                "sql.execute": sql_ok,
                "branch.list": branch_ok,
                "branch.create": branch_ok,
                "branch.delete": branch_ok,
            },
            "branch_present": runtime["branch_present"],
            "project_id_present": runtime["project_id_present"],
        },
        "checks": [
            {"name": "required_env", "ok": runtime["conn_present"]},
            {"name": "live_backend", "ok": sql_ok, "details": probe.get("details", {})},
            {"name": "branch_management", "ok": branch_ok},
        ],
        "supported_read_commands": ["project.info", "sql.query", "branch.list"],
        "supported_write_commands": ["sql.execute", "branch.create", "branch.delete"],
        "next_steps": [
            f"Set {runtime['conn_env']} with a Neon connection string.",
            "Use sql.query to run read-only queries before enabling sql.execute.",
            "Use branch.list to explore available branches.",
        ],
    }


def _require_arg(value: str | None, *, code: str, message: str, detail_key: str, detail_value: str) -> str:
    resolved = (value or "").strip()
    if resolved:
        return resolved
    raise CliError(code=code, message=message, exit_code=4, details={detail_key: detail_value})


def project_info_result(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    if not runtime["api_key_present"] or not runtime["project_id_present"]:
        raise CliError(
            code="NEON_PROJECT_REQUIRED",
            message="NEON_API_KEY and NEON_PROJECT_ID are required for project info",
            exit_code=4,
            details={"api_key_env": runtime["api_key_env"], "project_id_env": runtime["project_id_env"]},
        )
    client = create_client(ctx_obj)
    info = client.project_info()
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Neon project {runtime['project_id']}.",
        "project": info,
        "scope_preview": {
            "selection_surface": "project",
            "command_id": "project.info",
            "project_id": runtime["project_id"],
        },
    }


def sql_query_result(ctx_obj: dict[str, Any], *, query: str) -> dict[str, Any]:
    client = create_client(ctx_obj)
    result = client.sql_query(query)
    rows = result.get("rows", []) if isinstance(result, dict) else []
    row_count = len(rows) if isinstance(rows, list) else 0
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Query returned {row_count} row{'s' if row_count != 1 else ''}.",
        "result": result,
        "row_count": row_count,
        "scope_preview": {
            "selection_surface": "sql",
            "command_id": "sql.query",
        },
    }


def sql_execute_result(ctx_obj: dict[str, Any], *, statement: str) -> dict[str, Any]:
    client = create_client(ctx_obj)
    result = client.sql_execute(statement)
    return {
        "status": "live_write",
        "backend": BACKEND_NAME,
        "summary": "SQL statement executed.",
        "result": result,
        "scope_preview": {
            "selection_surface": "sql",
            "command_id": "sql.execute",
        },
    }


def branch_list_result(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    if not runtime["api_key_present"] or not runtime["project_id_present"]:
        raise CliError(
            code="NEON_PROJECT_REQUIRED",
            message="NEON_API_KEY and NEON_PROJECT_ID are required for branch operations",
            exit_code=4,
            details={"api_key_env": runtime["api_key_env"], "project_id_env": runtime["project_id_env"]},
        )
    client = create_client(ctx_obj)
    branches = client.branch_list()
    items = [
        {
            "id": str(b.get("id") or ""),
            "label": str(b.get("name") or b.get("id") or "Branch"),
            "subtitle": b.get("current_state") or None,
            "kind": "branch",
        }
        for b in branches
        if isinstance(b, dict)
    ]
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Found {len(branches)} branch{'es' if len(branches) != 1 else ''}.",
        "branches": branches,
        "branch_count": len(branches),
        "picker": {"kind": "branch", "items": items, "count": len(items), "label_key": "label"},
        "scope_preview": {
            "selection_surface": "branch",
            "command_id": "branch.list",
            "project_id": runtime["project_id"],
        },
    }


def branch_create_result(ctx_obj: dict[str, Any], *, name: str | None, parent_id: str | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    if not runtime["api_key_present"] or not runtime["project_id_present"]:
        raise CliError(
            code="NEON_PROJECT_REQUIRED",
            message="NEON_API_KEY and NEON_PROJECT_ID are required for branch operations",
            exit_code=4,
            details={"api_key_env": runtime["api_key_env"], "project_id_env": runtime["project_id_env"]},
        )
    client = create_client(ctx_obj)
    result = client.branch_create(name=name, parent_id=parent_id)
    return {
        "status": "live_write",
        "backend": BACKEND_NAME,
        "summary": f"Created branch{' ' + name if name else ''}.",
        "branch": result,
        "scope_preview": {
            "selection_surface": "branch",
            "command_id": "branch.create",
            "project_id": runtime["project_id"],
        },
    }


def branch_delete_result(ctx_obj: dict[str, Any], *, branch_id: str) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    if not runtime["api_key_present"] or not runtime["project_id_present"]:
        raise CliError(
            code="NEON_PROJECT_REQUIRED",
            message="NEON_API_KEY and NEON_PROJECT_ID are required for branch operations",
            exit_code=4,
            details={"api_key_env": runtime["api_key_env"], "project_id_env": runtime["project_id_env"]},
        )
    client = create_client(ctx_obj)
    result = client.branch_delete(branch_id)
    return {
        "status": "live_write",
        "backend": BACKEND_NAME,
        "summary": f"Deleted branch {branch_id}.",
        "result": result,
        "scope_preview": {
            "selection_surface": "branch",
            "command_id": "branch.delete",
            "project_id": runtime["project_id"],
        },
    }
