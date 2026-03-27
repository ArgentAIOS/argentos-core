from __future__ import annotations

import json
from typing import Any

from .client import PipedriveApiError, PipedriveClient
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
            "deal.list": True,
            "deal.get": True,
            "person.list": True,
            "person.get": True,
            "organization.list": True,
            "organization.get": True,
            "activity.list": True,
            "pipeline.list": True,
            "stage.list": True,
        },
        "write_support": {
            "deal.create": "live",
            "deal.update": "live",
            "person.create": "live",
            "organization.create": "live",
            "activity.create": "live",
            "note.create": "live",
        },
    }


def create_client(ctx_obj: dict[str, Any]) -> PipedriveClient:
    runtime = resolve_runtime_values(ctx_obj)
    if not runtime["api_token_present"]:
        raise CliError(
            code="PIPEDRIVE_SETUP_REQUIRED",
            message="Pipedrive connector is missing the required API token",
            exit_code=4,
            details={"missing_keys": [runtime["token_env"]]},
        )
    return PipedriveClient(api_token=runtime["api_token"], company_domain=runtime["company_domain"])


def probe_runtime(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    if not runtime["api_token_present"]:
        return {
            "ok": False,
            "code": "PIPEDRIVE_SETUP_REQUIRED",
            "message": "Pipedrive connector is missing the required API token",
            "details": {"missing_keys": [runtime["token_env"]], "live_backend_available": False},
        }
    try:
        client = create_client(ctx_obj)
        user = client.probe()
    except CliError as err:
        return {"ok": False, "code": err.code, "message": err.message, "details": err.details}
    except PipedriveApiError as err:
        code = "PIPEDRIVE_AUTH_FAILED" if err.status_code in {401, 403} else "PIPEDRIVE_API_ERROR"
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
    user_data = user.get("data", {}) if isinstance(user.get("data"), dict) else {}
    return {
        "ok": True,
        "code": "OK",
        "message": "Pipedrive live read runtime is ready",
        "details": {
            "live_backend_available": True,
            "user_name": user_data.get("name"),
            "company_domain": runtime["company_domain"],
        },
    }


def _write_error(err: PipedriveApiError, *, operation: str) -> CliError:
    code = "PIPEDRIVE_AUTH_FAILED" if err.status_code in {401, 403} else "PIPEDRIVE_API_ERROR"
    message = err.message if err.status_code not in {401, 403} else f"Pipedrive {operation} failed because the API token lacks access"
    return CliError(
        code=code,
        message=message,
        exit_code=5 if err.status_code in {401, 403} else 4,
        details={
            "operation": operation,
            "status_code": err.status_code,
            "error_code": err.code,
            "error_details": err.details or {},
        },
    )


def health_snapshot(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    probe = probe_runtime(ctx_obj)
    status = "ready" if probe["ok"] else ("needs_setup" if probe["code"] == "PIPEDRIVE_SETUP_REQUIRED" else "degraded")
    return {
        "status": status,
        "summary": probe["message"],
        "connector": {
            "backend": BACKEND_NAME,
            "live_backend_available": bool(probe.get("ok")),
            "live_read_available": bool(probe.get("ok")),
            "write_bridge_available": True,
            "scaffold_only": False,
        },
        "auth": {
            "token_env": runtime["token_env"],
            "api_token_present": runtime["api_token_present"],
        },
        "checks": [
            {
                "name": "required_env",
                "ok": runtime["api_token_present"],
                "details": {"missing_keys": [] if runtime["api_token_present"] else [runtime["token_env"]]},
            },
            {"name": "live_backend", "ok": bool(probe.get("ok")), "details": probe.get("details", {})},
        ],
        "runtime_ready": bool(probe.get("ok")),
        "probe": probe,
        "next_steps": [
            f"Set {runtime['token_env']} in API Keys.",
            "Optionally set PIPEDRIVE_DEAL_ID, PIPEDRIVE_PERSON_ID, PIPEDRIVE_ORG_ID, PIPEDRIVE_PIPELINE_ID to stabilize scope.",
            "Pipedrive write commands are now wired to the live API.",
        ],
    }


def doctor_snapshot(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    probe = probe_runtime(ctx_obj)
    live = bool(probe.get("ok"))
    return {
        "status": "ready" if live else ("needs_setup" if probe.get("code") == "PIPEDRIVE_SETUP_REQUIRED" else "degraded"),
        "summary": "Pipedrive connector diagnostics.",
        "runtime": {
            "implementation_mode": "live_read_with_live_writes",
            "command_readiness": {
                "deal.list": live,
                "deal.get": live,
                "deal.create": live,
                "deal.update": live,
                "person.list": live,
                "person.get": live,
                "person.create": live,
                "organization.list": live,
                "organization.get": live,
                "organization.create": live,
                "activity.list": live,
                "activity.create": live,
                "pipeline.list": live,
                "stage.list": live,
                "note.create": live,
            },
            "deal_id_present": runtime["deal_id_present"],
            "person_id_present": runtime["person_id_present"],
            "org_id_present": runtime["org_id_present"],
            "pipeline_id_present": runtime["pipeline_id_present"],
        },
        "checks": [
            {"name": "required_env", "ok": runtime["api_token_present"]},
            {"name": "live_backend", "ok": live, "details": probe.get("details", {})},
            {"name": "write_commands", "ok": True, "details": {"mode": "live"}},
        ],
        "supported_read_commands": [
            "deal.list", "deal.get", "person.list", "person.get",
            "organization.list", "organization.get", "activity.list",
            "pipeline.list", "stage.list",
        ],
        "scaffolded_commands": [],
        "next_steps": [
            f"Set {runtime['token_env']} in API Keys.",
            "Use deal.list or pipeline.list to confirm the connected Pipedrive account.",
            "Write commands now execute live mutations with the current API token.",
        ],
    }


def _picker(items: list[dict[str, Any]], *, kind: str, label_key: str = "label") -> dict[str, Any]:
    return {"kind": kind, "items": items, "count": len(items), "label_key": label_key}


def _require_arg(value: str | None, *, code: str, message: str, detail_key: str, detail_value: str) -> str:
    resolved = (value or "").strip()
    if resolved:
        return resolved
    raise CliError(code=code, message=message, exit_code=4, details={detail_key: detail_value})


def deal_list_result(ctx_obj: dict[str, Any], *, limit: int) -> dict[str, Any]:
    client = create_client(ctx_obj)
    deals = client.list_deals(limit=limit)
    items = [
        {"id": str(d.get("id") or ""), "label": str(d.get("title") or d.get("id") or "Deal"), "subtitle": d.get("status"), "kind": "deal"}
        for d in deals
    ]
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Returned {len(deals)} Pipedrive deal{'s' if len(deals) != 1 else ''}.",
        "deals": deals,
        "deal_count": len(deals),
        "picker": _picker(items, kind="deal"),
        "scope_preview": {"selection_surface": "deal", "command_id": "deal.list"},
    }


def deal_get_result(ctx_obj: dict[str, Any], deal_id: str | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved = _require_arg(deal_id or runtime["deal_id"], code="PIPEDRIVE_DEAL_REQUIRED", message="Deal ID is required", detail_key="env", detail_value=runtime["deal_id_env"])
    client = create_client(ctx_obj)
    deal = client.get_deal(resolved)
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Read Pipedrive deal {resolved}.",
        "deal": deal,
        "scope_preview": {"selection_surface": "deal", "command_id": "deal.get", "deal_id": resolved},
    }


def person_list_result(ctx_obj: dict[str, Any], *, limit: int) -> dict[str, Any]:
    client = create_client(ctx_obj)
    persons = client.list_persons(limit=limit)
    items = [
        {"id": str(p.get("id") or ""), "label": str(p.get("name") or p.get("email") or p.get("id") or "Person"), "subtitle": p.get("email"), "kind": "person"}
        for p in persons
    ]
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Returned {len(persons)} Pipedrive person{'s' if len(persons) != 1 else ''}.",
        "persons": persons,
        "person_count": len(persons),
        "picker": _picker(items, kind="person"),
        "scope_preview": {"selection_surface": "person", "command_id": "person.list"},
    }


def person_get_result(ctx_obj: dict[str, Any], person_id: str | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved = _require_arg(person_id or runtime["person_id"], code="PIPEDRIVE_PERSON_REQUIRED", message="Person ID is required", detail_key="env", detail_value=runtime["person_id_env"])
    client = create_client(ctx_obj)
    person = client.get_person(resolved)
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Read Pipedrive person {resolved}.",
        "person": person,
        "scope_preview": {"selection_surface": "person", "command_id": "person.get", "person_id": resolved},
    }


def organization_list_result(ctx_obj: dict[str, Any], *, limit: int) -> dict[str, Any]:
    client = create_client(ctx_obj)
    orgs = client.list_organizations(limit=limit)
    items = [
        {"id": str(o.get("id") or ""), "label": str(o.get("name") or o.get("id") or "Organization"), "subtitle": o.get("address"), "kind": "organization"}
        for o in orgs
    ]
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Returned {len(orgs)} Pipedrive organization{'s' if len(orgs) != 1 else ''}.",
        "organizations": orgs,
        "organization_count": len(orgs),
        "picker": _picker(items, kind="organization"),
        "scope_preview": {"selection_surface": "organization", "command_id": "organization.list"},
    }


