from __future__ import annotations

import json
from typing import Any

from .client import PineconeApiError, PineconeClient
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


def _parse_json_text(value: str | None, *, code: str, message: str) -> Any:
    if value is None or value == "":
        return None
    try:
        return json.loads(value)
    except json.JSONDecodeError as err:
        raise CliError(code=code, message=message, exit_code=4, details={"error": str(err)}) from err


def _require_index_name(runtime: dict[str, Any], index_name: str | None) -> str:
    resolved = (index_name or runtime["index_name"] or "").strip()
    if resolved:
        return resolved
    raise CliError(
        code="PINECONE_INDEX_NAME_REQUIRED",
        message="An index name is required for this command",
        exit_code=4,
        details={"missing_keys": [runtime["index_name_env"]]},
    )


def _require_vector_id(runtime: dict[str, Any], vector_id: str | None) -> str:
    resolved = (vector_id or runtime["vector_id"] or "").strip()
    if resolved:
        return resolved
    raise CliError(
        code="PINECONE_VECTOR_ID_REQUIRED",
        message="A vector ID is required for this command",
        exit_code=4,
        details={"missing_keys": [runtime["vector_id_env"]]},
    )


def capabilities_snapshot() -> dict[str, Any]:
    manifest = _load_manifest()
    read_support = {}
    write_support = {}
    for command in manifest["commands"]:
        command_id = command["id"]
        if command["required_mode"] == "readonly":
            read_support[command_id] = True
        else:
            write_support[command_id] = True
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


def create_client(ctx_obj: dict[str, Any]) -> PineconeClient:
    runtime = resolve_runtime_values(ctx_obj)
    if not runtime["api_key_present"]:
        raise CliError(
            code="PINECONE_SETUP_REQUIRED",
            message="Pinecone connector is missing required credentials",
            exit_code=4,
            details={"missing_keys": [runtime["api_key_env"]]},
        )
    return PineconeClient(
        api_key=runtime["api_key"],
        base_url=runtime["base_url"],
        api_version=runtime["api_version"],
        index_host=runtime["index_host"] or None,
        default_namespace=runtime["namespace"] or None,
    )


