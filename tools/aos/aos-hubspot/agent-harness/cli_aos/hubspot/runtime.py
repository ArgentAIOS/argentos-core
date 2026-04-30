from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any
from urllib import error, parse, request

from .config import resolve_runtime_values
from .constants import DEFAULT_PROPERTIES, NOTE_ASSOCIATION_TYPE_IDS, OBJECT_ENDPOINTS
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


def _scope_preview(
    ctx_obj: dict[str, Any],
    *,
    command_id: str,
    resource: str,
    operation: str,
    picker_options: list[dict[str, Any]] | None = None,
    records: list[dict[str, Any]] | None = None,
    **details: Any,
) -> dict[str, Any]:
    scope = _scope(ctx_obj)
    candidates = _scope_candidates(
        ctx_obj,
        resource=resource,
        picker_options=picker_options,
        records=records,
        **details,
    )
    preview: dict[str, Any] = {
        "command_id": command_id,
        "resource": resource,
        "operation": operation,
        "portal_id": scope.get("portal_id"),
        "account_alias": scope.get("account_alias"),
    }
    if picker_options is not None:
        preview["picker"] = {"kind": resource, "items": picker_options}
        preview["candidate_count"] = len(picker_options)
    if candidates:
        preview["scope_candidates"] = candidates
        preview["scope_candidate_count"] = len(candidates)
    preview.update(details)
    preview["preview"] = _preview_summary(resource, operation, preview, picker_options=picker_options)
    return preview


def _candidate_key(candidate: dict[str, Any]) -> tuple[str, str]:
    return (str(candidate.get("kind") or ""), str(candidate.get("value") or ""))


_RESOURCE_PLURALS = {
    "company": "companies",
    "contact": "contacts",
    "deal": "deals",
    "note": "notes",
    "owner": "owners",
    "pipeline": "pipelines",
    "ticket": "tickets",
}


def _resource_noun(resource: str, count: int) -> str:
    if count == 1:
        return resource
    return _RESOURCE_PLURALS.get(resource, f"{resource}s")


def _preview_summary(
    resource: str,
    operation: str,
    preview: dict[str, Any],
    *,
    picker_options: list[dict[str, Any]] | None = None,
) -> str:
    parts = [f"HubSpot {resource}.{operation}"]
    count = preview.get("count")
    if isinstance(count, int):
        parts.append(f"{count} {_resource_noun(resource, count)}")
    first_label = None
    if picker_options:
        for option in picker_options:
            if not isinstance(option, dict):
                continue
            label = str(option.get("label") or "").strip()
            if label:
                first_label = label
                break
    if first_label:
        parts.append(first_label)
    portal_id = preview.get("portal_id")
    if portal_id:
        parts.append(f"portal {portal_id}")
    account_alias = preview.get("account_alias")
    if account_alias:
        parts.append(str(account_alias))
    object_type = preview.get("object_type")
    if resource == "pipeline" and object_type:
        parts.append(f"{object_type} pipelines")
    semantic_labels: list[str] = []
    for candidate in preview.get("scope_candidates", []):
        if not isinstance(candidate, dict):
            continue
        kind = str(candidate.get("kind") or "")
        if kind not in {"owner", "pipeline", "queue", "team", "team_id"}:
            continue
        label = str(candidate.get("label") or candidate.get("value") or "").strip()
        if not label or label in semantic_labels:
            continue
        semantic_labels.append(label)
    parts.extend(semantic_labels[:2])
    return " · ".join(parts)


def _append_candidate(
    candidates: list[dict[str, Any]],
    seen: set[tuple[str, str]],
    *,
    kind: str,
    value: Any,
    label: Any | None = None,
    **extras: Any,
) -> None:
    text = str(value or "").strip()
    if not text:
        return
    candidate: dict[str, Any] = {
        "kind": kind,
        "value": text,
        "label": str(label or text),
    }
    for key, extra_value in extras.items():
        if extra_value is None:
            continue
        if isinstance(extra_value, str) and not extra_value.strip():
            continue
        candidate[key] = extra_value
    candidate_key = _candidate_key(candidate)
    if candidate_key in seen:
        return
    seen.add(candidate_key)
    candidates.append(candidate)


