from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urljoin
from urllib.request import Request, urlopen


@dataclass(slots=True)
class PayPunchApiError(Exception):
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


class PayPunchClient:
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
                "User-Agent": "ArgentOS-AOS-PayPunch/0.1",
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
            raise PayPunchApiError(
                status_code=getattr(err, "code", None),
                code=payload.get("code") or payload.get("error") or "HTTP_ERROR",
                message=payload.get("message") or getattr(err, "reason", None) or str(err),
                details={"url": url, **({"response": payload} if payload else {})},
            ) from err
        except URLError as err:
            raise PayPunchApiError(
                status_code=None,
                code="NETWORK_ERROR",
                message=str(getattr(err, "reason", err)),
                details={"url": url},
            ) from err

    def list_timesheets(
        self,
        *,
        tenant_id: str | None = None,
        company_id: str | None = None,
        employee_id: str | None = None,
        pay_period: str | None = None,
        limit: int = 50,
    ) -> dict[str, Any]:
        return self._request(
            "GET",
            "/timesheets",
            params={
                "tenant_id": tenant_id,
                "company_id": company_id,
                "employee_id": employee_id,
                "pay_period": pay_period,
                "limit": limit,
            },
        )

    def get_timesheet(self, timesheet_id: str) -> dict[str, Any]:
        return self._request("GET", f"/timesheets/{timesheet_id}")

    def list_employees(self, *, company_id: str | None = None, limit: int = 100) -> dict[str, Any]:
        return self._request("GET", "/employees", params={"company_id": company_id, "limit": limit})

    def get_employee(self, employee_id: str) -> dict[str, Any]:
        return self._request("GET", f"/employees/{employee_id}")

    def list_companies(self, *, tenant_id: str | None = None, limit: int = 50) -> dict[str, Any]:
        return self._request("GET", "/companies", params={"tenant_id": tenant_id, "limit": limit})

    def get_company(self, company_id: str) -> dict[str, Any]:
        return self._request("GET", f"/companies/{company_id}")

    def export_quickbooks_iif(self, *, company_id: str | None = None, pay_period: str | None = None) -> dict[str, Any]:
        return self._request(
            "GET",
            "/exports/quickbooks-iif",
            params={"company_id": company_id, "pay_period": pay_period},
        )

    def export_csv(self, *, company_id: str | None = None, pay_period: str | None = None) -> dict[str, Any]:
        return self._request("GET", "/exports/csv", params={"company_id": company_id, "pay_period": pay_period})

    def list_pay_periods(self, *, company_id: str | None = None, limit: int = 12) -> dict[str, Any]:
        return self._request("GET", "/pay-periods", params={"company_id": company_id, "limit": limit})

    def current_pay_period(self, *, company_id: str | None = None) -> dict[str, Any]:
        return self._request("GET", "/pay-periods/current", params={"company_id": company_id})

    def hours_summary(self, *, company_id: str | None = None, pay_period: str | None = None) -> dict[str, Any]:
        return self._request(
            "GET",
            "/reports/hours-summary",
            params={"company_id": company_id, "pay_period": pay_period},
        )

    def overtime_report(self, *, company_id: str | None = None, pay_period: str | None = None) -> dict[str, Any]:
        return self._request(
            "GET",
            "/reports/overtime",
            params={"company_id": company_id, "pay_period": pay_period},
        )
