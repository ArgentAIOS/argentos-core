from __future__ import annotations

from typing import Any

from .config import runtime_config
from .constants import AUTH_DESCRIPTOR, CONNECTOR_DESCRIPTOR
from .runtime import probe_api


def config_snapshot(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    config = runtime_config(ctx_obj)
    probe = probe_api(ctx_obj) if config["auth_ready"] else None
    return {
        **config,
        "api_probe": probe
        or {
            "ok": False,
            "code": "SKIPPED",
            "message": "HubSpot API probe skipped until portal and token are configured",
            "details": {"skipped": True},
        },
        "runtime_ready": bool(probe and probe["ok"]),
    }


def health_snapshot(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    config = runtime_config(ctx_obj)
    required_ready = bool(config["portal_id"]) and config["access_token_present"]
    probe = probe_api(ctx_obj) if required_ready else None

    checks = [
        {
            "name": "portal_id",
            "ok": bool(config["portal_id"]),
            "details": {"present": bool(config["portal_id"]), "source": config["portal_id_source"]},
        },
        {
            "name": "access_token",
            "ok": config["access_token_present"],
            "details": {"env": config["access_token_env"], "present": config["access_token_present"]},
        },
        {
            "name": "api_probe",
            "ok": probe["ok"] if probe else False,
            "details": probe["details"] if probe else {"skipped": True},
        },
        {
            "name": "app_id",
            "ok": config["app_id_present"],
            "details": {"env": config["app_id_env"], "present": config["app_id_present"]},
        },
        {
            "name": "webhook_secret",
            "ok": config["webhook_secret_present"],
            "details": {
                "env": config["webhook_secret_env"],
                "present": config["webhook_secret_present"],
            },
        },
    ]

    next_steps: list[str] = []
    if not config["portal_id"]:
        next_steps.append("Set HUBSPOT_PORTAL_ID to the target HubSpot portal/account id.")
    if not config["access_token_present"]:
        next_steps.append(f"Set {config['access_token_env']} for live HubSpot API access.")
    if probe and not probe["ok"]:
        next_steps.append(f"Fix the HubSpot API probe failure: {probe['message']}")
    if not config["app_id_present"]:
        next_steps.append(f"Optional: set {config['app_id_env']} when the OAuth app is provisioned.")
    if not config["webhook_secret_present"]:
        next_steps.append(
            f"Optional: set {config['webhook_secret_env']} before enabling webhook-backed workers."
        )

    if probe and not probe["ok"]:
        status = "auth_error"
        summary = f"HubSpot credentials are configured, but the API probe failed: {probe['message']}"
    elif required_ready and probe and probe["ok"]:
        status = "ok"
        summary = "HubSpot API credentials are configured and the probe succeeded."
    else:
        status = "needs_setup"
        summary = "HubSpot runtime needs portal and token configuration before live reads can run."

    return {
        "status": status,
        "summary": summary,
        "connector": CONNECTOR_DESCRIPTOR,
        "auth": AUTH_DESCRIPTOR,
        "checks": checks,
        "next_steps": next_steps,
    }


def scaffold_result(
    ctx_obj: dict[str, Any],
    *,
    command_id: str,
    resource: str,
    operation: str,
    inputs: dict[str, Any],
    consequential: bool = False,
) -> dict[str, Any]:
    config = runtime_config(ctx_obj)
    return {
        "status": "scaffold",
        "scaffold_only": True,
        "executed": False,
        "backend": "hubspot",
        "resource": resource,
        "operation": operation,
        "command_id": command_id,
        "scope": {
            "portal_id": config["portal_id"],
            "account_alias": config["account_alias"],
        },
        "inputs": inputs,
        "side_effects_possible": consequential,
        "next_step": "Wire this command to the live HubSpot write-path bridge.",
    }
