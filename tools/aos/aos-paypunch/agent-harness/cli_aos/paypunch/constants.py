from __future__ import annotations

from pathlib import Path

CONNECTOR_ROOT = Path(__file__).resolve().parents[3]
HARNESS_ROOT = CONNECTOR_ROOT / "agent-harness"
CONNECTOR_PATH = CONNECTOR_ROOT / "connector.json"
PERMISSIONS_PATH = HARNESS_ROOT / "permissions.json"

BACKEND_NAME = "paypunch-api"
CONNECTOR_LABEL = "PayPunch"
CONNECTOR_CATEGORY = "time-tracking"
CONNECTOR_CATEGORIES = ("time-tracking", "payroll", "bookkeeping")
CONNECTOR_RESOURCES = ("timesheet", "employee", "company", "pay_period", "export", "report")
MODE_ORDER = ("readonly", "write", "admin")

READ_COMMANDS = (
    "timesheet.list",
    "timesheet.get",
    "employee.list",
    "employee.get",
    "company.list",
    "company.get",
    "export.quickbooks_iif",
    "export.csv",
    "pay_period.list",
    "pay_period.current",
    "report.hours_summary",
    "report.overtime",
    "capabilities",
    "config.show",
    "health",
    "doctor",
)