def _record_scope_candidates(resource: str, record: dict[str, Any]) -> list[dict[str, Any]]:
    properties = record.get("properties") or {}
    candidates: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()

    if resource in {"contact", "company", "deal", "ticket"}:
        owner_id = (
            properties.get("hubspot_owner_id")
            or properties.get("owner_id")
            or record.get("hubspot_owner_id")
            or record.get("owner_id")
        )
        if owner_id:
            _append_candidate(candidates, seen, kind="owner", value=owner_id, label=f"Owner {owner_id}")

    if resource == "deal":
        pipeline_id = properties.get("pipeline") or record.get("pipeline")
        if pipeline_id:
            _append_candidate(candidates, seen, kind="pipeline", value=pipeline_id, label=f"Pipeline {pipeline_id}")
    elif resource == "ticket":
        queue_id = (
            properties.get("queue")
            or properties.get("queue_id")
            or properties.get("hs_queue")
            or properties.get("hs_queue_id")
            or properties.get("hs_pipeline_stage")
        )
        if queue_id:
            _append_candidate(
                candidates,
                seen,
                kind="queue",
                value=queue_id,
                label=f"Queue {queue_id}",
                subtitle=str(properties.get("hs_pipeline") or record.get("hs_pipeline") or "").strip()
                or None,
            )
        pipeline_id = properties.get("hs_pipeline") or record.get("hs_pipeline")
        if pipeline_id:
            _append_candidate(candidates, seen, kind="pipeline", value=pipeline_id, label=f"Pipeline {pipeline_id}")
    elif resource == "owner":
        team_id = record.get("team_id")
        if team_id:
            _append_candidate(candidates, seen, kind="team", value=team_id, label=f"Team {team_id}")
        for team in record.get("teams", []):
            if not isinstance(team, dict):
                continue
            candidate_team_id = team.get("id")
            if candidate_team_id is None:
                continue
            team_label = team.get("name") or team.get("label") or f"Team {candidate_team_id}"
            _append_candidate(candidates, seen, kind="team", value=candidate_team_id, label=team_label)

    return candidates


def _scope_candidates(
    ctx_obj: dict[str, Any],
    *,
    resource: str,
    picker_options: list[dict[str, Any]] | None = None,
    records: list[dict[str, Any]] | None = None,
    **details: Any,
) -> list[dict[str, Any]]:
    scope = _scope(ctx_obj)
    candidates: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    portal_id = scope.get("portal_id")
    if portal_id:
        candidate: dict[str, Any] = {"kind": "portal", "value": str(portal_id), "label": f"Portal {portal_id}"}
        account_alias = scope.get("account_alias")
        if account_alias:
            candidate["subtitle"] = str(account_alias)
        candidate_key = _candidate_key(candidate)
        seen.add(candidate_key)
        candidates.append(candidate)
    account_alias = scope.get("account_alias")
    if account_alias:
        _append_candidate(candidates, seen, kind="account_alias", value=account_alias, label=account_alias)
    if resource == "pipeline" and details.get("object_type"):
        object_type = str(details["object_type"])
        _append_candidate(candidates, seen, kind="object_type", value=object_type, label=f"{object_type} pipelines")
    if resource == "owner" and details.get("team_id"):
        team_id = str(details["team_id"])
        _append_candidate(candidates, seen, kind="team_id", value=team_id, label=f"Team {team_id}")
    if resource == "note" and details.get("object_type") and details.get("associated_object_id"):
        object_type = str(details["object_type"])
        object_id = str(details["associated_object_id"])
        _append_candidate(
            candidates,
            seen,
            kind=object_type,
            value=object_id,
            label=f"{object_type.title()} {object_id}",
        )
    if records:
        for record in records:
            if not isinstance(record, dict):
                continue
            for candidate in _record_scope_candidates(resource, record):
                candidate_key = _candidate_key(candidate)
                if candidate_key in seen:
                    continue
                seen.add(candidate_key)
                candidates.append(candidate)
    if picker_options:
        for option in picker_options:
            if not isinstance(option, dict):
                continue
            candidate = {"kind": resource, **option}
            candidate_key = _candidate_key(candidate)
            if candidate_key in seen:
                continue
            seen.add(candidate_key)
            candidates.append(candidate)
    return candidates


