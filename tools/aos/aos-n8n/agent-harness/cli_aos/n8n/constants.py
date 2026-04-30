from __future__ import annotations

TOOL_NAME = "aos-n8n"
BACKEND_NAME = "n8n-live-bridge"
MANIFEST_SCHEMA_VERSION = "1.0.0"
MODE_ORDER = ["readonly", "write", "full", "admin"]

N8N_API_URL_ENV = "N8N_API_URL"
N8N_API_KEY_ENV = "N8N_API_KEY"
N8N_WEBHOOK_BASE_URL_ENV = "N8N_WEBHOOK_BASE_URL"
N8N_WORKSPACE_NAME_ENV = "N8N_WORKSPACE_NAME"
N8N_WORKFLOW_ID_ENV = "N8N_WORKFLOW_ID"
N8N_WORKFLOW_NAME_ENV = "N8N_WORKFLOW_NAME"
N8N_WORKFLOW_STATUS_ENV = "N8N_WORKFLOW_STATUS"

CONNECTOR_LABEL = "n8n"
CONNECTOR_CATEGORY = "automation-orchestration"
CONNECTOR_CATEGORIES = ["automation-orchestration", "workflow-automation", "integrations"]
CONNECTOR_RESOURCES = ["workflow", "execution", "trigger"]

WORKFLOW_TRIGGER_EVENT_HINTS = [
    {
        "value": "manual",
        "label": "Manual",
        "description": "Human-initiated trigger from the worker.",
    },
    {
        "value": "webhook",
        "label": "Webhook",
        "description": "External event routed through a webhook.",
    },
    {
        "value": "schedule",
        "label": "Schedule",
        "description": "Timer or cron-driven trigger.",
    },
    {
        "value": "replay",
        "label": "Replay",
        "description": "Replay of a prior event or execution.",
    },
    {
        "value": "custom",
        "label": "Custom",
        "description": "Any other free-form event label.",
    },
]

WORKFLOW_TRIGGER_PAYLOAD_HINTS = {
    "type": "object",
    "shape": "flat key-value map",
    "description": "Repeated --payload key=value flags are merged into the JSON body as string fields.",
    "example": {"source": "agent", "reason": "follow-up"},
    "notes": [
        "Nested objects are not supported by the CLI payload flags.",
        "Values are passed through as strings.",
    ],
}

WORKFLOW_TRIGGER_RESPONSE_HINTS = {
    "type": "json",
    "normalized_fields": [
        "ok",
        "status_code",
        "response_kind",
        "execution_id",
        "response_status",
        "summary",
        "trigger_url_redacted",
    ],
    "description": "The webhook bridge normalizes response metadata so UI code can show success and execution IDs without parsing raw JSON.",
}

AUTH_DESCRIPTOR = {
    "kind": "service-key",
    "required": True,
    "service_keys": [N8N_API_URL_ENV, N8N_API_KEY_ENV, N8N_WEBHOOK_BASE_URL_ENV],
    "interactive_setup": [
        "Create or connect an n8n instance for the workspace you want this worker to use.",
        f"Add {N8N_API_URL_ENV}, {N8N_API_KEY_ENV}, and {N8N_WEBHOOK_BASE_URL_ENV} in operator-controlled API Keys.",
        f"Use local {N8N_API_URL_ENV}, {N8N_API_KEY_ENV}, and {N8N_WEBHOOK_BASE_URL_ENV} values only as harness fallbacks when operator keys are unavailable.",
        "workflow.list and workflow.status use the live n8n API read path.",
        "workflow.trigger posts a live webhook execution payload through the bridge.",
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
        "id": "workflow.list",
        "summary": "List workflows from the live n8n API",
        "required_mode": "readonly",
        "supports_json": True,
        "resource": "workflow",
        "action_class": "read",
    },
    {
        "id": "workflow.status",
        "summary": "Read live workflow status from the n8n API",
        "required_mode": "readonly",
        "supports_json": True,
        "resource": "workflow",
        "action_class": "read",
    },
    {
        "id": "workflow.trigger",
        "summary": "Trigger a live n8n workflow execution bridge",
        "required_mode": "write",
        "supports_json": True,
        "resource": "workflow",
        "action_class": "write",
    },
]

WRITE_COMMAND_IDS = {"workflow.trigger"}
