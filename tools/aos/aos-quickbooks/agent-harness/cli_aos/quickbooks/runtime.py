from __future__ import annotations

import base64
import json
import os
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any
from urllib import error, parse, request

from . import __version__
from .service_keys import service_key_env

TOOL_NAME = "aos-quickbooks"
CONNECTOR_LABEL = "QuickBooks Online"
CONNECTOR_CATEGORY = "finance-backoffice"
CONNECTOR_CATEGORIES = ["finance-backoffice", "bookkeeping", "accounting"]
CONNECTOR_RESOURCES = [
    "company",
    "customer",
    "vendor",
    "invoice",
    "bill",
    "payment",
    "account",
    "transaction",
]
CONNECTOR_AUTH = {
    "kind": "oauth-service-key",
    "required": True,
    "service_keys": [
        "QBO_CLIENT_ID",
        "QBO_CLIENT_SECRET",
        "QBO_REFRESH_TOKEN",
        "QBO_REALM_ID",
    ],
    "interactive_setup": [
        "Create an Intuit developer app for QuickBooks Online.",
        "Add QBO_CLIENT_ID, QBO_CLIENT_SECRET, QBO_REFRESH_TOKEN, and QBO_REALM_ID in API Keys.",
        "Set QBO_API_BASE_URL to https://sandbox-quickbooks.api.intuit.com when targeting a sandbox company.",
        "Keep company, account, and date-window scope narrow before enabling write actions.",
    ],
}

GLOBAL_COMMAND_SPECS = [
    {
        "id": "capabilities",
        "summary": "Describe the connector manifest",
        "required_mode": "readonly",
        "supports_json": True,
        "resource": "connector",
        "action_class": "read",
    },
    {
        "id": "health",
        "summary": "Report connector health and backend readiness",
        "required_mode": "readonly",
        "supports_json": True,
        "resource": "connector",
        "action_class": "read",
    },
    {
        "id": "config.show",
        "summary": "Show redacted connector configuration",
        "required_mode": "readonly",
        "supports_json": True,
        "resource": "connector",
        "action_class": "read",
    },
    {
        "id": "doctor",
        "summary": "Run connector diagnostics",
        "required_mode": "readonly",
        "supports_json": True,
        "resource": "connector",
        "action_class": "read",
    },
]

COMMAND_SPECS = [
    {
        "id": "company.read",
        "summary": "Read QuickBooks company info",
        "required_mode": "readonly",
        "supports_json": True,
        "resource": "company",
        "action_class": "read",
    },
    {
        "id": "customer.list",
        "summary": "List customers",
        "required_mode": "readonly",
        "supports_json": True,
        "resource": "customer",
        "action_class": "read",
    },
    {
        "id": "customer.search",
        "summary": "Search customers",
        "required_mode": "readonly",
        "supports_json": True,
        "resource": "customer",
        "action_class": "read",
    },
    {
        "id": "customer.read",
        "summary": "Read a customer",
        "required_mode": "readonly",
        "supports_json": True,
        "resource": "customer",
        "action_class": "read",
    },
    {
        "id": "vendor.list",
        "summary": "List vendors",
        "required_mode": "readonly",
        "supports_json": True,
        "resource": "vendor",
        "action_class": "read",
    },
    {
        "id": "vendor.search",
        "summary": "Search vendors",
        "required_mode": "readonly",
        "supports_json": True,
        "resource": "vendor",
        "action_class": "read",
    },
    {
        "id": "vendor.read",
        "summary": "Read a vendor",
        "required_mode": "readonly",
        "supports_json": True,
        "resource": "vendor",
        "action_class": "read",
    },
    {
        "id": "invoice.list",
        "summary": "List invoices",
        "required_mode": "readonly",
        "supports_json": True,
        "resource": "invoice",
        "action_class": "read",
    },
    {
        "id": "invoice.search",
        "summary": "Search invoices",
        "required_mode": "readonly",
        "supports_json": True,
        "resource": "invoice",
        "action_class": "read",
    },
    {
        "id": "invoice.read",
        "summary": "Read an invoice",
        "required_mode": "readonly",
        "supports_json": True,
        "resource": "invoice",
        "action_class": "read",
    },
    {
        "id": "invoice.create_draft",
        "summary": "Create a draft invoice",
        "required_mode": "write",
        "supports_json": True,
        "resource": "invoice",
        "action_class": "write",
    },
    {
        "id": "bill.list",
        "summary": "List bills",
        "required_mode": "readonly",
        "supports_json": True,
        "resource": "bill",
        "action_class": "read",
    },
    {
        "id": "bill.search",
        "summary": "Search bills",
        "required_mode": "readonly",
        "supports_json": True,
        "resource": "bill",
        "action_class": "read",
    },
    {
        "id": "bill.read",
        "summary": "Read a bill",
        "required_mode": "readonly",
        "supports_json": True,
        "resource": "bill",
        "action_class": "read",
    },
    {
        "id": "bill.create_draft",
        "summary": "Create a draft bill",
        "required_mode": "write",
        "supports_json": True,
        "resource": "bill",
        "action_class": "write",
    },
    {
        "id": "payment.list",
        "summary": "List payments",
        "required_mode": "readonly",
        "supports_json": True,
        "resource": "payment",
        "action_class": "read",
    },
    {
        "id": "payment.read",
        "summary": "Read a payment",
        "required_mode": "readonly",
        "supports_json": True,
        "resource": "payment",
        "action_class": "read",
    },
    {
        "id": "account.list",
        "summary": "List chart of accounts entries",
        "required_mode": "readonly",
        "supports_json": True,
        "resource": "account",
        "action_class": "read",
    },
    {
        "id": "account.read",
        "summary": "Read an account",
        "required_mode": "readonly",
        "supports_json": True,
        "resource": "account",
        "action_class": "read",
    },
    {
        "id": "transaction.list",
        "summary": "List transactions",
        "required_mode": "readonly",
        "supports_json": True,
        "resource": "transaction",
        "action_class": "read",
    },
    {
        "id": "transaction.read",
        "summary": "Read a transaction",
        "required_mode": "readonly",
        "supports_json": True,
        "resource": "transaction",
        "action_class": "read",
    },
]

