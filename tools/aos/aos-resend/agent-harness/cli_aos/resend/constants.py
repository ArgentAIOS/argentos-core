from __future__ import annotations

from pathlib import Path

TOOL_NAME = "aos-resend"
BACKEND_NAME = "resend-api"
RESEND_API_KEY_ENV = "RESEND_API_KEY"
RESEND_FROM_EMAIL_ENV = "RESEND_FROM_EMAIL"
RESEND_AUDIENCE_ID_ENV = "RESEND_AUDIENCE_ID"
RESEND_DOMAIN_ID_ENV = "RESEND_DOMAIN_ID"

MODE_ORDER = ["readonly", "write", "full", "admin"]
HARNESS_ROOT = Path(__file__).resolve().parents[2]
CONNECTOR_PATH = HARNESS_ROOT.parent / "connector.json"
PERMISSIONS_PATH = HARNESS_ROOT / "permissions.json"
