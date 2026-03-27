from __future__ import annotations

import json
from datetime import date, timedelta
from dataclasses import dataclass
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urljoin
from urllib.request import Request, urlopen

from .constants import BACKEND_NAME


@dataclass(slots=True)
class SalesforceApiError(Exception):
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
    return {
        "id": raw.get("Id"),
        "name": raw.get("Name"),
        "email": raw.get("Email"),
        "company": raw.get("Company"),
        "status": raw.get("Status"),
        "lead_source": raw.get("LeadSource"),
        "phone": raw.get("Phone"),
        "created": raw.get("CreatedDate"),
        "raw": raw,
    }


def _normalize_contact(raw: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": raw.get("Id"),
        "name": raw.get("Name"),
        "email": raw.get("Email"),
        "phone": raw.get("Phone"),
        "account_id": raw.get("AccountId"),
        "created": raw.get("CreatedDate"),
        "raw": raw,
    }


def _normalize_opportunity(raw: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": raw.get("Id"),
        "name": raw.get("Name"),
        "stage": raw.get("StageName"),
        "amount": raw.get("Amount"),
        "close_date": raw.get("CloseDate"),
        "account_id": raw.get("AccountId"),
        "probability": raw.get("Probability"),
        "created": raw.get("CreatedDate"),
        "raw": raw,
    }


def _normalize_account(raw: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": raw.get("Id"),
        "name": raw.get("Name"),
        "industry": raw.get("Industry"),
        "type": raw.get("Type"),
        "phone": raw.get("Phone"),
        "website": raw.get("Website"),
        "created": raw.get("CreatedDate"),
        "raw": raw,
    }


def _normalize_task(raw: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": raw.get("Id"),
        "subject": raw.get("Subject"),
        "status": raw.get("Status"),
        "priority": raw.get("Priority"),
        "who_id": raw.get("WhoId"),
        "what_id": raw.get("WhatId"),
        "due_date": raw.get("ActivityDate"),
        "created": raw.get("CreatedDate"),
        "raw": raw,
    }


