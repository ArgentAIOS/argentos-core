from __future__ import annotations

from typing import Any

from .config import redacted_config_snapshot, runtime_config
from .constants import CONNECTOR_AUTH, CONNECTOR_CATEGORY, CONNECTOR_CATEGORIES, CONNECTOR_LABEL, CONNECTOR_RESOURCES
from .runtime import doctor_snapshot, health_snapshot, probe_api, scaffold_result


def config_snapshot(ctx_obj: dict[str, Any] | None = None) -> dict[str, Any]:
    config = runtime_config(ctx_obj)
    probe = probe_api(ctx_obj)
    return {
        "status": "ok" if config["api_key_present"] and config["base_url_present"] else "needs_setup",
        "summary": "Mailchimp connector configuration.",
        "connector": {
            "label": CONNECTOR_LABEL,
            "category": CONNECTOR_CATEGORY,
            "categories": CONNECTOR_CATEGORIES,
            "resources": CONNECTOR_RESOURCES,
        },
        "auth": CONNECTOR_AUTH,
        "config": {
            **redacted_config_snapshot(ctx_obj),
            "api_key": None,
        },
        "api_probe": probe,
        "runtime_ready": bool(probe["ok"]),
    }
