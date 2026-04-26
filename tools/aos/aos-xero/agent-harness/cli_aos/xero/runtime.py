from __future__ import annotations

import json
from typing import Any

from .client import XeroApiError, XeroClient
from .config import config_snapshot, resolve_runtime_values
from .constants import BACKEND_NAME, CONNECTOR_PATH, DEFAULT_API_BASE_URL, DEFAULT_TOKEN_URL, TOOL_NAME
from .errors import CliError


def _load_manifest() -> dict[str, Any]:
    return json.loads(CONNECTOR_PATH.read_text())


def _scope_preview(command_id: str, resource: str, extra: dict[str, Any] | None = None) -> dict[str, Any]:
    payload = {"selection_surface": resource, "command_id": command_id, "backend": BACKEND_NAME}
    if extra:
        payload.update(extra)
    return payload


def _picker(items: list[dict[str, Any]], *, kind: str, label_key: str = "label") -> dict[str, Any]:
    return {"kind": kind, "items": items, "count": len(items), "label_key": label_key}


def _require_arg(value: str | None, *, code: str, message: str, detail_key: str, detail_value: str) -> str:
    resolved = (value or "").strip()
    if resolved:
        return resolved
    raise CliError(code=code, message=message, exit_code=4, details={detail_key: detail_value})


def capabilities_snapshot() -> dict[str, Any]:
    manifest = _load_manifest()
    read_support: dict[str, bool] = {}
    write_support: dict[str, bool] = {}
    for command in manifest["commands"]:
        target = read_support if command["required_mode"] == "readonly" else write_support
        target[command["id"]] = True
    return {
        "tool": manifest["tool"],
        "backend": manifest["backend"],
        "manifest_schema_version": manifest.get("manifest_schema_version", "1.0.0"),
        "connector": manifest["connector"],
        "auth": manifest["auth"],
        "scope": manifest.get("scope", {}),
        "commands": manifest["commands"],
        "read_support": read_support,
        "write_support": write_support,
    }


def create_client(ctx_obj: dict[str, Any]) -> XeroClient:
    runtime = resolve_runtime_values(ctx_obj)
    missing: list[str] = []
    if not runtime["client_id_present"]:
        missing.append(runtime["client_id_env"])
    if not runtime["client_secret_present"]:
        missing.append(runtime["client_secret_env"])
    if not runtime["refresh_token_present"]:
        missing.append(runtime["refresh_token_env"])
    if not runtime["tenant_id_present"]:
        missing.append(runtime["tenant_id_env"])
    if missing:
        raise CliError(
            code="XERO_SETUP_REQUIRED",
            message="Xero connector is missing required credentials",
            exit_code=4,
            details={"missing_keys": missing},
        )
    return XeroClient(
        client_id=runtime["client_id"],
        client_secret=runtime["client_secret"],
        refresh_token=runtime["refresh_token"],
        tenant_id=runtime["tenant_id"],
        api_base_url=runtime["api_base_url"] or DEFAULT_API_BASE_URL,
        token_url=runtime["token_url"] or DEFAULT_TOKEN_URL,
    )


