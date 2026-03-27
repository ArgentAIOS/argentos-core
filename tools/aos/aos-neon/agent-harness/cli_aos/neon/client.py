from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from .constants import BACKEND_NAME, NEON_API_BASE


@dataclass(slots=True)
class NeonApiError(Exception):
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


class NeonClient:
    """Client for Neon API (branch/project management) and SQL via the serverless HTTP endpoint."""

    def __init__(self, *, api_key: str, connection_string: str, project_id: str | None = None) -> None:
        self._api_key = api_key.strip()
        self._connection_string = connection_string.strip()
        self._project_id = (project_id or "").strip() or None
        self._user_agent = "aos-neon/0.1.0"

        # Parse the serverless SQL endpoint from the connection string
        # postgresql://user:pass@ep-xxx.region.aws.neon.tech/dbname
        self._sql_host = self._parse_host(connection_string)

    @staticmethod
    def _parse_host(conn_str: str) -> str | None:
        """Extract the host from a postgres connection string."""
        try:
            # postgresql://user:pass@host/dbname
            after_at = conn_str.split("@", 1)[1] if "@" in conn_str else ""
            host = after_at.split("/", 1)[0] if "/" in after_at else after_at
            return host or None
        except (IndexError, ValueError):
            return None

    def _api_request(
        self,
        method: str,
        path: str,
        *,
        body: dict[str, Any] | None = None,
    ) -> Any:
        url = f"{NEON_API_BASE}{path}"
        payload = json.dumps(body).encode("utf-8") if body is not None else None
        headers: dict[str, str] = {
            "Authorization": f"Bearer {self._api_key}",
            "Accept": "application/json",
            "User-Agent": self._user_agent,
        }
        if payload is not None:
            headers["Content-Type"] = "application/json"
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
            code = str(details.get("code") or "NEON_API_ERROR")
            message = str(details.get("message") or err.reason or "Neon API request failed")
            raise NeonApiError(
                status_code=err.code,
                code=code,
                message=message,
                details=details,
            ) from err
        except URLError as err:
            raise NeonApiError(
                status_code=None,
                code="NEON_NETWORK_ERROR",
                message=str(getattr(err, "reason", err)),
                details={"backend": BACKEND_NAME, "url": url},
            ) from err

    def _sql_request(self, query: str, *, params: list[Any] | None = None) -> dict[str, Any]:
        """Execute SQL via the Neon serverless HTTP endpoint."""
        if not self._sql_host:
            raise NeonApiError(
                status_code=None,
                code="NEON_CONNECTION_INVALID",
                message="Could not parse host from connection string",
                details={"backend": BACKEND_NAME},
            )
        url = f"https://{self._sql_host}/sql"
        body: dict[str, Any] = {"query": query}
        if params:
            body["params"] = params
        payload = json.dumps(body).encode("utf-8")
        # Extract user:pass from connection string for auth
        auth_part = self._connection_string.split("://", 1)[1].split("@", 1)[0] if "://" in self._connection_string else ""
        headers: dict[str, str] = {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "Neon-Connection-String": self._connection_string,
            "User-Agent": self._user_agent,
        }
        request = Request(url, data=payload, method="POST", headers=headers)
        try:
            with urlopen(request, timeout=30) as response:
                result = _load_json(response.read())
                return result if isinstance(result, dict) else {"rows": result}
        except HTTPError as err:
            details: dict[str, Any] = {}
            try:
                details = _load_json(err.read())
                if not isinstance(details, dict):
                    details = {"raw": details}
            except Exception:
                details = {}
            raise NeonApiError(
                status_code=err.code,
                code=str(details.get("code") or "NEON_SQL_ERROR"),
                message=str(details.get("message") or err.reason or "SQL query failed"),
                details=details,
            ) from err
        except URLError as err:
            raise NeonApiError(
                status_code=None,
                code="NEON_NETWORK_ERROR",
                message=str(getattr(err, "reason", err)),
                details={"backend": BACKEND_NAME},
            ) from err

    # --- SQL operations ---

    def sql_query(self, query: str, *, params: list[Any] | None = None) -> dict[str, Any]:
        return self._sql_request(query, params=params)

    def sql_execute(self, statement: str, *, params: list[Any] | None = None) -> dict[str, Any]:
        return self._sql_request(statement, params=params)

    # --- Branch operations (require NEON_API_KEY + NEON_PROJECT_ID) ---

    def _require_project_id(self) -> str:
        if not self._project_id:
            raise NeonApiError(
                status_code=None,
                code="NEON_PROJECT_ID_REQUIRED",
                message="NEON_PROJECT_ID is required for branch operations",
                details={"backend": BACKEND_NAME},
            )
        return self._project_id

    def branch_list(self) -> list[dict[str, Any]]:
        project_id = self._require_project_id()
        result = self._api_request("GET", f"/projects/{project_id}/branches")
        branches = result.get("branches") if isinstance(result, dict) else result
        return branches if isinstance(branches, list) else []

    def branch_create(self, *, name: str | None = None, parent_id: str | None = None) -> dict[str, Any]:
        project_id = self._require_project_id()
        body: dict[str, Any] = {}
        branch_spec: dict[str, Any] = {}
        if name:
            branch_spec["name"] = name
        if parent_id:
            branch_spec["parent_id"] = parent_id
        if branch_spec:
            body["branch"] = branch_spec
        result = self._api_request("POST", f"/projects/{project_id}/branches", body=body)
        return result if isinstance(result, dict) else {}

    def branch_delete(self, branch_id: str) -> dict[str, Any]:
        project_id = self._require_project_id()
        result = self._api_request("DELETE", f"/projects/{project_id}/branches/{branch_id}")
        return result if isinstance(result, dict) else {}

    # --- Project info ---

    def project_info(self) -> dict[str, Any]:
        project_id = self._require_project_id()
        result = self._api_request("GET", f"/projects/{project_id}")
        return result if isinstance(result, dict) else {}

    # --- Health probe ---

    def probe(self) -> dict[str, Any]:
        """Lightweight check: run SELECT 1 against the connection."""
        result = self._sql_request("SELECT 1 AS ok")
        return {"ok": True, "details": result}
