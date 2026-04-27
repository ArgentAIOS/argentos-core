from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urljoin
from urllib.request import Request, urlopen


@dataclass(slots=True)
class HolaceApiError(Exception):
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


def _load_json(payload: bytes) -> dict[str, Any]:
    if not payload:
        return {}
    text = payload.decode("utf-8")
    if not text.strip():
        return {}
    value = json.loads(text)
    return value if isinstance(value, dict) else {"value": value}


class HolaceClient:
    def __init__(self, *, api_key: str, base_url: str) -> None:
        self._api_key = api_key.strip()
        self._base_url = base_url.strip().rstrip("/")

    def _request(self, method: str, path: str, *, params: dict[str, Any] | None = None) -> dict[str, Any]:
        url = urljoin(self._base_url + "/", path.lstrip("/"))
        if params:
            query = urlencode([(key, str(value)) for key, value in params.items() if value not in (None, "")])
            if query:
                url = f"{url}?{query}"
        request = Request(
            url,
            method=method.upper(),
            headers={
                "Authorization": f"Bearer {self._api_key}",
                "Accept": "application/json",
                "User-Agent": "ArgentOS-AOS-Holace/0.1",
            },
        )
        try:
            with urlopen(request, timeout=30) as response:
                data = _load_json(response.read())
                data.setdefault("_http_status", response.status)
                data.setdefault("_request_url", url)
                return data
        except HTTPError as err:
            body = err.read() if hasattr(err, "read") else b""
            try:
                payload = _load_json(body)
            except Exception:
                payload = {}
            raise HolaceApiError(
                status_code=getattr(err, "code", None),
                code=payload.get("code") or payload.get("error") or "HTTP_ERROR",
                message=payload.get("message") or getattr(err, "reason", None) or str(err),
                details={"url": url, **({"response": payload} if payload else {})},
            ) from err
        except URLError as err:
            raise HolaceApiError(
                status_code=None,
                code="NETWORK_ERROR",
                message=str(getattr(err, "reason", err)),
                details={"url": url},
            ) from err

    def list_cases(self, *, attorney_id: str | None = None, client_id: str | None = None, case_type: str | None = None, limit: int = 25) -> dict[str, Any]:
        return self._request("GET", "/cases", params={"attorney_id": attorney_id, "client_id": client_id, "case_type": case_type, "limit": limit})

    def get_case(self, case_id: str) -> dict[str, Any]:
        return self._request("GET", f"/cases/{case_id}")

    def case_timeline(self, case_id: str) -> dict[str, Any]:
        return self._request("GET", f"/cases/{case_id}/timeline")

    def list_clients(self, *, limit: int = 50) -> dict[str, Any]:
        return self._request("GET", "/clients", params={"limit": limit})

    def get_client(self, client_id: str) -> dict[str, Any]:
        return self._request("GET", f"/clients/{client_id}")

    def list_documents(self, *, case_id: str | None = None, limit: int = 25) -> dict[str, Any]:
        return self._request("GET", "/documents", params={"case_id": case_id, "limit": limit})

    def get_document(self, document_id: str) -> dict[str, Any]:
        return self._request("GET", f"/documents/{document_id}")

    def list_deadlines(self, *, case_id: str | None = None, limit: int = 20) -> dict[str, Any]:
        return self._request("GET", "/deadlines", params={"case_id": case_id, "limit": limit})

    def check_statute(self, *, state: str, case_type: str | None = None) -> dict[str, Any]:
        return self._request("GET", "/deadlines/statute", params={"state": state, "case_type": case_type})

    def list_settlements(self, *, case_id: str | None = None, limit: int = 10) -> dict[str, Any]:
        return self._request("GET", "/settlements", params={"case_id": case_id, "limit": limit})

    def get_settlement(self, settlement_id: str) -> dict[str, Any]:
        return self._request("GET", f"/settlements/{settlement_id}")

    def settlement_tracker(self) -> dict[str, Any]:
        return self._request("GET", "/settlements/tracker")

    def list_billing(self, *, case_id: str | None = None, limit: int = 25) -> dict[str, Any]:
        return self._request("GET", "/billing", params={"case_id": case_id, "limit": limit})

    def list_communications(self, *, case_id: str | None = None, limit: int = 25) -> dict[str, Any]:
        return self._request("GET", "/communications", params={"case_id": case_id, "limit": limit})

    def case_status_report(self, *, case_id: str | None = None) -> dict[str, Any]:
        return self._request("GET", "/reports/case-status", params={"case_id": case_id})

    def pipeline_report(self, *, attorney_id: str | None = None) -> dict[str, Any]:
        return self._request("GET", "/reports/pipeline", params={"attorney_id": attorney_id})
