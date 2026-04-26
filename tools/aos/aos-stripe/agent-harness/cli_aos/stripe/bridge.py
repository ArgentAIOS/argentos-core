from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .config import config_snapshot, resolve_runtime_values
from .constants import BACKEND_NAME, MANIFEST_SCHEMA_VERSION, MODE_ORDER, TOOL_NAME
from . import runtime as runtime_module


ROOT_DIR = Path(__file__).resolve().parents[3]
CONNECTOR_PATH = ROOT_DIR / "connector.json"
PERMISSIONS_PATH = ROOT_DIR / "agent-harness" / "permissions.json"


def _load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text())


def _permissions() -> dict[str, str]:
    return _load_json(PERMISSIONS_PATH).get("permissions", {})


def _manifest() -> dict[str, Any]:
    return _load_json(CONNECTOR_PATH)


def _connector_commands() -> list[dict[str, Any]]:
    return _manifest().get("commands", [])


def capabilities_snapshot() -> dict[str, Any]:
    manifest = _manifest()
    return {
        "tool": TOOL_NAME,
        "backend": manifest.get("backend", BACKEND_NAME),
        "version": "0.1.0",
        "manifest_schema_version": MANIFEST_SCHEMA_VERSION,
        "modes": MODE_ORDER,
        "connector": manifest.get("connector", {}),
        "scope": manifest.get("scope", {}),
        "auth": manifest.get("auth", {}),
        "commands": [
            {
                "id": command["id"],
                "summary": command["summary"],
                "required_mode": command["required_mode"],
                "supports_json": bool(command.get("supports_json", True)),
            }
            for command in _connector_commands()
        ],
    }


def _check(name: str, ok: bool, details: dict[str, Any]) -> dict[str, Any]:
    return {"name": name, "ok": ok, "details": details}


def health_snapshot(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    probe = runtime_module.probe_runtime(ctx_obj) if runtime["secret_key_present"] else None

    checks = [
        _check("secret_key", runtime["secret_key_present"], {"env": runtime["secret_key_env"], "present": runtime["secret_key_present"]}),
        _check("account_id", runtime["account_id_present"], {"env": runtime["account_id_env"], "present": runtime["account_id_present"]}),
        _check("customer_scope", runtime["customer_id_present"], {"env": runtime["customer_id_env"], "present": runtime["customer_id_present"]}),
        _check("api_probe", bool(probe and probe["ok"]), probe["details"] if probe else {"skipped": True}),
        _check("subscription_scope", runtime["subscription_id_present"], {"env": runtime["subscription_id_env"], "present": runtime["subscription_id_present"]}),
    ]

    if not runtime["secret_key_present"]:
        status = "needs_setup"
        summary = "Stripe runtime needs STRIPE_SECRET_KEY before live reads or writes can run."
        next_steps = [f"Set {runtime['secret_key_env']} in connector service keys."]
    elif probe and not probe["ok"]:
        status = "auth_error"
        summary = f"Stripe credentials are configured, but the probe failed: {probe['message']}"
        next_steps = [f"Fix the Stripe probe failure: {probe['message']}"]
    else:
        status = "ok"
        summary = "Stripe connector is configured for live reads and permission-gated writes."
        next_steps = []
        if not runtime["account_id_present"]:
            next_steps.append(f"Optional: set {runtime['account_id_env']} for connected-account workflows.")
        if not runtime["customer_id_present"]:
            next_steps.append(f"Optional: set {runtime['customer_id_env']} for stable customer-scoped defaults.")

    return {
        "status": status,
        "summary": summary,
        "connector": runtime["connector"],
        "auth": runtime["auth"],
        "scope": runtime["scope"],
        "checks": checks,
        "next_steps": next_steps,
    }


def doctor_snapshot(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    health = health_snapshot(ctx_obj)
    diagnostics = {
        "api_base_url": runtime["api_base_url"],
        "secret_key_env": runtime["secret_key_env"],
        "account_id_env": runtime["account_id_env"],
        "customer_id_env": runtime["customer_id_env"],
        "payment_intent_id_env": runtime["payment_intent_id_env"],
        "subscription_id_env": runtime["subscription_id_env"],
        "price_id_env": runtime["price_id_env"],
        "invoice_id_env": runtime["invoice_id_env"],
    }
    return {
        **health,
        "diagnostics": diagnostics,
        "runtime": config_snapshot(ctx_obj)["runtime"],
    }