def _picker_label(resource: str, record: dict[str, Any]) -> str:
    properties = record.get("properties") or {}
    if resource in {"contact", "company"}:
        return str(
            properties.get("name")
            or properties.get("firstname")
            or properties.get("lastname")
            or properties.get("email")
            or record.get("id")
            or resource
        )
    if resource == "deal":
        return str(properties.get("dealname") or properties.get("hs_object_id") or record.get("id") or "deal")
    if resource == "ticket":
        return str(properties.get("subject") or properties.get("hs_object_id") or record.get("id") or "ticket")
    if resource == "owner":
        first = str(record.get("first_name") or record.get("firstName") or "").strip()
        last = str(record.get("last_name") or record.get("lastName") or "").strip()
        name = " ".join(part for part in [first, last] if part).strip()
        return str(name or record.get("email") or record.get("id") or "owner")
    if resource == "pipeline":
        return str(record.get("label") or record.get("id") or "pipeline")
    return str(record.get("id") or resource)


def _picker_subtitle(resource: str, record: dict[str, Any]) -> str | None:
    properties = record.get("properties") or {}
    if resource in {"contact", "company"}:
        parts = [
            properties.get("email"),
            properties.get("phone"),
            properties.get("jobtitle") or properties.get("job_title"),
            properties.get("hubspot_owner_id"),
        ]
    elif resource == "deal":
        parts = [
            properties.get("dealstage"),
            properties.get("pipeline"),
            properties.get("amount"),
            properties.get("hubspot_owner_id"),
        ]
    elif resource == "ticket":
        parts = [
            properties.get("hs_pipeline"),
            properties.get("hs_pipeline_stage"),
            properties.get("hubspot_owner_id"),
        ]
    elif resource == "owner":
        teams = record.get("teams") or []
        team_count = len([team for team in teams if isinstance(team, dict)])
        parts = [
            record.get("email"),
            record.get("team_id"),
            f"teams={team_count}" if team_count else None,
        ]
    elif resource == "pipeline":
        stage_count = len([stage for stage in record.get("stages", []) if isinstance(stage, dict)])
        stage_names = [
            str(stage.get("label") or stage.get("id"))
            for stage in record.get("stages", [])
            if isinstance(stage, dict) and (stage.get("label") or stage.get("id"))
        ]
        parts = [f"stages={stage_count}"]
        if stage_names:
            parts.append(stage_names[0])
    else:
        parts = []
    values = [str(part) for part in parts if part]
    return " | ".join(values) if values else None


def _picker_options(resource: str, records: list[dict[str, Any]], *, selected_id: str | None = None) -> list[dict[str, Any]]:
    options: list[dict[str, Any]] = []
    for record in records:
        record_id = record.get("id")
        if record_id is None:
            continue
        option: dict[str, Any] = {
            "value": str(record_id),
            "label": _picker_label(resource, record),
            "resource": resource,
        }
        subtitle = _picker_subtitle(resource, record)
        if subtitle:
            option["subtitle"] = subtitle
        if selected_id is not None and str(selected_id) == str(record_id):
            option["selected"] = True
        options.append(option)
    return options


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
    picker_options = _picker_options(resource, results)
    preview = _scope_preview(
        ctx_obj,
        command_id=f"{resource}.{operation}",
        resource=resource,
        operation=operation,
        picker_options=picker_options,
        records=results,
        count=len(results),
        next_after=next_after,
    )
    return {
        "status": "ok",
        "backend": "hubspot",
        "resource": resource,
        "operation": operation,
        "scope": {
            **_scope(ctx_obj),
            "preview": preview,
        },
        "scope_preview": preview,
        "scope_candidates": preview.get("scope_candidates", []),
        "count": len(results),
        "paging": {"next_after": next_after},
        "results": results,
        "picker_options": picker_options,
    }


