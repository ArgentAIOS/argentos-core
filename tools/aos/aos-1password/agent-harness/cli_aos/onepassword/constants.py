from __future__ import annotations

from pathlib import Path

TOOL_NAME = "aos-1password"
BACKEND_NAME = "1password-cli"

OP_PATH_ENV = "AOS_1PASSWORD_OP_PATH"
AOS_ACCOUNT_ENV = "AOS_1PASSWORD_ACCOUNT"
OP_ACCOUNT_ENV = "OP_ACCOUNT"
SERVICE_ACCOUNT_TOKEN_ENV = "OP_SERVICE_ACCOUNT_TOKEN"
VAULT_ENV = "AOS_1PASSWORD_VAULT"
ITEM_ENV = "AOS_1PASSWORD_ITEM"
FIELD_ENV = "AOS_1PASSWORD_FIELD"

MODE_ORDER = ["readonly", "write", "full", "admin"]

HARNESS_ROOT = Path(__file__).resolve().parents[2]
CONNECTOR_PATH = HARNESS_ROOT.parent / "connector.json"
PERMISSIONS_PATH = HARNESS_ROOT / "permissions.json"
