from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, quote
from urllib.request import Request, urlopen

from .constants import BACKEND_NAME, DEFAULT_API_BASE_URL


@dataclass(slots=True)
class BlacksmithApiError(Exception):
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


def _normalize_item(raw: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": raw.get("id"),
        "name": raw.get("name"),
        "status": raw.get("status"),
        "workflow": raw.get("workflow"),
        "run_id": raw.get("run_id"),
        "duration": raw.get("duration"),
        "created": raw.get("created"),
        "raw": raw,
    }


class BlacksmithClient:
    def __init__(self, *, api_key: str, base_url: str = DEFAULT_API_BASE_URL) -> None:
        self._api_key = api_key.strip()
        self._base_url = base_url.rstrip("/")
        self._user_agent = "aos-blacksmith/0.1.0"

    def _request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        expect_json: bool = True,
    ) -> Any:
        url = f"{self._base_url}{path}"
        if params:
            query = urlencode([(key, str(value)) for key, value in params.items() if value is not None])
            if query:
                url = f"{url}?{query}"
        headers = {
            "Authorization": f"Bearer {self._api_key}",
            "Accept": "application/json",
            "User-Agent": self._user_agent,
        }
        request = Request(url, method=method.upper(), headers=headers)
        try:
            with urlopen(request, timeout=60) as response:
                payload = response.read()
                if expect_json:
                    return _dict_or_empty(_load_json(payload))
                return {
                    "content_type": response.headers.get("Content-Type"),
                    "bytes": payload,
                    "final_url": response.geturl(),
                }
        except HTTPError as err:
            details: dict[str, Any] = {}
            try:
                details = _dict_or_empty(_load_json(err.read()))
            except Exception:
                details = {}
            code = str(details.get("error") or details.get("code") or "BLACKSMITH_API_ERROR")
            message = str(details.get("message") or err.reason or "Blacksmith API request failed")
            raise BlacksmithApiError(
                status_code=err.code,
                code=code,
                message=message,
                details=details or {"backend": BACKEND_NAME, "url": url},
            ) from err
        except URLError as err:
            raise BlacksmithApiError(
                status_code=None,
                code="BLACKSMITH_NETWORK_ERROR",
                message=str(getattr(err, "reason", err)),
                details={"backend": BACKEND_NAME, "url": url},
            ) from err

    def list_runners(self) -> dict[str, Any]:
        raw = self._request("GET", "/runners")
        runners = [_normalize_item(item) for item in _list_or_empty(raw.get("runners")) if isinstance(item, dict)]
        return {"runners": runners, "count": len(runners), "raw": raw}

    def runner_status(self) -> dict[str, Any]:
        raw = self._request("GET", "/runners/status")
        runners = [_normalize_item(item) for item in _list_or_empty(raw.get("runners")) if isinstance(item, dict)]
        return {"status": raw.get("status"), "runners": runners, "raw": raw}

    def list_builds(self, *, repo: str | None = None, workflow_name: str | None = None, limit: int = 10) -> dict[str, Any]:
        raw = self._request(
            "GET",
            "/builds",
            params={
                "repo": repo or None,
                "workflow_name": workflow_name or None,
                "limit": max(1, min(limit, 100)),
            },
        )
        builds = [_normalize_item(item) for item in _list_or_empty(raw.get("builds")) if isinstance(item, dict)]
        return {"builds": builds, "count": len(builds), "raw": raw}

    def get_build(self, *, run_id: str) -> dict[str, Any]:
        raw = self._request("GET", f"/builds/{quote(run_id, safe='')}")
        return {"build": _normalize_item(_dict_or_empty(raw.get("build") or raw)), "raw": raw}

    def get_build_logs(self, *, run_id: str) -> dict[str, Any]:
        raw = self._request("GET", f"/builds/{quote(run_id, safe='')}/logs", expect_json=False)
        payload = raw.get("bytes") or b""
        text = payload.decode("utf-8", errors="replace")
        return {
            "run_id": run_id,
            "logs": text,
            "bytes_count": len(payload),
            "content_type": raw.get("content_type"),
            "raw": raw,
        }

    def list_cache(self, *, repo: str | None = None) -> dict[str, Any]:
        raw = self._request("GET", "/cache", params={"repo": repo or None})
        entries = [_normalize_item(item) for item in _list_or_empty(raw.get("cache") or raw.get("entries")) if isinstance(item, dict)]
        return {"entries": entries, "count": len(entries), "raw": raw}

    def cache_stats(self, *, repo: str | None = None) -> dict[str, Any]:
        raw = self._request("GET", "/cache/stats", params={"repo": repo or None})
        return {"repo": repo, "stats": raw, "raw": raw}

    def usage_summary(self, *, date_range: str | None = None) -> dict[str, Any]:
        raw = self._request("GET", "/usage/summary", params={"date_range": date_range or None})
        return {"summary": raw, "raw": raw}

    def usage_billing(self, *, date_range: str | None = None) -> dict[str, Any]:
        raw = self._request("GET", "/usage/billing", params={"date_range": date_range or None})
        return {"billing": raw, "raw": raw}
