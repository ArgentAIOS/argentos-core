from __future__ import annotations

import json
from typing import Any
from urllib import error, parse, request

from .config import resolve_runtime_values
from .constants import DEFAULT_PROPERTIES, OBJECT_ENDPOINTS
from .errors import CliError


API_TIMEOUT_SECONDS = 20


def _normalize_after(value: str | int | None) -> str | int | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    return int(text) if text.isdigit() else text


def _clean_dict(values: dict[str, Any]) -> dict[str, Any]:
    cleaned: dict[str, Any] = {}
    for key, value in values.items():
        if value is None:
            continue
        if isinstance(value, str) and not value.strip():
            continue
        cleaned[key] = value
    return cleaned


def _query_with_properties(base: dict[str, Any], properties: list[str] | tuple[str, ...] | None) -> dict[str, Any]:
    selected = [value for value in (properties or []) if value]
    if not selected:
        return _clean_dict(base)
    enriched = dict(base)
    enriched["properties"] = ",".join(selected)
    return _clean_dict(enriched)


def _headers(access_token: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {access_token}",
        "Accept": "application/json",
        "Content-Type": "application/json",
        "User-Agent": "aos-hubspot/0.1.0",
    }


def _request_json(
    ctx_obj: dict[str, Any],
    method: str,
    path: str,
    *,
    query: dict[str, Any] | None = None,
    payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    resolved = resolve_runtime_values(ctx_obj)
    access_token = resolved.get("access_token")
    if not access_token:
        raise CliError(
            code="AUTH_REQUIRED",
            message="HubSpot access token is not configured",
            exit_code=4,
            details={"env": resolved.get("access_token_env")},
        )

    query_string = parse.urlencode(_clean_dict(query or {}), doseq=True)
    url = f"{resolved['base_url']}{path}"
    if query_string:
        url = f"{url}?{query_string}"

    data = None
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")

    req = request.Request(url, data=data, method=method.upper(), headers=_headers(access_token))

    try:
        with request.urlopen(req, timeout=API_TIMEOUT_SECONDS) as response:
            charset = response.headers.get_content_charset("utf-8")
            body = response.read().decode(charset)
            return json.loads(body) if body else {}
    except error.HTTPError as err:
        charset = err.headers.get_content_charset("utf-8") if err.headers else "utf-8"
        body_text = err.read().decode(charset or "utf-8", errors="replace")
        details: dict[str, Any] = {"status": err.code, "url": url}
        message = body_text or str(err)
        try:
            payload = json.loads(body_text) if body_text else {}
        except json.JSONDecodeError:
            payload = {}
        if isinstance(payload, dict) and payload:
            details["response"] = payload
            message = str(payload.get("message") or payload.get("error") or message)
        if err.code in (401, 403):
            code = "HUBSPOT_AUTH_ERROR"
        elif err.code == 404:
            code = "NOT_FOUND"
        elif err.code == 429:
            code = "RATE_LIMITED"
        else:
            code = "HUBSPOT_API_ERROR"
        raise CliError(code=code, message=message, exit_code=5, details=details) from err
    except error.URLError as err:
        raise CliError(
            code="NETWORK_ERROR",
            message="Failed to reach HubSpot API",
            exit_code=6,
            details={"reason": str(err.reason), "path": path},
        ) from err


def _scope(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    resolved = resolve_runtime_values(ctx_obj)
    return {
        "portal_id": resolved.get("portal_id"),
        "account_alias": resolved.get("account_alias"),
    }


def _normalize_object(record: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": record.get("id"),
        "created_at": record.get("createdAt"),
        "updated_at": record.get("updatedAt"),
        "archived": record.get("archived", False),
        "properties": record.get("properties") or {},
    }


def _object_collection_result(resource: str, operation: str, ctx_obj: dict[str, Any], response: dict[str, Any]) -> dict[str, Any]:
    results = [_normalize_object(item) for item in response.get("results", []) if isinstance(item, dict)]
    paging = response.get("paging") or {}
    next_after = (((paging.get("next") or {}).get("after")) if isinstance(paging, dict) else None)
    return {
        "status": "ok",
        "backend": "hubspot",
        "resource": resource,
        "operation": operation,
        "scope": _scope(ctx_obj),
        "count": len(results),
        "paging": {"next_after": next_after},
        "results": results,
    }


def _single_object_result(resource: str, operation: str, ctx_obj: dict[str, Any], response: dict[str, Any]) -> dict[str, Any]:
    return {
        "status": "ok",
        "backend": "hubspot",
        "resource": resource,
        "operation": operation,
        "scope": _scope(ctx_obj),
        "result": _normalize_object(response),
    }


def _default_properties(resource: str, properties: list[str] | tuple[str, ...] | None) -> list[str]:
    if properties:
        return [value for value in properties if value]
    return list(DEFAULT_PROPERTIES.get(resource, []))


def list_objects(
    ctx_obj: dict[str, Any],
    *,
    resource: str,
    limit: int,
    after: str | None,
    properties: list[str] | tuple[str, ...] | None,
) -> dict[str, Any]:
    endpoint = OBJECT_ENDPOINTS[resource]
    selected_properties = _default_properties(resource, properties)
    response = _request_json(
        ctx_obj,
        "GET",
        f"/crm/v3/objects/{endpoint}",
        query=_query_with_properties(
            {
                "limit": limit,
                "after": _normalize_after(after),
                "archived": "false",
            },
            selected_properties,
        ),
    )
    return _object_collection_result(resource, "list", ctx_obj, response)


def search_objects(
    ctx_obj: dict[str, Any],
    *,
    resource: str,
    query_text: str | None,
    limit: int,
    after: str | None,
    properties: list[str] | tuple[str, ...] | None,
    filters: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    if not query_text and not filters:
        return list_objects(ctx_obj, resource=resource, limit=limit, after=after, properties=properties)
    endpoint = OBJECT_ENDPOINTS[resource]
    payload: dict[str, Any] = {
        "limit": limit,
        "properties": _default_properties(resource, properties),
    }
    normalized_after = _normalize_after(after)
    if normalized_after is not None:
        payload["after"] = normalized_after
    if query_text:
        payload["query"] = query_text
    if filters:
        payload["filterGroups"] = [{"filters": filters}]
    response = _request_json(ctx_obj, "POST", f"/crm/v3/objects/{endpoint}/search", payload=payload)
    return _object_collection_result(resource, "search", ctx_obj, response)


def read_object(
    ctx_obj: dict[str, Any],
    *,
    resource: str,
    object_id: str,
    properties: list[str] | tuple[str, ...] | None,
) -> dict[str, Any]:
    endpoint = OBJECT_ENDPOINTS[resource]
    response = _request_json(
        ctx_obj,
        "GET",
        f"/crm/v3/objects/{endpoint}/{parse.quote(str(object_id), safe='')}",
        query=_query_with_properties({"archived": "false"}, _default_properties(resource, properties)),
    )
    return _single_object_result(resource, "read", ctx_obj, response)


def list_owners(
    ctx_obj: dict[str, Any],
    *,
    limit: int,
    after: str | None,
    team_id: str | None,
    email: str | None,
) -> dict[str, Any]:
    response = _request_json(
        ctx_obj,
        "GET",
        "/crm/v3/owners",
        query={"limit": limit, "after": _normalize_after(after), "archived": "false"},
    )
    results = []
    for item in response.get("results", []):
        if not isinstance(item, dict):
            continue
        candidate_team_id = str(item.get("teams", [{}])[0].get("id", "") or "") if item.get("teams") else ""
        candidate_email = str(item.get("email") or "")
        if team_id and candidate_team_id != team_id:
            continue
        if email and candidate_email.lower() != email.lower():
            continue
        results.append(
            {
                "id": item.get("id"),
                "email": candidate_email or None,
                "first_name": item.get("firstName"),
                "last_name": item.get("lastName"),
                "user_id": item.get("userId"),
                "team_id": candidate_team_id or None,
                "archived": item.get("archived", False),
            }
        )
    paging = response.get("paging") or {}
    next_after = (((paging.get("next") or {}).get("after")) if isinstance(paging, dict) else None)
    return {
        "status": "ok",
        "backend": "hubspot",
        "resource": "owner",
        "operation": "list",
        "scope": _scope(ctx_obj),
        "count": len(results),
        "paging": {"next_after": next_after},
        "results": results,
    }


def list_pipelines(ctx_obj: dict[str, Any], *, object_type: str) -> dict[str, Any]:
    endpoint = OBJECT_ENDPOINTS.get(object_type, f"{object_type}s")
    response = _request_json(ctx_obj, "GET", f"/crm/v3/pipelines/{endpoint}")
    results = []
    for item in response.get("results", []):
        if not isinstance(item, dict):
            continue
        results.append(
            {
                "id": item.get("id"),
                "label": item.get("label"),
                "display_order": item.get("displayOrder"),
                "archived": item.get("archived", False),
                "stages": [
                    {
                        "id": stage.get("id"),
                        "label": stage.get("label"),
                        "metadata": stage.get("metadata") or {},
                        "display_order": stage.get("displayOrder"),
                    }
                    for stage in item.get("stages", [])
                    if isinstance(stage, dict)
                ],
            }
        )
    return {
        "status": "ok",
        "backend": "hubspot",
        "resource": "pipeline",
        "operation": "list",
        "scope": _scope(ctx_obj),
        "object_type": object_type,
        "count": len(results),
        "results": results,
    }


def probe_api(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    resolved = resolve_runtime_values(ctx_obj)
    if not resolved.get("portal_id"):
        return {
            "ok": False,
            "code": "MISSING_PORTAL_ID",
            "message": "HubSpot portal ID is not configured",
            "details": {"env": "HUBSPOT_PORTAL_ID"},
        }
    if not resolved.get("access_token"):
        return {
            "ok": False,
            "code": "MISSING_ACCESS_TOKEN",
            "message": "HubSpot access token is not configured",
            "details": {"env": resolved.get("access_token_env")},
        }
    try:
        response = _request_json(ctx_obj, "GET", "/crm/v3/owners", query={"limit": 1, "archived": "false"})
        return {
            "ok": True,
            "code": "OK",
            "message": "HubSpot API probe succeeded",
            "details": {"owner_count": len(response.get("results", [])), "portal_id": resolved.get("portal_id")},
        }
    except CliError as err:
        return {"ok": False, "code": err.code, "message": err.message, "details": err.details}
