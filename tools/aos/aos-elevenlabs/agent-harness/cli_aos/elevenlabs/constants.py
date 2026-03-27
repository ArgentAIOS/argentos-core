from __future__ import annotations

from pathlib import Path

TOOL_NAME = "aos-elevenlabs"
BACKEND_NAME = "elevenlabs-api"

ELEVENLABS_API_KEY_ENV = "ELEVENLABS_API_KEY"
ELEVENLABS_BASE_URL_ENV = "ELEVENLABS_BASE_URL"
ELEVENLABS_VOICE_ID_ENV = "ELEVENLABS_VOICE_ID"
ELEVENLABS_MODEL_ID_ENV = "ELEVENLABS_MODEL_ID"
ELEVENLABS_HISTORY_ITEM_ID_ENV = "ELEVENLABS_HISTORY_ITEM_ID"

DEFAULT_BASE_URL = "https://api.elevenlabs.io"
DEFAULT_SYNTHESIS_OUTPUT_FORMAT = "mp3_44100_128"
DEFAULT_SFX_DURATION_SECONDS: float | None = None  # let API decide
DEFAULT_STABILITY: float = 0.5
DEFAULT_SIMILARITY_BOOST: float = 0.75
DEFAULT_STYLE: float = 0.0
MODE_ORDER = ["readonly", "write", "full", "admin"]

HARNESS_ROOT = Path(__file__).resolve().parents[2]
CONNECTOR_PATH = HARNESS_ROOT.parent / "connector.json"
PERMISSIONS_PATH = HARNESS_ROOT / "permissions.json"