def probe_runtime(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    if not runtime["api_key_present"]:
        return {
            "ok": False,
            "code": "PINECONE_SETUP_REQUIRED",
            "message": "Pinecone connector is missing required credentials",
            "details": {
                "missing_keys": [runtime["api_key_env"]],
                "live_backend_available": False,
            },
        }
    try:
        client = create_client(ctx_obj)
        indexes = client.list_indexes(limit=1)
    except CliError as err:
        return {"ok": False, "code": err.code, "message": err.message, "details": err.details}
    except PineconeApiError as err:
        code = "PINECONE_AUTH_FAILED" if err.status_code in {401, 403} else "PINECONE_API_ERROR"
        return {
            "ok": False,
            "code": code,
            "message": err.message,
            "details": {**(err.details or {}), "status_code": err.status_code, "live_backend_available": False},
        }
    return {
        "ok": True,
        "code": "OK",
        "message": "Pinecone live runtime is ready",
        "details": {
            "live_backend_available": True,
            "index_count": indexes["count"],
            "sample_indexes": [item.get("name") for item in indexes["indexes"][:3] if isinstance(item, dict)],
        },
    }


def health_snapshot(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    probe = probe_runtime(ctx_obj)
    status = "ready" if probe["ok"] else ("needs_setup" if probe["code"] == "PINECONE_SETUP_REQUIRED" else "degraded")
    return {
        "status": status,
        "summary": probe["message"],
        "connector": {
            "backend": BACKEND_NAME,
            "live_backend_available": bool(probe.get("ok")),
            "live_read_available": bool(probe.get("ok")),
            "write_bridge_available": bool(probe.get("ok")),
            "scaffold_only": True,
        },
        "auth": {
            "api_key_env": runtime["api_key_env"],
            "api_key_present": runtime["api_key_present"],
        },
        "scope": {
            "base_url": runtime["base_url"],
            "api_version": runtime["api_version"],
            "default_index_name": runtime["index_name"] or None,
            "default_index_host": runtime["index_host"] or None,
            "default_namespace": runtime["namespace"] or None,
        },
        "checks": [
            {
                "name": "required_env",
                "ok": runtime["api_key_present"],
                "details": {"missing_keys": [] if runtime["api_key_present"] else [runtime["api_key_env"]]},
            },
            {"name": "live_backend", "ok": bool(probe.get("ok")), "details": probe.get("details", {})},
        ],
        "runtime_ready": bool(probe.get("ok")),
        "live_backend_available": bool(probe.get("ok")),
        "live_read_available": bool(probe.get("ok")),
        "write_bridge_available": bool(probe.get("ok")),
        "scaffold_only": True,
        "probe": probe,
        "next_steps": [
            f"Set {runtime['api_key_env']} in API Keys.",
            f"Optionally set {runtime['index_name_env']} and {runtime['index_host_env']} for stable data-plane routing.",
            "Use index.list to confirm the API key can reach the control plane.",
        ],
    }


def doctor_snapshot(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    probe = probe_runtime(ctx_obj)
    ready = bool(probe.get("ok"))
    return {
        "status": "ready" if ready else ("needs_setup" if probe.get("code") == "PINECONE_SETUP_REQUIRED" else "degraded"),
        "summary": "Pinecone connector diagnostics.",
        "runtime": {
            "implementation_mode": "live_read_write",
            "command_readiness": {
                "index.list": ready,
                "index.create": ready,
                "index.describe": ready,
                "index.delete": ready,
                "vector.upsert": ready,
                "vector.query": ready,
                "vector.fetch": ready,
                "vector.delete": ready,
                "namespace.list": ready,
            },
            "index_name_present": runtime["index_name_present"],
            "index_host_present": runtime["index_host_present"],
            "namespace_present": runtime["namespace_present"],
            "vector_id_present": runtime["vector_id_present"],
        },
        "checks": [
            {
                "name": "required_env",
                "ok": runtime["api_key_present"],
                "details": {"missing_keys": [] if runtime["api_key_present"] else [runtime["api_key_env"]]},
            },
            {"name": "live_backend", "ok": bool(probe.get("ok")), "details": probe.get("details", {})},
        ],
        "probe": probe,
    }


def index_list_result(ctx_obj: dict[str, Any], *, limit: int | None = None) -> dict[str, Any]:
    client = create_client(ctx_obj)
    runtime = resolve_runtime_values(ctx_obj)
    result = client.list_indexes(limit=limit or runtime["index_limit"] or 50)
    return {
        "status": "live_read",
        "summary": "Listed Pinecone indexes.",
        "indexes": result["indexes"],
        "count": result["count"],
        "scope_preview": _scope_preview("index.list", "index", {"limit": limit or runtime["index_limit"] or 50}),
    }


def index_create_result(
    ctx_obj: dict[str, Any],
    *,
    index_name: str | None = None,
    dimension: int | None = None,
    metric: str | None = None,
    cloud: str | None = None,
    region: str | None = None,
) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    name = _require_index_name(runtime, index_name)
    resolved_dimension = dimension or runtime["dimension"]
    if resolved_dimension is None:
        raise CliError(
            code="PINECONE_DIMENSION_REQUIRED",
            message="Index dimension is required",
            exit_code=4,
            details={"missing_keys": [runtime["dimension_env"]]},
        )
    client = create_client(ctx_obj)
    result = client.create_index(
        index_name=name,
        dimension=resolved_dimension,
        metric=(metric or runtime["metric"] or "cosine"),
        cloud=(cloud or runtime["cloud"] or "aws"),
        region=(region or runtime["region"] or "us-east-1"),
    )
    return {
        "status": "live_write",
        "summary": f"Created Pinecone index {name}.",
        "index": result["index"],
        "scope_preview": _scope_preview("index.create", "index", {"index_name": name}),
    }


def index_describe_result(ctx_obj: dict[str, Any], *, index_name: str | None = None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    name = _require_index_name(runtime, index_name)
    client = create_client(ctx_obj)
    result = client.describe_index(name)
    return {
        "status": "live_read",
        "summary": f"Described Pinecone index {name}.",
        "index": result,
        "scope_preview": _scope_preview("index.describe", "index", {"index_name": name}),
    }


def index_delete_result(ctx_obj: dict[str, Any], *, index_name: str | None = None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    name = _require_index_name(runtime, index_name)
    client = create_client(ctx_obj)
    result = client.delete_index(name)
    return {
        "status": "live_write",
        "summary": f"Deleted Pinecone index {name}.",
        "delete_result": result,
        "scope_preview": _scope_preview("index.delete", "index", {"index_name": name}),
    }


def vector_upsert_result(
    ctx_obj: dict[str, Any],
    *,
    index_name: str | None = None,
    namespace: str | None = None,
    vector_id: str | None = None,
    values_json: str | None = None,
    metadata_json: str | None = None,
) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    name = _require_index_name(runtime, index_name)
    resolved_vector_id = _require_vector_id(runtime, vector_id)
    values = _parse_json_text(
        values_json,
        code="PINECONE_VALUES_JSON_INVALID",
        message="values_json must be valid JSON",
    )
    if not isinstance(values, list):
        raise CliError(
            code="PINECONE_VALUES_JSON_INVALID",
            message="values_json must decode to a JSON array",
            exit_code=4,
            details={"type": type(values).__name__},
        )
    metadata = _parse_json_text(
        metadata_json,
        code="PINECONE_METADATA_JSON_INVALID",
        message="metadata_json must be valid JSON",
    )
    if metadata is not None and not isinstance(metadata, dict):
        raise CliError(
            code="PINECONE_METADATA_JSON_INVALID",
            message="metadata_json must decode to a JSON object",
            exit_code=4,
            details={"type": type(metadata).__name__},
        )
    client = create_client(ctx_obj)
    result = client.upsert_vectors(
        index_name=name,
        namespace=namespace or runtime["namespace"] or None,
        vectors=[{"id": resolved_vector_id, "values": values, "metadata": metadata or {}}],
    )
    return {
        "status": "live_write",
        "summary": f"Upserted vector {resolved_vector_id} into {name}.",
        "upsert": result,
        "scope_preview": _scope_preview("vector.upsert", "vector", {"index_name": name, "vector_id": resolved_vector_id}),
    }


def vector_query_result(
    ctx_obj: dict[str, Any],
    *,
    index_name: str | None = None,
    namespace: str | None = None,
    query_vector_json: str | None = None,
    top_k: int | None = None,
    filter_json: str | None = None,
) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    name = _require_index_name(runtime, index_name)
    vector = _parse_json_text(
        query_vector_json,
        code="PINECONE_QUERY_VECTOR_INVALID",
        message="query_vector_json must be valid JSON",
    )
    if not isinstance(vector, list):
        raise CliError(
            code="PINECONE_QUERY_VECTOR_INVALID",
            message="query_vector_json must decode to a JSON array",
            exit_code=4,
            details={"type": type(vector).__name__},
        )
    filter_value = _parse_json_text(
        filter_json,
        code="PINECONE_FILTER_JSON_INVALID",
        message="filter_json must be valid JSON",
    )
    if filter_value is not None and not isinstance(filter_value, dict):
        raise CliError(
            code="PINECONE_FILTER_JSON_INVALID",
            message="filter_json must decode to a JSON object",
            exit_code=4,
            details={"type": type(filter_value).__name__},
        )
    client = create_client(ctx_obj)
    result = client.query_vectors(
        index_name=name,
        namespace=namespace or runtime["namespace"] or None,
        vector=vector,
        top_k=top_k or runtime["top_k"] or 10,
        filter=filter_value,
    )
    return {
        "status": "live_read",
        "summary": f"Queried Pinecone index {name}.",
        "query": result,
        "scope_preview": _scope_preview("vector.query", "vector", {"index_name": name, "top_k": top_k or runtime["top_k"] or 10}),
    }


def vector_fetch_result(
    ctx_obj: dict[str, Any],
    *,
    index_name: str | None = None,
    namespace: str | None = None,
    vector_id: str | None = None,
) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    name = _require_index_name(runtime, index_name)
    resolved_vector_id = _require_vector_id(runtime, vector_id)
    client = create_client(ctx_obj)
    result = client.fetch_vectors(
        index_name=name,
        namespace=namespace or runtime["namespace"] or None,
        ids=[resolved_vector_id],
    )
    return {
        "status": "live_read",
        "summary": f"Fetched vector {resolved_vector_id} from {name}.",
        "fetch": result,
        "scope_preview": _scope_preview("vector.fetch", "vector", {"index_name": name, "vector_id": resolved_vector_id}),
    }


def vector_delete_result(
    ctx_obj: dict[str, Any],
    *,
    index_name: str | None = None,
    namespace: str | None = None,
    vector_id: str | None = None,
    filter_json: str | None = None,
    delete_all: bool = False,
) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    name = _require_index_name(runtime, index_name)
    ids = [vector_id or runtime["vector_id"]] if (vector_id or runtime["vector_id"]) else None
    filter_value = _parse_json_text(
        filter_json,
        code="PINECONE_FILTER_JSON_INVALID",
        message="filter_json must be valid JSON",
    )
    if filter_value is not None and not isinstance(filter_value, dict):
        raise CliError(
            code="PINECONE_FILTER_JSON_INVALID",
            message="filter_json must decode to a JSON object",
            exit_code=4,
            details={"type": type(filter_value).__name__},
        )
    if not delete_all and ids is None and filter_value is None:
        raise CliError(
            code="PINECONE_VECTOR_DELETE_TARGET_REQUIRED",
            message="vector.delete requires vector_id, filter_json, or --delete-all",
            exit_code=4,
            details={},
        )
    client = create_client(ctx_obj)
    result = client.delete_vectors(
        index_name=name,
        namespace=namespace or runtime["namespace"] or None,
        ids=ids,
        delete_all=delete_all,
        filter=filter_value,
    )
    return {
        "status": "live_write",
        "summary": f"Deleted vectors from {name}.",
        "delete": result,
        "scope_preview": _scope_preview("vector.delete", "vector", {"index_name": name}),
    }


def namespace_list_result(
    ctx_obj: dict[str, Any],
    *,
    index_name: str | None = None,
    prefix: str | None = None,
    limit: int | None = None,
) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    name = _require_index_name(runtime, index_name)
    client = create_client(ctx_obj)
    result = client.list_namespaces(index_name=name, prefix=prefix, limit=limit or runtime["index_limit"] or 50)
    return {
        "status": "live_read",
        "summary": f"Listed namespaces for {name}.",
        "namespaces": result["namespaces"],
        "count": result["count"],
        "scope_preview": _scope_preview("namespace.list", "namespace", {"index_name": name, "limit": limit or runtime["index_limit"] or 50}),
    }
