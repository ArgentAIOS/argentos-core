from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urljoin
from urllib.request import Request, urlopen

from .constants import BACKEND_NAME


@dataclass(slots=True)
class PipedriveApiError(Exception):
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


def _normalize_deal(raw: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": raw.get("id"),
        "title": raw.get("title"),
        "value": raw.get("value"),
        "currency": raw.get("currency"),
        "stage_id": raw.get("stage_id"),
        "pipeline_id": raw.get("pipeline_id"),
        "person_id": raw.get("person_id"),
        "org_id": raw.get("org_id"),
        "status": raw.get("status"),
        "add_time": raw.get("add_time"),
        "raw": raw,
    }


def _normalize_person(raw: dict[str, Any]) -> dict[str, Any]:
    emails = raw.get("email", [])
    phones = raw.get("phone", [])
    email = emails[0].get("value") if isinstance(emails, list) and emails and isinstance(emails[0], dict) else (emails if isinstance(emails, str) else None)
    phone = phones[0].get("value") if isinstance(phones, list) and phones and isinstance(phones[0], dict) else (phones if isinstance(phones, str) else None)
    return {
        "id": raw.get("id"),
        "name": raw.get("name"),
        "email": email,
        "phone": phone,
        "org_id": raw.get("org_id"),
        "open_deals_count": raw.get("open_deals_count"),
        "add_time": raw.get("add_time"),
        "raw": raw,
    }


def _normalize_organization(raw: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": raw.get("id"),
        "name": raw.get("name"),
        "address": raw.get("address"),
        "open_deals_count": raw.get("open_deals_count"),
        "people_count": raw.get("people_count"),
        "add_time": raw.get("add_time"),
        "raw": raw,
    }


def _normalize_activity(raw: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": raw.get("id"),
        "subject": raw.get("subject"),
        "type": raw.get("type"),
        "due_date": raw.get("due_date"),
        "due_time": raw.get("due_time"),
        "done": raw.get("done"),
        "person_id": raw.get("person_id"),
        "deal_id": raw.get("deal_id"),
        "org_id": raw.get("org_id"),
        "add_time": raw.get("add_time"),
        "raw": raw,
    }


def _normalize_pipeline(raw: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": raw.get("id"),
        "name": raw.get("name"),
        "active": raw.get("active"),
        "deal_probability": raw.get("deal_probability"),
        "order_nr": raw.get("order_nr"),
        "add_time": raw.get("add_time"),
        "raw": raw,
    }


def _normalize_stage(raw: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": raw.get("id"),
        "name": raw.get("name"),
        "pipeline_id": raw.get("pipeline_id"),
        "deal_probability": raw.get("deal_probability"),
        "order_nr": raw.get("order_nr"),
        "add_time": raw.get("add_time"),
        "raw": raw,
    }