def organization_get_result(ctx_obj: dict[str, Any], org_id: str | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved = _require_arg(org_id or runtime["org_id"], code="PIPEDRIVE_ORG_REQUIRED", message="Organization ID is required", detail_key="env", detail_value=runtime["org_id_env"])
    client = create_client(ctx_obj)
    org = client.get_organization(resolved)
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Read Pipedrive organization {resolved}.",
        "organization": org,
        "scope_preview": {"selection_surface": "organization", "command_id": "organization.get", "org_id": resolved},
    }


def activity_list_result(ctx_obj: dict[str, Any], *, limit: int) -> dict[str, Any]:
    client = create_client(ctx_obj)
    activities = client.list_activities(limit=limit)
    items = [
        {"id": str(a.get("id") or ""), "label": str(a.get("subject") or a.get("id") or "Activity"), "subtitle": a.get("type"), "kind": "activity"}
        for a in activities
    ]
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Returned {len(activities)} Pipedrive activit{'ies' if len(activities) != 1 else 'y'}.",
        "activities": activities,
        "activity_count": len(activities),
        "picker": _picker(items, kind="activity"),
        "scope_preview": {"selection_surface": "activity", "command_id": "activity.list"},
    }


def pipeline_list_result(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    client = create_client(ctx_obj)
    pipelines = client.list_pipelines()
    items = [
        {"id": str(p.get("id") or ""), "label": str(p.get("name") or p.get("id") or "Pipeline"), "kind": "pipeline"}
        for p in pipelines
    ]
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Returned {len(pipelines)} Pipedrive pipeline{'s' if len(pipelines) != 1 else ''}.",
        "pipelines": pipelines,
        "pipeline_count": len(pipelines),
        "picker": _picker(items, kind="pipeline"),
        "scope_preview": {"selection_surface": "pipeline", "command_id": "pipeline.list"},
    }