def _single_object_result(
    resource: str,
    operation: str,
    ctx_obj: dict[str, Any],
    response: dict[str, Any],
    *,
    command_id: str | None = None,
    **preview_details: Any,
) -> dict[str, Any]:
    normalized = _normalize_object(response)
    picker_options = _picker_options(resource, [normalized], selected_id=normalized.get("id"))
    preview = _scope_preview(
        ctx_obj,
        command_id=command_id or f"{resource}.{operation}",
        resource=resource,
        operation=operation,
        picker_options=picker_options,
        records=[normalized],
        object_id=normalized.get("id"),
        count=1,
        **preview_details,
    )
    return {
        "status": "ok",
        "backend": "hubspot",
        "resource": resource,
        "operation": operation,
        "scope": {
            **_scope(ctx_obj),
            "preview": preview,
        },
        "scope_preview": preview,
        "scope_candidates": preview.get("scope_candidates", []),
        "result": normalized,
        "picker_options": picker_options,
    }


def _default_properties(resource: str, properties: list[str] | tuple[str, ...] | None) -> list[str]:
    if properties:
        return [value for value in properties if value]
    return list(DEFAULT_PROPERTIES.get(resource, []))


def _object_path(resource: str, object_id: str | None = None) -> str:
    endpoint = OBJECT_ENDPOINTS[resource]
    base = f"/crm/v3/objects/{endpoint}"
    if object_id is None:
        return base
    return f"{base}/{parse.quote(str(object_id), safe='')}"


def _properties_payload(properties: dict[str, Any]) -> dict[str, Any]:
    normalized: dict[str, Any] = {}
    for key, value in properties.items():
        key_text = str(key).strip()
        if not key_text:
            continue
        if value is None:
            continue
        normalized[key_text] = value
    if not normalized:
        raise CliError(
            code="INVALID_USAGE",
            message="At least one property must be provided",
            exit_code=2,
            details={"properties": properties},
        )
    return normalized


def _live_write_result(
    resource: str,
    operation: str,
    ctx_obj: dict[str, Any],
    response: dict[str, Any],
    *,
    command_id: str | None = None,
    **preview_details: Any,
) -> dict[str, Any]:
    payload = _single_object_result(
        resource,
        operation,
        ctx_obj,
        response,
        command_id=command_id,
        **preview_details,
    )
    payload["executed"] = True
    payload["command_id"] = command_id or f"{resource}.{operation}"
    return payload


def create_object(
    ctx_obj: dict[str, Any],
    *,
    resource: str,
    properties: dict[str, Any],
    command_id: str | None = None,
) -> dict[str, Any]:
    response = _request_json(
        ctx_obj,
        "POST",
        _object_path(resource),
        payload={"properties": _properties_payload(properties)},
    )
    return _live_write_result(resource, "create", ctx_obj, response, command_id=command_id)


def update_object(
    ctx_obj: dict[str, Any],
    *,
    resource: str,
    object_id: str,
    properties: dict[str, Any],
    operation: str = "update",
    command_id: str | None = None,
    **preview_details: Any,
) -> dict[str, Any]:
    response = _request_json(
        ctx_obj,
        "PATCH",
        _object_path(resource, object_id),
        payload={"properties": _properties_payload(properties)},
    )
    return _live_write_result(
        resource,
        operation,
        ctx_obj,
        response,
        command_id=command_id,
        **preview_details,
    )


def assign_owner(
    ctx_obj: dict[str, Any],
    *,
    record_type: str,
    record_id: str,
    owner_id: str,
) -> dict[str, Any]:
    payload = update_object(
        ctx_obj,
        resource=record_type,
        object_id=record_id,
        properties={"hubspot_owner_id": owner_id},
        operation="assign",
        command_id="owner.assign",
        owner_id=owner_id,
        record_type=record_type,
    )
    payload["assignment"] = {
        "record_type": record_type,
        "record_id": record_id,
        "owner_id": owner_id,
    }
    return payload


