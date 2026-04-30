from __future__ import annotations

import json
import os
import shutil
import subprocess
from dataclasses import dataclass
from typing import Any

from .constants import BACKEND_NAME


@dataclass(slots=True)
class OnePasswordCliError(Exception):
    code: str
    message: str
    exit_code: int | None = None
    stderr: str = ""
    stdout: str = ""
    details: dict[str, Any] | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "code": self.code,
            "message": self.message,
            "exit_code": self.exit_code,
            "stderr": self.stderr,
            "details": self.details or {},
        }


def _json_payload(text: str) -> Any:
    stripped = text.strip()
    if not stripped:
        return {}
    return json.loads(stripped)


def _list_payload(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]
    return []


def _dict_payload(payload: Any) -> dict[str, Any]:
    return payload if isinstance(payload, dict) else {}


def _normalize_account(raw: dict[str, Any]) -> dict[str, Any]:
    return {
        "account_uuid": raw.get("account_uuid") or raw.get("id"),
        "account_name": raw.get("account_name") or raw.get("name"),
        "url": raw.get("url") or raw.get("shorthand"),
        "user_email": raw.get("user_email") or raw.get("email"),
        "raw": raw,
    }


def _normalize_vault(raw: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": raw.get("id"),
        "name": raw.get("name"),
        "type": raw.get("type"),
        "description": raw.get("description"),
        "raw": raw,
    }


def _normalize_item_summary(raw: dict[str, Any]) -> dict[str, Any]:
    vault = raw.get("vault") if isinstance(raw.get("vault"), dict) else {}
    return {
        "id": raw.get("id"),
        "title": raw.get("title"),
        "category": raw.get("category"),
        "vault": {
            "id": vault.get("id"),
            "name": vault.get("name"),
        },
        "updated_at": raw.get("updated_at"),
        "created_at": raw.get("created_at"),
        "raw": raw,
    }


def _is_concealed_field(field: dict[str, Any]) -> bool:
    field_type = str(field.get("type") or "").upper()
    purpose = str(field.get("purpose") or "").upper()
    return field_type == "CONCEALED" or purpose in {"PASSWORD", "OTP"}


def _redact_field(field: dict[str, Any]) -> dict[str, Any]:
    redacted = dict(field)
    if _is_concealed_field(field) and "value" in redacted:
        redacted["value"] = None
        redacted["value_redacted"] = True
    else:
        redacted["value_redacted"] = False
    return redacted


def normalize_item(raw: dict[str, Any], *, redact: bool) -> dict[str, Any]:
    fields = raw.get("fields")
    normalized_fields = []
    if isinstance(fields, list):
        normalized_fields = [
            _redact_field(field) if redact else dict(field)
            for field in fields
            if isinstance(field, dict)
        ]
    vault = raw.get("vault") if isinstance(raw.get("vault"), dict) else {}
    return {
        "id": raw.get("id"),
        "title": raw.get("title"),
        "category": raw.get("category"),
        "vault": {
            "id": vault.get("id"),
            "name": vault.get("name"),
        },
        "fields": normalized_fields,
        "urls": raw.get("urls") if isinstance(raw.get("urls"), list) else [],
        "created_at": raw.get("created_at"),
        "updated_at": raw.get("updated_at"),
        "raw": raw if not redact else None,
        "redacted": redact,
    }


def find_field(item: dict[str, Any], field_selector: str) -> dict[str, Any] | None:
    selector = field_selector.strip().lower()
    for field in item.get("fields", []):
        if not isinstance(field, dict):
            continue
        candidates = [
            str(field.get("id") or "").lower(),
            str(field.get("label") or "").lower(),
            str(field.get("purpose") or "").lower(),
        ]
        if selector in candidates:
            return field
    return None