def stage_list_result(ctx_obj: dict[str, Any], pipeline_id: str | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved = (pipeline_id or runtime["pipeline_id"] or "").strip() or None
    client = create_client(ctx_obj)
    stages = client.list_stages(pipeline_id=resolved)
    items = [
        {"id": str(s.get("id") or ""), "label": str(s.get("name") or s.get("id") or "Stage"), "subtitle": f"pipeline={s.get('pipeline_id')}", "kind": "stage"}
        for s in stages
    ]
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Returned {len(stages)} Pipedrive stage{'s' if len(stages) != 1 else ''}.",
        "stages": stages,
        "stage_count": len(stages),
        "picker": _picker(items, kind="stage"),
        "scope_preview": {"selection_surface": "stage", "command_id": "stage.list", "pipeline_id": resolved},
    }


def deal_create_result(
    ctx_obj: dict[str, Any],
    *,
    title: str,
    value: float | None,
    currency: str | None,
) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    client = create_client(ctx_obj)
    try:
        deal = client.create_deal(
            title=title,
            value=value,
            currency=currency,
            person_id=runtime["person_id"] or None,
            org_id=runtime["org_id"] or None,
        )
    except PipedriveApiError as err:
        raise _write_error(err, operation="deal.create") from err
    return {
        "status": "live_write",
        "backend": BACKEND_NAME,
        "command": "deal.create",
        "summary": f"Created Pipedrive deal {deal.get('id') or title}.",
        "deal": deal,
        "inputs": {"title": title, "value": value, "currency": currency},
        "scope_preview": {"selection_surface": "deal", "command_id": "deal.create"},
    }


