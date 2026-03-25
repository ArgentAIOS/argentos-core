from pathlib import Path

MODE_ORDER = ["readonly", "write", "full", "admin"]
CONNECTOR_PATH = Path(__file__).resolve().parents[3] / "connector.json"
PERMISSIONS_PATH = Path(__file__).resolve().parents[2] / "permissions.json"
MANIFEST_SCHEMA_VERSION = "1.0.0"
DEFAULT_GWS_BIN = "gws"
