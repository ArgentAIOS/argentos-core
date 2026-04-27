from __future__ import annotations

import json
from typing import Any

from . import __version__
from .client import CallScrubApiError, CallScrubClient
from .config import config_snapshot, resolve_runtime_values, redacted_config_snapshot
from .constants import BACKEND_NAME, CONNECTOR_CATEGORIES, CONNECTOR_CATEGORY, CONNECTOR_LABEL, CONNECTOR_PATH, CONNECTOR_RESOURCES, MODE_ORDER, READ_COMMANDS
from .errors import ConnectorError


def _connector_manifest() -> dict[str, Any]:
    return json.loads(CONNECTOR_PATH.read_text())


def _manifest_status() -> dict[str, Any]:
    try:
        manifest = _connector_manifest()
    except json.JSONDecodeError as err:
        return {"path": str(CONNECTOR_PATH), "valid_json": False, "error": {"message": str(err), "line": err.lineno, "column": err.colno}}
    return {"path": str(CONNECTOR_PATH), "valid_json": True, "command_count": len(manifest.get("commands", []))}


def _as_list(payload: dict[str, Any], *keys: str) -> list[Any]:
    for key in keys:
        value = payload.get(key)
        if isinstance(value, list):
            return value
    for value in payload.values():
        if isinstance(value, list):
            return value
    return []


def _pick_text(record: dict[str, Any], *keys: str) -> str:
    for key in keys:
        value = record.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def _picker_items(items: list[Any], *, kind: str, label_keys: tuple[str, ...], subtitle_keys: tuple[str, ...] = ()) -> list[dict[str, Any]]:
    picker: list[dict[str, Any]] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        value = _pick_text(item, "id", f"{kind}_id", f"{kind}Id")
        if not value:
            continue
        label = _pick_text(item, *label_keys) or value
        option: dict[str, Any] = {"value": value, "label": label, "kind": kind}
        subtitle = _pick_text(item, *subtitle_keys)
        if subtitle:
            option["subtitle"] = subtitle
        picker.append(option)
    return picker


def _scope_preview(*, command_id: str, selection_surface: str, **extra: Any) -> dict[str, Any]:
    return {"command_id": command_id, "selection_surface": selection_surface, **extra}


def create_client(ctx_obj: dict[str, Any] | None = None) -> CallScrubClient:
    runtime = resolve_runtime_values(ctx_obj)
    missing = [name for name in ("CALLSCRUB_API_KEY", "CALLSCRUB_API_BASE_URL") if not runtime["details"][name]["present"]]
    if missing:
        raise ConnectorError(
            code="CALLSCRUB_SERVICE_KEYS_REQUIRED",
            message="CALLSCRUB_API_KEY and CALLSCRUB_API_BASE_URL service keys are required for CallScrub live reads.",
            details={"missing_service_keys": missing},
        )
    return CallScrubClient(api_key=runtime["api_key"], base_url=runtime["api_base_url"])


def _required(value: str, *, code: str, message: str, env: str) -> str:
    if value:
        return value
    raise ConnectorError(code=code, message=message, details={"service_key": env})


def capabilities_snapshot() -> dict[str, Any]:
    manifest = _connector_manifest()
    return {
        "tool": manifest["tool"],
        "version": __version__,
        "backend": manifest["backend"],
        "manifest_schema_version": manifest.get("manifest_schema_version", "1.0.0"),
        "modes": MODE_ORDER,
        "connector": manifest["connector"],
        "auth": manifest["auth"],
        "scope": manifest.get("scope", {}),
        "commands": manifest["commands"],
        "read_support": {command_id: True for command_id in READ_COMMANDS},
        "write_support": {"live_writes_enabled": False, "scaffold_only": False, "scaffolded_commands": []},
    }


def probe_live_read(runtime: dict[str, Any]) -> dict[str, Any]:
    missing = [name for name in ("CALLSCRUB_API_KEY", "CALLSCRUB_API_BASE_URL") if not runtime["details"][name]["present"]]
    if missing:
        return {"ok": False, "details": {"missing_keys": missing, "reason": "required service keys missing"}}
    try:
        client = CallScrubClient(api_key=runtime["api_key"], base_url=runtime["api_base_url"])
        calls = _as_list(client.list_calls(limit=1), "calls", "data", "items")
        agents = _as_list(client.list_agents(limit=1), "agents", "data", "items")
        return {"ok": True, "details": {"call_count_sample": len(calls), "agent_count_sample": len(agents)}}
    except CallScrubApiError as err:
        return {"ok": False, "details": {"error": err.as_dict()}}


