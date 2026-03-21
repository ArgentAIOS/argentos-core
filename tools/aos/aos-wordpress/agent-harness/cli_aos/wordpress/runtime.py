from __future__ import annotations

import base64
import json
import socket
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

from .config import runtime_config
from .constants import RESOURCE_PATHS, TOOL_NAME
from .errors import CliError


def _ensure_resource(resource: str) -> str:
    if resource not in RESOURCE_PATHS:
        raise CliError(
            code="INVALID_USAGE",
            message=f"Unsupported WordPress resource: {resource}",
            exit_code=2,
            details={"resource": resource},
        )
    return RESOURCE_PATHS[resource]


def _require_nonempty(value: str | None, *, field: str) -> str:
    if value is None or not value.strip():
        raise CliError(
            code="INVALID_USAGE",
            message=f"{field} is required",
            exit_code=2,
            details={"field": field},
        )
    return value.strip()


def _request_json(
    method: str,
    path: str,
    *,
    query: dict[str, Any] | None = None,
    payload: dict[str, Any] | None = None,
    config: dict[str, Any] | None = None,
) -> Any:
    runtime = config or runtime_config()
    if not runtime["base_url_present"]:
        raise CliError(
            code="CONFIG_ERROR",
            message="WORDPRESS_BASE_URL is required",
            exit_code=4,
            details={"missing": ["WORDPRESS_BASE_URL"]},
        )

    url = f"{runtime['api_root_url'].rstrip('/')}/{path.lstrip('/')}"
    if query:
        url = f"{url}?{urllib.parse.urlencode(query, doseq=True)}"

    data = None
    headers = {
        "Accept": "application/json",
        "User-Agent": f"{TOOL_NAME}/1.0",
    }
    if runtime["auth_ready"]:
        username, password = _auth_credentials()
        auth_value = base64.b64encode(f"{username}:{password}".encode("utf-8")).decode("ascii")
        headers["Authorization"] = f"Basic {auth_value}"

    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"

    request = urllib.request.Request(url, data=data, headers=headers, method=method)

    try:
        with urllib.request.urlopen(request, timeout=runtime["request_timeout_s"]) as response:
            body = response.read()
    except urllib.error.HTTPError as exc:
        error_payload = _decode_response_body(exc.read())
        details = {
            "status_code": exc.code,
            "url": url,
            "response": error_payload,
        }
        if exc.code in (400, 422):
            raise CliError(
                code="INVALID_USAGE",
                message=_error_message(error_payload, exc.reason),
                exit_code=2,
                details=details,
            ) from exc
        if exc.code in (401, 403):
            raise CliError(
                code="AUTH_ERROR",
                message=_error_message(error_payload, exc.reason),
                exit_code=4,
                details=details,
            ) from exc
        if exc.code == 404:
            raise CliError(
                code="NOT_FOUND",
                message=_error_message(error_payload, exc.reason),
                exit_code=6,
                details=details,
            ) from exc
        if exc.code >= 500:
            raise CliError(
                code="BACKEND_UNAVAILABLE",
                message=_error_message(error_payload, exc.reason),
                exit_code=5,
                details=details,
            ) from exc
        raise CliError(
            code="REQUEST_FAILED",
            message=_error_message(error_payload, exc.reason),
            exit_code=10,
            details=details,
        ) from exc
    except (urllib.error.URLError, TimeoutError, socket.timeout) as exc:
        raise CliError(
            code="BACKEND_UNAVAILABLE",
            message=f"Unable to reach WordPress at {runtime['base_url']}",
            exit_code=5,
            details={
                "url": url,
                "reason": str(exc),
            },
        ) from exc

    if not body:
        return {}
    decoded = _decode_response_body(body)
    if isinstance(decoded, dict):
        return decoded
    return {"value": decoded}


def _decode_response_body(body: bytes) -> Any:
    if not body:
        return {}
    text = body.decode("utf-8", errors="replace")
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return {"response_text": text}


def _error_message(error_payload: Any, fallback: str) -> str:
    if isinstance(error_payload, dict):
        message = error_payload.get("message")
        if isinstance(message, str) and message:
            return message
        code = error_payload.get("code")
        if isinstance(code, str) and code:
            return code
    return str(fallback)


def _auth_credentials() -> tuple[str, str]:
    from .config import runtime_config

    config = runtime_config()
    username = config.get("username_source") and _env_value(config["username_source"])
    password = config.get("application_password_source") and _env_value(config["application_password_source"])
    if not username or not password:
        raise CliError(
            code="CONFIG_ERROR",
            message="WORDPRESS_USERNAME and WORDPRESS_APPLICATION_PASSWORD are required",
            exit_code=4,
            details={
                "missing": [
                    key
                    for key, present in (
                        ("WORDPRESS_USERNAME", bool(username)),
                        ("WORDPRESS_APPLICATION_PASSWORD", bool(password)),
                    )
                    if not present
                ]
            },
        )
    return username, password