def deal_update_result(ctx_obj: dict[str, Any], *, deal_id: str) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    client = create_client(ctx_obj)
    try:
        current = client.get_deal(deal_id)
        updated = client.update_deal(
            deal_id,
            fields={
                "title": current.get("title") or deal_id,
                "value": current.get("value"),
                "currency": current.get("currency"),
                "status": current.get("status"),
                "person_id": current.get("person_id") or runtime["person_id"] or None,
                "org_id": current.get("org_id") or runtime["org_id"] or None,
                "pipeline_id": current.get("pipeline_id") or runtime["pipeline_id"] or None,
                "stage_id": current.get("stage_id") or None,
            },
        )
    except PipedriveApiError as err:
        raise _write_error(err, operation="deal.update") from err
    return {
        "status": "live_write",
        "backend": BACKEND_NAME,
        "command": "deal.update",
        "summary": f"Updated Pipedrive deal {deal_id}.",
        "deal": updated,
        "inputs": {"deal_id": deal_id},
        "scope_preview": {"selection_surface": "deal", "command_id": "deal.update", "deal_id": deal_id},
    }


def person_create_result(ctx_obj: dict[str, Any], *, name: str, email: str | None) -> dict[str, Any]:
    client = create_client(ctx_obj)
    try:
        person = client.create_person(name=name, email=email)
    except PipedriveApiError as err:
        raise _write_error(err, operation="person.create") from err
    return {
        "status": "live_write",
        "backend": BACKEND_NAME,
        "command": "person.create",
        "summary": f"Created Pipedrive person {person.get('id') or name}.",
        "person": person,
        "inputs": {"name": name, "email": email},
        "scope_preview": {"selection_surface": "person", "command_id": "person.create"},
    }


def organization_create_result(ctx_obj: dict[str, Any], *, name: str) -> dict[str, Any]:
    client = create_client(ctx_obj)
    try:
        org = client.create_organization(name=name)
    except PipedriveApiError as err:
        raise _write_error(err, operation="organization.create") from err
    return {
        "status": "live_write",
        "backend": BACKEND_NAME,
        "command": "organization.create",
        "summary": f"Created Pipedrive organization {org.get('id') or name}.",
        "organization": org,
        "inputs": {"name": name},
        "scope_preview": {"selection_surface": "organization", "command_id": "organization.create"},
    }


def activity_create_result(
    ctx_obj: dict[str, Any],
    *,
    subject: str,
    activity_type: str | None,
) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    client = create_client(ctx_obj)
    try:
        activity = client.create_activity(
            subject=subject,
            activity_type=activity_type,
            person_id=runtime["person_id"] or None,
            deal_id=runtime["deal_id"] or None,
            org_id=runtime["org_id"] or None,
        )
    except PipedriveApiError as err:
        raise _write_error(err, operation="activity.create") from err
    return {
        "status": "live_write",
        "backend": BACKEND_NAME,
        "command": "activity.create",
        "summary": f"Created Pipedrive activity {activity.get('id') or subject}.",
        "activity": activity,
        "inputs": {"subject": subject, "type": activity_type},
        "scope_preview": {"selection_surface": "activity", "command_id": "activity.create"},
    }


def note_create_result(
    ctx_obj: dict[str, Any],
    *,
    content: str,
    deal_id: str | None,
    person_id: str | None,
) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    client = create_client(ctx_obj)
    resolved_deal_id = deal_id or runtime["deal_id"] or None
    resolved_person_id = person_id or runtime["person_id"] or None
    resolved_org_id = runtime["org_id"] or None
    try:
        note = client.create_note(
            content=content,
            deal_id=resolved_deal_id,
            person_id=resolved_person_id,
            org_id=resolved_org_id,
        )
    except PipedriveApiError as err:
        raise _write_error(err, operation="note.create") from err
    return {
        "status": "live_write",
        "backend": BACKEND_NAME,
        "command": "note.create",
        "summary": f"Created Pipedrive note {note.get('id') or 'new note'}.",
        "note": note,
        "inputs": {"content": content, "deal_id": resolved_deal_id, "person_id": resolved_person_id},
        "scope_preview": {"selection_surface": "note", "command_id": "note.create"},
    }
