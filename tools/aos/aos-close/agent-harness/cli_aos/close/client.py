from __future__ import annotations

import base64
import json
from dataclasses import dataclass
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urljoin
from urllib.request import Request, urlopen

from .constants import BACKEND_NAME


@dataclass(slots=True)
class CloseApiError(Exception):
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


def _dict_or_empty(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _normalize_lead(raw: dict[str, Any]) -> dict[str, Any]:
    contacts = raw.get("contacts", [])
    return {
        "id": raw.get("id"),
        "display_name": raw.get("display_name"),
        "status_label": raw.get("status_label"),
        "description": raw.get("description"),
        "url": raw.get("url"),
        "contacts": contacts if isinstance(contacts, list) else [],
        "created_by": raw.get("created_by"),
        "date_created": raw.get("date_created"),
        "raw": raw,
    }


def _normalize_contact(raw: dict[str, Any]) -> dict[str, Any]:
    emails = raw.get("emails", [])
    phones = raw.get("phones", [])
    return {
        "id": raw.get("id"),
        "name": raw.get("name") or raw.get("display_name"),
        "title": raw.get("title"),
        "emails": emails if isinstance(emails, list) else [],
        "phones": phones if isinstance(phones, list) else [],
        "lead_id": raw.get("lead_id"),
        "date_created": raw.get("date_created"),
        "raw": raw,
    }


def _normalize_opportunity(raw: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": raw.get("id"),
        "note": raw.get("note"),
        "confidence": raw.get("confidence"),
        "value": raw.get("value"),
        "value_period": raw.get("value_period"),
        "lead_id": raw.get("lead_id"),
        "status_type": raw.get("status_type"),
        "date_created": raw.get("date_created"),
        "raw": raw,
    }


def _normalize_activity(raw: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": raw.get("id"),
        "type": raw.get("_type"),
        "lead_id": raw.get("lead_id"),
        "user_id": raw.get("user_id"),
        "date_created": raw.get("date_created"),
        "raw": raw,
    }


def _normalize_task(raw: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": raw.get("id"),
        "text": raw.get("text"),
        "is_complete": raw.get("is_complete"),
        "due_date": raw.get("due_date"),
        "assigned_to": raw.get("assigned_to"),
        "lead_id": raw.get("lead_id"),
        "date_created": raw.get("date_created"),
        "raw": raw,
    }


class CloseClient:
    def __init__(self, *, api_key: str) -> None:
        self._api_key = api_key.strip()
        self._base_url = "https://api.close.com/api/v1"
        token = base64.b64encode(f"{self._api_key}:".encode("utf-8")).decode("utf-8")
        self._auth_header = f"Basic {token}"
        self._user_agent = "aos-close/0.1.0"

    def _request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        body: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        url = urljoin(self._base_url + "/", path.lstrip("/"))
        if params:
            query = urlencode([(key, str(value)) for key, value in params.items() if value is not None])
            if query:
                url = f"{url}?{query}"
        payload = json.dumps(body).encode("utf-8") if body is not None else None
        headers = {
            "Authorization": self._auth_header,
            "Accept": "application/json",
            "User-Agent": self._user_agent,
        }
        if payload is not None:
            headers["Content-Type"] = "application/json"
        request = Request(url, data=payload, method=method.upper(), headers=headers)
        try:
            with urlopen(request, timeout=30) as response:
                return _dict_or_empty(_load_json(response.read()))
        except HTTPError as err:
            details: dict[str, Any] = {}
            try:
                details = _dict_or_empty(_load_json(err.read()))
            except Exception:
                details = {}
            code = str(details.get("error") or details.get("field-errors") or "CLOSE_API_ERROR")
            message = str(details.get("error") or err.reason or "Close API request failed")
            raise CloseApiError(
                status_code=err.code,
                code=code,
                message=message,
                details=details,
            ) from err
        except URLError as err:
            raise CloseApiError(
                status_code=None,
                code="CLOSE_NETWORK_ERROR",
                message=str(getattr(err, "reason", err)),
                details={"backend": BACKEND_NAME, "url": url},
            ) from err

    def list_leads(self, *, limit: int = 10, query: str | None = None) -> list[dict[str, Any]]:
        params: dict[str, Any] = {"_limit": limit}
        if query:
            params["query"] = query
        result = self._request("GET", "/lead/", params=params)
        data = result.get("data", [])
        return [_normalize_lead(l) for l in data if isinstance(l, dict)]

    def get_lead(self, lead_id: str) -> dict[str, Any]:
        raw = self._request("GET", f"/lead/{lead_id}/")
        return _normalize_lead(raw)

    def list_contacts(self, *, limit: int = 10) -> list[dict[str, Any]]:
        result = self._request("GET", "/contact/", params={"_limit": limit})
        data = result.get("data", [])
        return [_normalize_contact(c) for c in data if isinstance(c, dict)]

    def get_contact(self, contact_id: str) -> dict[str, Any]:
        raw = self._request("GET", f"/contact/{contact_id}/")
        return _normalize_contact(raw)

    def list_opportunities(self, *, limit: int = 10) -> list[dict[str, Any]]:
        result = self._request("GET", "/opportunity/", params={"_limit": limit})
        data = result.get("data", [])
        return [_normalize_opportunity(o) for o in data if isinstance(o, dict)]

    def get_opportunity(self, opp_id: str) -> dict[str, Any]:
        raw = self._request("GET", f"/opportunity/{opp_id}/")
        return _normalize_opportunity(raw)

    def list_activities(self, *, limit: int = 10) -> list[dict[str, Any]]:
        result = self._request("GET", "/activity/", params={"_limit": limit})
        data = result.get("data", [])
        return [_normalize_activity(a) for a in data if isinstance(a, dict)]

    def list_tasks(self, *, limit: int = 10) -> list[dict[str, Any]]:
        result = self._request("GET", "/task/", params={"_limit": limit})
        data = result.get("data", [])
        return [_normalize_task(t) for t in data if isinstance(t, dict)]

    def probe(self) -> dict[str, Any]:
        return self._request("GET", "/me/")