ALL_COMMAND_SPECS = [*GLOBAL_COMMAND_SPECS, *COMMAND_SPECS]
MODE_ORDER = ["readonly", "write", "full", "admin"]
DEFAULT_API_BASE_URL = "https://quickbooks.api.intuit.com"
DEFAULT_TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer"
DEFAULT_MINOR_VERSION = 75
DEFAULT_TIMEOUT_SECONDS = 20.0
WRITE_COMMAND_IDS = {
    "invoice.create_draft",
    "bill.create_draft",
}
READ_ONLY_KEYS = ("QBO_CLIENT_ID", "QBO_CLIENT_SECRET", "QBO_REFRESH_TOKEN", "QBO_REALM_ID")
RESOURCE_ENTITY_MAP = {
    "customer": "Customer",
    "vendor": "Vendor",
    "invoice": "Invoice",
    "bill": "Bill",
    "payment": "Payment",
    "account": "Account",
}
RESOURCE_PATH_MAP = {
    "customer": "customer",
    "vendor": "vendor",
    "invoice": "invoice",
    "bill": "bill",
    "payment": "payment",
    "account": "account",
}
SEARCH_FIELDS = {
    "customer": ["DisplayName", "CompanyName", "GivenName", "FamilyName"],
    "vendor": ["DisplayName", "CompanyName", "GivenName", "FamilyName"],
    "invoice": ["DocNumber", "PrivateNote"],
    "bill": ["DocNumber", "PrivateNote"],
    "payment": ["DocNumber", "PrivateNote"],
    "account": ["Name", "AccountType"],
}
TRANSACTION_SEARCH_ENTITIES = [
    "Invoice",
    "Bill",
    "Payment",
    "SalesReceipt",
    "CreditMemo",
    "Purchase",
    "VendorCredit",
    "Deposit",
    "Transfer",
    "RefundReceipt",
    "BillPayment",
    "JournalEntry",
]


@dataclass
class ConnectorError(Exception):
    code: str
    message: str
    exit_code: int
    details: dict[str, Any] | None = None

    def to_error(self) -> dict[str, Any]:
        payload = {"code": self.code, "message": self.message}
        if self.details is not None:
            payload["details"] = self.details
        return payload


def _env(name: str, default: str = "") -> str:
    return (service_key_env(name, default) or "").strip()


def _realm_id() -> str:
    return _env("QBO_REALM_ID")


def _redact(value: str | None, *, keep: int = 4) -> str:
    if not value:
        return ""
    if len(value) <= keep:
        return "*" * len(value)
    return f"{value[:2]}...{value[-keep:]}"


def _parse_int(value: str | None, default: int) -> int:
    if value is None or value == "":
        return default
    try:
        parsed = int(value)
    except ValueError:
        return default
    return parsed if parsed > 0 else default


def _parse_float(value: str | None, default: float) -> float:
    if value is None or value == "":
        return default
    try:
        parsed = float(value)
    except ValueError:
        return default
    return parsed if parsed > 0 else default


def _canonical_entity_name(value: str | None) -> str | None:
    if not value:
        return None
    lowered = value.strip().lower()
    if lowered in RESOURCE_ENTITY_MAP:
        return RESOURCE_ENTITY_MAP[lowered]
    if lowered == "companyinfo":
        return "CompanyInfo"
    return value


def runtime_config() -> dict[str, Any]:
    api_base_url = _env("QBO_API_BASE_URL", DEFAULT_API_BASE_URL).rstrip("/")
    token_url = _env("QBO_TOKEN_URL", DEFAULT_TOKEN_URL).rstrip("/")
    minor_version = _parse_int(_env("QBO_MINOR_VERSION"), DEFAULT_MINOR_VERSION)
    timeout_seconds = _parse_float(_env("QBO_HTTP_TIMEOUT_SECONDS"), DEFAULT_TIMEOUT_SECONDS)
    env_values = {key: _env(key) for key in READ_ONLY_KEYS}
    configured = {key: bool(value.strip()) for key, value in env_values.items()}
    missing_keys = [key for key, ok in configured.items() if not ok]
    auth_ready = not missing_keys
    return {
        "tool": TOOL_NAME,
        "version": __version__,
        "backend": "quickbooks-online",
        "label": CONNECTOR_LABEL,
        "category": CONNECTOR_CATEGORY,
        "categories": CONNECTOR_CATEGORIES,
        "resources": CONNECTOR_RESOURCES,
        "auth": {
            "kind": CONNECTOR_AUTH["kind"],
            "required": CONNECTOR_AUTH["required"],
            "service_keys": list(CONNECTOR_AUTH["service_keys"]),
            "configured": configured,
            "missing_keys": missing_keys,
            "redacted": {
                "QBO_CLIENT_ID": _redact(env_values["QBO_CLIENT_ID"]),
                "QBO_CLIENT_SECRET": _redact(env_values["QBO_CLIENT_SECRET"]),
                "QBO_REFRESH_TOKEN": _redact(env_values["QBO_REFRESH_TOKEN"]),
                "QBO_REALM_ID": _redact(env_values["QBO_REALM_ID"]),
            },
            "interactive_setup": list(CONNECTOR_AUTH["interactive_setup"]),
        },
        "runtime": {
            "api_base_url": api_base_url,
            "token_url": token_url,
            "minor_version": minor_version,
            "timeout_seconds": timeout_seconds,
            "sandbox": "sandbox-quickbooks.api.intuit.com" in api_base_url,
            "auth_ready": auth_ready,
            "read_only_ready": auth_ready,
            "write_paths_implemented": True,
            "write_paths_permission_gated": True,
            "write_paths_scaffolded": [],
            "write_paths_live": sorted(WRITE_COMMAND_IDS),
        },
    }


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _format_result(
    *,
    ok: bool,
    command: str,
    mode: str,
    started: float,
    data: dict[str, Any] | None = None,
    error: dict[str, Any] | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "ok": ok,
        "tool": TOOL_NAME,
        "command": command,
        "meta": {
            "mode": mode,
            "duration_ms": int((datetime.now(timezone.utc).timestamp() - started) * 1000),
            "timestamp": _utc_now(),
            "version": __version__,
        },
    }
    if ok:
        payload["data"] = data or {}
    else:
        payload["error"] = error or {"code": "INTERNAL_ERROR", "message": "Unknown error"}
    return payload


def _connector_status(
    *,
    config: dict[str, Any],
    probe: dict[str, Any] | None,
    label: str,
) -> dict[str, Any]:
    missing_keys = config["auth"]["missing_keys"]
    if missing_keys:
        status = "needs_setup"
        summary = "QuickBooks OAuth and realm configuration is incomplete."
    elif probe and not probe.get("ok"):
        status = "auth_error" if probe.get("code", "").startswith("QBO_AUTH") else "degraded"
        summary = probe.get("message", "QuickBooks runtime probe failed.")
    else:
        status = "healthy"
        summary = "QuickBooks Online live read access is available."

    checks = [
        {
            "name": "service_keys",
            "ok": not missing_keys,
            "details": {
                "configured": config["auth"]["configured"],
                "missing_keys": missing_keys,
            },
        },
        {
            "name": "refresh_token_probe",
            "ok": bool(probe and probe.get("ok")),
            "details": probe or {"ok": False, "code": "SKIPPED", "message": "Probe skipped until service keys are set."},
        },
        {
            "name": "write_paths",
            "ok": True,
            "details": {
                "implemented": True,
                "permission_gated": True,
                "scaffolded": [],
                "live": sorted(WRITE_COMMAND_IDS),
            },
        },
    ]
    return {
        "status": status,
        "summary": summary,
        "connector": {
            "label": label,
            "category": config["category"],
            "categories": config["categories"],
            "resources": config["resources"],
        },
        "auth": config["auth"],
        "runtime": config["runtime"],
        "checks": checks,
    }