def _env_value(name: str) -> str:
    import os

    return os.getenv(name, "")


def _summarize_root(payload: dict[str, Any]) -> dict[str, Any]:
    return {
        "name": payload.get("name"),
        "description": payload.get("description"),
        "url": payload.get("url"),
        "home": payload.get("home"),
        "gmt_offset": payload.get("gmt_offset"),
        "timezone_string": payload.get("timezone_string"),
        "namespaces": payload.get("namespaces", []),
        "routes_count": len(payload.get("routes", {})) if isinstance(payload.get("routes"), dict) else 0,
    }


def _summarize_user(payload: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": payload.get("id"),
        "name": payload.get("name"),
        "slug": payload.get("slug"),
        "roles": payload.get("roles", []),
    }


def _require_auth_ready() -> dict[str, Any]:
    config = runtime_config()
    if not config["auth_ready"]:
        raise CliError(
            code="CONFIG_ERROR",
            message="WordPress live commands require WORDPRESS_BASE_URL, WORDPRESS_USERNAME, and WORDPRESS_APPLICATION_PASSWORD",
            exit_code=4,
            details={
                "missing": [
                    key
                    for key, present in (
                        ("WORDPRESS_BASE_URL", config["base_url_present"]),
                        ("WORDPRESS_USERNAME", config["username_present"]),
                        ("WORDPRESS_APPLICATION_PASSWORD", config["application_password_present"]),
                    )
                    if not present
                ]
            },
        )
    return config


def probe_site(config: dict[str, Any] | None = None) -> dict[str, Any]:
    runtime = config or runtime_config()
    if not runtime["base_url_present"]:
        return {
            "ok": False,
            "code": "SKIPPED",
            "message": "WordPress base URL is not configured",
            "details": {"skipped": True},
        }
    try:
        root = _request_json("GET", "/", config=runtime)
    except CliError as exc:
        return {
            "ok": False,
            "code": exc.code,
            "message": exc.message,
            "details": exc.details,
        }
    if not isinstance(root, dict):
        root = {}
    return {
        "ok": True,
        "code": "OK",
        "message": "WordPress REST root reachable",
        "details": _summarize_root(root),
    }


def probe_api(config: dict[str, Any] | None = None) -> dict[str, Any]:
    runtime = config or runtime_config()
    if not runtime["auth_ready"]:
        return {
            "ok": False,
            "code": "SKIPPED",
            "message": "WordPress auth probe skipped until base URL, username, and application password are configured",
            "details": {
                "skipped": True,
                "auth_ready": False,
            },
        }
    try:
        user = _request_json("GET", "/wp/v2/users/me", config=runtime)
    except CliError as exc:
        return {
            "ok": False,
            "code": exc.code,
            "message": exc.message,
            "details": exc.details,
        }
    if not isinstance(user, dict):
        user = {}
    return {
        "ok": True,
        "code": "OK",
        "message": "WordPress authenticated request succeeded",
        "details": _summarize_user(user),
    }


def read_site() -> dict[str, Any]:
    runtime = _require_auth_ready()
    root = _request_json("GET", "/", config=runtime)
    user = _request_json("GET", "/wp/v2/users/me", config=runtime)
    return {
        "status": "ok",
        "resource": "site",
        "operation": "read",
        "site": _summarize_root(root if isinstance(root, dict) else {}),
        "current_user": _summarize_user(user if isinstance(user, dict) else {}),
    }


def list_content(
    resource: str,
    *,
    per_page: int = 10,
    page: int = 1,
    search: str | None = None,
    statuses: list[str] | None = None,
    orderby: str = "date",
    order: str = "desc",
) -> dict[str, Any]:
    runtime = _require_auth_ready()
    resource_path = _ensure_resource(resource)
    query: dict[str, Any] = {
        "per_page": per_page,
        "page": page,
        "orderby": orderby,
        "order": order,
        "context": "view",
    }
    if search:
        query["search"] = search
    if statuses:
        query["status"] = ",".join(statuses)
    payload = _request_json("GET", f"/wp/v2/{resource_path}", query=query, config=runtime)
    results = payload if isinstance(payload, list) else payload.get("results", []) if isinstance(payload, dict) else []
    return {
        "status": "ok",
        "resource": resource,
        "operation": "list",
        "query": {
            "per_page": per_page,
            "page": page,
            "search": search,
            "statuses": statuses or [],
            "orderby": orderby,
            "order": order,
        },
        "count": len(results),
        "results": results,
        "raw": payload,
    }


