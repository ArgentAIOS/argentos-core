from __future__ import annotations

import json
import os
from dataclasses import dataclass
from typing import Any, Iterable
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen

from .errors import CliError
from .constants import DEFAULT_BASE_ID_ENV, DEFAULT_TABLE_NAME_ENV, LEGACY_BASE_ID_ENV, LEGACY_TABLE_NAME_ENV
from .service_keys import resolve_named_value


def _coerce_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    return json.dumps(value, sort_keys=True, default=str)


def _record_search_text(record: dict[str, Any]) -> str:
    parts: list[str] = [record.get("id", ""), record.get("createdTime", "")]
    fields = record.get("fields", {})
    if isinstance(fields, dict):
        for key, value in fields.items():
            parts.append(str(key))
            if isinstance(value, dict):
                parts.append(_coerce_text(value))
                continue
            if isinstance(value, (list, tuple, set)):
                parts.extend(_coerce_text(item) for item in value)
                continue
            parts.append(_coerce_text(value))
    return " ".join(part for part in parts if part).casefold()


def _json_payload(response: Any, *, url: str) -> dict[str, Any]:
    text = response.read().decode("utf-8")
    if not text.strip():
        return {}
    try:
        payload = json.loads(text)
    except json.JSONDecodeError as err:
        raise CliError(
            code="AIRTABLE_BAD_RESPONSE",
            message="Airtable returned invalid JSON",
            exit_code=4,
            details={"url": url, "error": str(err)},
        ) from err
    if not isinstance(payload, dict):
        raise CliError(
            code="AIRTABLE_BAD_RESPONSE",
            message="Airtable returned a non-object response",
            exit_code=4,
            details={"url": url},
        )
    return payload


def _error_details(body: str) -> dict[str, Any]:
    if not body.strip():
        return {}
    try:
        payload = json.loads(body)
    except json.JSONDecodeError:
        return {"raw": body}
    if isinstance(payload, dict):
        error = payload.get("error")
        if isinstance(error, dict):
            return error
        return payload
    return {"raw": payload}


def _quote_path(value: str) -> str:
    return quote(value, safe="")


def _picker_label(name: str, identifier: str) -> str:
    if name and identifier and name != identifier:
        return f"{name} ({identifier})"
    return name or identifier


def _field_preview(field: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": field.get("id"),
        "name": field.get("name"),
        "type": field.get("type"),
        "is_primary": field.get("primary", field.get("isPrimary", False)),
    }


def _base_picker_entry(base: dict[str, Any], *, selected_base_id: str | None = None) -> dict[str, Any]:
    base_id = str(base.get("id", "")).strip()
    base_name = str(base.get("name", "")).strip()
    return {
        "id": base_id,
        "name": base_name,
        "label": _picker_label(base_name, base_id),
        "selected": bool(selected_base_id and base_id == selected_base_id),
        "permission_level": base.get("permissionLevel"),
        "is_favorite": base.get("isFavorite"),
    }


def _table_picker_entry(
    table: dict[str, Any],
    *,
    base_id: str,
    selected_table_name: str | None = None,
) -> dict[str, Any]:
    table_id = str(table.get("id", "")).strip()
    table_name = str(table.get("name", "")).strip()
    fields = table.get("fields", [])
    views = table.get("views", [])
    field_values = fields if isinstance(fields, list) else []
    view_values = views if isinstance(views, list) else []
    field_list = [field for field in field_values if isinstance(field, dict)]
    field_names = [str(field.get("name", "")).strip() for field in field_list if str(field.get("name", "")).strip()]
    return {
        "id": table_id,
        "name": table_name,
        "label": _picker_label(table_name, table_id),
        "selected": bool(selected_table_name and (table_name == selected_table_name or table_id == selected_table_name)),
        "base_id": base_id,
        "field_count": len(field_list),
        "view_count": len(view_values),
        "field_names": field_names,
        "field_preview": [_field_preview(field) for field in field_list[:5]],
    }