def config_snapshot() -> dict[str, Any]:
    config = runtime_config()
    probe = probe_runtime(config) if config["runtime"]["auth_ready"] else {
        "ok": False,
        "code": "SKIPPED",
        "message": "QuickBooks probe skipped until required service keys are configured.",
        "details": {"skipped": True},
    }
    return {
        **config,
        "api_probe": probe,
        "runtime_ready": bool(probe and probe.get("ok")),
    }


def health_snapshot() -> dict[str, Any]:
    config = runtime_config()
    probe = probe_runtime(config) if config["runtime"]["auth_ready"] else None
    snapshot = _connector_status(config=config, probe=probe, label=CONNECTOR_LABEL)
    next_steps: list[str] = []
    if config["auth"]["missing_keys"]:
        next_steps.append("Set QBO_CLIENT_ID, QBO_CLIENT_SECRET, QBO_REFRESH_TOKEN, and QBO_REALM_ID.")
    if probe and not probe.get("ok"):
        next_steps.append(f"Fix the QuickBooks probe failure: {probe['message']}")
    if not config["runtime"]["auth_ready"]:
        next_steps.append("Use a sandbox base URL if you are connecting to a sandbox company.")
    snapshot["next_steps"] = next_steps
    return snapshot


def doctor_snapshot() -> dict[str, Any]:
    snapshot = health_snapshot()
    recommendations: list[str] = [
        "Keep write mode scoped to sandbox or narrow company/account contexts until QuickBooks write behavior is validated.",
        "Use invoice.create_draft only with an explicit item_id; QuickBooks Online requires a sales item on invoice lines.",
    ]
    if snapshot["status"] == "needs_setup":
        recommendations.insert(0, "Set the required QuickBooks service keys before running live read commands.")
    elif snapshot["status"] != "healthy":
        recommendations.insert(0, "Resolve the live QuickBooks probe failure before assigning this connector.")
    snapshot["recommendations"] = recommendations
    return snapshot


def _request_json(
    method: str,
    url: str,
    *,
    headers: dict[str, str] | None = None,
    payload: dict[str, Any] | None = None,
    timeout_seconds: float | None = None,
) -> dict[str, Any]:
    body = None
    request_headers = {"Accept": "application/json"}
    if headers:
        request_headers.update(headers)
    if payload is not None:
        body = json.dumps(payload).encode("utf-8")
        request_headers["Content-Type"] = "application/json"
    req = request.Request(url, data=body, headers=request_headers, method=method)
    timeout = timeout_seconds if timeout_seconds is not None else DEFAULT_TIMEOUT_SECONDS
    try:
        with request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8")
    except error.HTTPError as exc:
        raw = exc.read().decode("utf-8", "replace") if hasattr(exc, "read") else ""
        details: dict[str, Any] = {
            "url": url,
            "status": exc.code,
        }
        if raw:
            try:
                details["body"] = json.loads(raw)
            except json.JSONDecodeError:
                details["body"] = raw
        if exc.code in {401, 403}:
            raise ConnectorError("QBO_AUTH_ERROR", "QuickBooks rejected the request.", 4, details) from exc
        if exc.code == 404:
            raise ConnectorError("QBO_NOT_FOUND", "QuickBooks could not find the requested record.", 6, details) from exc
        if exc.code in {408, 429} or exc.code >= 500:
            raise ConnectorError("QBO_BACKEND_UNAVAILABLE", "QuickBooks is temporarily unavailable.", 5, details) from exc
        raise ConnectorError("QBO_REQUEST_ERROR", "QuickBooks returned an error response.", 10, details) from exc
    except error.URLError as exc:
        raise ConnectorError(
            "QBO_BACKEND_UNAVAILABLE",
            "QuickBooks backend is unreachable.",
            5,
            {"url": url, "reason": str(exc.reason)},
        ) from exc

    if not raw:
        return {}
    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ConnectorError(
            "QBO_RESPONSE_ERROR",
            "QuickBooks returned a non-JSON response.",
            10,
            {"url": url, "body": raw[:2000]},
        ) from exc


def _token_headers(config: dict[str, Any]) -> dict[str, str]:
    client_id = _env("QBO_CLIENT_ID")
    client_secret = _env("QBO_CLIENT_SECRET")
    credentials = base64.b64encode(f"{client_id}:{client_secret}".encode("utf-8")).decode("ascii")
    return {
        "Authorization": f"Basic {credentials}",
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json",
    }


def refresh_access_token(config: dict[str, Any]) -> dict[str, Any]:
    if config["auth"]["missing_keys"]:
        raise ConnectorError(
            "QBO_CONFIG_MISSING",
            "QuickBooks service keys are missing.",
            4,
            {"missing_keys": config["auth"]["missing_keys"]},
        )
    payload = parse.urlencode(
        {
            "grant_type": "refresh_token",
            "refresh_token": _env("QBO_REFRESH_TOKEN"),
        }
    ).encode("utf-8")
    req = request.Request(
        config["runtime"]["token_url"],
        data=payload,
        headers=_token_headers(config),
        method="POST",
    )
    try:
        with request.urlopen(req, timeout=config["runtime"]["timeout_seconds"]) as resp:
            raw = resp.read().decode("utf-8")
    except error.HTTPError as exc:
        raw = exc.read().decode("utf-8", "replace") if hasattr(exc, "read") else ""
        details: dict[str, Any] = {"url": config["runtime"]["token_url"], "status": exc.code}
        if raw:
            try:
                details["body"] = json.loads(raw)
            except json.JSONDecodeError:
                details["body"] = raw
        raise ConnectorError("QBO_AUTH_ERROR", "QuickBooks refresh token exchange failed.", 4, details) from exc
    except error.URLError as exc:
        raise ConnectorError(
            "QBO_BACKEND_UNAVAILABLE",
            "QuickBooks token endpoint is unreachable.",
            5,
            {"url": config["runtime"]["token_url"], "reason": str(exc.reason)},
        ) from exc
    try:
        token_payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ConnectorError(
            "QBO_RESPONSE_ERROR",
            "QuickBooks token endpoint returned a non-JSON response.",
            10,
            {"url": config["runtime"]["token_url"], "body": raw[:2000]},
        ) from exc
    if not isinstance(token_payload, dict) or "access_token" not in token_payload:
        raise ConnectorError(
            "QBO_RESPONSE_ERROR",
            "QuickBooks token endpoint response was incomplete.",
            10,
            {"url": config["runtime"]["token_url"], "body": token_payload},
        )
    return token_payload


def _authorized_request(config: dict[str, Any], method: str, path: str) -> dict[str, Any]:
    token = refresh_access_token(config)
    url = f"{config['runtime']['api_base_url']}{path}"
    headers = {"Authorization": f"Bearer {token['access_token']}"}
    return _request_json(method, url, headers=headers, timeout_seconds=config["runtime"]["timeout_seconds"])


def _company_info_path(config: dict[str, Any]) -> str:
    realm_id = _realm_id()
    params = parse.urlencode({"minorversion": str(config["runtime"]["minor_version"])})
    return f"/v3/company/{realm_id}/companyinfo/{realm_id}?{params}"


