from pathlib import Path

MODE_ORDER = ["readonly", "write", "full", "admin"]
PERMISSIONS_PATH = Path(__file__).resolve().parents[2] / "permissions.json"
DEFAULT_GWS_BIN = "gws"
