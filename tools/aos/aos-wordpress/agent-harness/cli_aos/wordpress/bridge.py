from __future__ import annotations

from typing import Any

from .config import redacted_config_snapshot, runtime_config
from .constants import (
    CONNECTOR_AUTH,
    CONNECTOR_CATEGORY,
    CONNECTOR_CATEGORIES,
    CONNECTOR_LABEL,
    CONNECTOR_RESOURCES,
    IMPLEMENTED_WRITE_COMMANDS,
    SCAFFOLDED_WRITE_COMMANDS,
)
from .runtime import probe_api, probe_site


def config_snapshot(ctx_obj: dict[str, Any] | None = None) -> dict[str, Any]:
    config = runtime_config()
    site_probe = probe_site(config)
    api_probe = probe_api(config)
    runtime_ready = bool(api_probe["ok"])
    return {
        "status": _status_from_probes(config, site_probe, api_probe),
        "summary": _summary_from_probes(config, site_probe, api_probe),
        "connector": {
            "label": CONNECTOR_LABEL,
            "category": CONNECTOR_CATEGORY,
            "categories": CONNECTOR_CATEGORIES,
            "resources": CONNECTOR_RESOURCES,
        },
        "auth": CONNECTOR_AUTH,
        "config": {
            **redacted_config_snapshot(),
            "site_probe": site_probe,
            "api_probe": api_probe,
            "runtime_ready": runtime_ready,
            "implemented_write_commands": IMPLEMENTED_WRITE_COMMANDS,
            "scaffolded_write_commands": SCAFFOLDED_WRITE_COMMANDS,
        },
    }


def health_snapshot(ctx_obj: dict[str, Any] | None = None) -> dict[str, Any]:
    config = runtime_config()
    site_probe = probe_site(config)
    api_probe = probe_api(config)

    checks = [
        {
            "name": "base_url",
            "ok": config["base_url_present"],
            "details": {
                "present": config["base_url_present"],
                "source": config["base_url_source"],
                "value": config["base_url"] or None,
            },
        },
        {
            "name": "site_probe",
            "ok": site_probe["ok"],
            "details": site_probe["details"],
        },
        {
            "name": "username",
            "ok": config["username_present"],
            "details": {
                "present": config["username_present"],
                "source": config["username_source"],
            },
        },
        {
            "name": "application_password",
            "ok": config["application_password_present"],
            "details": {
                "present": config["application_password_present"],
                "source": config["application_password_source"],
            },
        },
        {
            "name": "api_probe",
            "ok": api_probe["ok"],
            "details": api_probe["details"],
        },
        {
            "name": "write_paths",
            "ok": True,
            "details": {
                "implemented": IMPLEMENTED_WRITE_COMMANDS,
                "scaffolded": SCAFFOLDED_WRITE_COMMANDS,
            },
        },
    ]

    next_steps = []
    if not config["base_url_present"]:
        next_steps.append("Set WORDPRESS_BASE_URL to the target site URL, for example https://example.com.")
    if not config["username_present"]:
        next_steps.append("Set WORDPRESS_USERNAME to the dedicated WordPress service user.")
    if not config["application_password_present"]:
        next_steps.append("Set WORDPRESS_APPLICATION_PASSWORD from a WordPress Application Password.")
    if config["base_url_present"] and not site_probe["ok"]:
        next_steps.append(f"Confirm the WordPress REST root is reachable: {site_probe['message']}")
    if config["auth_ready"] and not api_probe["ok"]:
        next_steps.append(f"Fix WordPress authentication: {api_probe['message']}")

    status = "ok"
    summary = "WordPress REST API reachable and authenticated."
    if not config["base_url_present"]:
        status = "needs_setup"
        summary = "Set the WordPress base URL before attempting live calls."
    elif not config["auth_ready"]:
        status = "needs_setup"
        summary = "WordPress base URL is reachable, but username or application password is missing."
    elif not site_probe["ok"]:
        status = "backend_unavailable"
        summary = f"WordPress REST root is not reachable: {site_probe['message']}"
    elif not api_probe["ok"]:
        status = "auth_error"
        summary = f"WordPress authentication failed: {api_probe['message']}"

    return {
        "status": status,
        "summary": summary,
        "connector": {
            "label": CONNECTOR_LABEL,
            "category": CONNECTOR_CATEGORY,
            "categories": CONNECTOR_CATEGORIES,
            "resources": CONNECTOR_RESOURCES,
        },
        "auth": CONNECTOR_AUTH,
        "checks": checks,
        "next_steps": next_steps,
    }


def doctor_snapshot(ctx_obj: dict[str, Any] | None = None) -> dict[str, Any]:
    health = health_snapshot(ctx_obj)
    config = config_snapshot(ctx_obj)
    return {
        "status": health["status"],
        "summary": health["summary"],
        "backend": "wordpress-rest-api",
        "connector": health["connector"],
        "auth": health["auth"],
        "checks": health["checks"],
        "next_steps": health["next_steps"],
        "config": config["config"],
    }


def _status_from_probes(
    config: dict[str, Any],
    site_probe: dict[str, Any],
    api_probe: dict[str, Any],
) -> str:
    if not config["base_url_present"]:
        return "needs_setup"
    if not config["auth_ready"]:
        return "needs_setup"
    if not site_probe["ok"]:
        return "backend_unavailable"
    if not api_probe["ok"]:
        return "auth_error"
    return "ok"


def _summary_from_probes(
    config: dict[str, Any],
    site_probe: dict[str, Any],
    api_probe: dict[str, Any],
) -> str:
    status = _status_from_probes(config, site_probe, api_probe)
    if status == "needs_setup" and not config["base_url_present"]:
        return "WordPress base URL is not configured."
    if status == "needs_setup":
        return "WordPress authentication is not configured yet."
    if status == "backend_unavailable":
        return f"WordPress REST root is not reachable: {site_probe['message']}"
    if status == "auth_error":
        return f"WordPress authentication failed: {api_probe['message']}"
    return "WordPress REST API reachable and authenticated."