def search_content(
    resource: str,
    *,
    query_text: str,
    per_page: int = 10,
    page: int = 1,
    statuses: list[str] | None = None,
    orderby: str = "date",
    order: str = "desc",
) -> dict[str, Any]:
    if not query_text:
        raise CliError(
            code="INVALID_USAGE",
            message="A non-empty query is required",
            exit_code=2,
            details={"field": "query_text"},
        )
    return list_content(
        resource,
        per_page=per_page,
        page=page,
        search=query_text,
        statuses=statuses,
        orderby=orderby,
        order=order,
    )


def read_content(
    resource: str,
    *,
    object_id: str,
) -> dict[str, Any]:
    runtime = _require_auth_ready()
    resource_path = _ensure_resource(resource)
    object_id = _require_nonempty(object_id, field=f"{resource}.id")
    payload = _request_json("GET", f"/wp/v2/{resource_path}/{object_id}", query={"context": "edit"}, config=runtime)
    return {
        "status": "ok",
        "resource": resource,
        "operation": "read",
        "id": object_id,
        "result": payload,
    }


def create_draft_post(
    *,
    title: str,
    content: str | None = None,
    excerpt: str | None = None,
    slug: str | None = None,
    status: str = "draft",
) -> dict[str, Any]:
    runtime = _require_auth_ready()
    title = _require_nonempty(title, field="title")
    payload = {"title": title, "status": status}
    if content is not None:
        payload["content"] = content
    if excerpt is not None:
        payload["excerpt"] = excerpt
    if slug is not None:
        payload["slug"] = slug
    result = _request_json("POST", "/wp/v2/posts", payload=payload, config=runtime)
    return {
        "status": "ok",
        "resource": "post",
        "operation": "create_draft",
        "result": result,
    }


def update_draft_post(
    *,
    post_id: str,
    title: str | None = None,
    content: str | None = None,
    excerpt: str | None = None,
    slug: str | None = None,
    status: str = "draft",
) -> dict[str, Any]:
    runtime = _require_auth_ready()
    post_id = _require_nonempty(post_id, field="post_id")
    payload: dict[str, Any] = {"status": status}
    if title is not None:
        payload["title"] = title
    if content is not None:
        payload["content"] = content
    if excerpt is not None:
        payload["excerpt"] = excerpt
    if slug is not None:
        payload["slug"] = slug
    if len(payload) == 1:
        raise CliError(
            code="INVALID_USAGE",
            message="At least one field is required to update a draft",
            exit_code=2,
            details={"field_count": 0},
        )
    result = _request_json("POST", f"/wp/v2/posts/{post_id}", payload=payload, config=runtime)
    return {
        "status": "ok",
        "resource": "post",
        "operation": "update_draft",
        "id": post_id,
        "result": result,
    }


def schedule_post(
    *,
    title: str | None,
    content: str | None,
    publish_at: str,
    post_id: str | None = None,
    excerpt: str | None = None,
    slug: str | None = None,
) -> dict[str, Any]:
    runtime = _require_auth_ready()
    publish_at = _require_nonempty(publish_at, field="publish_at")
    payload: dict[str, Any] = {"status": "future", "date": publish_at}
    if post_id is not None:
        post_id = _require_nonempty(post_id, field="post_id")
    if title is not None:
        title = _require_nonempty(title, field="title")
    if title is not None:
        payload["title"] = title
    if content is not None:
        payload["content"] = content
    if excerpt is not None:
        payload["excerpt"] = excerpt
    if slug is not None:
        payload["slug"] = slug
    if post_id:
        result = _request_json("POST", f"/wp/v2/posts/{post_id}", payload=payload, config=runtime)
    else:
        if title is None:
            raise CliError(
                code="INVALID_USAGE",
                message="A title is required when creating a scheduled post",
                exit_code=2,
                details={"field": "title"},
            )
        result = _request_json("POST", "/wp/v2/posts", payload=payload, config=runtime)
    return {
        "status": "ok",
        "resource": "post",
        "operation": "schedule",
        "id": post_id,
        "publish_at": publish_at,
        "result": result,
    }


def publish_post(
    *,
    post_id: str,
) -> dict[str, Any]:
    runtime = _require_auth_ready()
    post_id = _require_nonempty(post_id, field="post_id")
    result = _request_json("POST", f"/wp/v2/posts/{post_id}", payload={"status": "publish"}, config=runtime)
    return {
        "status": "ok",
        "resource": "post",
        "operation": "publish",
        "id": post_id,
        "result": result,
    }