def probe_runtime(config: dict[str, Any]) -> dict[str, Any]:
    if config["auth"]["missing_keys"]:
        return {
            "ok": False,
            "code": "QBO_CONFIG_MISSING",
            "message": "QuickBooks service keys are missing.",
            "details": {"missing_keys": config["auth"]["missing_keys"]},
        }
    try:
        token = refresh_access_token(config)
        company = _read_company_payload(config, access_token=token["access_token"])
    except ConnectorError as exc:
        return {"ok": False, "code": exc.code, "message": exc.message, "details": exc.details or {}}

    company_info = company.get("CompanyInfo") if isinstance(company, dict) else None
    if not isinstance(company_info, dict):
        return {
            "ok": False,
            "code": "QBO_RESPONSE_ERROR",
            "message": "QuickBooks company probe returned an unexpected payload.",
            "details": {"body": company},
        }
    return {
        "ok": True,
        "code": "OK",
        "message": "QuickBooks API and company info probe succeeded.",
        "details": {
            "realm_id": _realm_id(),
            "company_name": company_info.get("CompanyName"),
            "company_id": company_info.get("Id"),
            "api_base_url": config["runtime"]["api_base_url"],
            "minor_version": config["runtime"]["minor_version"],
        },
    }


def _read_company_payload(config: dict[str, Any], *, access_token: str) -> dict[str, Any]:
    return _request_json(
        "GET",
        f"{config['runtime']['api_base_url']}{_company_info_path(config)}",
        headers={"Authorization": f"Bearer {access_token}"},
        timeout_seconds=config["runtime"]["timeout_seconds"],
    )


def _read_company(config: dict[str, Any]) -> dict[str, Any]:
    token = refresh_access_token(config)
    company = _read_company_payload(config, access_token=token["access_token"])
    company_info = company.get("CompanyInfo") if isinstance(company, dict) else None
    if not isinstance(company_info, dict):
        raise ConnectorError(
            "QBO_RESPONSE_ERROR",
            "QuickBooks company info returned an unexpected payload.",
            10,
            {"body": company},
        )
    picker_options = _picker_options("company", [company_info], selected_id=company_info.get("Id"))
    return _decorate_live_result(
        config=config,
        resource="company",
        operation="read",
        data={
            "status": "ok",
            "resource": "company",
            "operation": "read",
            "result": company_info,
        },
        picker_options=picker_options,
        company_name=company_info.get("CompanyName"),
        company_id=company_info.get("Id"),
    )


def _scope_base(config: dict[str, Any], *, company_name: str | None = None) -> dict[str, Any]:
    return {
        "realm_id": _realm_id(),
        "company_name": company_name,
        "api_base_url": config["runtime"]["api_base_url"],
    }


def _date_window(options: dict[str, str]) -> dict[str, str | None] | None:
    start = (
        options.get("date_from")
        or options.get("start_date")
        or options.get("startdate")
        or options.get("start")
        or options.get("since")
    )
    end = (
        options.get("date_to")
        or options.get("end_date")
        or options.get("enddate")
        or options.get("end")
        or options.get("until")
    )
    if not start and not end:
        return None
    return {"start": start or None, "end": end or None}


def _scope_candidate(
    kind: str,
    value: str | int | None,
    label: str,
    *,
    subtitle: str | None = None,
    **details: Any,
) -> dict[str, Any] | None:
    if value is None:
        return None
    candidate: dict[str, Any] = {
        "kind": kind,
        "value": str(value),
        "label": label,
    }
    if subtitle:
        candidate["subtitle"] = subtitle
    candidate.update(details)
    return candidate


def _company_scope_candidate(*, realm_id: str, company_name: str | None = None) -> dict[str, Any] | None:
    label = company_name or (f"realm {realm_id}" if realm_id else "QuickBooks company")
    candidate = _scope_candidate(
        "company",
        realm_id or company_name or "company",
        str(label),
        subtitle=f"realm {realm_id}" if realm_id else None,
    )
    if candidate is not None:
        candidate["selected"] = bool(realm_id)
    return candidate


def _date_window_candidate(date_window: dict[str, str | None] | None) -> dict[str, Any] | None:
    if not isinstance(date_window, dict):
        return None
    start = date_window.get("start") or "*"
    end = date_window.get("end") or "*"
    candidate = _scope_candidate(
        "date_window",
        f"{start}..{end}",
        f"{start}..{end}",
        start=date_window.get("start"),
        end=date_window.get("end"),
    )
    if candidate is not None:
        candidate["selected"] = bool(date_window.get("start") or date_window.get("end"))
    return candidate


def _selected_account_candidate(options: dict[str, str]) -> dict[str, Any] | None:
    account_value = options.get("account") or options.get("account_id") or options.get("account_name")
    if not account_value:
        return None
    return _scope_candidate("account", account_value, account_value, selected=True, source="request")


def _account_candidate_from_ref(ref: dict[str, Any], *, source: str, selected: bool = False) -> dict[str, Any] | None:
    value = ref.get("value") or ref.get("Id") or ref.get("id") or ref.get("name") or ref.get("Name")
    if value is None:
        return None
    label = str(ref.get("name") or ref.get("Name") or ref.get("DisplayName") or value)
    parts = [ref.get("AccountType"), ref.get("AccountSubType"), ref.get("AcctNum")]
    subtitle = " | ".join(str(part) for part in parts if part)
    candidate = _scope_candidate("account", value, label, subtitle=subtitle or None, source=source)
    if candidate is not None:
        candidate["selected"] = selected
    return candidate


def _iter_account_candidates(record: Any, *, path: str = "") -> list[dict[str, Any]]:
    candidates: list[dict[str, Any]] = []
    if isinstance(record, dict):
        for key, value in record.items():
            next_path = f"{path}.{key}" if path else key
            if key.lower() == "accountref" and isinstance(value, dict):
                candidate = _account_candidate_from_ref(value, source=next_path)
                if candidate is not None:
                    candidates.append(candidate)
            candidates.extend(_iter_account_candidates(value, path=next_path))
    elif isinstance(record, list):
        for index, item in enumerate(record):
            candidates.extend(_iter_account_candidates(item, path=f"{path}[{index}]"))
    return candidates


def _transaction_account_labels(record: dict[str, Any]) -> list[str]:
    labels: list[str] = []
    for candidate in _iter_account_candidates(record):
        label = str(candidate.get("label") or "").strip()
        if not label or label in labels:
            continue
        labels.append(label)
    return labels


def _transaction_entity_type(record: dict[str, Any]) -> str | None:
    value = record.get("entity_type") or record.get("entityType") or record.get("TransactionType")
    if not value:
        return None
    return str(value)