def probe_runtime(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    if not runtime["credentials_present"]:
        missing = [key for key, present in [
            (runtime["client_id_env"], runtime["client_id_present"]),
            (runtime["client_secret_env"], runtime["client_secret_present"]),
            (runtime["refresh_token_env"], runtime["refresh_token_present"]),
            (runtime["tenant_id_env"], runtime["tenant_id_present"]),
        ] if not present]
        return {
            "ok": False,
            "code": "XERO_SETUP_REQUIRED",
            "message": "Xero connector is missing required credentials",
            "details": {"missing_keys": missing, "live_backend_available": False},
        }
    try:
        client = create_client(ctx_obj)
        connections = client.connections()
    except CliError as err:
        return {"ok": False, "code": err.code, "message": err.message, "details": err.details}
    except XeroApiError as err:
        code = "XERO_AUTH_FAILED" if err.status_code in {401, 403} else "XERO_API_ERROR"
        return {
            "ok": False,
            "code": code,
            "message": err.message,
            "details": {**(err.details or {}), "status_code": err.status_code, "live_backend_available": False},
        }
    return {
        "ok": True,
        "code": "OK",
        "message": "Xero live runtime is ready",
        "details": {"live_backend_available": True, "connections": connections},
    }


def health_snapshot(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    probe = probe_runtime(ctx_obj)
    status = "ready" if probe["ok"] else ("needs_setup" if probe["code"] == "XERO_SETUP_REQUIRED" else "degraded")
    return {
        "status": status,
        "summary": probe["message"],
        "connector": {
            "tool": TOOL_NAME,
            "backend": BACKEND_NAME,
            "live_backend_available": bool(probe["ok"]),
            "live_read_available": bool(probe["ok"]),
            "write_bridge_available": False,
            "scaffold_only": False,
        },
        "auth": {
            "client_id_env": runtime["client_id_env"],
            "client_id_present": runtime["client_id_present"],
            "client_secret_env": runtime["client_secret_env"],
            "client_secret_present": runtime["client_secret_present"],
            "refresh_token_env": runtime["refresh_token_env"],
            "refresh_token_present": runtime["refresh_token_present"],
            "tenant_id_env": runtime["tenant_id_env"],
            "tenant_id_present": runtime["tenant_id_present"],
            "service_keys": runtime["service_keys"],
            "operator_service_keys": runtime["service_keys"],
            "sources": runtime["sources"],
            "development_fallback": runtime["service_keys"],
        },
        "scope": {
            "contact_id": runtime["contact_id"],
            "invoice_id": runtime["invoice_id"],
            "payment_id": runtime["payment_id"],
            "api_base_url": runtime["api_base_url"],
            "token_url": runtime["token_url"],
        },
        "checks": [
            {
                "name": "required_env",
                "ok": runtime["credentials_present"],
                "details": {"missing_keys": [] if runtime["credentials_present"] else [
                    key for key, present in [
                        (runtime["client_id_env"], runtime["client_id_present"]),
                        (runtime["client_secret_env"], runtime["client_secret_present"]),
                        (runtime["refresh_token_env"], runtime["refresh_token_present"]),
                        (runtime["tenant_id_env"], runtime["tenant_id_present"]),
                    ] if not present
                ]},
            },
            {"name": "live_backend", "ok": bool(probe["ok"]), "details": probe.get("details", {})},
        ],
        "runtime_ready": bool(probe["ok"]),
        "probe": probe,
        "next_steps": [
            f"Set {runtime['client_id_env']}, {runtime['client_secret_env']}, {runtime['refresh_token_env']}, and {runtime['tenant_id_env']} in operator-controlled API Keys.",
            "Use invoice.list or contact.list to confirm the live backend responds.",
            "Do not advertise Xero write commands until live write workflows and approval policy are implemented.",
        ],
    }


def doctor_snapshot(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    probe = probe_runtime(ctx_obj)
    ready = bool(probe["ok"])
    return {
        "status": "ready" if ready else ("needs_setup" if probe["code"] == "XERO_SETUP_REQUIRED" else "degraded"),
        "summary": "Xero connector diagnostics.",
        "runtime": {
            "implementation_mode": "live_read_only",
            "command_readiness": {
                "invoice.list": ready,
                "invoice.get": ready,
                "contact.list": ready,
                "contact.get": ready,
                "payment.list": ready,
                "payment.get": ready,
                "account.list": ready,
                "bank_transaction.list": ready,
                "report.profit_loss": ready,
                "report.balance_sheet": ready,
                "quote.list": ready,
            },
        },
        "checks": [
            {"name": "required_env", "ok": runtime["credentials_present"]},
            {"name": "live_backend", "ok": ready, "details": probe.get("details", {})},
        ],
        "supported_read_commands": [
            "invoice.list",
            "invoice.get",
            "contact.list",
            "contact.get",
            "payment.list",
            "payment.get",
            "account.list",
            "bank_transaction.list",
            "report.profit_loss",
            "report.balance_sheet",
            "quote.list",
        ],
        "supported_write_commands": [],
    }


def _empty_picker(kind: str) -> dict[str, Any]:
    return _picker([], kind=kind)


def _normalize_invoice(raw: dict[str, Any]) -> dict[str, Any]:
    contact = raw.get("Contact") if isinstance(raw.get("Contact"), dict) else {}
    return {
        "id": raw.get("InvoiceID"),
        "number": raw.get("InvoiceNumber"),
        "contact": contact.get("Name") or contact.get("ContactID"),
        "status": raw.get("Status"),
        "total": raw.get("Total"),
        "amount_due": raw.get("AmountDue"),
        "currency": raw.get("CurrencyCode"),
        "date": raw.get("DateString") or raw.get("Date"),
        "due_date": raw.get("DueDateString") or raw.get("DueDate"),
        "raw": raw,
    }


def _normalize_contact(raw: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": raw.get("ContactID"),
        "name": raw.get("Name"),
        "email": raw.get("EmailAddress"),
        "phone": raw.get("Phones", [{}])[0].get("PhoneNumber") if isinstance(raw.get("Phones"), list) and raw.get("Phones") else None,
        "is_customer": raw.get("IsCustomer"),
        "is_supplier": raw.get("IsSupplier"),
        "outstanding_balance": raw.get("AccountsReceivableOutstanding"),
        "raw": raw,
    }


def _normalize_payment(raw: dict[str, Any]) -> dict[str, Any]:
    invoice = raw.get("Invoice") if isinstance(raw.get("Invoice"), dict) else {}
    return {
        "id": raw.get("PaymentID"),
        "invoice": invoice.get("InvoiceID") or invoice.get("InvoiceNumber"),
        "amount": raw.get("Amount"),
        "currency": raw.get("CurrencyCode"),
        "date": raw.get("DateString") or raw.get("Date"),
        "status": raw.get("Status"),
        "payment_type": raw.get("PaymentType"),
        "raw": raw,
    }


def _normalize_account(raw: dict[str, Any]) -> dict[str, Any]:
    return {
        "code": raw.get("Code"),
        "name": raw.get("Name"),
        "type": raw.get("Type"),
        "class": raw.get("Class"),
        "status": raw.get("Status"),
        "tax_type": raw.get("TaxType"),
        "description": raw.get("Description"),
        "raw": raw,
    }


def _normalize_bank_transaction(raw: dict[str, Any]) -> dict[str, Any]:
    contact = raw.get("Contact") if isinstance(raw.get("Contact"), dict) else {}
    return {
        "id": raw.get("BankTransactionID"),
        "type": raw.get("Type"),
        "contact": contact.get("Name") or contact.get("ContactID"),
        "total": raw.get("Total"),
        "date": raw.get("DateString") or raw.get("Date"),
        "status": raw.get("Status"),
        "bank_account": raw.get("BankAccount") or raw.get("BankAccountCode"),
        "raw": raw,
    }


def _normalize_quote(raw: dict[str, Any]) -> dict[str, Any]:
    contact = raw.get("Contact") if isinstance(raw.get("Contact"), dict) else {}
    return {
        "id": raw.get("QuoteID"),
        "number": raw.get("QuoteNumber"),
        "contact": contact.get("Name") or contact.get("ContactID"),
        "status": raw.get("QuoteStatus"),
        "total": raw.get("Total"),
        "date": raw.get("DateString") or raw.get("Date"),
        "expiry_date": raw.get("ExpiryDateString") or raw.get("ExpiryDate"),
        "raw": raw,
    }


def _extract_entries(data: dict[str, Any], key: str) -> list[dict[str, Any]]:
    entries = data.get(key, [])
    return [item for item in entries if isinstance(item, dict)] if isinstance(entries, list) else []


def run_read_command(command_id: str, items: tuple[str, ...], ctx_obj: dict[str, Any] | None = None) -> dict[str, Any]:
    ctx = ctx_obj or {}
    runtime = resolve_runtime_values(ctx)
    client = create_client(ctx)
    args = list(items)
    if command_id == "invoice.list":
        limit = int(args[0]) if args and args[0].isdigit() else 25
        statuses = args[1].split(",") if len(args) > 1 and args[1] else ["AUTHORISED", "SUBMITTED"]
        data = client.list_invoices(limit=limit, statuses=statuses)
        invoices = [_normalize_invoice(item) for item in _extract_entries(data, "Invoices")]
        return {"status": "live_read", "backend": BACKEND_NAME, "summary": f"Listed {len(invoices)} invoice(s).", "invoices": invoices, "picker": _picker([{"value": item["id"], "label": item["number"] or item["id"], "subtitle": item.get("contact"), "selected": False} for item in invoices], kind="xero_invoice"), "scope_preview": _scope_preview("invoice.list", "invoice", {"tenant_id": runtime["tenant_id"]})}
    if command_id == "invoice.get":
        invoice_id = args[0] if args else runtime["invoice_id"]
        resolved = _require_arg(invoice_id, code="XERO_INVOICE_ID_REQUIRED", message="invoice_id is required", detail_key="env", detail_value=runtime["invoice_id_env"])
        data = client.get_invoice(resolved)
        invoices = [_normalize_invoice(item) for item in _extract_entries(data, "Invoices")]
        invoice = invoices[0] if invoices else _normalize_invoice(data.get("Invoices", [{}])[0] if isinstance(data.get("Invoices"), list) and data.get("Invoices") else {})
        return {"status": "live_read", "backend": BACKEND_NAME, "summary": f"Fetched invoice {resolved}.", "invoice": invoice, "scope_preview": _scope_preview("invoice.get", "invoice", {"invoice_id": resolved})}
    if command_id == "contact.list":
        limit = int(args[0]) if args and args[0].isdigit() else 25
        data = client.list_contacts(limit=limit)
        contacts = [_normalize_contact(item) for item in _extract_entries(data, "Contacts")]
        return {"status": "live_read", "backend": BACKEND_NAME, "summary": f"Listed {len(contacts)} contact(s).", "contacts": contacts, "picker": _picker([{"value": item["id"], "label": item["name"] or item["id"], "subtitle": item.get("email"), "selected": False} for item in contacts], kind="xero_contact"), "scope_preview": _scope_preview("contact.list", "contact", {"tenant_id": runtime["tenant_id"]})}
    if command_id == "contact.get":
        contact_id = args[0] if args else runtime["contact_id"]
        resolved = _require_arg(contact_id, code="XERO_CONTACT_ID_REQUIRED", message="contact_id is required", detail_key="env", detail_value=runtime["contact_id_env"])
        data = client.get_contact(resolved)
        contacts = [_normalize_contact(item) for item in _extract_entries(data, "Contacts")]
        contact = contacts[0] if contacts else _normalize_contact(data.get("Contacts", [{}])[0] if isinstance(data.get("Contacts"), list) and data.get("Contacts") else {})
        return {"status": "live_read", "backend": BACKEND_NAME, "summary": f"Fetched contact {resolved}.", "contact": contact, "scope_preview": _scope_preview("contact.get", "contact", {"contact_id": resolved})}
    if command_id == "payment.list":
        limit = int(args[0]) if args and args[0].isdigit() else 25
        data = client.list_payments(limit=limit)
        payments = [_normalize_payment(item) for item in _extract_entries(data, "Payments")]
        return {"status": "live_read", "backend": BACKEND_NAME, "summary": f"Listed {len(payments)} payment(s).", "payments": payments, "picker": _picker([{"value": item["id"], "label": item["id"] or item.get("invoice"), "subtitle": item.get("amount"), "selected": False} for item in payments], kind="xero_payment"), "scope_preview": _scope_preview("payment.list", "payment", {"tenant_id": runtime["tenant_id"]})}
    if command_id == "payment.get":
        payment_id = args[0] if args else runtime["payment_id"]
        resolved = _require_arg(payment_id, code="XERO_PAYMENT_ID_REQUIRED", message="payment_id is required", detail_key="env", detail_value=runtime["payment_id_env"])
        data = client.get_payment(resolved)
        payments = [_normalize_payment(item) for item in _extract_entries(data, "Payments")]
        payment = payments[0] if payments else _normalize_payment(data.get("Payments", [{}])[0] if isinstance(data.get("Payments"), list) and data.get("Payments") else {})
        return {"status": "live_read", "backend": BACKEND_NAME, "summary": f"Fetched payment {resolved}.", "payment": payment, "scope_preview": _scope_preview("payment.get", "payment", {"payment_id": resolved})}
    if command_id == "account.list":
        limit = int(args[0]) if args and args[0].isdigit() else 100
        data = client.list_accounts(limit=limit)
        accounts = [_normalize_account(item) for item in _extract_entries(data, "Accounts")]
        return {"status": "live_read", "backend": BACKEND_NAME, "summary": f"Listed {len(accounts)} account(s).", "accounts": accounts, "picker": _picker([{"value": item["code"], "label": item["name"] or item["code"], "subtitle": item.get("type"), "selected": False} for item in accounts], kind="xero_account"), "scope_preview": _scope_preview("account.list", "account", {"tenant_id": runtime["tenant_id"]})}
    if command_id == "bank_transaction.list":
        limit = int(args[0]) if args and args[0].isdigit() else 25
        data = client.list_bank_transactions(limit=limit)
        transactions = [_normalize_bank_transaction(item) for item in _extract_entries(data, "BankTransactions")]
        return {"status": "live_read", "backend": BACKEND_NAME, "summary": f"Listed {len(transactions)} bank transaction(s).", "bank_transactions": transactions, "picker": _picker([{"value": item["id"], "label": item["id"] or item.get("type"), "subtitle": item.get("contact"), "selected": False} for item in transactions], kind="xero_bank_transaction"), "scope_preview": _scope_preview("bank_transaction.list", "bank_transaction", {"tenant_id": runtime["tenant_id"]})}
    if command_id == "report.profit_loss":
        date = args[0] if args else runtime["date"]
        data = client.profit_and_loss_report(date=date)
        return {"status": "live_read", "backend": BACKEND_NAME, "summary": "Generated Profit & Loss report.", "report": data, "scope_preview": _scope_preview("report.profit_loss", "report", {"date": date})}
    if command_id == "report.balance_sheet":
        date = args[0] if args else runtime["date"]
        data = client.balance_sheet_report(date=date)
        return {"status": "live_read", "backend": BACKEND_NAME, "summary": "Generated Balance Sheet report.", "report": data, "scope_preview": _scope_preview("report.balance_sheet", "report", {"date": date})}
    if command_id == "quote.list":
        limit = int(args[0]) if args and args[0].isdigit() else 25
        data = client.list_quotes(limit=limit)
        quotes = [_normalize_quote(item) for item in _extract_entries(data, "Quotes")]
        return {"status": "live_read", "backend": BACKEND_NAME, "summary": f"Listed {len(quotes)} quote(s).", "quotes": quotes, "picker": _picker([{"value": item["id"], "label": item["number"] or item["id"], "subtitle": item.get("contact"), "selected": False} for item in quotes], kind="xero_quote"), "scope_preview": _scope_preview("quote.list", "quote", {"tenant_id": runtime["tenant_id"]})}
    raise CliError(code="XERO_UNKNOWN_COMMAND", message=f"Unsupported command: {command_id}", exit_code=2, details={})
