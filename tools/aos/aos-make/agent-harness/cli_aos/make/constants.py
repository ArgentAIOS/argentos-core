from __future__ import annotations

from typing import Any

TOOL_NAME = "aos-make"
BACKEND_NAME = "make-live-bridge"
MANIFEST_SCHEMA_VERSION = "1.0.0"
MODE_ORDER = ["readonly", "write", "full", "admin"]

MAKE_API_URL_ENV = "MAKE_API_URL"
MAKE_API_KEY_ENV = "MAKE_API_KEY"
MAKE_WEBHOOK_BASE_URL_ENV = "MAKE_WEBHOOK_BASE_URL"
MAKE_ORGANIZATION_ID_ENV = "MAKE_ORGANIZATION_ID"
MAKE_ORGANIZATION_NAME_ENV = "MAKE_ORGANIZATION_NAME"
MAKE_TEAM_ID_ENV = "MAKE_TEAM_ID"
MAKE_TEAM_NAME_ENV = "MAKE_TEAM_NAME"
MAKE_SCENARIO_ID_ENV = "MAKE_SCENARIO_ID"
MAKE_SCENARIO_NAME_ENV = "MAKE_SCENARIO_NAME"
MAKE_SCENARIO_STATUS_ENV = "MAKE_SCENARIO_STATUS"
MAKE_CONNECTION_ID_ENV = "MAKE_CONNECTION_ID"
MAKE_CONNECTION_NAME_ENV = "MAKE_CONNECTION_NAME"
MAKE_EXECUTION_ID_ENV = "MAKE_EXECUTION_ID"
MAKE_RUN_ID_ENV = "MAKE_RUN_ID"

CONNECTOR_LABEL = "Make"
CONNECTOR_CATEGORY = "automation-orchestration"
CONNECTOR_CATEGORIES = ["automation-orchestration", "workflow-automation", "integrations"]
CONNECTOR_RESOURCES = ["organization", "team", "scenario", "connection", "execution", "run"]

TRIGGER_EVENT_HINTS = ["manual", "webhook", "scheduled", "replay", "custom"]
TRIGGER_PAYLOAD_EXAMPLE = {"source": "agent", "reason": "follow-up"}
TRIGGER_RESPONSE_ACK_FIELDS = ["status", "state", "result", "message"]
TRIGGER_RESPONSE_RESULT_FIELDS = ["response", "result"]

AUTH_DESCRIPTOR = {
    "kind": "service-key",
    "required": True,
    "service_keys": [MAKE_API_URL_ENV, MAKE_API_KEY_ENV],
    "optional_service_keys": [
        MAKE_WEBHOOK_BASE_URL_ENV,
        MAKE_ORGANIZATION_ID_ENV,
        MAKE_ORGANIZATION_NAME_ENV,
        MAKE_TEAM_ID_ENV,
        MAKE_TEAM_NAME_ENV,
        MAKE_SCENARIO_ID_ENV,
        MAKE_SCENARIO_NAME_ENV,
        MAKE_SCENARIO_STATUS_ENV,
        MAKE_CONNECTION_ID_ENV,
        MAKE_CONNECTION_NAME_ENV,
        MAKE_EXECUTION_ID_ENV,
        MAKE_RUN_ID_ENV,
    ],
    "interactive_setup": [
        "Connect or proxy a live Make bridge for the workspace you want this worker to use.",
        f"Add {MAKE_API_URL_ENV} and {MAKE_API_KEY_ENV} in operator-controlled service keys.",
        f"Optionally set {MAKE_WEBHOOK_BASE_URL_ENV} if you need a stable public base for trigger execution callbacks.",
        f"Optionally set {MAKE_ORGANIZATION_NAME_ENV}, {MAKE_TEAM_NAME_ENV}, {MAKE_SCENARIO_NAME_ENV}, and {MAKE_CONNECTION_NAME_ENV} in service keys to preview the selected scope.",
        "Use local MAKE_* environment variables only as harness fallbacks when operator keys are unavailable.",
        "Scoped service-key entries must be injected by the operator runtime and are not bypassed with local env.",
        "scenario.list, scenario.status, connection.list, and execution.list use the live Make read path.",
        "scenario.trigger and execution.run post a live execution payload through the configured bridge.",
        "Production live-write smoke is not claimed until tested against an operator Make bridge.",
    ],
}

GLOBAL_COMMAND_SPECS = [
    {
        "id": "capabilities",
        "summary": "Describe the connector manifest",
        "required_mode": "readonly",
        "supports_json": True,
        "resource": "connector",
        "action_class": "read",
    },
    {
        "id": "health",
        "summary": "Report connector health and setup readiness",
        "required_mode": "readonly",
        "supports_json": True,
        "resource": "connector",
        "action_class": "read",
    },
    {
        "id": "config.show",
        "summary": "Show redacted connector configuration",
        "required_mode": "readonly",
        "supports_json": True,
        "resource": "connector",
        "action_class": "read",
    },
    {
        "id": "doctor",
        "summary": "Run connector diagnostics",
        "required_mode": "readonly",
        "supports_json": True,
        "resource": "connector",
        "action_class": "read",
    },
]

