from __future__ import annotations

import base64
import json
from dataclasses import dataclass
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, quote
from urllib.request import Request, urlopen


@dataclass(slots=True)
class LionReportApiError(Exception):
    status_code: int | None
    code: str
    message: str
    details: dict[str, Any] | None = None


def _load_json(payload: bytes) -> Any:
    if not payload:
        return {}
    text = payload.decode("utf-8")
    if not text.strip():
        return {}
    return json.loads(text)


def _dict_or_empty(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _list_or_empty(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


class LionReportClient:
    def __init__(self, *, api_key: str, base_url: str = "https://api.lion.report") -> None:
        self._api_key = api_key.strip()
        self._base_url = base_url.rstrip("/")
        self._user_agent = "aos-lion-report/0.1.0"

    def _request(
        self,
        method: str,
        path: str,
        *,
        query: dict[str, Any] | None = None,
        json_body: dict[str, Any] | None = None,
    ) -> Any:
        url = f"{self._base_url}{path}"
        if query:
            url = f"{url}?{urlencode([(k, str(v)) for k, v in query.items() if v is not None])}"
        headers = {
            "Authorization": f"Bearer {self._api_key}",
            "Accept": "application/json",
            "User-Agent": self._user_agent,
        }
        payload: bytes | None = None
        if json_body is not None:
            payload = json.dumps(json_body).encode("utf-8")
            headers["Content-Type"] = "application/json"
        request = Request(url, data=payload, method=method.upper(), headers=headers)
        try:
            with urlopen(request, timeout=60) as response:
                return _dict_or_empty(_load_json(response.read()))
        except HTTPError as err:
            details: dict[str, Any] = {}
            try:
                details = _dict_or_empty(_load_json(err.read()))
            except Exception:
                details = {}
            code = str(details.get("code") or details.get("error") or "LION_REPORT_API_ERROR")
            message = str(details.get("message") or err.reason or "LION Report API request failed")
            raise LionReportApiError(
                status_code=err.code,
                code=code,
                message=message,
                details=details or {"url": url},
            ) from err
        except URLError as err:
            raise LionReportApiError(
                status_code=None,
                code="LION_REPORT_NETWORK_ERROR",
                message=str(getattr(err, "reason", err)),
                details={"url": url},
            ) from err

    def list_reports(self, *, report_type: str | None = None, date_range: str | None = None, limit: int = 25) -> dict[str, Any]:
        return self._request(
            "GET",
            "/api/v1/reports",
            query={"type": report_type, "date_range": date_range, "limit": max(1, limit)},
        )

    def get_report(self, report_id: str) -> dict[str, Any]:
        return self._request("GET", f"/api/v1/reports/{quote(report_id, safe='')}")

    def generate_report(self, payload: dict[str, Any]) -> dict[str, Any]:
        return self._request("POST", "/api/v1/reports/generate", json_body=payload)

    def schedule_report(self, payload: dict[str, Any]) -> dict[str, Any]:
        return self._request("POST", "/api/v1/reports/schedule", json_body=payload)

    def list_data_sources(self) -> dict[str, Any]:
        return self._request("GET", "/api/v1/data/sources")

    def query_data_source(self, data_source: str, query_text: str, *, date_range: str | None = None) -> dict[str, Any]:
        return self._request(
            "GET",
            f"/api/v1/data/sources/{quote(data_source, safe='')}/query",
            query={"q": query_text, "date_range": date_range},
        )

    def import_data(self, payload: dict[str, Any]) -> dict[str, Any]:
        return self._request("POST", "/api/v1/data/import", json_body=payload)

    def run_analysis(self, payload: dict[str, Any]) -> dict[str, Any]:
        return self._request("POST", "/api/v1/analysis/run", json_body=payload)

    def list_analyses(self, *, limit: int = 20) -> dict[str, Any]:
        return self._request("GET", "/api/v1/analysis", query={"limit": max(1, limit)})

    def list_templates(self, *, limit: int = 20) -> dict[str, Any]:
        return self._request("GET", "/api/v1/templates", query={"limit": max(1, limit)})

    def get_template(self, template_id: str) -> dict[str, Any]:
        return self._request("GET", f"/api/v1/templates/{quote(template_id, safe='')}")

    def export_pdf(self, report_id: str) -> dict[str, Any]:
        return self._request("GET", f"/api/v1/reports/{quote(report_id, safe='')}/export/pdf")

    def export_csv(self, report_id: str) -> dict[str, Any]:
        return self._request("GET", f"/api/v1/reports/{quote(report_id, safe='')}/export/csv")

    def export_email(self, report_id: str, recipient_email: str) -> dict[str, Any]:
        return self._request(
            "POST",
            f"/api/v1/reports/{quote(report_id, safe='')}/export/email",
            json_body={"recipient_email": recipient_email},
        )

    def list_journal_entries(self, *, date_range: str | None = None, limit: int = 25) -> dict[str, Any]:
        return self._request("GET", "/api/v1/journal/entries", query={"date_range": date_range, "limit": max(1, limit)})

    def create_journal_entry(self, payload: dict[str, Any]) -> dict[str, Any]:
        return self._request("POST", "/api/v1/journal/entries", json_body=payload)

    def get_journal_entry(self, entry_id: str) -> dict[str, Any]:
        return self._request("GET", f"/api/v1/journal/entries/{quote(entry_id, safe='')}")

    def list_users(self, *, limit: int = 25) -> dict[str, Any]:
        return self._request("GET", "/api/v1/users", query={"limit": max(1, limit)})

    def get_user(self, user_id: str) -> dict[str, Any]:
        return self._request("GET", f"/api/v1/users/{quote(user_id, safe='')}")

    def list_training(self, *, limit: int = 25) -> dict[str, Any]:
        return self._request("GET", "/api/v1/training", query={"limit": max(1, limit)})

    def training_stats(self) -> dict[str, Any]:
        return self._request("GET", "/api/v1/training/stats")
