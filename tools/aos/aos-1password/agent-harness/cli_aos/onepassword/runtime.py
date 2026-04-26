from __future__ import annotations

import json
from typing import Any

from . import __version__
from .client import OnePasswordCliError, OnePasswordClient, find_field
from .config import config_snapshot, resolve_runtime_values
from .constants import BACKEND_NAME, CONNECTOR_PATH, MODE_ORDER
from .errors import CliError


def _load_manifest() -> dict[str, Any]:
    return json.loads(CONNECTOR_PATH.read_text())


def _scope_preview(command_id: str, resource: str, extra: dict[str, Any] | None = None) -> dict[str, Any]:
    payload = {
        "selection_surface": resource,
        "command_id": command_id,
        "backend": BACKEND_NAME,
    }
    if extra:
        payload.update(extra)
    return payload


def _picker(items: list[dict[str, Any]], *, kind: str, label_key: str = "name") -> dict[str, Any]:
    return {"kind": kind, "items": items, "count": len(items), "label_key": label_key}


def _require_arg(value: str | None, *, code: str, message: str, detail_key: str, detail_value: str) -> str:
    resolved = (value or "").strip()
    if resolved:
        return resolved
    raise CliError(code=code, message=message, exit_code=4, details={detail_key: detail_value})


def _limit(value: int | None) -> int:
    if value is None:
        return 50
    return max(0, min(value, 500))


def _cli_failure(err: OnePasswordCliError) -> CliError:
    details = err.details or {}
    if err.exit_code is not None:
        details = {**details, "op_exit_code": err.exit_code}
    if err.stderr:
        details = {**details, "stderr": err.stderr}
    if err.code in {"ONEPASSWORD_CLI_NOT_FOUND", "ONEPASSWORD_CLI_TIMEOUT"}:
        exit_code = 5
    elif err.code == "ONEPASSWORD_AUTH_REQUIRED":
        exit_code = 4
    else:
        exit_code = 10
    return CliError(code=err.code, message=err.message, exit_code=exit_code, details=details)


def capabilities_snapshot() -> dict[str, Any]:
    manifest = _load_manifest()
    read_support = {}
    admin_support = {}
    for command in manifest["commands"]:
        command_id = command["id"]
        if command["required_mode"] == "admin":
            admin_support[command_id] = True
        elif command["required_mode"] == "readonly":
            read_support[command_id] = True
    return {
        "tool": manifest["tool"],
        "version": __version__,
        "backend": manifest["backend"],
        "manifest_schema_version": manifest.get("manifest_schema_version", "1.0.0"),
        "modes": MODE_ORDER,
        "connector": manifest["connector"],
        "auth": manifest["auth"],
        "scope": manifest.get("scope", {}),
        "commands": manifest["commands"],
        "read_support": read_support,
        "admin_support": admin_support,
        "write_support": {},
    }


def create_client(ctx_obj: dict[str, Any]) -> OnePasswordClient:
    runtime = resolve_runtime_values(ctx_obj)
    return OnePasswordClient(
        binary_path=runtime["op_path"],
        account=runtime["account"] or None,
        service_account_token=runtime["service_account_token"] or None,
    )