COMMAND_SPECS = [
    {
        "id": "organization.list",
        "summary": "List Make organizations from the live bridge",
        "required_mode": "readonly",
        "supports_json": True,
        "resource": "organization",
        "action_class": "read",
    },
    {
        "id": "team.list",
        "summary": "List Make teams from the live bridge",
        "required_mode": "readonly",
        "supports_json": True,
        "resource": "team",
        "action_class": "read",
    },
    {
        "id": "scenario.list",
        "summary": "List Make scenarios from the live bridge",
        "required_mode": "readonly",
        "supports_json": True,
        "resource": "scenario",
        "action_class": "read",
    },
    {
        "id": "scenario.status",
        "summary": "Read Make scenario status from the live bridge",
        "required_mode": "readonly",
        "supports_json": True,
        "resource": "scenario",
        "action_class": "read",
    },
    {
        "id": "connection.list",
        "summary": "List Make connections from the live bridge",
        "required_mode": "readonly",
        "supports_json": True,
        "resource": "connection",
        "action_class": "read",
    },
    {
        "id": "execution.list",
        "summary": "List Make executions from the live bridge",
        "required_mode": "readonly",
        "supports_json": True,
        "resource": "execution",
        "action_class": "read",
    },
    {
        "id": "execution.status",
        "summary": "Read Make execution status from the live bridge",
        "required_mode": "readonly",
        "supports_json": True,
        "resource": "execution",
        "action_class": "read",
    },
    {
        "id": "scenario.trigger",
        "summary": "Trigger a live Make scenario execution with builder hints",
        "required_mode": "write",
        "supports_json": True,
        "resource": "scenario",
        "action_class": "write",
        "input_hints": {
            "event": {
                "type": "string",
                "default": "manual",
                "suggested_values": TRIGGER_EVENT_HINTS,
                "description": "Free-form event label passed through to the live bridge.",
            },
            "payload": {
                "type": "object",
                "shape": "flat key-value map",
                "description": "Repeated --payload key=value flags are merged into the JSON body as string fields.",
                "example": TRIGGER_PAYLOAD_EXAMPLE,
            },
        },
        "response_hints": {
            "type": "json",
            "normalized_fields": ["ok", "status_code", "response_kind", "execution_id", "response_status", "summary", "trigger_url_redacted"],
            "description": "The bridge normalizes response metadata so UI code can show success state and execution IDs without parsing raw JSON.",
        },
    },
    {
        "id": "execution.run",
        "summary": "Run a live Make scenario execution with builder hints",
        "required_mode": "write",
        "supports_json": True,
        "resource": "execution",
        "action_class": "write",
        "input_hints": {
            "event": {
                "type": "string",
                "default": "manual",
                "suggested_values": TRIGGER_EVENT_HINTS,
                "description": "Free-form event label passed through to the live bridge.",
            },
            "payload": {
                "type": "object",
                "shape": "flat key-value map",
                "description": "Repeated --payload key=value flags are merged into the JSON body as string fields.",
                "example": TRIGGER_PAYLOAD_EXAMPLE,
            },
        },
        "response_hints": {
            "type": "json",
            "normalized_fields": ["ok", "status_code", "response_kind", "execution_id", "response_status", "summary", "trigger_url_redacted"],
            "description": "The bridge normalizes response metadata so UI code can show success state and execution IDs without parsing raw JSON.",
        },
    },
]

WRITE_COMMAND_IDS = {"scenario.trigger", "execution.run"}


def trigger_builder_hints(
    *,
    runtime: dict[str, Any] | None = None,
    probe: dict[str, Any] | None = None,
    payload: dict[str, Any] | None = None,
    response: Any | None = None,
) -> dict[str, Any]:
    runtime = runtime or {}
    probe = probe or {}
    probe_details = probe.get("details", {}) if isinstance(probe, dict) else {}
    write_probe = probe_details.get("write_probe", {}) if isinstance(probe_details, dict) else {}
    write_probe_details = write_probe.get("details", {}) if isinstance(write_probe, dict) else {}
    response_payload = response if isinstance(response, dict) else None
    normalized_response = {
        "acknowledged": None,
        "result_keys": [],
        "response_keys": [],
    }
    if response_payload is not None:
        normalized_response["acknowledged"] = next(
            (
                str(response_payload.get(field)).strip()
                for field in TRIGGER_RESPONSE_ACK_FIELDS
                if response_payload.get(field) is not None and str(response_payload.get(field)).strip()
            ),
            None,
        )
        normalized_response["response_keys"] = sorted(response_payload.keys())
        normalized_response["result_keys"] = [field for field in TRIGGER_RESPONSE_RESULT_FIELDS if field in response_payload]

    return {
        "command_id": "scenario.trigger",
        "selection_surface": "scenario",
        "event": {
            "default": "manual",
            "suggested_values": TRIGGER_EVENT_HINTS,
            "description": "Free-form event label forwarded to the configured Make bridge.",
        },
        "payload": {
            "kind": "object",
            "input_mode": "key_value_pairs_or_json",
            "example": TRIGGER_PAYLOAD_EXAMPLE,
            "payload_keys": sorted(payload.keys()) if payload else [],
            "description": "Repeated --payload key=value entries become a JSON object; --payload-json can supply the object directly.",
        },
        "bridge": {
            "available": bool(probe_details.get("write_bridge_available")) if probe_details else None,
            "endpoint": write_probe_details.get("endpoint"),
            "probe_method": write_probe_details.get("method"),
            "execution_method": "POST",
            "allow": write_probe_details.get("allow"),
        },
        "response_normalization": {
            "acknowledged_from": TRIGGER_RESPONSE_ACK_FIELDS,
            "result_from": TRIGGER_RESPONSE_RESULT_FIELDS,
            "normalized": normalized_response,
        },
        "request_template": {
            "request_method": "POST",
            "organization_name": runtime.get("organization_name"),
            "team_name": runtime.get("team_name"),
            "scenario_id": runtime.get("scenario_id"),
            "scenario_name": runtime.get("scenario_name"),
            "connection_id": runtime.get("connection_id"),
            "event": "manual",
            "payload": TRIGGER_PAYLOAD_EXAMPLE,
        },
    }
