from __future__ import annotations

from pathlib import Path

TOOL_NAME = "aos-supabase"
BACKEND_NAME = "supabase-api"
SUPABASE_URL_ENV = "SUPABASE_URL"
SUPABASE_SERVICE_ROLE_KEY_ENV = "SUPABASE_SERVICE_ROLE_KEY"
SUPABASE_ANON_KEY_ENV = "SUPABASE_ANON_KEY"
SUPABASE_TABLE_ENV = "SUPABASE_TABLE"
SUPABASE_BUCKET_ENV = "SUPABASE_BUCKET"

MODE_ORDER = ["readonly", "write", "full", "admin"]
HARNESS_ROOT = Path(__file__).resolve().parents[2]
CONNECTOR_PATH = HARNESS_ROOT.parent / "connector.json"
PERMISSIONS_PATH = HARNESS_ROOT / "permissions.json"
