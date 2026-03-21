from __future__ import annotations

import os

from .constants import DEFAULT_API_BASE, DEFAULT_ENVIRONMENT


def _env(name: str) -> str | None:
    value = os.getenv(name, "").strip()
    return value or None


def current_config(*, account: str | None, environment: str, realm_id: str | None, api_base: str) -> dict[str, object]:
    client_id = _env("QBO_CLIENT_ID")
    client_secret = _env("QBO_CLIENT_SECRET")
    refresh_token = _env("QBO_REFRESH_TOKEN")
    access_token = _env("QBO_ACCESS_TOKEN")
    selected_realm = realm_id or _env("QBO_REALM_ID") or _env("AOS_QUICKBOOKS_REALM_ID")

    return {
        "tool": "aos-quickbooks",
        "backend": "quickbooks-online",
        "account": account or _env("AOS_QUICKBOOKS_ACCOUNT"),
        "environment": environment or _env("AOS_QUICKBOOKS_ENVIRONMENT") or DEFAULT_ENVIRONMENT,
        "realm_id": selected_realm,
        "api_base": api_base or _env("AOS_QUICKBOOKS_API_BASE") or DEFAULT_API_BASE,
        "oauth_client_configured": bool(client_id and client_secret),
        "refresh_token_configured": bool(refresh_token),
        "access_token_configured": bool(access_token),
        "realm_selected": bool(selected_realm),
    }


def health_snapshot(*, account: str | None, environment: str, realm_id: str | None, api_base: str) -> dict[str, object]:
    config = current_config(account=account, environment=environment, realm_id=realm_id, api_base=api_base)
    oauth_ready = bool(config["oauth_client_configured"])
    token_ready = bool(config["refresh_token_configured"] or config["access_token_configured"])
    realm_ready = bool(config["realm_selected"])
    ready = oauth_ready and token_ready and realm_ready

    checks = [
        {
            "name": "oauth_client",
            "ok": oauth_ready,
            "details": {
                "client_id_configured": bool(_env("QBO_CLIENT_ID")),
                "client_secret_configured": bool(_env("QBO_CLIENT_SECRET")),
            },
        },
        {
            "name": "oauth_token_material",
            "ok": token_ready,
            "details": {
                "refresh_token_configured": bool(_env("QBO_REFRESH_TOKEN")),
                "access_token_configured": bool(_env("QBO_ACCESS_TOKEN")),
            },
        },
        {
            "name": "realm_selection",
            "ok": realm_ready,
            "details": {
                "realm_id_configured": bool(config["realm_id"]),
            },
        },
        {
            "name": "api_probe",
            "ok": False,
            "details": {
                "implemented": False,
                "note": "Live QuickBooks API probe is not implemented in this scaffold.",
            },
        },
    ]

    next_steps: list[str] = []
    if not oauth_ready:
        next_steps.append("Set QBO_CLIENT_ID and QBO_CLIENT_SECRET for the Intuit app.")
    if not token_ready:
        next_steps.append("Complete QuickBooks OAuth login and store QBO_REFRESH_TOKEN or QBO_ACCESS_TOKEN.")
    if not realm_ready:
        next_steps.append("Set QBO_REALM_ID to select the QuickBooks company.")
    if ready:
        next_steps.append("Implement the live QuickBooks API bridge and replace the scaffold stubs.")

    return {
        "status": "ok" if ready else "needs_setup",
        "summary": "Scaffold configuration is present." if ready else "QuickBooks OAuth setup is incomplete.",
        "backend": "quickbooks-online",
        "checks": checks,
        "next_steps": next_steps,
        "config": config,
    }