def update_deal_stage(
    ctx_obj: dict[str, Any],
    *,
    deal_id: str,
    stage_id: str,
    pipeline_id: str | None,
) -> dict[str, Any]:
    properties: dict[str, Any] = {"dealstage": stage_id}
    if pipeline_id:
        properties["pipeline"] = pipeline_id
    return update_object(
        ctx_obj,
        resource="deal",
        object_id=deal_id,
        properties=properties,
        operation="update_stage",
        command_id="deal.update_stage",
        stage_id=stage_id,
        pipeline_id=pipeline_id,
    )


def update_ticket_status(
    ctx_obj: dict[str, Any],
    *,
    ticket_id: str,
    stage_id: str,
    pipeline_id: str | None,
) -> dict[str, Any]:
    properties: dict[str, Any] = {"hs_pipeline_stage": stage_id}
    if pipeline_id:
        properties["hs_pipeline"] = pipeline_id
    return update_object(
        ctx_obj,
        resource="ticket",
        object_id=ticket_id,
        properties=properties,
        operation="update_status",
        command_id="ticket.update_status",
        stage_id=stage_id,
        pipeline_id=pipeline_id,
    )


def create_note(
    ctx_obj: dict[str, Any],
    *,
    object_type: str,
    object_id: str,
    body: str,
) -> dict[str, Any]:
    note_response = _request_json(
        ctx_obj,
        "POST",
        _object_path("note"),
        payload={
            "properties": {
                "hs_timestamp": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
                "hs_note_body": body,
            }
        },
    )
    note_id = note_response.get("id")
    if not note_id:
        raise CliError(
            code="HUBSPOT_API_ERROR",
            message="HubSpot note create did not return a note id",
            exit_code=5,
            details={"operation": "note.create", "response": note_response},
        )
    association_type_id = NOTE_ASSOCIATION_TYPE_IDS[object_type]
    _request_json(
        ctx_obj,
        "PUT",
        f"/crm/v3/objects/notes/{parse.quote(str(note_id), safe='')}/associations/"
        f"{parse.quote(object_type, safe='')}/{parse.quote(str(object_id), safe='')}/{association_type_id}",
    )
    payload = _live_write_result(
        "note",
        "create",
        ctx_obj,
        note_response,
        command_id="note.create",
        object_type=object_type,
        associated_object_id=object_id,
        association_type_id=association_type_id,
    )
    payload["association"] = {
        "object_type": object_type,
        "object_id": object_id,
        "association_type_id": association_type_id,
    }
    return payload


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
                "teams": [team for team in item.get("teams", []) if isinstance(team, dict)],
                "archived": item.get("archived", False),
            }
    )
    paging = response.get("paging") or {}
    next_after = (((paging.get("next") or {}).get("after")) if isinstance(paging, dict) else None)
    picker_options = _picker_options("owner", results)
    preview = _scope_preview(
        ctx_obj,
        command_id="owner.list",
        resource="owner",
        operation="list",
        picker_options=picker_options,
        records=results,
        team_id=team_id,
        email=email,
        count=len(results),
        next_after=next_after,
    )
    return {
        "status": "ok",
        "backend": "hubspot",
        "resource": "owner",
        "operation": "list",
        "scope": {
            **_scope(ctx_obj),
            "preview": preview,
        },
        "scope_preview": preview,
        "scope_candidates": preview.get("scope_candidates", []),
        "count": len(results),
        "paging": {"next_after": next_after},
        "results": results,
        "picker_options": picker_options,
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
    picker_options = _picker_options("pipeline", results)
    preview = _scope_preview(
        ctx_obj,
        command_id="pipeline.list",
        resource="pipeline",
        operation="list",
        picker_options=picker_options,
        records=results,
        object_type=object_type,
        count=len(results),
    )
    return {
        "status": "ok",
        "backend": "hubspot",
        "resource": "pipeline",
        "operation": "list",
        "scope": {
            **_scope(ctx_obj),
            "preview": preview,
        },
        "scope_preview": preview,
        "scope_candidates": preview.get("scope_candidates", []),
        "object_type": object_type,
        "count": len(results),
        "results": results,
        "picker_options": picker_options,
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
