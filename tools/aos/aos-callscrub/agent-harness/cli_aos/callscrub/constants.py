from __future__ import annotations

from pathlib import Path

CONNECTOR_ROOT = Path(__file__).resolve().parents[3]
HARNESS_ROOT = CONNECTOR_ROOT / "agent-harness"
CONNECTOR_PATH = CONNECTOR_ROOT / "connector.json"
PERMISSIONS_PATH = HARNESS_ROOT / "permissions.json"

BACKEND_NAME = "callscrub-api"
CONNECTOR_LABEL = "CallScrub"
CONNECTOR_CATEGORY = "sales-analytics"
CONNECTOR_CATEGORIES = ("sales-analytics", "call-tracking", "coaching")
CONNECTOR_RESOURCES = ("call", "transcript", "coaching", "agent", "team", "report")
MODE_ORDER = ("readonly", "write", "admin")

READ_COMMANDS = (
    "call.list",
    "call.get",
    "transcript.get",
    "transcript.search",
    "coaching.list",
    "coaching.get",
    "agent.list",
    "agent.stats",
    "agent.scorecard",
    "team.list",
    "team.stats",
    "report.list",
)
