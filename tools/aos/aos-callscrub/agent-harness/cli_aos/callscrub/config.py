from __future__ import annotations

from typing import Any

from .constants import BACKEND_NAME, CONNECTOR_CATEGORIES, CONNECTOR_CATEGORY, CONNECTOR_LABEL, CONNECTOR_RESOURCES
from .service_keys import service_key_details

SERVICE_KEY_NAMES = (
    "CALLSCRUB_API_KEY",
    "CALLSCRUB_API_BASE_URL",
    "CALLSCRUB_TEAM_ID",
    "CALLSCRUB_AGENT_NAME",
    "CALLSCRUB_CALL_ID",
    "CALLSCRUB_COACHING_ID",
    "CALLSCRUB_DATE_RANGE",
    "CALLSCRUB_SEARCH_QUERY",
    "CALLSCRUB_REPORT_TYPE",
)


def _detail(name: str, ctx_obj: dict[str, Any] | None) -> dict[str, Any]:
    return service_key_details(name, ctx_obj)


def resolve_runtime_values(ctx_obj: dict[str, Any] | None = None) -> dict[str, Any]:
    ctx_obj = ctx_obj or {}
    details = {name: _detail(name, ctx_obj) for name in SERVICE_KEY_NAMES}
    return {
        "backend": BACKEND_NAME,
        "api_key": details["CALLSCRUB_API_KEY"]["value"],
        "api_base_url": details["CALLSCRUB_API_BASE_URL"]["value"].rstrip("/"),
        "team_id": details["CALLSCRUB_TEAM_ID"]["value"],
        "agent_name": details["CALLSCRUB_AGENT_NAME"]["value"],
        "call_id": details["CALLSCRUB_CALL_ID"]["value"],
        "coaching_id": details["CALLSCRUB_COACHING_ID"]["value"],
        "date_range": details["CALLSCRUB_DATE_RANGE"]["value"],
        "search_query": details["CALLSCRUB_SEARCH_QUERY"]["value"],
        "report_type": details["CALLSCRUB_REPORT_TYPE"]["value"],
        "details": details,
        "service_keys": ["CALLSCRUB_API_KEY", "CALLSCRUB_API_BASE_URL"],
        "optional_scope_service_keys": [
            "CALLSCRUB_TEAM_ID",
            "CALLSCRUB_AGENT_NAME",
            "CALLSCRUB_CALL_ID",
            "CALLSCRUB_COACHING_ID",
            "CALLSCRUB_DATE_RANGE",
            "CALLSCRUB_SEARCH_QUERY",
            "CALLSCRUB_REPORT_TYPE",
        ],
    }


def _redact(value: str) -> str:
    return "<redacted>" if value else ""


def redacted_config_snapshot(ctx_obj: dict[str, Any] | None = None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    details = runtime["details"]
    return {
        "backend": runtime["backend"],
        "api_base_url": runtime["api_base_url"],
        "api_base_url_source": details["CALLSCRUB_API_BASE_URL"]["source"],
        "api_key": _redact(runtime["api_key"]),
        "api_key_source": details["CALLSCRUB_API_KEY"]["source"],
        "team_id": runtime["team_id"],
        "team_id_source": details["CALLSCRUB_TEAM_ID"]["source"],
        "agent_name": runtime["agent_name"],
        "agent_name_source": details["CALLSCRUB_AGENT_NAME"]["source"],
        "call_id": runtime["call_id"],
        "call_id_source": details["CALLSCRUB_CALL_ID"]["source"],
        "coaching_id": runtime["coaching_id"],
        "coaching_id_source": details["CALLSCRUB_COACHING_ID"]["source"],
        "date_range": runtime["date_range"],
        "date_range_source": details["CALLSCRUB_DATE_RANGE"]["source"],
        "search_query": runtime["search_query"],
        "search_query_source": details["CALLSCRUB_SEARCH_QUERY"]["source"],
        "report_type": runtime["report_type"],
        "report_type_source": details["CALLSCRUB_REPORT_TYPE"]["source"],
    }


def config_snapshot(ctx_obj: dict[str, Any] | None = None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    command_defaults = {
        "call.list": {"selection_surface": "call", "args": ["CALLSCRUB_TEAM_ID", "CALLSCRUB_AGENT_NAME", "CALLSCRUB_DATE_RANGE"], "limit": 25},
        "call.get": {"selection_surface": "call", "args": ["CALLSCRUB_CALL_ID"]},
        "transcript.get": {"selection_surface": "transcript", "args": ["CALLSCRUB_CALL_ID"]},
        "transcript.search": {"selection_surface": "transcript", "args": ["CALLSCRUB_SEARCH_QUERY"], "limit": 20},
        "coaching.list": {"selection_surface": "coaching", "limit": 10},
        "coaching.get": {"selection_surface": "coaching", "args": ["CALLSCRUB_COACHING_ID"]},
        "agent.list": {"selection_surface": "agent", "limit": 50},
        "agent.stats": {"selection_surface": "agent", "args": ["CALLSCRUB_AGENT_NAME", "CALLSCRUB_DATE_RANGE"]},
        "agent.scorecard": {"selection_surface": "agent", "args": ["CALLSCRUB_AGENT_NAME"]},
        "team.list": {"selection_surface": "team", "limit": 20},
        "team.stats": {"selection_surface": "team", "args": ["CALLSCRUB_TEAM_ID", "CALLSCRUB_DATE_RANGE"]},
        "report.list": {"selection_surface": "report", "args": ["CALLSCRUB_REPORT_TYPE", "CALLSCRUB_DATE_RANGE"], "limit": 10},
    }
    return {
        "tool": "aos-callscrub",
        "backend": BACKEND_NAME,
        "auth": {
            "kind": "service-key",
            "service_keys": list(runtime["service_keys"]),
            "required_service_keys_present": {
                "CALLSCRUB_API_KEY": runtime["details"]["CALLSCRUB_API_KEY"]["present"],
                "CALLSCRUB_API_BASE_URL": runtime["details"]["CALLSCRUB_API_BASE_URL"]["present"],
            },
            "service_key_sources": {
                "CALLSCRUB_API_KEY": runtime["details"]["CALLSCRUB_API_KEY"]["source"],
                "CALLSCRUB_API_BASE_URL": runtime["details"]["CALLSCRUB_API_BASE_URL"]["source"],
            },
            "local_env_fallback": True,
        },
        "runtime": {
            "implementation_mode": "live_read_only",
            "command_defaults": command_defaults,
            "write_bridge_available": False,
            "scaffold_only": False,
        },
        "scope": redacted_config_snapshot(ctx_obj),
        "connector": {
            "label": CONNECTOR_LABEL,
            "category": CONNECTOR_CATEGORY,
            "categories": list(CONNECTOR_CATEGORIES),
            "resources": list(CONNECTOR_RESOURCES),
        },
    }