class OnePasswordClient:
    def __init__(
        self,
        *,
        binary_path: str = "op",
        account: str | None = None,
        service_account_token: str | None = None,
        timeout_seconds: int = 30,
    ) -> None:
        self._binary_path = binary_path or "op"
        self._account = (account or "").strip() or None
        self._service_account_token = (service_account_token or "").strip() or None
        self._timeout_seconds = timeout_seconds

    @property
    def binary_path(self) -> str:
        return self._binary_path

    @property
    def resolved_binary(self) -> str | None:
        if "/" in self._binary_path:
            return self._binary_path if shutil.which(self._binary_path) or shutil.which(self._binary_path.split("/")[-1]) else None
        return shutil.which(self._binary_path)

    def _account_args(self) -> list[str]:
        return ["--account", self._account] if self._account else []

    def _run(self, args: list[str], *, expect_json: bool = True) -> Any:
        command = [self._binary_path, *args]
        env = os.environ.copy()
        if self._service_account_token:
            env["OP_SERVICE_ACCOUNT_TOKEN"] = self._service_account_token
        try:
            result = subprocess.run(
                command,
                check=False,
                capture_output=True,
                text=True,
                timeout=self._timeout_seconds,
                env=env,
            )
        except FileNotFoundError as err:
            raise OnePasswordCliError(
                code="ONEPASSWORD_CLI_NOT_FOUND",
                message="1Password CLI (`op`) was not found",
                details={"backend": BACKEND_NAME, "binary": self._binary_path},
            ) from err
        except subprocess.TimeoutExpired as err:
            raise OnePasswordCliError(
                code="ONEPASSWORD_CLI_TIMEOUT",
                message="1Password CLI command timed out",
                details={"backend": BACKEND_NAME, "timeout_seconds": self._timeout_seconds},
                stdout=err.stdout or "",
                stderr=err.stderr or "",
            ) from err
        if result.returncode != 0:
            stderr = result.stderr.strip()
            code = "ONEPASSWORD_AUTH_REQUIRED" if "not signed in" in stderr.lower() or "signin" in stderr.lower() else "ONEPASSWORD_CLI_ERROR"
            raise OnePasswordCliError(
                code=code,
                message=stderr or "1Password CLI command failed",
                exit_code=result.returncode,
                stderr=stderr,
                stdout=result.stdout.strip(),
                details={"backend": BACKEND_NAME},
            )
        if not expect_json:
            return result.stdout.strip()
        try:
            return _json_payload(result.stdout)
        except json.JSONDecodeError as err:
            raise OnePasswordCliError(
                code="ONEPASSWORD_JSON_INVALID",
                message="1Password CLI returned invalid JSON",
                stdout=result.stdout,
                stderr=result.stderr,
                details={"backend": BACKEND_NAME, "error": str(err)},
            ) from err

    def version(self) -> str:
        return str(self._run(["--version"], expect_json=False))

    def whoami(self) -> dict[str, Any]:
        payload = self._run(["whoami", *self._account_args(), "--format", "json"])
        return _dict_payload(payload)

    def list_accounts(self) -> dict[str, Any]:
        payload = self._run(["account", "list", "--format", "json"])
        accounts = [_normalize_account(item) for item in _list_payload(payload)]
        return {"accounts": accounts, "count": len(accounts), "raw": payload}

    def list_vaults(self) -> dict[str, Any]:
        payload = self._run(["vault", "list", *self._account_args(), "--format", "json"])
        vaults = [_normalize_vault(item) for item in _list_payload(payload)]
        return {"vaults": vaults, "count": len(vaults), "raw": payload}

    def list_items(self, *, vault: str | None = None, limit: int = 50) -> dict[str, Any]:
        args = ["item", "list", *self._account_args(), "--format", "json"]
        if vault:
            args.extend(["--vault", vault])
        payload = self._run(args)
        items = [_normalize_item_summary(item) for item in _list_payload(payload)]
        limited = items[: max(limit, 0)]
        return {"items": limited, "count": len(limited), "raw_count": len(items), "raw": payload}

    def get_item(self, item: str, *, vault: str | None = None, redact: bool = True) -> dict[str, Any]:
        args = ["item", "get", item, *self._account_args(), "--format", "json"]
        if vault:
            args.extend(["--vault", vault])
        payload = self._run(args)
        return normalize_item(_dict_payload(payload), redact=redact)
