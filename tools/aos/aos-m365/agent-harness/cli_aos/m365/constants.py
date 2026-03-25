from __future__ import annotations

TOOL_NAME = "aos-m365"
CONNECTOR_LABEL = "Microsoft 365"
CONNECTOR_CATEGORY = "productivity-suite"
CONNECTOR_CATEGORIES = ["productivity-suite", "inbox", "calendar", "files-docs"]
CONNECTOR_RESOURCES = ["mail", "calendar", "file", "excel", "teams"]
MANIFEST_SCHEMA_VERSION = "1.0.0"
MODE_ORDER = ["readonly", "write", "full", "admin"]

CONNECTOR_AUTH = {
    "kind": "oauth-service-key",
    "required": True,
    "service_keys": ["M365_TENANT_ID", "M365_CLIENT_ID", "M365_CLIENT_SECRET"],
    "interactive_setup": [
        "Register an application in Microsoft Entra ID.",
        "Grant Microsoft Graph application permissions for the resources you want to read.",
        "Add M365_TENANT_ID, M365_CLIENT_ID, and M365_CLIENT_SECRET in API Keys.",
        "Set M365_TARGET_USER for mailbox, calendar, and OneDrive-backed reads.",
        "Use the live Teams and Excel picker commands to choose team, channel, workbook, worksheet, and range scope when you need those surfaces.",
    ],
}

GLOBAL_COMMAND_SPECS = [
    {
        "id": "health",
        "summary": "Report connector health and backend readiness",
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
        "id": "mail.search",
        "summary": "Search Outlook mail",
        "required_mode": "readonly",
        "supports_json": True,
        "resource": "mail",
        "action_class": "read",
    },
    {
        "id": "mail.read",
        "summary": "Read an Outlook message",
        "required_mode": "readonly",
        "supports_json": True,
        "resource": "mail",
        "action_class": "read",
    },
    {
        "id": "mail.reply",
        "summary": "Reply to an Outlook message",
        "required_mode": "write",
        "supports_json": True,
        "resource": "mail",
        "action_class": "write",
    },
    {
        "id": "mail.send",
        "summary": "Send a new Outlook message",
        "required_mode": "write",
        "supports_json": True,
        "resource": "mail",
        "action_class": "write",
    },
    {
        "id": "calendar.list",
        "summary": "List calendar events",
        "required_mode": "readonly",
        "supports_json": True,
        "resource": "calendar",
        "action_class": "read",
    },
    {
        "id": "calendar.create",
        "summary": "Create a calendar event",
        "required_mode": "write",
        "supports_json": True,
        "resource": "calendar",
        "action_class": "write",
    },
    {
        "id": "file.list",
        "summary": "List OneDrive or SharePoint files",
        "required_mode": "readonly",
        "supports_json": True,
        "resource": "file",
        "action_class": "read",
    },
    {
        "id": "excel.list_workbooks",
        "summary": "List workbook candidates from OneDrive or SharePoint",
        "required_mode": "readonly",
        "supports_json": True,
        "resource": "excel",
        "action_class": "read",
    },
    {
        "id": "excel.list_worksheets",
        "summary": "List worksheets for a workbook",
        "required_mode": "readonly",
        "supports_json": True,
        "resource": "excel",
        "action_class": "read",
    },
    {
        "id": "excel.used_range",
        "summary": "Read the used range for a worksheet",
        "required_mode": "readonly",
        "supports_json": True,
        "resource": "excel",
        "action_class": "read",
    },
    {
        "id": "excel.read_rows",
        "summary": "Read Excel rows",
        "required_mode": "readonly",
        "supports_json": True,
        "resource": "excel",
        "action_class": "read",
    },
    {
        "id": "excel.append_rows",
        "summary": "Append Excel rows",
        "required_mode": "write",
        "supports_json": True,
        "resource": "excel",
        "action_class": "write",
    },
    {
        "id": "teams.list_messages",
        "summary": "List Teams messages",
        "required_mode": "readonly",
        "supports_json": True,
        "resource": "teams",
        "action_class": "read",
    },
    {
        "id": "teams.list_teams",
        "summary": "List Teams teams available to the configured target user",
        "required_mode": "readonly",
        "supports_json": True,
        "resource": "teams",
        "action_class": "read",
    },
    {
        "id": "teams.list_channels",
        "summary": "List channels for a Teams team",
        "required_mode": "readonly",
        "supports_json": True,
        "resource": "teams",
        "action_class": "read",
    },
    {
        "id": "teams.reply_message",
        "summary": "Reply to a Teams message",
        "required_mode": "write",
        "supports_json": True,
        "resource": "teams",
        "action_class": "write",
    },
]

READ_COMMAND_IDS = {
    "mail.search",
    "mail.read",
    "calendar.list",
    "file.list",
    "excel.list_workbooks",
    "excel.list_worksheets",
    "excel.used_range",
    "excel.read_rows",
    "teams.list_messages",
    "teams.list_teams",
    "teams.list_channels",
}

WRITE_COMMAND_IDS = {
    "mail.reply",
    "mail.send",
    "calendar.create",
    "excel.append_rows",
    "teams.reply_message",
}