def health_snapshot(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    probe = probe_live_read(runtime)
    required_ready = runtime["details"]["CALLSCRUB_API_KEY"]["present"] and runtime["details"]["CALLSCRUB_API_BASE_URL"]["present"]
    live_ready = bool(probe.get("ok"))
    if not required_ready:
        status = "needs_setup"
        summary = "Configure CALLSCRUB_API_KEY and CALLSCRUB_API_BASE_URL in operator-controlled service keys before live CallScrub reads."
        next_steps = [
            "Set CALLSCRUB_API_KEY in operator-controlled service keys.",
            "Set CALLSCRUB_API_BASE_URL to the CallScrub API host in operator-controlled service keys.",
            "Use local CALLSCRUB_* environment variables only as development harness fallback.",
        ]
    elif not live_ready:
        status = "degraded"
        summary = "CallScrub service keys are present, but the live read probe failed."
        next_steps = ["Verify the CallScrub API base URL and key.", "Confirm the API key has call and agent read scopes."]
    else:
        status = "ready"
        summary = "CallScrub credentials and API reachability are ready for the sampled call/agent read probe."
        next_steps = [
            "Use read-only commands, and tenant-smoke each resource family before advertising production readiness for that family.",
            "Transcript, coaching, team, and report commands are implemented but not separately tenant-smoked in this repo.",
        ]
    return {
        "status": status,
        "summary": summary,
        "connector": {
            "backend": BACKEND_NAME,
            "label": CONNECTOR_LABEL,
            "category": CONNECTOR_CATEGORY,
            "categories": list(CONNECTOR_CATEGORIES),
            "resources": list(CONNECTOR_RESOURCES),
            "live_backend_available": True,
            "live_backend_probe_ok": live_ready,
            "live_read_available": True,
            "sampled_read_probe_ok": live_ready,
            "write_bridge_available": False,
            "scaffold_only": False,
        },
        "auth": {
            "required_service_keys": ["CALLSCRUB_API_KEY", "CALLSCRUB_API_BASE_URL"],
            "missing_service_keys": [name for name in ("CALLSCRUB_API_KEY", "CALLSCRUB_API_BASE_URL") if not runtime["details"][name]["present"]],
            "service_key_sources": {
                "CALLSCRUB_API_KEY": runtime["details"]["CALLSCRUB_API_KEY"]["source"],
                "CALLSCRUB_API_BASE_URL": runtime["details"]["CALLSCRUB_API_BASE_URL"]["source"],
            },
            "local_env_fallback": True,
        },
        "probe": probe,
        "next_steps": next_steps,
    }


def doctor_snapshot(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    return {
        "health": health_snapshot(ctx_obj),
        "config": redacted_config_snapshot(ctx_obj),
        "manifest": _manifest_status(),
        "runtime": {
            "implementation_mode": "live_read_only",
            "supported_read_commands": list(READ_COMMANDS),
            "write_bridge_available": False,
            "tenant_smoke_tested": False,
            "sampled_probe_commands": ["call.list", "agent.list"],
        },
    }


def call_list_result(ctx_obj: dict[str, Any], *, team_id: str | None = None, agent_name: str | None = None, date_range: str | None = None, limit: int = 25) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    payload = create_client(ctx_obj).list_calls(team_id=team_id or runtime["team_id"], agent_name=agent_name or runtime["agent_name"], date_range=date_range or runtime["date_range"], limit=limit)
    calls = _as_list(payload, "calls", "data", "items")
    return {"calls": calls, "call_count": len(calls), "raw": payload, "picker": {"kind": "call", "items": _picker_items(calls, kind="call", label_keys=("title", "agent_name", "disposition"), subtitle_keys=("date", "score"))}, "scope_preview": _scope_preview(command_id="call.list", selection_surface="call", team_id=team_id or runtime["team_id"], agent_name=agent_name or runtime["agent_name"], date_range=date_range or runtime["date_range"], limit=limit)}


def call_get_result(ctx_obj: dict[str, Any], call_id: str | None = None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved = _required((call_id or runtime["call_id"]).strip(), code="CALLSCRUB_CALL_ID_REQUIRED", message="A call ID is required.", env="CALLSCRUB_CALL_ID")
    return {"call": create_client(ctx_obj).get_call(resolved), "scope_preview": _scope_preview(command_id="call.get", selection_surface="call", call_id=resolved)}


def transcript_get_result(ctx_obj: dict[str, Any], call_id: str | None = None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved = _required((call_id or runtime["call_id"]).strip(), code="CALLSCRUB_CALL_ID_REQUIRED", message="A call ID is required.", env="CALLSCRUB_CALL_ID")
    return {"transcript": create_client(ctx_obj).get_transcript(resolved), "scope_preview": _scope_preview(command_id="transcript.get", selection_surface="transcript", call_id=resolved)}


def transcript_search_result(ctx_obj: dict[str, Any], *, query: str | None = None, limit: int = 20) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved = _required((query or runtime["search_query"]).strip(), code="CALLSCRUB_SEARCH_QUERY_REQUIRED", message="A transcript search query is required.", env="CALLSCRUB_SEARCH_QUERY")
    payload = create_client(ctx_obj).search_transcripts(query=resolved, limit=limit)
    results = _as_list(payload, "results", "transcripts", "data", "items")
    return {"results": results, "result_count": len(results), "raw": payload, "scope_preview": _scope_preview(command_id="transcript.search", selection_surface="transcript", query=resolved, limit=limit)}


def coaching_list_result(ctx_obj: dict[str, Any], *, limit: int = 10) -> dict[str, Any]:
    payload = create_client(ctx_obj).list_coaching(limit=limit)
    reports = _as_list(payload, "coaching", "reports", "data", "items")
    return {"coaching": reports, "coaching_count": len(reports), "raw": payload, "picker": {"kind": "coaching", "items": _picker_items(reports, kind="coaching", label_keys=("summary", "title", "agent_name"), subtitle_keys=("call_id", "created"))}, "scope_preview": _scope_preview(command_id="coaching.list", selection_surface="coaching", limit=limit)}


def coaching_get_result(ctx_obj: dict[str, Any], coaching_id: str | None = None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved = _required((coaching_id or runtime["coaching_id"]).strip(), code="CALLSCRUB_COACHING_ID_REQUIRED", message="A coaching report ID is required.", env="CALLSCRUB_COACHING_ID")
    return {"coaching": create_client(ctx_obj).get_coaching(resolved), "scope_preview": _scope_preview(command_id="coaching.get", selection_surface="coaching", coaching_id=resolved)}


def agent_list_result(ctx_obj: dict[str, Any], *, limit: int = 50) -> dict[str, Any]:
    payload = create_client(ctx_obj).list_agents(limit=limit)
    agents = _as_list(payload, "agents", "data", "items")
    return {"agents": agents, "agent_count": len(agents), "raw": payload, "picker": {"kind": "agent", "items": _picker_items(agents, kind="agent", label_keys=("name", "agent_name"), subtitle_keys=("team", "avg_score"))}, "scope_preview": _scope_preview(command_id="agent.list", selection_surface="agent", limit=limit)}


def agent_stats_result(ctx_obj: dict[str, Any], *, agent_name: str | None = None, date_range: str | None = None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved = _required((agent_name or runtime["agent_name"]).strip(), code="CALLSCRUB_AGENT_NAME_REQUIRED", message="An agent name is required.", env="CALLSCRUB_AGENT_NAME")
    return {"stats": create_client(ctx_obj).agent_stats(agent_name=resolved, date_range=date_range or runtime["date_range"]), "scope_preview": _scope_preview(command_id="agent.stats", selection_surface="agent", agent_name=resolved, date_range=date_range or runtime["date_range"])}


def agent_scorecard_result(ctx_obj: dict[str, Any], *, agent_name: str | None = None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved = _required((agent_name or runtime["agent_name"]).strip(), code="CALLSCRUB_AGENT_NAME_REQUIRED", message="An agent name is required.", env="CALLSCRUB_AGENT_NAME")
    return {"scorecard": create_client(ctx_obj).agent_scorecard(agent_name=resolved), "scope_preview": _scope_preview(command_id="agent.scorecard", selection_surface="agent", agent_name=resolved)}


def team_list_result(ctx_obj: dict[str, Any], *, limit: int = 20) -> dict[str, Any]:
    payload = create_client(ctx_obj).list_teams(limit=limit)
    teams = _as_list(payload, "teams", "data", "items")
    return {"teams": teams, "team_count": len(teams), "raw": payload, "picker": {"kind": "team", "items": _picker_items(teams, kind="team", label_keys=("name", "team_name"), subtitle_keys=("agent_count", "avg_score"))}, "scope_preview": _scope_preview(command_id="team.list", selection_surface="team", limit=limit)}


def team_stats_result(ctx_obj: dict[str, Any], *, team_id: str | None = None, date_range: str | None = None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved = _required((team_id or runtime["team_id"]).strip(), code="CALLSCRUB_TEAM_ID_REQUIRED", message="A team ID is required.", env="CALLSCRUB_TEAM_ID")
    return {"stats": create_client(ctx_obj).team_stats(team_id=resolved, date_range=date_range or runtime["date_range"]), "scope_preview": _scope_preview(command_id="team.stats", selection_surface="team", team_id=resolved, date_range=date_range or runtime["date_range"])}


def report_list_result(ctx_obj: dict[str, Any], *, report_type: str | None = None, date_range: str | None = None, limit: int = 10) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    payload = create_client(ctx_obj).list_reports(report_type=report_type or runtime["report_type"], date_range=date_range or runtime["date_range"], limit=limit)
    reports = _as_list(payload, "reports", "data", "items")
    return {"reports": reports, "report_count": len(reports), "raw": payload, "scope_preview": _scope_preview(command_id="report.list", selection_surface="report", report_type=report_type or runtime["report_type"], date_range=date_range or runtime["date_range"], limit=limit)}
