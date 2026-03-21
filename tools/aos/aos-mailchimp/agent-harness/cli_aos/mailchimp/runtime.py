from __future__ import annotations

from typing import Any

from .client import MailchimpClient
from .config import runtime_config
from .constants import CONNECTOR_CATEGORY, CONNECTOR_CATEGORIES, CONNECTOR_LABEL, CONNECTOR_RESOURCES
from .errors import CliError


def _scope(ctx_obj: dict[str, Any] | None) -> dict[str, Any]:
    config = runtime_config(ctx_obj)
    return {
        "base_url": config["base_url"] or None,
        "server_prefix": config["resolved_server_prefix"],
    }


def _client(ctx_obj: dict[str, Any] | None) -> MailchimpClient:
    return MailchimpClient.from_context(ctx_obj or {})


def _collection_result(resource: str, operation: str, ctx_obj: dict[str, Any] | None, response: dict[str, Any]) -> dict[str, Any]:
    items = response.get("lists") or response.get("campaigns") or response.get("members") or response.get("items") or []
    if not isinstance(items, list):
        items = []
    count = response.get("total_items")
    if count is None:
        count = len(items)
    return {
        "status": "ok",
        "backend": "mailchimp-marketing",
        "resource": resource,
        "operation": operation,
        "scope": _scope(ctx_obj),
        "count": count,
        "results": items,
        "raw": response,
    }


def _single_result(resource: str, operation: str, ctx_obj: dict[str, Any] | None, response: dict[str, Any]) -> dict[str, Any]:
    return {
        "status": "ok",
        "backend": "mailchimp-marketing",
        "resource": resource,
        "operation": operation,
        "scope": _scope(ctx_obj),
        "result": response,
    }


def probe_api(ctx_obj: dict[str, Any] | None = None) -> dict[str, Any]:
    config = runtime_config(ctx_obj)
    if not config["api_key_present"]:
        return {
            "ok": False,
            "code": "SETUP_REQUIRED",
            "message": "MAILCHIMP_API_KEY is required",
            "details": {"missing": ["MAILCHIMP_API_KEY"]},
        }
    if not config["base_url_present"]:
        return {
            "ok": False,
            "code": "SETUP_REQUIRED",
            "message": "Unable to resolve a Mailchimp server prefix",
            "details": {"missing": ["MAILCHIMP_SERVER_PREFIX"], "api_key_has_datacenter": bool(config["inferred_server_prefix"])},
        }

    client = _client(ctx_obj)
    try:
        ping = client.ping()
        root = client.root()
    except CliError as err:
        return {"ok": False, "code": err.code, "message": err.message, "details": err.details}

    return {
        "ok": True,
        "code": "OK",
        "message": "Mailchimp API reachable",
        "details": {
            "ping": ping,
            "account": root,
        },
    }


