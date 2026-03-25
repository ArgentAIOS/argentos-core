from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urljoin
from urllib.request import Request, urlopen

from .constants import BACKEND_NAME, DEFAULT_BASE_URL


@dataclass(slots=True)
class HootsuiteApiError(Exception):
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


class HootsuiteClient:
    def __init__(self, *, access_token: str, base_url: str | None = None) -> None:
        self._access_token = access_token.strip()
        self._base_url = (base_url or DEFAULT_BASE_URL).strip().rstrip("/")

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
        request = Request(
            url,
            data=payload,
            method=method.upper(),
            headers={
                "Authorization": f"Bearer {self._access_token}",
                "Accept": "application/json",
                **({"Content-Type": "application/json"} if payload is not None else {}),
            },
        )
        try:
            with urlopen(request, timeout=30) as response:
                body_bytes = response.read()
                data = _load_json(body_bytes)
                data.setdefault("_http_status", response.status)
                data.setdefault("_request_url", url)
                return data
        except HTTPError as err:
            body_bytes = err.read() if hasattr(err, "read") else b""
            try:
                payload = _load_json(body_bytes)
            except Exception:
                payload = {}
            raise HootsuiteApiError(
                status_code=getattr(err, "code", None),
                code=payload.get("code") or payload.get("error") or "HTTP_ERROR",
                message=payload.get("message") or getattr(err, "reason", None) or str(err),
                details={"url": url, **({"response": payload} if payload else {})},
            ) from err
        except URLError as err:
            raise HootsuiteApiError(
                status_code=None,
                code="NETWORK_ERROR",
                message=str(getattr(err, "reason", err)),
                details={"url": url},
            ) from err

    def me(self) -> dict[str, Any]:
        return self._request("GET", "/v1/me")

    def list_organizations(self) -> dict[str, Any]:
        return self._request("GET", "/v1/me/organizations")

    def read_organization(self, organization_id: str) -> dict[str, Any]:
        return self._request("GET", f"/v1/organizations/{organization_id}")

    def list_social_profiles(self, organization_id: str | None = None) -> dict[str, Any]:
        if organization_id:
            return self._request("GET", f"/v1/organizations/{organization_id}/socialProfiles")
        return self._request("GET", "/v1/socialProfiles")

    def read_social_profile(self, social_profile_id: str) -> dict[str, Any]:
        return self._request("GET", f"/v1/socialProfiles/{social_profile_id}")

    def list_teams(self, organization_id: str) -> dict[str, Any]:
        return self._request("GET", f"/v1/organizations/{organization_id}/teams")

    def read_team(self, team_id: str) -> dict[str, Any]:
        return self._request("GET", f"/v1/teams/{team_id}")

    def list_team_members(self, team_id: str) -> dict[str, Any]:
        return self._request("GET", f"/v1/teams/{team_id}/members")

    def list_team_social_profiles(self, team_id: str) -> dict[str, Any]:
        return self._request("GET", f"/v1/teams/{team_id}/socialProfiles")

    def list_messages(
        self,
        *,
        social_profile_id: str | None = None,
        state: str | None = None,
        start_time: str | None = None,
        end_time: str | None = None,
        limit: int = 25,
    ) -> dict[str, Any]:
        params: dict[str, Any] = {"limit": limit}
        if social_profile_id:
            params["socialProfileId"] = social_profile_id
        if state:
            params["state"] = state
        if start_time:
            params["startTime"] = start_time
        if end_time:
            params["endTime"] = end_time
        return self._request("GET", "/v1/messages", params=params)

    def read_message(self, message_id: str) -> dict[str, Any]:
        return self._request("GET", f"/v1/messages/{message_id}")