def probe_runtime(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    client = create_client(ctx_obj)
    try:
        version = client.version()
    except OnePasswordCliError as err:
        return {
            "ok": False,
            "code": err.code,
            "message": err.message,
            "details": {
                **(err.details or {}),
                "binary": runtime["op_path"],
                "live_backend_available": False,
            },
        }
    try:
        whoami = client.whoami()
    except OnePasswordCliError as err:
        return {
            "ok": False,
            "code": err.code,
            "message": "1Password CLI is installed but not authorized",
            "details": {
                **(err.details or {}),
                "binary": runtime["op_path"],
                "version": version,
                "account": runtime["account"] or None,
                "live_backend_available": True,
                "live_read_available": False,
            },
        }
    return {
        "ok": True,
        "code": "OK",
        "message": "1Password CLI runtime is ready",
        "details": {
            "binary": runtime["op_path"],
            "version": version,
            "account": runtime["account"] or whoami.get("account_name") or None,
            "live_backend_available": True,
            "live_read_available": True,
        },
    }


def health_snapshot(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    probe = probe_runtime(ctx_obj)
    ready = bool(probe.get("ok"))
    status = "ready" if ready else "needs_setup"
    return {
        "status": status,
        "summary": probe["message"],
        "connector": {
            "backend": BACKEND_NAME,
            "live_backend_available": bool(probe.get("details", {}).get("live_backend_available")),
            "live_read_available": ready,
            "write_bridge_available": False,
            "scaffold_only": False,
        },
        "auth": {
            "kind": "local-cli",
            "op_path_env": runtime["op_path_env"],
            "account_env": runtime["account_env"],
            "op_account_env": runtime["op_account_env"],
            "account_present": runtime["account_present"],
            "service_account_token_env": runtime["service_account_token_env"],
            "service_account_token_present": runtime["service_account_token_present"],
            "service_account_token_source": runtime["service_account_token_source"],
            "operator_service_keys": [runtime["service_account_token_env"]],
        },
        "scope": {
            "account": runtime["account"] or None,
            "vault": runtime["vault"] or None,
            "item": runtime["item"] or None,
            "field": runtime["field"] or None,
        },
        "checks": [
            {
                "name": "op_cli",
                "ok": probe.get("code") != "ONEPASSWORD_CLI_NOT_FOUND",
                "details": {"binary": runtime["op_path"]},
            },
            {"name": "auth", "ok": ready, "details": probe.get("details", {})},
        ],
        "runtime_ready": ready,
        "live_backend_available": bool(probe.get("details", {}).get("live_backend_available")),
        "live_read_available": ready,
        "write_bridge_available": False,
        "scaffold_only": False,
        "probe": probe,
        "next_steps": [
            "Install the 1Password CLI (`op`) if it is missing.",
            f"Add {runtime['service_account_token_env']} to operator-controlled service keys, or run `op signin` and unlock the 1Password desktop app.",
            f"Set {runtime['vault_env']} to scope item lookups to a vault.",
        ],
    }


def doctor_snapshot(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    probe = probe_runtime(ctx_obj)
    ready = bool(probe.get("ok"))
    return {
        "status": "ready" if ready else "needs_setup",
        "summary": "1Password connector diagnostics.",
        "runtime": {
            "implementation_mode": "live_read_admin_reveal",
            "command_readiness": {
                "account.whoami": ready,
                "account.list": ready,
                "vault.list": ready,
                "item.list": ready,
                "item.get": ready,
                "item.reveal": ready,
            },
        },
        "checks": [
            {"name": "op_cli", "ok": probe.get("code") != "ONEPASSWORD_CLI_NOT_FOUND"},
            {"name": "auth", "ok": ready, "details": probe.get("details", {})},
        ],
        "supported_read_commands": ["account.whoami", "account.list", "vault.list", "item.list", "item.get"],
        "supported_admin_commands": ["item.reveal"],
        "next_steps": [
            "Use account.whoami to confirm which 1Password account is active.",
            "Use vault.list, then item.list --vault <vault>, before item.get.",
            "Use item.reveal only for one explicit field and only in admin mode.",
        ],
    }


def account_whoami_result(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    try:
        account = create_client(ctx_obj).whoami()
    except OnePasswordCliError as err:
        raise _cli_failure(err) from err
    return {
        "status": "live_read",
        "account": account,
        "scope_preview": _scope_preview("account.whoami", "account"),
    }


def account_list_result(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    try:
        accounts = create_client(ctx_obj).list_accounts()
    except OnePasswordCliError as err:
        raise _cli_failure(err) from err
    return {
        "status": "live_read",
        "accounts": accounts,
        "picker": _picker(accounts["accounts"], kind="1password_account", label_key="account_name"),
        "scope_preview": _scope_preview("account.list", "account"),
    }


def vault_list_result(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    try:
        vaults = create_client(ctx_obj).list_vaults()
    except OnePasswordCliError as err:
        raise _cli_failure(err) from err
    return {
        "status": "live_read",
        "vaults": vaults,
        "picker": _picker(vaults["vaults"], kind="1password_vault"),
        "scope_preview": _scope_preview("vault.list", "vault"),
    }


def item_list_result(ctx_obj: dict[str, Any], *, vault: str | None, limit: int | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved_vault = (vault or runtime["vault"] or "").strip() or None
    try:
        items = create_client(ctx_obj).list_items(vault=resolved_vault, limit=_limit(limit))
    except OnePasswordCliError as err:
        raise _cli_failure(err) from err
    return {
        "status": "live_read",
        "items": items,
        "picker": _picker(items["items"], kind="1password_item", label_key="title"),
        "scope_preview": _scope_preview("item.list", "item", {"vault": resolved_vault}),
    }


def item_get_result(ctx_obj: dict[str, Any], *, item: str | None, vault: str | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved_item = _require_arg(
        item or runtime["item"],
        code="ONEPASSWORD_ITEM_REQUIRED",
        message="item name or ID is required",
        detail_key="env",
        detail_value=runtime["item_env"],
    )
    resolved_vault = (vault or runtime["vault"] or "").strip() or None
    try:
        payload = create_client(ctx_obj).get_item(resolved_item, vault=resolved_vault, redact=True)
    except OnePasswordCliError as err:
        raise _cli_failure(err) from err
    return {
        "status": "live_read",
        "item": payload,
        "scope_preview": _scope_preview("item.get", "item", {"vault": resolved_vault, "item": resolved_item}),
    }


def item_reveal_result(ctx_obj: dict[str, Any], *, item: str | None, vault: str | None, field: str | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved_item = _require_arg(
        item or runtime["item"],
        code="ONEPASSWORD_ITEM_REQUIRED",
        message="item name or ID is required",
        detail_key="env",
        detail_value=runtime["item_env"],
    )
    resolved_field = _require_arg(
        field or runtime["field"],
        code="ONEPASSWORD_FIELD_REQUIRED",
        message="field ID or label is required",
        detail_key="env",
        detail_value=runtime["field_env"],
    )
    resolved_vault = (vault or runtime["vault"] or "").strip() or None
    try:
        payload = create_client(ctx_obj).get_item(resolved_item, vault=resolved_vault, redact=False)
    except OnePasswordCliError as err:
        raise _cli_failure(err) from err
    selected = find_field(payload, resolved_field)
    if selected is None:
        raise CliError(
            code="ONEPASSWORD_FIELD_NOT_FOUND",
            message="requested field was not found on the item",
            exit_code=6,
            details={"field": resolved_field, "item": resolved_item},
        )
    return {
        "status": "live_sensitive_read",
        "sensitive": True,
        "field": {
            "id": selected.get("id"),
            "label": selected.get("label"),
            "type": selected.get("type"),
            "purpose": selected.get("purpose"),
            "value": selected.get("value"),
        },
        "scope_preview": _scope_preview(
            "item.reveal",
            "field",
            {"vault": resolved_vault, "item": resolved_item, "field": resolved_field},
        ),
    }
