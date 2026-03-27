from __future__ import annotations

from pathlib import Path

TOOL_NAME = "aos-salesforce"
BACKEND_NAME = "salesforce-api"
SALESFORCE_ACCESS_TOKEN_ENV = "SALESFORCE_ACCESS_TOKEN"
SALESFORCE_INSTANCE_URL_ENV = "SALESFORCE_INSTANCE_URL"
SALESFORCE_RECORD_ID_ENV = "SALESFORCE_RECORD_ID"
SALESFORCE_REPORT_ID_ENV = "SALESFORCE_REPORT_ID"

MODE_ORDER = ["readonly", "write", "full", "admin"]
HARNESS_ROOT = Path(__file__).resolve().parents[2]
CONNECTOR_PATH = HARNESS_ROOT.parent / "connector.json"
PERMISSIONS_PATH = HARNESS_ROOT / "permissions.json"
