from __future__ import annotations

from pathlib import Path

MODE_ORDER = ["readonly", "write", "full", "admin"]
HARNESS_ROOT = Path(__file__).resolve().parents[2]
REPO_ROOT = Path(__file__).resolve().parents[3]
PERMISSIONS_PATH = HARNESS_ROOT / "permissions.json"
CONNECTOR_META_PATH = REPO_ROOT / "connector.json"
DEFAULT_ENVIRONMENT = "sandbox"
DEFAULT_API_BASE = "https://quickbooks.api.intuit.com"
