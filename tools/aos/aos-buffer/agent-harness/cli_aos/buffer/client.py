from __future__ import annotations

from dataclasses import dataclass
import json
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from .constants import DEFAULT_TIMEOUT_SECONDS
from .errors import BufferAPIError


@dataclass(frozen=True)
class BufferResponse:
    status: int
    data: Any
    headers: dict[str, str]


class BufferClient:
    def __init__(self, *, api_key: str, base_url: str, graphql_url: str, timeout: int = DEFAULT_TIMEOUT_SECONDS) -> None:
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.graphql_url = graphql_url.rstrip("/")
        self.timeout = timeout

    def _request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, str | int | None] | None = None,
        body: dict[str, Any] | None = None,
        form: dict[str, str | int | None] | None = None,
    ) -> BufferResponse:
        url = f"{self.base_url}/{path.lstrip('/')}"
        if params:
            encoded = urlencode({key: value for key, value in params.items() if value is not None})
            if encoded:
                url = f"{url}?{encoded}"
        headers = {"Authorization": f"Bearer {self.api_key}"}
        data: bytes | None = None
        if body is not None:
            headers["Content-Type"] = "application/json"
            data = json.dumps(body).encode("utf-8")
        elif form is not None:
            headers["Content-Type"] = "application/x-www-form-urlencoded"
            data = urlencode({key: value for key, value in form.items() if value is not None}).encode("utf-8")
        request = Request(url, data=data, method=method.upper(), headers=headers)
        try:
            with urlopen(request, timeout=self.timeout) as response:
                raw = response.read().decode("utf-8")
                payload = json.loads(raw) if raw else None
                return BufferResponse(
                    status=getattr(response, "status", 200),
                    data=payload,
                    headers={key: value for key, value in response.headers.items()},
                )
        except HTTPError as exc:
            raw = exc.read().decode("utf-8") if hasattr(exc, "read") else ""
            raise BufferAPIError(f"Buffer API request failed: {exc.code} {exc.reason}: {raw or exc}") from exc
        except URLError as exc:
            raise BufferAPIError(f"Buffer API request failed: {exc.reason}") from exc

    def read_account(self) -> dict[str, Any]:
        response = self._request("GET", "/user.json")
        return response.data or {}

    def list_channels(self) -> dict[str, Any]:
        response = self._request("GET", "/profiles.json")
        return {"channels": response.data or []}

    def read_channel(self, channel_id: str) -> dict[str, Any]:
        response = self._request("GET", f"/profiles/{channel_id}.json")
        return response.data or {}

    def list_profiles(self) -> dict[str, Any]:
        response = self._request("GET", "/profiles.json")
        return {"profiles": response.data or []}

    def read_profile(self, profile_id: str) -> dict[str, Any]:
        response = self._request("GET", f"/profiles/{profile_id}.json")
        return response.data or {}

    def list_profile_schedules(self, profile_id: str) -> dict[str, Any]:
        response = self._request("GET", f"/profiles/{profile_id}/schedules.json")
        return {"schedules": response.data or []}

    def update_profile_schedules(self, profile_id: str, schedules: list[dict[str, Any]]) -> dict[str, Any]:
        form: dict[str, str | int | None] = {}
        for index, schedule in enumerate(schedules):
            days = schedule.get("days") or []
            times = schedule.get("times") or []
            for day in days:
                form[f"schedules[{index}][days][]"] = day
            for time in times:
                form[f"schedules[{index}][times][]"] = time
        response = self._request("POST", f"/profiles/{profile_id}/schedules/update.json", form=form)
        return response.data or {}

    def list_posts(self, *, profile_id: str | None = None, status: str | None = None, limit: int = 10) -> dict[str, Any]:
        return {
            "supported": False,
            "status": "scaffold_read_only",
            "reason": (
                "Buffer's current public docs confirm account/profile reads, but do not yet expose a stable post list surface "
                "in this connector scaffold."
            ),
            "profile_id": profile_id,
            "post_count": 0,
            "posts": [],
            "status_filter": status,
            "limit": limit,
        }

    def read_post(self, post_id: str) -> dict[str, Any]:
        return {
            "supported": False,
            "status": "scaffold_read_only",
            "reason": "Buffer post read is scaffolded until the current API post schema is confirmed.",
            "post": {"id": post_id},
        }

    def create_post_draft(self, *, channel_id: str, text: str, due_at: str | None = None) -> dict[str, Any]:
        return {
            "supported": False,
            "status": "scaffold_write_only",
            "reason": "Buffer post creation is scaffolded until the current public post contract is confirmed.",
            "post": {"channel_id": channel_id, "text": text, "due_at": due_at},
        }

    def schedule_post(self, *, channel_id: str, text: str, due_at: str | None = None) -> dict[str, Any]:
        return {
            "supported": False,
            "status": "scaffold_write_only",
            "reason": "Buffer post scheduling is scaffolded until the current public post contract is confirmed.",
            "post": {"channel_id": channel_id, "text": text, "due_at": due_at},
        }
