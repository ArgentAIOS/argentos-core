from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from .constants import BACKEND_NAME, DEFAULT_BASE_URL


@dataclass(slots=True)
class CodeRabbitApiError(Exception):
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


def _list_or_empty(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


class CodeRabbitClient:
    def __init__(self, *, api_key: str, base_url: str = DEFAULT_BASE_URL) -> None:
        self._api_key = api_key.strip()
        self._base_url = base_url.rstrip("/")
        self._user_agent = "aos-coderabbit/0.1.0"

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
            encoded = urlencode([(key, str(value)) for key, value in query.items() if value is not None])
            if encoded:
                url = f"{url}?{encoded}"
        headers = {
            "x-coderabbitai-api-key": self._api_key,
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
                data = response.read()
                return _load_json(data)
        except HTTPError as err:
            details: dict[str, Any] = {}
            try:
                details = _dict_or_empty(_load_json(err.read()))
            except Exception:
                details = {}
            code = str(details.get("code") or details.get("error") or "CODERABBIT_API_ERROR")
            message = str(details.get("message") or err.reason or "CodeRabbit API request failed")
            raise CodeRabbitApiError(
                status_code=err.code,
                code=code,
                message=message,
                details=details or {"backend": BACKEND_NAME, "url": url},
            ) from err
        except URLError as err:
            raise CodeRabbitApiError(
                status_code=None,
                code="CODERABBIT_NETWORK_ERROR",
                message=str(getattr(err, "reason", err)),
                details={"backend": BACKEND_NAME, "url": url},
            ) from err

    def metrics_reviews(
        self,
        *,
        start_date: str,
        end_date: str,
        organization_ids: str | None = None,
        repository_ids: str | None = None,
        user_ids: str | None = None,
        format: str = "json",
        limit: int = 1000,
        cursor: str | None = None,
    ) -> dict[str, Any]:
        raw = self._request(
            "GET",
            "/v1/metrics/reviews",
            query={
                "start_date": start_date,
                "end_date": end_date,
                "organization_ids": organization_ids,
                "repository_ids": repository_ids,
                "user_ids": user_ids,
                "format": format,
                "limit": limit,
                "cursor": cursor,
            },
        )
        data = _list_or_empty(raw.get("data"))
        reports = [item for item in data if isinstance(item, dict)]
        return {"reports": reports, "next_cursor": raw.get("next_cursor"), "raw": raw}

    def report_generate(self, payload: dict[str, Any]) -> list[dict[str, Any]]:
        raw = self._request("POST", "/api/v1/report.generate", json_body=payload)
        return [item for item in _list_or_empty(raw) if isinstance(item, dict)]
