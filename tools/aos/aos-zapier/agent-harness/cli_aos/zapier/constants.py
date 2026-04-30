from __future__ import annotations

from typing import Any

TOOL_NAME = "aos-zapier"
BACKEND_NAME = "zapier-bridge"
MANIFEST_SCHEMA_VERSION = "1.0.0"
MODE_ORDER = ["readonly", "write", "full", "admin"]

ZAPIER_API_URL_ENV = "ZAPIER_API_URL"
ZAPIER_API_KEY_ENV = "ZAPIER_API_KEY"
ZAPIER_WEBHOOK_BASE_URL_ENV = "ZAPIER_WEBHOOK_BASE_URL"
ZAPIER_WORKSPACE_NAME_ENV = "ZAPIER_WORKSPACE_NAME"
ZAPIER_ZAP_ID_ENV = "ZAPIER_ZAP_ID"
ZAPIER_ZAP_NAME_ENV = "ZAPIER_ZAP_NAME"
ZAPIER_ZAP_STATUS_ENV = "ZAPIER_ZAP_STATUS"

CONNECTOR_LABEL = "Zapier"
CONNECTOR_CATEGORY = "automation-orchestration"
CONNECTOR_CATEGORIES = ["automation-orchestration", "workflow-automation", "integrations"]
CONNECTOR_RESOURCES = ["zap", "trigger", "workspace"]

TRIGGER_EVENT_HINTS = ["manual", "scheduled", "webhook", "test"]
TRIGGER_PAYLOAD_EXAMPLE = {
    "source": "agent",
    "reason": "manual",
}
TRIGGER_RESPONSE_ACK_FIELDS = ["status", "state", "result", "message"]
TRIGGER_RESPONSE_RESULT_FIELDS = ["response", "result"]

AUTH_DESCRIPTOR = {
    "kind": "service-key",
    "required": True,
    "service_keys": [ZAPIER_API_URL_ENV, ZAPIER_API_KEY_ENV],
    "interactive_setup": [
        f"Add {ZAPIER_API_URL_ENV} and {ZAPIER_API_KEY_ENV} in operator-controlled API Keys to point at the live Zapier bridge.",
        f"Add {ZAPIER_WEBHOOK_BASE_URL_ENV} in API Keys when you want future webhook URLs to use a stable public base; local env is only a harness fallback.",
        f"Use local env only as a harness fallback when operator-controlled API Keys are unavailable.",
        f"Set {ZAPIER_WORKSPACE_NAME_ENV}, {ZAPIER_ZAP_ID_ENV}, {ZAPIER_ZAP_NAME_ENV}, and {ZAPIER_ZAP_STATUS_ENV} to preview the zap scope shown to workers.",
        "zap.trigger now uses the configured bridge when POST /trigger is available.",
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
        "id": "zap.list",
        "summary": "List Zapier zaps through the configured bridge",
        "required_mode": "readonly",
        "supports_json": True,
        "resource": "zap",
        "action_class": "read",
    },
    {
        "id": "zap.status",
        "summary": "Read Zapier zap status through the configured bridge",
        "required_mode": "readonly",
        "supports_json": True,
        "resource": "zap",
        "action_class": "read",
    },
    {
        "id": "zap.trigger",
        "summary": "Trigger a Zapier zap through the configured bridge",
        "required_mode": "write",
        "supports_json": True,
        "resource": "zap",
        "action_class": "write",
        "input_hints": {
            "event": {
                "default": "manual",
                "suggested_values": TRIGGER_EVENT_HINTS,
                "description": "Trigger label forwarded to the configured Zapier bridge.",
            },
            "payload": {
                "kind": "object",
                "input_mode": "key_value_pairs_or_json",
                "example": TRIGGER_PAYLOAD_EXAMPLE,
                "description": "Repeated --payload key=value entries become a JSON object; --payload-json can supply the object directly.",
            },
            "response": {
                "acknowledged_from": TRIGGER_RESPONSE_ACK_FIELDS,
                "result_from": TRIGGER_RESPONSE_RESULT_FIELDS,
            },
        },
    },
]

WRITE_COMMAND_IDS = {"zap.trigger"}


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
        normalized_response["result_keys"] = [
            field for field in TRIGGER_RESPONSE_RESULT_FIELDS if field in response_payload
        ]

    return {
        "command_id": "zap.trigger",
        "selection_surface": "zap",
        "event": {
            "default": "manual",
            "suggested_values": TRIGGER_EVENT_HINTS,
            "description": "Trigger label forwarded to the configured Zapier bridge.",
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
            "workspace_name": runtime.get("workspace_name"),
            "zap_id": runtime.get("zap_id"),
            "event": "manual",
            "payload": TRIGGER_PAYLOAD_EXAMPLE,
        },
    }
