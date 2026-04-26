from __future__ import annotations

import os
import subprocess
from functools import lru_cache
from pathlib import Path
from typing import Any

from .constants import (
    AOS_ACCOUNT_ENV,
    BACKEND_NAME,
    FIELD_ENV,
    ITEM_ENV,
    OP_ACCOUNT_ENV,
    OP_PATH_ENV,
    SERVICE_ACCOUNT_TOKEN_ENV,
    VAULT_ENV,
)

ARGENTOS_ROOT = Path(__file__).resolve().parents[6]


def _mask(value: str | None) -> str | None:
    if not value:
        return None
    if len(value) <= 8:
        return "*" * len(value)
    return f"{value[:4]}***{value[-4:]}"


@lru_cache(maxsize=8)
def resolve_service_key(variable: str) -> str | None:
    command = [
        "node",
        "--import",
        "tsx",
        "-e",
        (
            "import { resolveServiceKey } from './src/infra/service-keys.ts';"
            f" process.stdout.write(resolveServiceKey('{variable}') || '');"
            " process.exit(0);"
        ),
    ]
    result = subprocess.run(
        command,
        cwd=ARGENTOS_ROOT,
        capture_output=True,
        text=True,
        timeout=20,
        check=False,
    )
    if result.returncode != 0:
        return None
    return result.stdout.strip() or None


def resolve_runtime_values(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    op_path_env = ctx_obj.get("op_path_env") or OP_PATH_ENV
    account_env = ctx_obj.get("account_env") or AOS_ACCOUNT_ENV
    vault_env = ctx_obj.get("vault_env") or VAULT_ENV
    item_env = ctx_obj.get("item_env") or ITEM_ENV
    field_env = ctx_obj.get("field_env") or FIELD_ENV

    account = (os.getenv(account_env) or os.getenv(OP_ACCOUNT_ENV) or "").strip()
    service_account_token_from_service_keys = resolve_service_key(SERVICE_ACCOUNT_TOKEN_ENV) or ""
    service_account_token_from_env = (os.getenv(SERVICE_ACCOUNT_TOKEN_ENV) or "").strip()
    service_account_token = service_account_token_from_service_keys or service_account_token_from_env

    return {
        "backend": BACKEND_NAME,
        "op_path_env": op_path_env,
        "op_path": (os.getenv(op_path_env) or "op").strip() or "op",
        "account_env": account_env,
        "op_account_env": OP_ACCOUNT_ENV,
        "account": account,
        "account_present": bool(account),
        "service_account_token_env": SERVICE_ACCOUNT_TOKEN_ENV,
        "service_account_token_present": bool(service_account_token),
        "service_account_token_preview": _mask(service_account_token),
        "service_account_token": service_account_token,
        "service_account_token_source": (
            "service-keys"
            if service_account_token_from_service_keys
            else "process.env"
            if service_account_token_from_env
            else None
        ),
        "vault_env": vault_env,
        "vault": (os.getenv(vault_env) or "").strip(),
        "item_env": item_env,
        "item": (os.getenv(item_env) or "").strip(),
        "field_env": field_env,
        "field": (os.getenv(field_env) or "").strip(),
    }


def config_snapshot(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    from .runtime import probe_runtime

    probe = probe_runtime(ctx_obj)
    return {
        "summary": "1Password connector configuration snapshot.",
        "backend": BACKEND_NAME,
        "runtime": {
            "implementation_mode": "live_read_admin_reveal",
            "live_read_available": bool(probe.get("ok")),
            "write_bridge_available": False,
            "probe": probe,
        },
        "auth": {
            "kind": "local-cli",
            "op_path_env": runtime["op_path_env"],
            "op_path": runtime["op_path"],
            "account_env": runtime["account_env"],
            "op_account_env": runtime["op_account_env"],
            "account_present": runtime["account_present"],
            "service_account_token_env": runtime["service_account_token_env"],
            "service_account_token_present": runtime["service_account_token_present"],
            "service_account_token_preview": runtime["service_account_token_preview"],
            "service_account_token_source": runtime["service_account_token_source"],
            "operator_service_keys": [runtime["service_account_token_env"]],
        },
        "scope": {
            "workerFields": ["account", "vault", "item", "field", "limit"],
            "account": runtime["account"] or None,
            "vault": runtime["vault"] or None,
            "item": runtime["item"] or None,
            "field": runtime["field"] or None,
        },
        "read_support": {
            "account.whoami": True,
            "account.list": True,
            "vault.list": True,
            "item.list": True,
            "item.get": True,
        },
        "admin_support": {
            "item.reveal": True,
        },
    }