def _transaction_scope_preview(records: list[dict[str, Any]]) -> dict[str, Any] | None:
    if not records:
        return None
    entity_types: list[str] = []
    doc_numbers: list[str] = []
    txn_dates: list[str] = []
    account_labels: list[str] = []
    account_candidates: list[dict[str, Any]] = []
    for record in records:
        entity_type = _transaction_entity_type(record)
        if entity_type and entity_type not in entity_types:
            entity_types.append(entity_type)
        doc_number = str(record.get("DocNumber") or record.get("Id") or "").strip()
        if doc_number and doc_number not in doc_numbers:
            doc_numbers.append(doc_number)
        txn_date = str(record.get("TxnDate") or "").strip()
        if txn_date and txn_date not in txn_dates:
            txn_dates.append(txn_date)
        for candidate in _iter_account_candidates(record):
            if not isinstance(candidate, dict):
                continue
            account_candidates.append(candidate)
            label = str(candidate.get("label") or "").strip()
            if label and label not in account_labels:
                account_labels.append(label)
    account_candidates = _dedupe_scope_candidates(account_candidates)
    preview: dict[str, Any] = {
        "record_count": len(records),
        "entity_types": entity_types or None,
        "doc_numbers": doc_numbers or None,
        "txn_dates": txn_dates or None,
        "account_labels": account_labels or None,
        "account_candidates": account_candidates or None,
    }
    return preview


def _dedupe_scope_candidates(candidates: list[dict[str, Any]]) -> list[dict[str, Any]]:
    deduped: list[dict[str, Any]] = []
    seen: set[tuple[str, str, str, str | None]] = set()
    for candidate in candidates:
        key = (
            str(candidate.get("kind")),
            str(candidate.get("value")),
            str(candidate.get("label")),
            candidate.get("subtitle") if isinstance(candidate.get("subtitle"), str) else None,
        )
        if key in seen:
            continue
        seen.add(key)
        deduped.append(candidate)
    return deduped


def _transaction_narrowing(
    *,
    options: dict[str, str],
    results: list[dict[str, Any]],
) -> dict[str, Any]:
    realm_id = _realm_id()
    company_name = options.get("company") or options.get("company_name")
    company_candidate = _company_scope_candidate(realm_id=realm_id, company_name=company_name)
    date_window = _date_window(options)
    date_window_candidate = _date_window_candidate(date_window)
    selected_account = _selected_account_candidate(options)
    account_candidates: list[dict[str, Any]] = []
    for index, result in enumerate(results):
        account_candidates.extend(_iter_account_candidates(result, path=f"results[{index}]"))
    if selected_account is None and len(account_candidates) == 1:
        account_candidates[0]["selected"] = True
        selected_account = account_candidates[0]
    elif selected_account is not None:
        account_candidates = [candidate for candidate in account_candidates if candidate.get("value") != selected_account.get("value")]
    account_candidates = _dedupe_scope_candidates(account_candidates)
    if selected_account is not None:
        account_candidates = _dedupe_scope_candidates([selected_account, *account_candidates])

    account_scope = {
        "selected": selected_account,
        "candidates": account_candidates,
    }
    narrowing: dict[str, Any] = {
        "company": company_candidate,
        "account": account_scope,
        "date_window": date_window_candidate,
        "filters": {
            "company": company_name,
            "account": options.get("account") or options.get("account_id") or options.get("account_name"),
            "date_window": date_window,
        },
    }
    narrowing["selected_filters"] = {
        "company": company_candidate,
        "account": selected_account,
        "date_window": date_window_candidate,
    }
    narrowing["candidate_count"] = len(account_candidates)
    return narrowing


def _picker_label(resource: str, record: dict[str, Any]) -> str:
    if resource == "company":
        return str(record.get("CompanyName") or record.get("Name") or record.get("Id") or "company")
    if resource in {"customer", "vendor"}:
        return str(
            record.get("DisplayName")
            or record.get("CompanyName")
            or " ".join(part for part in [record.get("GivenName"), record.get("FamilyName")] if part)
            or record.get("PrimaryEmailAddr", {}).get("Address")
            or record.get("Id")
            or resource
        )
    if resource == "account":
        return str(record.get("Name") or record.get("AcctNum") or record.get("Id") or "account")
    if resource in {"invoice", "bill", "payment", "transaction"}:
        return str(record.get("DocNumber") or record.get("TxnDate") or record.get("Id") or resource)
    return str(record.get("Id") or resource)


def _picker_subtitle(resource: str, record: dict[str, Any]) -> str | None:
    if resource == "company":
        parts = [record.get("Id"), record.get("Country"), record.get("CompanyAddr", {}).get("City")]
    elif resource in {"customer", "vendor"}:
        email = record.get("PrimaryEmailAddr", {}).get("Address") if isinstance(record.get("PrimaryEmailAddr"), dict) else None
        parts = [email, record.get("CompanyName")]
    elif resource == "account":
        parts = [record.get("AccountType"), record.get("AccountSubType"), record.get("AcctNum")]
    elif resource in {"invoice", "bill", "payment", "transaction"}:
        if resource == "transaction":
            entity_type = _transaction_entity_type(record)
            account_labels = _transaction_account_labels(record)
            account_preview = ", ".join(account_labels[:2])
            if len(account_labels) > 2:
                account_preview = f"{account_preview} +{len(account_labels) - 2} more"
            parts = [entity_type, record.get("TxnDate"), account_preview or None]
        else:
            parts = [record.get("TxnDate"), record.get("EntityRef", {}).get("name") if isinstance(record.get("EntityRef"), dict) else None]
    else:
        parts = []
    values = [str(part) for part in parts if part]
    return " | ".join(values) if values else None


def _picker_options(resource: str, records: list[dict[str, Any]], *, selected_id: str | None = None) -> list[dict[str, Any]]:
    options: list[dict[str, Any]] = []
    for record in records:
        record_id = record.get("Id") or record.get("id")
        if record_id is None:
            continue
        option: dict[str, Any] = {
            "value": str(record_id),
            "label": _picker_label(resource, record),
            "resource": resource,
        }
        subtitle = _picker_subtitle(resource, record)
        if subtitle:
            option["subtitle"] = subtitle
        if selected_id is not None and str(selected_id) == str(record_id):
            option["selected"] = True
        options.append(option)
    return options


def _scope_preview(
    *,
    command_id: str,
    resource: str,
    operation: str,
    config: dict[str, Any],
    picker_options: list[dict[str, Any]] | None = None,
    date_window: dict[str, str | None] | None = None,
    narrowing: dict[str, Any] | None = None,
    **details: Any,
) -> dict[str, Any]:
    preview: dict[str, Any] = {
        "command_id": command_id,
        "resource": resource,
        "operation": operation,
        "realm_id": _realm_id(),
        "api_base_url": config["runtime"]["api_base_url"],
    }
    if picker_options is not None:
        preview["picker"] = {"kind": resource, "items": picker_options}
        preview["candidate_count"] = len(picker_options)
    if date_window is not None:
        preview["date_window"] = date_window
    if narrowing is not None:
        preview["narrowing"] = narrowing
    preview.update(details)
    return preview


