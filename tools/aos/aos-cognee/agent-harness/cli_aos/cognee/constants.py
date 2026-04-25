from __future__ import annotations

from pathlib import Path

TOOL_NAME = "aos-cognee"
MANIFEST_SCHEMA_VERSION = "1.0.0"
MODE_ORDER = ("readonly", "write", "full", "admin")
SEARCH_MODES = ("GRAPH_COMPLETION", "INSIGHTS", "SIMILARITY", "CHUNKS", "SUMMARIES")

CONNECTOR_ROOT = Path(__file__).resolve().parents[3]
HARNESS_ROOT = CONNECTOR_ROOT / "agent-harness"
CONNECTOR_PATH = CONNECTOR_ROOT / "connector.json"
PERMISSIONS_PATH = HARNESS_ROOT / "permissions.json"
