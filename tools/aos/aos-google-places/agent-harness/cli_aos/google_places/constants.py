from __future__ import annotations

from pathlib import Path

TOOL_NAME = "aos-google-places"
MANIFEST_SCHEMA_VERSION = "1.0.0"
CONNECTOR_LABEL = "Google Places"
CONNECTOR_CATEGORY = "local-search"
CONNECTOR_CATEGORIES = ["local-search", "maps", "research"]
CONNECTOR_RESOURCES = ["search", "place", "resolve"]
MODE_ORDER = ["readonly", "write", "full", "admin"]
DEFAULT_GOOGLE_PLACES_BASE_URL = "https://places.googleapis.com/v1"
DEFAULT_GOOGLE_PLACES_API_KEY_ENV = "GOOGLE_PLACES_API_KEY"
PERMISSIONS_PATH = Path(__file__).resolve().parents[2] / "permissions.json"
CONNECTOR_AUTH = {
    "kind": "service-key",
    "required": True,
    "service_keys": [DEFAULT_GOOGLE_PLACES_API_KEY_ENV],
    "interactive_setup": [
        "Preferred: add GOOGLE_PLACES_API_KEY in ArgentOS API Keys.",
        "The connector resolves the key from Argent Service Keys first, then process.env.",
        "This connector is readonly and intended for local search and place lookup.",
    ],
}
SEARCH_FIELD_MASK = (
    "places.id,"
    "places.displayName,"
    "places.formattedAddress,"
    "places.location,"
    "places.rating,"
    "places.priceLevel,"
    "places.types,"
    "places.currentOpeningHours,"
    "nextPageToken"
)
DETAILS_FIELD_MASK = (
    "id,"
    "displayName,"
    "formattedAddress,"
    "location,"
    "rating,"
    "priceLevel,"
    "types,"
    "regularOpeningHours,"
    "currentOpeningHours,"
    "nationalPhoneNumber,"
    "websiteUri"
)
RESOLVE_FIELD_MASK = (
    "places.id,"
    "places.displayName,"
    "places.formattedAddress,"
    "places.location,"
    "places.types"
)
COMMAND_SPECS = [
    {
        "id": "health",
        "summary": "Check Google Places runtime readiness",
        "required_mode": "readonly",
        "supports_json": True,
        "resource": "search",
        "action_class": "read",
    },
    {
        "id": "doctor",
        "summary": "Run Google Places runtime diagnostics",
        "required_mode": "readonly",
        "supports_json": True,
        "resource": "search",
        "action_class": "read",
    },
    {
        "id": "config.show",
        "summary": "Show redacted Google Places connector config",
        "required_mode": "readonly",
        "supports_json": True,
        "resource": "search",
        "action_class": "read",
    },
    {
        "id": "search",
        "summary": "Search Google Places by text query",
        "required_mode": "readonly",
        "supports_json": True,
        "resource": "search",
        "action_class": "read",
    },
    {
        "id": "place",
        "summary": "Get details for a Google Place by place id",
        "required_mode": "readonly",
        "supports_json": True,
        "resource": "place",
        "action_class": "read",
    },
    {
        "id": "resolve",
        "summary": "Resolve a location string into canonical Google Places matches",
        "required_mode": "readonly",
        "supports_json": True,
        "resource": "resolve",
        "action_class": "read",
    },
]