def _scope_candidates(preview: dict[str, Any]) -> list[dict[str, Any]]:
    candidates: list[dict[str, Any]] = []
    narrowing = preview.get("narrowing")
    if isinstance(narrowing, dict):
        company = narrowing.get("company")
        if isinstance(company, dict):
            candidates.append(company)
        account = narrowing.get("account")
        if isinstance(account, dict):
            selected_account = account.get("selected")
            if isinstance(selected_account, dict):
                candidates.append(selected_account)
            account_candidates = account.get("candidates")
            if isinstance(account_candidates, list):
                candidates.extend(candidate for candidate in account_candidates if isinstance(candidate, dict))
        date_window = narrowing.get("date_window")
        if isinstance(date_window, dict):
            candidates.append(date_window)
    else:
        realm_id = preview.get("realm_id")
        company_name = preview.get("company_name")
        company = _company_scope_candidate(
            realm_id=str(realm_id or ""),
            company_name=str(company_name) if company_name else None,
        )
        if company is not None:
            candidates.append(company)
        date_window = _date_window_candidate(preview.get("date_window") if isinstance(preview.get("date_window"), dict) else None)
        if date_window is not None:
            candidates.append(date_window)
    picker = preview.get("picker")
    if isinstance(picker, dict):
        kind = str(picker.get("kind") or preview.get("resource") or "connector")
        for item in picker.get("items", []):
            if not isinstance(item, dict):
                continue
            candidates.append({"kind": kind, **item})
    return _dedupe_scope_candidates(candidates)


def _decorate_live_result(
    *,
    config: dict[str, Any],
    resource: str,
    operation: str,
    data: dict[str, Any],
    picker_options: list[dict[str, Any]],
    date_window: dict[str, str | None] | None = None,
    narrowing: dict[str, Any] | None = None,
    transaction_records: list[dict[str, Any]] | None = None,
    **details: Any,
) -> dict[str, Any]:
    scope = _scope_base(config, company_name=details.get("company_name"))
    preview = _scope_preview(
        command_id=f"{resource}.{operation}",
        resource=resource,
        operation=operation,
        config=config,
        picker_options=picker_options,
        date_window=date_window,
        narrowing=narrowing,
        **details,
    )
    if resource == "transaction" and transaction_records is not None:
        transaction_preview = _transaction_scope_preview(transaction_records)
        if transaction_preview is not None:
            preview["transaction"] = transaction_preview
    scope_candidates = _scope_candidates(preview)
    preview["scope_candidates"] = scope_candidates
    return {
        **data,
        "scope": {**scope, "preview": preview},
        "scope_preview": _scope_preview_text(resource, operation, config, preview),
        "picker_options": picker_options,
        "scope_candidates": scope_candidates,
    }


def _scope_preview_text(resource: str, operation: str, config: dict[str, Any], preview: dict[str, Any]) -> str:
    parts = [f"realm {preview.get('realm_id') or 'unconfigured'}", f"{resource}.{operation}"]
    company_name = preview.get("company_name")
    if company_name:
        parts.insert(1, str(company_name))
    account_summary_added = False
    transaction = preview.get("transaction")
    if isinstance(transaction, dict):
        entity_types = transaction.get("entity_types")
        if isinstance(entity_types, list) and entity_types:
            label = "type" if len(entity_types) == 1 else "types"
            parts.append(f"{label} {', '.join(str(item) for item in entity_types if item)}")
        account_labels = transaction.get("account_labels")
        if isinstance(account_labels, list) and account_labels:
            selected_account = None
            narrowing = preview.get("narrowing")
            if isinstance(narrowing, dict):
                account = narrowing.get("account")
                if isinstance(account, dict):
                    selected = account.get("selected")
                    if isinstance(selected, dict) and selected.get("label"):
                        selected_account = str(selected["label"])
            if selected_account:
                parts.append(f"account {selected_account}")
                account_summary_added = True
            else:
                account_label = "account" if len(account_labels) == 1 else "accounts"
                preview_labels = ", ".join(str(item) for item in account_labels[:2] if item)
                if len(account_labels) > 2:
                    preview_labels = f"{preview_labels} +{len(account_labels) - 2} more"
                parts.append(f"{account_label} {preview_labels}")
                account_summary_added = True
    narrowing = preview.get("narrowing")
    if isinstance(narrowing, dict) and not account_summary_added:
        account = narrowing.get("account")
        if isinstance(account, dict):
            selected = account.get("selected")
            if isinstance(selected, dict) and selected.get("label"):
                parts.append(f"account {selected['label']}")
    date_window = preview.get("date_window")
    if isinstance(date_window, dict):
        start = date_window.get("start") or "*"
        end = date_window.get("end") or "*"
        parts.append(f"window {start}..{end}")
    candidate_count = preview.get("candidate_count")
    if candidate_count is not None:
        noun = "candidate" if candidate_count == 1 else "candidates"
        parts.append(f"{candidate_count} {noun}")
    elif preview.get("resource") == "company":
        parts.append("1 candidate")
    return " · ".join(parts)


def _parse_inputs(items: tuple[str, ...]) -> tuple[dict[str, str], list[str]]:
    options: dict[str, str] = {}
    terms: list[str] = []
    for item in items:
        if "=" not in item:
            terms.append(item)
            continue
        key, value = item.split("=", 1)
        key = key.strip().lower()
        value = value.strip()
        if not key:
            terms.append(item)
            continue
        options[key] = value
    return options, terms


def _limit_from_options(options: dict[str, str], default: int = 20) -> int:
    value = options.get("limit") or options.get("maxresults") or options.get("max_results")
    if not value:
        return default
    try:
        parsed = int(value)
    except ValueError:
        return default
    return parsed if parsed > 0 else default


def _escape_query_term(value: str) -> str:
    return value.replace("'", "''")


def _build_like_clause(fields: list[str], terms: list[str]) -> str:
    clauses: list[str] = []
    for term in terms:
        escaped = _escape_query_term(term)
        field_clauses = [f"{field} LIKE '%{escaped}%'" for field in fields]
        if field_clauses:
            clauses.append("(" + " OR ".join(field_clauses) + ")")
    return " AND ".join(clauses)


def _query_endpoint(config: dict[str, Any], entity: str, query: str) -> dict[str, Any]:
    realm_id = _realm_id()
    params = {
        "query": query,
        "minorversion": str(config["runtime"]["minor_version"]),
    }
    url = f"{config['runtime']['api_base_url']}/v3/company/{realm_id}/query?{parse.urlencode(params)}"
    return _authorized_request_with_token(config, "GET", url)