@dataclass(slots=True)
class AirtableClient:
    api_base_url: str
    api_token: str
    base_id: str | None = None
    table_name: str | None = None
    timeout: float = 30.0

    @classmethod
    def from_config(cls, config: dict[str, Any]) -> "AirtableClient":
        runtime = config["runtime"]
        return cls(
            api_base_url=str(runtime["api_base_url"]).rstrip("/"),
            api_token=str((config.get("_private") or {}).get("api_token") or ""),
            base_id=str(runtime["base_id"]).strip() or None,
            table_name=str(runtime["table_name"]).strip() or None,
        )

    def _env_table_name(self) -> str:
        return self.table_name or str(resolve_named_value(DEFAULT_TABLE_NAME_ENV, LEGACY_TABLE_NAME_ENV)["value"] or "")

    @staticmethod
    def _env_base_id() -> str:
        return str(resolve_named_value(DEFAULT_BASE_ID_ENV, LEGACY_BASE_ID_ENV)["value"] or "")

    def _request_json(
        self,
        path: str,
        *,
        method: str = "GET",
        params: dict[str, Any] | None = None,
        body: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        if not self.api_token:
            raise CliError(
                code="AIRTABLE_CONFIG_ERROR",
                message="AIRTABLE_API_TOKEN is required for live Airtable API calls",
                exit_code=4,
                details={"missing_keys": ["AIRTABLE_API_TOKEN"]},
            )
        url = f"{self.api_base_url}{path}"
        if params:
            query = urlencode([(key, value) for key, value in params.items() if value is not None], doseq=True)
            if query:
                url = f"{url}?{query}"
        headers = {
            "Authorization": f"Bearer {self.api_token}",
            "Accept": "application/json",
        }
        data: bytes | None = None
        if body is not None:
            data = json.dumps(body).encode("utf-8")
            headers["Content-Type"] = "application/json"
        request = Request(
            url,
            data=data,
            headers=headers,
            method=method,
        )
        try:
            with urlopen(request, timeout=self.timeout) as response:
                return _json_payload(response, url=url)
        except HTTPError as err:
            body = err.read().decode("utf-8", errors="replace")
            details = _error_details(body)
            raise CliError(
                code="AIRTABLE_HTTP_ERROR",
                message=details.get("message", err.reason if isinstance(err.reason, str) else "Airtable request failed"),
                exit_code=4,
                details={
                    "status": err.code,
                    "url": url,
                    "error": details,
                },
            ) from err
        except URLError as err:
            raise CliError(
                code="AIRTABLE_NETWORK_ERROR",
                message="Airtable request could not be completed",
                exit_code=4,
                details={"url": url, "reason": str(err.reason)},
            ) from err

    def list_bases(self, limit: int | None = None) -> dict[str, Any]:
        payload = self._request_json("/v0/meta/bases")
        bases = payload.get("bases", [])
        if not isinstance(bases, list):
            bases = []
        selected_base_id = self.base_id or self._env_base_id() or None
        if limit is not None:
            bases = bases[:limit]
        picker = [_base_picker_entry(base, selected_base_id=selected_base_id) for base in bases if isinstance(base, dict)]
        return {
            "summary": f"Listed {len(bases)} Airtable base(s)",
            "bases": bases,
            "base_count": len(bases),
            "picker": {
                "kind": "base",
                "selected_base_id": selected_base_id,
                "items": picker,
            },
            "source": "live",
        }

    def read_base_schema(self, base_id: str | None = None) -> dict[str, Any]:
        resolved_base_id = (base_id or self.base_id or self._env_base_id()).strip()
        if not resolved_base_id:
            raise CliError(
                code="AIRTABLE_CONFIG_ERROR",
                message="AIRTABLE_BASE_ID is required for base-scoped Airtable reads",
                exit_code=4,
                details={"missing_keys": ["AIRTABLE_BASE_ID"]},
            )
        payload = self._request_json(f"/v0/meta/bases/{_quote_path(resolved_base_id)}/tables")
        tables = payload.get("tables", [])
        if not isinstance(tables, list):
            tables = []
        selected_table_name = self._env_table_name() or None
        table_picker = [
            _table_picker_entry(table, base_id=resolved_base_id, selected_table_name=selected_table_name)
            for table in tables
            if isinstance(table, dict)
        ]
        return {
            "summary": f"Read Airtable base schema for {resolved_base_id}",
            "base": {
                "id": resolved_base_id,
                "table_count": len(tables),
                "tables": tables,
                "table_picker": table_picker,
                "selected_table_name": selected_table_name,
            },
            "tables": tables,
            "table_count": len(tables),
            "picker": {
                "kind": "table",
                "base_id": resolved_base_id,
                "selected_table_name": selected_table_name,
                "items": table_picker,
            },
            "table_picker": table_picker,
            "source": "live",
        }

    def list_tables(self) -> dict[str, Any]:
        return self.read_base_schema(self.base_id)

    def read_table(self, table_id: str | None) -> dict[str, Any]:
        resolved_table_id = (table_id or self._env_table_name()).strip()
        if not resolved_table_id:
            raise CliError(
                code="AIRTABLE_CONFIG_ERROR",
                message="AIRTABLE_TABLE_NAME is required when table.read is invoked without a table argument",
                exit_code=4,
                details={"missing_keys": ["AIRTABLE_TABLE_NAME"]},
            )
        schema = self.list_tables()
        base_id = schema["base"]["id"]
        for table in schema["tables"]:
            if not isinstance(table, dict):
                continue
            if table.get("id") == resolved_table_id or table.get("name") == resolved_table_id:
                table_picker = _table_picker_entry(
                    table,
                    base_id=base_id,
                    selected_table_name=table.get("name") or table.get("id") or resolved_table_id,
                )
                return {
                    "summary": f"Read Airtable table schema for {table.get('name', resolved_table_id)}",
                    "base": schema["base"],
                    "table": table,
                    "picker": {
                        "kind": "table",
                        "base_id": base_id,
                        "selected_table_name": table.get("name", resolved_table_id),
                        "items": schema["table_picker"],
                    },
                    "table_picker": table_picker,
                    "table_count": schema["table_count"],
                    "tables": schema["tables"],
                    "source": "live",
                }
        raise CliError(
            code="AIRTABLE_TABLE_NOT_FOUND",
            message=f"Table not found: {resolved_table_id}",
            exit_code=4,
            details={
                "table_id": resolved_table_id,
                "base_id": self.base_id,
                "available_tables": [table.get("name") for table in schema["tables"] if isinstance(table, dict)],
            },
        )

    def iter_records(self, table_name: str | None, *, page_size: int = 100) -> Iterable[dict[str, Any]]:
        resolved_table_name = (table_name or self._env_table_name()).strip()
        if not self.base_id:
            raise CliError(
                code="AIRTABLE_CONFIG_ERROR",
                message="AIRTABLE_BASE_ID is required for base-scoped Airtable reads",
                exit_code=4,
                details={"missing_keys": ["AIRTABLE_BASE_ID"]},
            )
        if not resolved_table_name:
            raise CliError(
                code="AIRTABLE_CONFIG_ERROR",
                message="AIRTABLE_TABLE_NAME is required for table-scoped Airtable reads",
                exit_code=4,
                details={"missing_keys": ["AIRTABLE_TABLE_NAME"]},
            )
        offset: str | None = None
        while True:
            params: dict[str, Any] = {"pageSize": page_size}
            if offset:
                params["offset"] = offset
            payload = self._request_json(
                f"/v0/{_quote_path(self.base_id)}/{_quote_path(resolved_table_name)}",
                params=params,
            )
            records = payload.get("records", [])
            if not isinstance(records, list):
                records = []
            for record in records:
                if isinstance(record, dict):
                    yield record
            offset = payload.get("offset")
            if not offset:
                break

    def list_records(self, table_name: str | None, *, limit: int = 10) -> dict[str, Any]:
        resolved_table_name = (table_name or self._env_table_name()).strip()
        if not self.base_id:
            raise CliError(
                code="AIRTABLE_CONFIG_ERROR",
                message="AIRTABLE_BASE_ID is required for base-scoped Airtable reads",
                exit_code=4,
                details={"missing_keys": ["AIRTABLE_BASE_ID"]},
            )
        if not resolved_table_name:
            raise CliError(
                code="AIRTABLE_CONFIG_ERROR",
                message="AIRTABLE_TABLE_NAME is required for table-scoped Airtable reads",
                exit_code=4,
                details={"missing_keys": ["AIRTABLE_TABLE_NAME"]},
            )
        collected: list[dict[str, Any]] = []
        scanned = 0
        offset: str | None = None
        while len(collected) < limit:
            page_size = min(100, limit - len(collected))
            params: dict[str, Any] = {"pageSize": page_size}
            if offset:
                params["offset"] = offset
            payload = self._request_json(
                f"/v0/{_quote_path(self.base_id)}/{_quote_path(resolved_table_name)}",
                params=params,
            )
            records = payload.get("records", [])
            if not isinstance(records, list):
                records = []
            scanned += len(records)
            for record in records:
                if isinstance(record, dict):
                    collected.append(record)
                    if len(collected) >= limit:
                        break
            offset = payload.get("offset")
            if not offset or not records or len(collected) >= limit:
                break
        return {
            "summary": f"Listed {len(collected)} Airtable record(s) from {resolved_table_name}",
            "base_id": self.base_id,
            "table": resolved_table_name,
            "records": collected,
            "record_count": len(collected),
            "scanned_records": scanned,
            "has_more": bool(offset),
            "next_offset": offset,
            "source": "live",
        }

    def search_records(self, table_name: str | None, query: str) -> dict[str, Any]:
        resolved_table_name = (table_name or self._env_table_name()).strip()
        matches: list[dict[str, Any]] = []
        scanned = 0
        needle = query.casefold().strip()
        for record in self.iter_records(resolved_table_name, page_size=100):
            scanned += 1
            if needle in _record_search_text(record):
                matches.append(record)
        return {
            "summary": f"Found {len(matches)} Airtable record(s) matching {query!r} in {resolved_table_name}",
            "base_id": self.base_id,
            "table": resolved_table_name,
            "query": query,
            "records": matches,
            "record_count": len(matches),
            "scanned_records": scanned,
            "search_strategy": "client_side_contains",
            "source": "live",
        }

    def read_record(self, table_name: str | None, record_id: str) -> dict[str, Any]:
        resolved_table_name = (table_name or self._env_table_name()).strip()
        if not self.base_id:
            raise CliError(
                code="AIRTABLE_CONFIG_ERROR",
                message="AIRTABLE_BASE_ID is required for base-scoped Airtable reads",
                exit_code=4,
                details={"missing_keys": ["AIRTABLE_BASE_ID"]},
            )
        if not resolved_table_name:
            raise CliError(
                code="AIRTABLE_CONFIG_ERROR",
                message="AIRTABLE_TABLE_NAME is required for table-scoped Airtable reads",
                exit_code=4,
                details={"missing_keys": ["AIRTABLE_TABLE_NAME"]},
            )
        payload = self._request_json(
            f"/v0/{_quote_path(self.base_id)}/{_quote_path(resolved_table_name)}/{_quote_path(record_id)}"
        )
        record = payload if isinstance(payload, dict) else {}
        return {
            "summary": f"Read Airtable record {record_id} from {resolved_table_name}",
            "base_id": self.base_id,
            "table": resolved_table_name,
            "record_id": record_id,
            "record": record,
            "source": "live",
        }

    def _resolve_table_for_write(self, table_name: str | None) -> str:
        resolved_table_name = (table_name or self._env_table_name()).strip()
        if not self.base_id:
            raise CliError(
                code="AIRTABLE_CONFIG_ERROR",
                message="AIRTABLE_BASE_ID is required for live Airtable writes",
                exit_code=4,
                details={"missing_keys": ["AIRTABLE_BASE_ID"]},
            )
        if not resolved_table_name:
            raise CliError(
                code="AIRTABLE_CONFIG_ERROR",
                message="AIRTABLE_TABLE_NAME is required for table-scoped Airtable writes",
                exit_code=4,
                details={"missing_keys": ["AIRTABLE_TABLE_NAME"]},
            )
        return resolved_table_name

    @staticmethod
    def _validate_fields(fields: dict[str, Any]) -> dict[str, Any]:
        if not fields:
            raise CliError(
                code="AIRTABLE_FIELDS_REQUIRED",
                message="At least one Airtable field value is required",
                exit_code=2,
                details={"expected": "Use --field Name=value or --fields-json '{\"Name\":\"value\"}'"},
            )
        return fields

    def create_record(self, table_name: str | None, fields: dict[str, Any], *, typecast: bool = False) -> dict[str, Any]:
        resolved_table_name = self._resolve_table_for_write(table_name)
        payload: dict[str, Any] = {"fields": self._validate_fields(fields)}
        if typecast:
            payload["typecast"] = True
        record = self._request_json(
            f"/v0/{_quote_path(self.base_id or '')}/{_quote_path(resolved_table_name)}",
            method="POST",
            body=payload,
        )
        return {
            "summary": f"Created Airtable record in {resolved_table_name}",
            "base_id": self.base_id,
            "table": resolved_table_name,
            "record_id": record.get("id"),
            "record": record,
            "source": "live",
        }

    def update_record(
        self,
        table_name: str | None,
        record_id: str,
        fields: dict[str, Any],
        *,
        typecast: bool = False,
    ) -> dict[str, Any]:
        resolved_table_name = self._resolve_table_for_write(table_name)
        payload: dict[str, Any] = {"fields": self._validate_fields(fields)}
        if typecast:
            payload["typecast"] = True
        record = self._request_json(
            f"/v0/{_quote_path(self.base_id or '')}/{_quote_path(resolved_table_name)}/{_quote_path(record_id)}",
            method="PATCH",
            body=payload,
        )
        return {
            "summary": f"Updated Airtable record {record_id} in {resolved_table_name}",
            "base_id": self.base_id,
            "table": resolved_table_name,
            "record_id": record_id,
            "record": record,
            "source": "live",
        }