class PipedriveClient:
    def __init__(self, *, api_token: str, company_domain: str | None = None) -> None:
        self._api_token = api_token.strip()
        self._base_url = f"https://{company_domain}.pipedrive.com/api/v1" if company_domain else "https://api.pipedrive.com/api/v1"
        self._user_agent = "aos-pipedrive/0.1.0"

    def _request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        body: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        all_params = {"api_token": self._api_token}
        if params:
            all_params.update(params)
        url = urljoin(self._base_url + "/", path.lstrip("/"))
        query = urlencode([(key, str(value)) for key, value in all_params.items() if value is not None])
        if query:
            url = f"{url}?{query}"
        payload = json.dumps(body).encode("utf-8") if body is not None else None
        headers = {
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
            code = str(details.get("error") or "PIPEDRIVE_API_ERROR")
            message = str(details.get("error_info") or details.get("error") or err.reason or "Pipedrive API request failed")
            raise PipedriveApiError(
                status_code=err.code,
                code=code,
                message=message,
                details=details,
            ) from err
        except URLError as err:
            raise PipedriveApiError(
                status_code=None,
                code="PIPEDRIVE_NETWORK_ERROR",
                message=str(getattr(err, "reason", err)),
                details={"backend": BACKEND_NAME, "url": url},
            ) from err

    def _get_data(self, response: dict[str, Any]) -> list[dict[str, Any]]:
        data = response.get("data")
        if isinstance(data, list):
            return data
        if isinstance(data, dict):
            return [data]
        return []

    def list_deals(self, *, limit: int = 10) -> list[dict[str, Any]]:
        result = self._request("GET", "/deals", params={"limit": limit, "sort": "add_time DESC"})
        return [_normalize_deal(d) for d in self._get_data(result)]

    def get_deal(self, deal_id: str) -> dict[str, Any]:
        result = self._request("GET", f"/deals/{deal_id}")
        data = self._get_data(result)
        if not data:
            raise PipedriveApiError(status_code=404, code="PIPEDRIVE_NOT_FOUND", message=f"Deal {deal_id} not found")
        return _normalize_deal(data[0])

    def list_persons(self, *, limit: int = 10) -> list[dict[str, Any]]:
        result = self._request("GET", "/persons", params={"limit": limit, "sort": "add_time DESC"})
        return [_normalize_person(p) for p in self._get_data(result)]

    def get_person(self, person_id: str) -> dict[str, Any]:
        result = self._request("GET", f"/persons/{person_id}")
        data = self._get_data(result)
        if not data:
            raise PipedriveApiError(status_code=404, code="PIPEDRIVE_NOT_FOUND", message=f"Person {person_id} not found")
        return _normalize_person(data[0])

    def list_organizations(self, *, limit: int = 10) -> list[dict[str, Any]]:
        result = self._request("GET", "/organizations", params={"limit": limit, "sort": "add_time DESC"})
        return [_normalize_organization(o) for o in self._get_data(result)]

    def get_organization(self, org_id: str) -> dict[str, Any]:
        result = self._request("GET", f"/organizations/{org_id}")
        data = self._get_data(result)
        if not data:
            raise PipedriveApiError(status_code=404, code="PIPEDRIVE_NOT_FOUND", message=f"Organization {org_id} not found")
        return _normalize_organization(data[0])

    def list_activities(self, *, limit: int = 10) -> list[dict[str, Any]]:
        result = self._request("GET", "/activities", params={"limit": limit})
        return [_normalize_activity(a) for a in self._get_data(result)]

    def list_pipelines(self) -> list[dict[str, Any]]:
        result = self._request("GET", "/pipelines")
        return [_normalize_pipeline(p) for p in self._get_data(result)]

    def list_stages(self, *, pipeline_id: str | None = None) -> list[dict[str, Any]]:
        params: dict[str, Any] = {}
        if pipeline_id:
            params["pipeline_id"] = pipeline_id
        result = self._request("GET", "/stages", params=params)
        return [_normalize_stage(s) for s in self._get_data(result)]

    def probe(self) -> dict[str, Any]:
        return self._request("GET", "/users/me")

    def create_deal(
        self,
        *,
        title: str,
        value: float | None = None,
        currency: str | None = None,
        person_id: str | None = None,
        org_id: str | None = None,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {"title": title}
        if value is not None:
            body["value"] = value
        if currency:
            body["currency"] = currency
        if person_id:
            body["person_id"] = person_id
        if org_id:
            body["org_id"] = org_id
        return _dict_or_empty(self._request("POST", "/deals", body=body).get("data"))

    def update_deal(self, deal_id: str, *, fields: dict[str, Any]) -> dict[str, Any]:
        filtered = {key: value for key, value in fields.items() if value is not None}
        return _dict_or_empty(self._request("PUT", f"/deals/{deal_id}", body=filtered).get("data"))

    def create_person(self, *, name: str, email: str | None = None) -> dict[str, Any]:
        body: dict[str, Any] = {"name": name}
        if email:
            body["email"] = email
        return _dict_or_empty(self._request("POST", "/persons", body=body).get("data"))

    def create_organization(self, *, name: str) -> dict[str, Any]:
        return _dict_or_empty(self._request("POST", "/organizations", body={"name": name}).get("data"))

    def create_activity(
        self,
        *,
        subject: str,
        activity_type: str | None = None,
        person_id: str | None = None,
        deal_id: str | None = None,
        org_id: str | None = None,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {"subject": subject}
        if activity_type:
            body["type"] = activity_type
        if person_id:
            body["person_id"] = person_id
        if deal_id:
            body["deal_id"] = deal_id
        if org_id:
            body["org_id"] = org_id
        return _dict_or_empty(self._request("POST", "/activities", body=body).get("data"))

    def create_note(
        self,
        *,
        content: str,
        deal_id: str | None = None,
        person_id: str | None = None,
        org_id: str | None = None,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {"content": content}
        if deal_id:
            body["deal_id"] = deal_id
        if person_id:
            body["person_id"] = person_id
        if org_id:
            body["org_id"] = org_id
        return _dict_or_empty(self._request("POST", "/notes", body=body).get("data"))