def _authorized_request_with_token(
    config: dict[str, Any],
    method: str,
    url: str,
    *,
    payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    token = refresh_access_token(config)
    return _request_json(
        method,
        url,
        headers={"Authorization": f"Bearer {token['access_token']}"},
        payload=payload,
        timeout_seconds=config["runtime"]["timeout_seconds"],
    )


def _read_entity(config: dict[str, Any], entity: str, object_id: str) -> dict[str, Any]:
    realm_id = _realm_id()
    params = parse.urlencode({"minorversion": str(config["runtime"]["minor_version"])})
    path = f"/v3/company/{realm_id}/{entity}/{object_id}?{params}"
    return _authorized_request_with_token(config, "GET", f"{config['runtime']['api_base_url']}{path}")


def _post_entity(config: dict[str, Any], entity: str, payload: dict[str, Any]) -> dict[str, Any]:
    realm_id = _realm_id()
    params = parse.urlencode({"minorversion": str(config["runtime"]["minor_version"])})
    path = f"/v3/company/{realm_id}/{entity.lower()}?{params}"
    return _authorized_request_with_token(config, "POST", f"{config['runtime']['api_base_url']}{path}", payload=payload)


def _normalize_query_response(entity: str, payload: dict[str, Any]) -> list[dict[str, Any]]:
    if entity == "Transaction":
        return []
    for key in ("QueryResponse", "queryResponse"):
        value = payload.get(key)
        if isinstance(value, dict):
            if entity in value and isinstance(value[entity], list):
                return [item for item in value[entity] if isinstance(item, dict)]
            singular = entity.rstrip("s")
            if singular in value and isinstance(value[singular], list):
                return [item for item in value[singular] if isinstance(item, dict)]
            for candidate in ("Customer", "Vendor", "Invoice", "Bill", "Payment", "Account"):
                if candidate in value and isinstance(value[candidate], list):
                    return [item for item in value[candidate] if isinstance(item, dict)]
    return []


def _list_resource(
    config: dict[str, Any],
    resource: str,
    *,
    limit: int,
    terms: list[str],
    options: dict[str, str],
) -> dict[str, Any]:
    if resource == "transaction":
        results: list[dict[str, Any]] = []
        for entity in TRANSACTION_SEARCH_ENTITIES:
            query = f"select * from {entity} startposition 1 maxresults {max(1, min(limit, 25))}"
            try:
                response = _query_endpoint(config, entity, query)
            except ConnectorError as exc:
                if exc.code in {"QBO_BACKEND_UNAVAILABLE", "QBO_REQUEST_ERROR"}:
                    continue
                raise
            items = _normalize_query_response(entity, response)
            for item in items:
                item = dict(item)
                item.setdefault("entity_type", entity)
                results.append(item)
            if len(results) >= limit:
                break
        results = results[:limit]
        picker_options = _picker_options("transaction", results)
        date_window = _date_window(options)
        narrowing = _transaction_narrowing(options=options, results=results)
        return _decorate_live_result(
            config=config,
            resource=resource,
            operation="list",
            data={
                "status": "ok",
                "resource": resource,
                "operation": "list",
                "count": len(results),
                "results": results,
            },
            picker_options=picker_options,
            date_window=date_window,
            narrowing=narrowing,
            transaction_records=results,
            aggregated_entities=TRANSACTION_SEARCH_ENTITIES,
            count=len(results),
        )

    entity = RESOURCE_ENTITY_MAP[resource]
    if terms:
        return _search_resource(config, resource, query_text=" ".join(terms), limit=limit, options=options)
    query = f"select * from {entity} startposition 1 maxresults {limit}"
    response = _query_endpoint(config, entity, query)
    results = _normalize_query_response(entity, response)
    picker_options = _picker_options(resource, results)
    return _decorate_live_result(
        config=config,
        resource=resource,
        operation="list",
        data={
            "status": "ok",
            "resource": resource,
            "operation": "list",
            "count": len(results),
            "results": results,
        },
        picker_options=picker_options,
        count=len(results),
    )


def _search_resource(
    config: dict[str, Any],
    resource: str,
    *,
    query_text: str,
    limit: int,
    options: dict[str, str],
) -> dict[str, Any]:
    entity = RESOURCE_ENTITY_MAP.get(resource)
    if resource == "transaction":
        return _search_transactions(config, query_text=query_text, limit=limit, options=options)
    if entity is None:
        raise ConnectorError("QBO_INVALID_USAGE", f"Unknown resource: {resource}", 2)
    fields = SEARCH_FIELDS.get(resource, ["Name"])
    clause = _build_like_clause(fields, [query_text]) if query_text else ""
    query = f"select * from {entity}"
    if clause:
        query += f" where {clause}"
    query += f" startposition 1 maxresults {limit}"
    response = _query_endpoint(config, entity, query)
    results = _normalize_query_response(entity, response)
    picker_options = _picker_options(resource, results)
    return _decorate_live_result(
        config=config,
        resource=resource,
        operation="search",
        data={
            "status": "ok",
            "resource": resource,
            "operation": "search",
            "query": query_text,
            "count": len(results),
            "results": results,
        },
        picker_options=picker_options,
        query=query_text,
        count=len(results),
    )


def _search_transactions(
    config: dict[str, Any],
    *,
    query_text: str,
    limit: int,
    options: dict[str, str],
) -> dict[str, Any]:
    results: list[dict[str, Any]] = []
    for resource in TRANSACTION_SEARCH_ENTITIES:
        entity = resource
        fields = ["DocNumber", "PrivateNote", "TxnDate"]
        clause = _build_like_clause(fields, [query_text]) if query_text else ""
        query = f"select * from {entity}"
        if clause:
            query += f" where {clause}"
        query += f" startposition 1 maxresults {max(1, min(limit, 25))}"
        try:
            response = _query_endpoint(config, entity, query)
        except ConnectorError as exc:
            if exc.code in {"QBO_BACKEND_UNAVAILABLE", "QBO_REQUEST_ERROR"}:
                continue
            raise
        items = _normalize_query_response(entity, response)
        for item in items:
            item = dict(item)
            item.setdefault("entity_type", entity)
            results.append(item)
        if len(results) >= limit:
            break
    results = results[:limit]
    picker_options = _picker_options("transaction", results)
    narrowing = _transaction_narrowing(options=options, results=results)
    return _decorate_live_result(
        config=config,
        resource="transaction",
        operation="search",
        data={
            "status": "ok",
            "resource": "transaction",
            "operation": "search",
            "query": query_text,
            "count": min(len(results), limit),
            "results": results,
        },
        picker_options=picker_options,
        date_window=_date_window(options),
        narrowing=narrowing,
        transaction_records=results,
        aggregated_entities=TRANSACTION_SEARCH_ENTITIES,
        query=query_text,
        count=min(len(results), limit),
    )


def _read_resource(config: dict[str, Any], resource: str, *, object_id: str, entity: str | None = None) -> dict[str, Any]:
    if resource == "transaction":
        return _read_transaction(config, object_id=object_id, entity=entity)
    qbo_entity = _canonical_entity_name(entity) or RESOURCE_ENTITY_MAP.get(resource)
    if qbo_entity is None:
        raise ConnectorError("QBO_INVALID_USAGE", f"Unknown resource: {resource}", 2)
    result = _read_entity(config, qbo_entity, object_id)
    picker_options = _picker_options(resource, [result], selected_id=object_id)
    return _decorate_live_result(
        config=config,
        resource=resource,
        operation="read",
        data={
            "status": "ok",
            "resource": resource,
            "operation": "read",
            "result": result,
        },
        picker_options=picker_options,
        object_id=object_id,
        count=1,
    )


def _read_transaction(config: dict[str, Any], *, object_id: str, entity: str | None = None) -> dict[str, Any]:
    candidates = [_canonical_entity_name(entity)] if entity else []
    candidates = [candidate for candidate in candidates if candidate]
    if not candidates:
        candidates = TRANSACTION_SEARCH_ENTITIES
    last_error: ConnectorError | None = None
    for candidate in candidates:
        try:
            result = _read_entity(config, candidate, object_id)
        except ConnectorError as exc:
            last_error = exc
            if exc.exit_code == 6:
                continue
            if exc.code in {"QBO_BACKEND_UNAVAILABLE", "QBO_REQUEST_ERROR"}:
                continue
            raise
        if isinstance(result, dict) and result:
            result = dict(result)
            result.setdefault("entity_type", candidate)
            picker_options = _picker_options("transaction", [result], selected_id=object_id)
            narrowing = _transaction_narrowing(options={}, results=[result])
            return _decorate_live_result(
                config=config,
                resource="transaction",
                operation="read",
                data={
                    "status": "ok",
                    "resource": "transaction",
                    "operation": "read",
                    "result": result,
                },
                picker_options=picker_options,
                narrowing=narrowing,
                transaction_records=[result],
                object_id=object_id,
                matched_entity=candidate,
                count=1,
            )
    if last_error is not None and last_error.exit_code == 6:
        raise ConnectorError(
            "QBO_NOT_FOUND",
            "QuickBooks could not find the requested transaction.",
            6,
            {"transaction_id": object_id, "candidates": candidates},
        ) from last_error
    raise ConnectorError(
        "QBO_NOT_FOUND",
        "QuickBooks could not find the requested transaction.",
        6,
        {"transaction_id": object_id, "candidates": candidates},
    )


def run_read_command(command_id: str, items: tuple[str, ...]) -> dict[str, Any]:
    config = runtime_config()
    options, terms = _parse_inputs(items)
    resource, operation = command_id.split(".", 1)
    if resource == "company" and operation == "read":
        return _read_company(config)
    if operation == "list":
        return _list_resource(config, resource, limit=_limit_from_options(options), terms=terms, options=options)
    if operation == "search":
        query_text = options.get("query") or " ".join(terms)
        return _search_resource(config, resource, query_text=query_text, limit=_limit_from_options(options), options=options)
    if operation == "read":
        object_id = options.get("id") or (terms[0] if terms else "")
        if not object_id:
            raise ConnectorError(
                "QBO_INVALID_USAGE",
                f"{command_id} requires an id argument.",
                2,
                {"usage": f"{command_id} <id>"},
            )
        entity = options.get("entity") or options.get("resource")
        return _read_resource(config, resource, object_id=object_id, entity=entity)
    raise ConnectorError("QBO_INVALID_USAGE", f"Unknown command: {command_id}", 2)


def _required_option(options: dict[str, str], *names: str) -> str:
    for name in names:
        value = options.get(name)
        if value:
            return value
    raise ConnectorError(
        "QBO_INVALID_USAGE",
        f"Missing required option: {names[0]}",
        2,
        {"accepted_keys": list(names)},
    )


def _amount_option(options: dict[str, str]) -> float:
    raw = _required_option(options, "amount", "total")
    try:
        amount = float(raw)
    except ValueError as exc:
        raise ConnectorError("QBO_INVALID_USAGE", "amount must be a number.", 2, {"amount": raw}) from exc
    if amount <= 0:
        raise ConnectorError("QBO_INVALID_USAGE", "amount must be greater than zero.", 2, {"amount": raw})
    return round(amount, 2)


def _invoice_payload(options: dict[str, str]) -> dict[str, Any]:
    customer_id = _required_option(options, "customer_id", "customer")
    item_id = _required_option(options, "item_id", "item", "product_id", "service_item_id")
    amount = _amount_option(options)
    line: dict[str, Any] = {
        "Amount": amount,
        "DetailType": "SalesItemLineDetail",
        "SalesItemLineDetail": {"ItemRef": {"value": item_id}},
    }
    description = options.get("description") or options.get("memo")
    if description:
        line["Description"] = description
    payload: dict[str, Any] = {
        "CustomerRef": {"value": customer_id},
        "Line": [line],
    }
    due_date = options.get("due_date") or options.get("duedate")
    if due_date:
        payload["DueDate"] = due_date
    private_note = options.get("private_note") or options.get("memo")
    if private_note:
        payload["PrivateNote"] = private_note
    doc_number = options.get("doc_number") or options.get("docnumber")
    if doc_number:
        payload["DocNumber"] = doc_number
    return payload


def _bill_payload(options: dict[str, str]) -> dict[str, Any]:
    vendor_id = _required_option(options, "vendor_id", "vendor")
    account_id = _required_option(options, "account_id", "account")
    amount = _amount_option(options)
    line: dict[str, Any] = {
        "Amount": amount,
        "DetailType": "AccountBasedExpenseLineDetail",
        "AccountBasedExpenseLineDetail": {"AccountRef": {"value": account_id}},
    }
    description = options.get("description") or options.get("memo")
    if description:
        line["Description"] = description
    payload: dict[str, Any] = {
        "VendorRef": {"value": vendor_id},
        "Line": [line],
    }
    due_date = options.get("due_date") or options.get("duedate")
    if due_date:
        payload["DueDate"] = due_date
    private_note = options.get("private_note") or options.get("memo")
    if private_note:
        payload["PrivateNote"] = private_note
    doc_number = options.get("doc_number") or options.get("docnumber")
    if doc_number:
        payload["DocNumber"] = doc_number
    return payload


def _create_draft(config: dict[str, Any], resource: str, options: dict[str, str]) -> dict[str, Any]:
    if resource == "invoice":
        entity = "Invoice"
        payload = _invoice_payload(options)
    elif resource == "bill":
        entity = "Bill"
        payload = _bill_payload(options)
    else:
        raise ConnectorError("QBO_INVALID_USAGE", f"Unknown write resource: {resource}", 2)

    response = _post_entity(config, entity, payload)
    result = response.get(entity) if isinstance(response.get(entity), dict) else response
    if not isinstance(result, dict):
        raise ConnectorError(
            "QBO_RESPONSE_ERROR",
            f"QuickBooks {resource} create returned an unexpected payload.",
            10,
            {"body": response},
        )
    picker_options = _picker_options(resource, [result], selected_id=result.get("Id"))
    return _decorate_live_result(
        config=config,
        resource=resource,
        operation="create_draft",
        data={
            "status": "ok",
            "resource": resource,
            "operation": "create_draft",
            "result": result,
            "request": {"payload": payload},
        },
        picker_options=picker_options,
        object_id=result.get("Id"),
        count=1,
    )


def run_write_command(command_id: str, items: tuple[str, ...]) -> dict[str, Any]:
    config = runtime_config()
    options, _terms = _parse_inputs(items)
    resource, operation = command_id.split(".", 1)
    if operation == "create_draft":
        return _create_draft(config, resource, options)
    raise ConnectorError("QBO_INVALID_USAGE", f"Unknown write command: {command_id}", 2)
