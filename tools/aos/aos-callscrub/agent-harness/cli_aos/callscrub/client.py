from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urljoin
from urllib.request import Request, urlopen


@dataclass(slots=True)
class CallScrubApiError(Exception):
    status_code: int | None
    code: str
    message: str
    details: dict[str, Any] | None = None

    def as_dict(self) -> dict[str, Any]:
        return {"status_code": self.status_code, "code": self.code, "message": self.message, "details": self.details or {}}


def _load_json(payload: bytes) -> dict[str, Any]:
    if not payload:
        return {}
    text = payload.decode("utf-8")
    if not text.strip():
        return {}
    value = json.loads(text)
    return value if isinstance(value, dict) else {"value": value}


class CallScrubClient:
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
                "User-Agent": "ArgentOS-AOS-CallScrub/0.1",
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
            raise CallScrubApiError(
                status_code=getattr(err, "code", None),
                code=payload.get("code") or payload.get("error") or "HTTP_ERROR",
                message=payload.get("message") or getattr(err, "reason", None) or str(err),
                details={"url": url, **({"response": payload} if payload else {})},
            ) from err
        except URLError as err:
            raise CallScrubApiError(status_code=None, code="NETWORK_ERROR", message=str(getattr(err, "reason", err)), details={"url": url}) from err

    def list_calls(self, *, team_id: str | None = None, agent_name: str | None = None, date_range: str | None = None, limit: int = 25) -> dict[str, Any]:
        return self._request("GET", "/calls", params={"team_id": team_id, "agent_name": agent_name, "date_range": date_range, "limit": limit})

    def get_call(self, call_id: str) -> dict[str, Any]:
        return self._request("GET", f"/calls/{call_id}")

    def get_transcript(self, call_id: str) -> dict[str, Any]:
        return self._request("GET", f"/calls/{call_id}/transcript")

    def search_transcripts(self, *, query: str, limit: int = 20) -> dict[str, Any]:
        return self._request("GET", "/transcripts/search", params={"query": query, "limit": limit})

    def list_coaching(self, *, limit: int = 10) -> dict[str, Any]:
        return self._request("GET", "/coaching", params={"limit": limit})

    def get_coaching(self, coaching_id: str) -> dict[str, Any]:
        return self._request("GET", f"/coaching/{coaching_id}")

    def list_agents(self, *, limit: int = 50) -> dict[str, Any]:
        return self._request("GET", "/agents", params={"limit": limit})

    def agent_stats(self, *, agent_name: str, date_range: str | None = None) -> dict[str, Any]:
        return self._request("GET", "/agents/stats", params={"agent_name": agent_name, "date_range": date_range})

    def agent_scorecard(self, *, agent_name: str) -> dict[str, Any]:
        return self._request("GET", "/agents/scorecard", params={"agent_name": agent_name})

    def list_teams(self, *, limit: int = 20) -> dict[str, Any]:
        return self._request("GET", "/teams", params={"limit": limit})

    def team_stats(self, *, team_id: str, date_range: str | None = None) -> dict[str, Any]:
        return self._request("GET", f"/teams/{team_id}/stats", params={"date_range": date_range})

    def list_reports(self, *, report_type: str | None = None, date_range: str | None = None, limit: int = 10) -> dict[str, Any]:
        return self._request("GET", "/reports", params={"report_type": report_type, "date_range": date_range, "limit": limit})
