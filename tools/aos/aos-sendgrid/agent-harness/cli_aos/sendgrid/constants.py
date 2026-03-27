from __future__ import annotations

from pathlib import Path

TOOL_NAME = "aos-sendgrid"
BACKEND_NAME = "sendgrid-api"
SENDGRID_API_KEY_ENV = "SENDGRID_API_KEY"
SENDGRID_FROM_EMAIL_ENV = "SENDGRID_FROM_EMAIL"
SENDGRID_TEMPLATE_ID_ENV = "SENDGRID_TEMPLATE_ID"
SENDGRID_LIST_ID_ENV = "SENDGRID_LIST_ID"

MODE_ORDER = ["readonly", "write", "full", "admin"]
HARNESS_ROOT = Path(__file__).resolve().parents[2]
CONNECTOR_PATH = HARNESS_ROOT.parent / "connector.json"
PERMISSIONS_PATH = HARNESS_ROOT / "permissions.json"