class SalesforceClient:
    def __init__(self, *, access_token: str, instance_url: str) -> None:
        self._access_token = access_token.strip()
        self._instance_url = instance_url.rstrip("/")
        self._base_url = f"{self._instance_url}/services/data/v59.0"
        self._user_agent = "aos-salesforce/0.1.0"

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
            "Authorization": f"Bearer {self._access_token}",
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
            errors = details if isinstance(details, list) else details.get("errors", details)
            if isinstance(errors, list) and errors:
                first = errors[0] if isinstance(errors[0], dict) else {}
                code = str(first.get("errorCode") or first.get("code") or "SALESFORCE_API_ERROR")
                message = str(first.get("message") or err.reason or "Salesforce API request failed")
            else:
                code = str(details.get("errorCode") or details.get("error") or "SALESFORCE_API_ERROR")
                message = str(details.get("message") or details.get("error_description") or err.reason or "Salesforce API request failed")
            raise SalesforceApiError(
                status_code=err.code,
                code=code,
                message=message,
                details=details,
            ) from err
        except URLError as err:
            raise SalesforceApiError(
                status_code=None,
                code="SALESFORCE_NETWORK_ERROR",
                message=str(getattr(err, "reason", err)),
                details={"backend": BACKEND_NAME, "url": url},
            ) from err

    def _query(self, soql: str) -> dict[str, Any]:
        return self._request("GET", "/query", params={"q": soql})

    def list_leads(self, *, limit: int = 10) -> list[dict[str, Any]]:
        result = self._query(f"SELECT Id, Name, Email, Company, Status, LeadSource, Phone, CreatedDate FROM Lead ORDER BY CreatedDate DESC LIMIT {limit}")
        records = result.get("records", [])
        return [_normalize_lead(r) for r in records if isinstance(r, dict)]

    def get_lead(self, record_id: str) -> dict[str, Any]:
        raw = self._request("GET", f"/sobjects/Lead/{record_id}")
        return _normalize_lead(raw)

    def list_contacts(self, *, limit: int = 10) -> list[dict[str, Any]]:
        result = self._query(f"SELECT Id, Name, Email, Phone, AccountId, CreatedDate FROM Contact ORDER BY CreatedDate DESC LIMIT {limit}")
        records = result.get("records", [])
        return [_normalize_contact(r) for r in records if isinstance(r, dict)]

    def get_contact(self, record_id: str) -> dict[str, Any]:
        raw = self._request("GET", f"/sobjects/Contact/{record_id}")
        return _normalize_contact(raw)

    def list_opportunities(self, *, limit: int = 10) -> list[dict[str, Any]]:
        result = self._query(f"SELECT Id, Name, StageName, Amount, CloseDate, AccountId, Probability, CreatedDate FROM Opportunity ORDER BY CreatedDate DESC LIMIT {limit}")
        records = result.get("records", [])
        return [_normalize_opportunity(r) for r in records if isinstance(r, dict)]

    def get_opportunity(self, record_id: str) -> dict[str, Any]:
        raw = self._request("GET", f"/sobjects/Opportunity/{record_id}")
        return _normalize_opportunity(raw)

    def list_accounts(self, *, limit: int = 10) -> list[dict[str, Any]]:
        result = self._query(f"SELECT Id, Name, Industry, Type, Phone, Website, CreatedDate FROM Account ORDER BY CreatedDate DESC LIMIT {limit}")
        records = result.get("records", [])
        return [_normalize_account(r) for r in records if isinstance(r, dict)]

    def get_account(self, record_id: str) -> dict[str, Any]:
        raw = self._request("GET", f"/sobjects/Account/{record_id}")
        return _normalize_account(raw)

    def list_tasks(self, *, limit: int = 10) -> list[dict[str, Any]]:
        result = self._query(f"SELECT Id, Subject, Status, Priority, WhoId, WhatId, ActivityDate, CreatedDate FROM Task ORDER BY CreatedDate DESC LIMIT {limit}")
        records = result.get("records", [])
        return [_normalize_task(r) for r in records if isinstance(r, dict)]

    def run_report(self, report_id: str) -> dict[str, Any]:
        return self._request("GET", f"/analytics/reports/{report_id}")

    def run_soql(self, soql: str) -> dict[str, Any]:
        return self._query(soql)

    def probe(self) -> dict[str, Any]:
        return self._request("GET", "/limits")

    def create_lead(self, *, name: str, company: str | None = None, email: str | None = None) -> dict[str, Any]:
        body: dict[str, Any] = {
            "LastName": name,
            "Company": company or name,
        }
        if email:
            body["Email"] = email
        return _dict_or_empty(self._request("POST", "/sobjects/Lead", body=body))

    def update_lead(self, record_id: str, *, fields: dict[str, Any]) -> dict[str, Any]:
        filtered = {key: value for key, value in fields.items() if value is not None}
        return _dict_or_empty(self._request("PATCH", f"/sobjects/Lead/{record_id}", body=filtered))

    def create_contact(self, *, last_name: str, email: str | None = None) -> dict[str, Any]:
        body: dict[str, Any] = {"LastName": last_name}
        if email:
            body["Email"] = email
        return _dict_or_empty(self._request("POST", "/sobjects/Contact", body=body))

    def create_opportunity(
        self,
        *,
        name: str,
        stage: str | None = None,
        amount: float | None = None,
        close_date: str | None = None,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {
            "Name": name,
            "StageName": stage or "Prospecting",
            "CloseDate": close_date or (date.today() + timedelta(days=30)).isoformat(),
        }
        if amount is not None:
            body["Amount"] = amount
        return _dict_or_empty(self._request("POST", "/sobjects/Opportunity", body=body))

    def update_opportunity(self, record_id: str, *, fields: dict[str, Any]) -> dict[str, Any]:
        filtered = {key: value for key, value in fields.items() if value is not None}
        return _dict_or_empty(self._request("PATCH", f"/sobjects/Opportunity/{record_id}", body=filtered))

    def create_task(self, *, subject: str) -> dict[str, Any]:
        body = {
            "Subject": subject,
            "Status": "Not Started",
            "ActivityDate": date.today().isoformat(),
        }
        return _dict_or_empty(self._request("POST", "/sobjects/Task", body=body))
