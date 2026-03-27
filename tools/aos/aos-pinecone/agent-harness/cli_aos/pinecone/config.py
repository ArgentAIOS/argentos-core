from __future__ import annotations

import os
from typing import Any

from .constants import (
    BACKEND_NAME,
    DEFAULT_API_VERSION,
    DEFAULT_CONTROL_BASE_URL,
    PINECONE_API_BASE_URL_ENV,
    PINECONE_API_KEY_ENV,
    PINECONE_API_VERSION_ENV,
    PINECONE_CLOUD_ENV,
    PINECONE_INDEX_DIMENSION_ENV,
    PINECONE_INDEX_HOST_ENV,
    PINECONE_INDEX_LIMIT_ENV,
    PINECONE_INDEX_NAME_ENV,
    PINECONE_METRIC_ENV,
    PINECONE_NAMESPACE_ENV,
    PINECONE_REGION_ENV,
    PINECONE_TOP_K_ENV,
    PINECONE_VECTOR_ID_ENV,
)


def _mask(value: str | None) -> str | None:
    if not value:
        return None
    if len(value) <= 8:
        return "*" * len(value)
    return f"{value[:4]}***{value[-4:]}"


def _int_or_none(value: str | None) -> int | None:
    try:
        return int(value) if value not in (None, "") else None
    except ValueError:
        return None


def resolve_runtime_values(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    api_key_env = ctx_obj.get("api_key_env") or PINECONE_API_KEY_ENV
    base_url_env = ctx_obj.get("base_url_env") or PINECONE_API_BASE_URL_ENV
    api_version_env = ctx_obj.get("api_version_env") or PINECONE_API_VERSION_ENV
    index_name_env = ctx_obj.get("index_name_env") or PINECONE_INDEX_NAME_ENV
    index_host_env = ctx_obj.get("index_host_env") or PINECONE_INDEX_HOST_ENV
    namespace_env = ctx_obj.get("namespace_env") or PINECONE_NAMESPACE_ENV
    vector_id_env = ctx_obj.get("vector_id_env") or PINECONE_VECTOR_ID_ENV
    dimension_env = ctx_obj.get("dimension_env") or PINECONE_INDEX_DIMENSION_ENV
    metric_env = ctx_obj.get("metric_env") or PINECONE_METRIC_ENV
    cloud_env = ctx_obj.get("cloud_env") or PINECONE_CLOUD_ENV
    region_env = ctx_obj.get("region_env") or PINECONE_REGION_ENV
    index_limit_env = ctx_obj.get("index_limit_env") or PINECONE_INDEX_LIMIT_ENV
    top_k_env = ctx_obj.get("top_k_env") or PINECONE_TOP_K_ENV

    api_key = (os.getenv(api_key_env) or "").strip()
    base_url = (os.getenv(base_url_env) or DEFAULT_CONTROL_BASE_URL).strip().rstrip("/")
    api_version = (os.getenv(api_version_env) or DEFAULT_API_VERSION).strip()
    index_name = (ctx_obj.get("index_name") or os.getenv(index_name_env) or "").strip()
    index_host = (ctx_obj.get("index_host") or os.getenv(index_host_env) or "").strip()
    namespace = (ctx_obj.get("namespace") or os.getenv(namespace_env) or "").strip()
    vector_id = (ctx_obj.get("vector_id") or os.getenv(vector_id_env) or "").strip()
    metric = (ctx_obj.get("metric") or os.getenv(metric_env) or "cosine").strip()
    cloud = (ctx_obj.get("cloud") or os.getenv(cloud_env) or "").strip()
    region = (ctx_obj.get("region") or os.getenv(region_env) or "").strip()
    dimension = _int_or_none(str(ctx_obj.get("dimension") or os.getenv(dimension_env) or "").strip())
    index_limit = _int_or_none(str(ctx_obj.get("index_limit") or os.getenv(index_limit_env) or "").strip())
    top_k = _int_or_none(str(ctx_obj.get("top_k") or os.getenv(top_k_env) or "").strip())

    return {
        "backend": BACKEND_NAME,
        "api_key_env": api_key_env,
        "base_url_env": base_url_env,
        "api_version_env": api_version_env,
        "index_name_env": index_name_env,
        "index_host_env": index_host_env,
        "namespace_env": namespace_env,
        "vector_id_env": vector_id_env,
        "dimension_env": dimension_env,
        "metric_env": metric_env,
        "cloud_env": cloud_env,
        "region_env": region_env,
        "index_limit_env": index_limit_env,
        "top_k_env": top_k_env,
        "api_key": api_key,
        "base_url": base_url,
        "api_version": api_version,
        "index_name": index_name,
        "index_host": index_host,
        "namespace": namespace,
        "vector_id": vector_id,
        "dimension": dimension,
        "metric": metric,
        "cloud": cloud,
        "region": region,
        "index_limit": index_limit,
        "top_k": top_k,
        "api_key_present": bool(api_key),
        "index_name_present": bool(index_name),
        "index_host_present": bool(index_host),
        "namespace_present": bool(namespace),
        "vector_id_present": bool(vector_id),
        "runtime_ready": bool(api_key),
    }


def config_snapshot(ctx_obj: dict[str, Any], *, probe: dict[str, Any] | None = None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    return {
        "backend": BACKEND_NAME,
        "auth": {
            "api_key_env": runtime["api_key_env"],
            "api_key_present": runtime["api_key_present"],
            "api_key_masked": _mask(runtime["api_key"]),
        },
        "scope": {
            "base_url": runtime["base_url"],
            "api_version": runtime["api_version"],
            "default_index_name": runtime["index_name"] or None,
            "default_index_host": runtime["index_host"] or None,
            "default_namespace": runtime["namespace"] or None,
            "default_vector_id": runtime["vector_id"] or None,
            "default_dimension": runtime["dimension"],
            "default_metric": runtime["metric"] or None,
            "default_cloud": runtime["cloud"] or None,
            "default_region": runtime["region"] or None,
        },
        "runtime": {
            "implementation_mode": "live_read_write",
            "runtime_ready": bool(probe["ok"]) if probe else runtime["runtime_ready"],
            "index_limit": runtime["index_limit"],
            "top_k": runtime["top_k"],
        },
        "probe": probe,
    }
