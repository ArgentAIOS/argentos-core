from __future__ import annotations

from pathlib import Path

TOOL_NAME = "aos-perplexity"
BACKEND_NAME = "perplexity-api"
DEFAULT_BASE_URL = "https://api.perplexity.ai"
DEFAULT_MODEL = "llama-3.1-sonar-large-128k-online"
API_KEY_ENV = "PERPLEXITY_API_KEY"
MODEL_ENV = "PERPLEXITY_MODEL"
SEARCH_DOMAIN_ENV = "PERPLEXITY_SEARCH_DOMAIN"
BASE_URL_ENV = "PERPLEXITY_BASE_URL"
PERMISSIONS_PATH = Path(__file__).resolve().parents[2] / "permissions.json"
CONNECTOR_PATH = Path(__file__).resolve().parents[3] / "connector.json"
MODE_ORDER = ["readonly", "write", "full", "admin"]
