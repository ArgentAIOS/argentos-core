from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from .constants import BACKEND_NAME


@dataclass(slots=True)
class SupabaseApiError(Exception):
    status_code: int | None
    code: str
    message: str
    details: dict[str, Any] | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "status_code": self.status_code,
            "code": self.code,
            "message": self.message,
            "details": self.details or {},
        }


def _load_json(payload: bytes) -> Any:
    if not payload:
        return {}
    text = payload.decode("utf-8")
    if not text.strip():
        return {}
    return json.loads(text)


class SupabaseClient:
    def __init__(self, *, project_url: str, service_role_key: str) -> None:
        self._project_url = project_url.rstrip("/")
        self._service_role_key = service_role_key.strip()
        self._user_agent = "aos-supabase/0.1.0"

    def _headers(self, *, prefer: str | None = None) -> dict[str, str]:
        headers: dict[str, str] = {
            "apikey": self._service_role_key,
            "Authorization": f"Bearer {self._service_role_key}",
            "Content-Type": "application/json",
            "User-Agent": self._user_agent,
        }
        if prefer:
            headers["Prefer"] = prefer
        return headers

    def _request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        body: Any | None = None,
        prefer: str | None = None,
    ) -> Any:
        url = f"{self._project_url}{path}"
        if params:
            query = urlencode([(k, str(v)) for k, v in params.items() if v is not None])
            if query:
                url = f"{url}?{query}"
        payload = json.dumps(body).encode("utf-8") if body is not None else None
        headers = self._headers(prefer=prefer)
        request = Request(url, data=payload, method=method.upper(), headers=headers)
        try:
            with urlopen(request, timeout=30) as response:
                return _load_json(response.read())
        except HTTPError as err:
            details: dict[str, Any] = {}
            try:
                details = _load_json(err.read())
                if not isinstance(details, dict):
                    details = {"raw": details}
            except Exception:
                details = {}
            code = str(details.get("code") or "SUPABASE_API_ERROR")
            message = str(details.get("message") or details.get("hint") or err.reason or "Supabase API request failed")
            raise SupabaseApiError(
                status_code=err.code,
                code=code,
                message=message,
                details=details,
            ) from err
        except URLError as err:
            raise SupabaseApiError(
                status_code=None,
                code="SUPABASE_NETWORK_ERROR",
                message=str(getattr(err, "reason", err)),
                details={"backend": BACKEND_NAME, "url": url},
            ) from err

    # --- PostgREST (table operations) ---

    def table_select(self, table: str, *, select: str = "*", filter_str: str | None = None, limit: int = 100) -> list[dict[str, Any]]:
        params: dict[str, Any] = {"select": select, "limit": limit}
        if filter_str:
            params["or"] = filter_str
        rows = self._request("GET", f"/rest/v1/{table}", params=params, prefer="return=representation")
        return rows if isinstance(rows, list) else []

    def table_insert(self, table: str, *, row: dict[str, Any]) -> dict[str, Any]:
        result = self._request("POST", f"/rest/v1/{table}", body=row, prefer="return=representation")
        if isinstance(result, list) and result:
            return result[0]
        return result if isinstance(result, dict) else {}

    def table_update(self, table: str, *, filter_str: str, updates: dict[str, Any]) -> list[dict[str, Any]]:
        url_path = f"/rest/v1/{table}?{filter_str}"
        result = self._request("PATCH", url_path, body=updates, prefer="return=representation")
        return result if isinstance(result, list) else []

    def table_delete(self, table: str, *, filter_str: str) -> list[dict[str, Any]]:
        url_path = f"/rest/v1/{table}?{filter_str}"
        result = self._request("DELETE", url_path, prefer="return=representation")
        return result if isinstance(result, list) else []

    def rpc_call(self, function_name: str, *, params: dict[str, Any] | None = None) -> Any:
        return self._request("POST", f"/rest/v1/rpc/{function_name}", body=params or {})

    # --- Storage ---

    def storage_list_buckets(self) -> list[dict[str, Any]]:
        result = self._request("GET", "/storage/v1/bucket")
        return result if isinstance(result, list) else []

    def storage_list_files(self, bucket: str, *, prefix: str = "", limit: int = 100) -> list[dict[str, Any]]:
        body: dict[str, Any] = {"prefix": prefix, "limit": limit}
        result = self._request("POST", f"/storage/v1/object/list/{bucket}", body=body)
        return result if isinstance(result, list) else []

    def storage_download_url(self, bucket: str, file_path: str) -> str:
        return f"{self._project_url}/storage/v1/object/public/{bucket}/{file_path}"

    # --- Health probe ---

    def probe(self) -> dict[str, Any]:
        """Lightweight health check via the PostgREST root endpoint."""
        result = self._request("GET", "/rest/v1/", prefer=None)
        return {"ok": True, "details": result if isinstance(result, dict) else {}}
