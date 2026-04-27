from __future__ import annotations

from pathlib import Path

CONNECTOR_ROOT = Path(__file__).resolve().parents[3]
HARNESS_ROOT = CONNECTOR_ROOT / "agent-harness"
CONNECTOR_PATH = CONNECTOR_ROOT / "connector.json"
PERMISSIONS_PATH = HARNESS_ROOT / "permissions.json"

BACKEND_NAME = "holace-api"
CONNECTOR_LABEL = "HoLaCe"
CONNECTOR_CATEGORY = "legal-practice"
CONNECTOR_CATEGORIES = ("legal-practice", "case-management", "personal-injury")
CONNECTOR_RESOURCES = ("case", "client", "document", "deadline", "settlement", "billing", "communication", "report")
MODE_ORDER = ("readonly", "write", "admin")

READ_COMMANDS = (
    "case.list",
    "case.get",
    "case.timeline",
    "client.list",
    "client.get",
    "document.list",
    "document.get",
    "deadline.list",
    "deadline.check_statute",
    "settlement.list",
    "settlement.get",
    "settlement.tracker",
    "billing.list",
    "communication.list",
    "report.case_status",
    "report.pipeline",
)