def health_snapshot(ctx_obj: dict[str, Any] | None = None) -> dict[str, Any]:
    config = runtime_config(ctx_obj)
    probe = probe_api(ctx_obj)

    checks = [
        {
            "name": "api_key",
            "ok": config["api_key_present"],
            "details": {
                "present": config["api_key_present"],
                "source": config["api_key_source"],
            },
        },
        {
            "name": "server_prefix",
            "ok": config["base_url_present"],
            "details": {
                "present": config["base_url_present"],
                "source": config["server_prefix_source"],
                "resolved_server_prefix": config["resolved_server_prefix"],
            },
        },
        {
            "name": "api_probe",
            "ok": probe["ok"],
            "details": probe,
        },
    ]

    next_steps: list[str] = []
    if not config["api_key_present"]:
        next_steps.append("Set MAILCHIMP_API_KEY for the target account.")
    if config["api_key_present"] and not config["base_url_present"]:
        next_steps.append("Set MAILCHIMP_SERVER_PREFIX or use an API key that includes the datacenter suffix.")
    if not probe["ok"] and probe["code"] not in {"SETUP_REQUIRED"}:
        next_steps.append(f"Fix Mailchimp API access: {probe['message']}")

    status = "ok"
    summary = "Mailchimp API is reachable."
    if not config["api_key_present"]:
        status = "needs_setup"
        summary = "Set MAILCHIMP_API_KEY before attempting live calls."
    elif not config["base_url_present"]:
        status = "needs_setup"
        summary = "Set MAILCHIMP_SERVER_PREFIX or provide an API key with a datacenter suffix."
    elif not probe["ok"]:
        if probe["code"] in {"AUTH_ERROR"}:
            status = "auth_error"
        elif probe["code"] in {"BACKEND_UNAVAILABLE", "NETWORK_ERROR"}:
            status = "backend_unavailable"
        else:
            status = "degraded"
        summary = f"Mailchimp API probe failed: {probe['message']}"

    return {
        "status": status,
        "summary": summary,
        "connector": {
            "label": CONNECTOR_LABEL,
            "category": CONNECTOR_CATEGORY,
            "categories": CONNECTOR_CATEGORIES,
            "resources": CONNECTOR_RESOURCES,
        },
        "checks": checks,
        "next_steps": next_steps,
    }


def doctor_snapshot(ctx_obj: dict[str, Any] | None = None) -> dict[str, Any]:
    config = runtime_config(ctx_obj)
    probe = probe_api(ctx_obj)

    checks = [
        {
            "name": "config",
            "ok": config["api_key_present"] and config["base_url_present"],
            "details": {
                "api_key_present": config["api_key_present"],
                "base_url_present": config["base_url_present"],
                "resolved_server_prefix": config["resolved_server_prefix"],
            },
        },
        {
            "name": "api_probe",
            "ok": probe["ok"],
            "details": probe,
        },
    ]

    status = "healthy" if all(check["ok"] for check in checks) else "degraded"
    if not config["api_key_present"] or not config["base_url_present"]:
        status = "needs_setup"

    recommendations = [
        "Create a dedicated Mailchimp API key for the target account.",
        "Set MAILCHIMP_SERVER_PREFIX when the API key suffix is not available or should be overridden.",
    ]
    if probe["ok"]:
        account = probe["details"].get("account", {})
        if isinstance(account, dict) and account.get("account_name"):
            recommendations.append(f"Connected to account: {account['account_name']}")

    return {
        "status": status,
        "backend": "mailchimp-marketing",
        "connector": {
            "label": CONNECTOR_LABEL,
            "category": CONNECTOR_CATEGORY,
            "categories": CONNECTOR_CATEGORIES,
            "resources": CONNECTOR_RESOURCES,
        },
        "checks": checks,
        "recommendations": recommendations,
    }


def config_snapshot(ctx_obj: dict[str, Any] | None = None) -> dict[str, Any]:
    config = runtime_config(ctx_obj)
    probe = probe_api(ctx_obj)
    return {
        "status": "ok" if config["api_key_present"] else "needs_setup",
        "connector": {
            "label": CONNECTOR_LABEL,
            "category": CONNECTOR_CATEGORY,
            "categories": CONNECTOR_CATEGORIES,
            "resources": CONNECTOR_RESOURCES,
        },
        "config": {
            **config,
            "api_key": None,
        },
        "api_probe": probe,
        "runtime_ready": bool(probe["ok"]),
    }


def scaffold_result(
    ctx_obj: dict[str, Any] | None,
    *,
    command_id: str,
    resource: str,
    operation: str,
    inputs: dict[str, Any],
) -> dict[str, Any]:
    return {
        "status": "scaffold",
        "backend": "mailchimp-marketing",
        "command": command_id,
        "resource": resource,
        "operation": operation,
        "executed": False,
        "inputs": inputs,
        "scope": _scope(ctx_obj),
        "next_steps": [
            "Wire this command to the Mailchimp Marketing API mutation once write behavior is validated.",
            "Keep mode gating and audit output intact when the live write path is added.",
        ],
    }

