from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urljoin
from urllib.request import Request, urlopen

from .constants import BACKEND_NAME


@dataclass(slots=True)
class CalendlyApiError(Exception):
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


def _normalize_user(raw: dict[str, Any]) -> dict[str, Any]:
    resource = raw.get("resource") or raw
    return {
        "uri": resource.get("uri"),
        "name": resource.get("name"),
        "email": resource.get("email"),
        "slug": resource.get("slug"),
        "scheduling_url": resource.get("scheduling_url"),
        "timezone": resource.get("timezone"),
        "created_at": resource.get("created_at"),
        "updated_at": resource.get("updated_at"),
    }


def _normalize_event(raw: dict[str, Any]) -> dict[str, Any]:
    return {
        "uri": raw.get("uri"),
        "name": raw.get("name"),
        "status": raw.get("status"),
        "start_time": raw.get("start_time"),
        "end_time": raw.get("end_time"),
        "event_type": raw.get("event_type"),
        "location": raw.get("location"),
        "created_at": raw.get("created_at"),
        "updated_at": raw.get("updated_at"),
        "cancellation": raw.get("cancellation"),
    }


def _normalize_event_type(raw: dict[str, Any]) -> dict[str, Any]:
    return {
        "uri": raw.get("uri"),
        "name": raw.get("name"),
        "slug": raw.get("slug"),
        "active": raw.get("active"),
        "duration_minutes": raw.get("duration"),
        "kind": raw.get("kind"),
        "scheduling_url": raw.get("scheduling_url"),
        "description_plain": raw.get("description_plain"),
        "created_at": raw.get("created_at"),
        "updated_at": raw.get("updated_at"),
    }


def _normalize_invitee(raw: dict[str, Any]) -> dict[str, Any]:
    return {
        "uri": raw.get("uri"),
        "name": raw.get("name"),
        "email": raw.get("email"),
        "status": raw.get("status"),
        "timezone": raw.get("timezone"),
        "created_at": raw.get("created_at"),
        "updated_at": raw.get("updated_at"),
        "cancellation": raw.get("cancellation"),
    }


def _extract_uuid(uri: str) -> str:
    """Extract the UUID from a Calendly URI like https://api.calendly.com/scheduled_events/UUID."""
    return uri.rstrip("/").rsplit("/", 1)[-1] if uri else uri


class CalendlyClient:
    def __init__(self, *, api_key: str) -> None:
        self._api_key = api_key.strip()
        self._base_url = "https://api.calendly.com"
        self._user_agent = "aos-calendly/0.1.0"

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
            "Authorization": f"Bearer {self._api_key}",
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
            message_text = str(details.get("message") or details.get("title") or err.reason or "Calendly API request failed")
            code = "CALENDLY_AUTH_FAILED" if err.code in {401, 403} else "CALENDLY_API_ERROR"
            raise CalendlyApiError(
                status_code=err.code,
                code=code,
                message=message_text,
                details=details,
            ) from err
        except URLError as err:
            raise CalendlyApiError(
                status_code=None,
                code="CALENDLY_NETWORK_ERROR",
                message=str(getattr(err, "reason", err)),
                details={"backend": BACKEND_NAME, "url": url},
            ) from err

    def get_current_user(self) -> dict[str, Any]:
        payload = self._request("GET", "/users/me")
        resource = payload.get("resource")
        if not isinstance(resource, dict):
            raise CalendlyApiError(
                status_code=None,
                code="CALENDLY_EMPTY_RESPONSE",
                message="Calendly did not return a user record",
                details={"backend": BACKEND_NAME, "endpoint": "/users/me"},
            )
        return _normalize_user(payload)

    def list_event_types(self, *, user_uri: str, count: int = 20) -> dict[str, Any]:
        payload = self._request("GET", "/event_types", params={"user": user_uri, "count": min(count, 100)})
        collection = payload.get("collection", [])
        event_types = [_normalize_event_type(item) for item in collection if isinstance(item, dict)]
        return {"event_types": event_types, "pagination": payload.get("pagination", {})}

    def get_event_type(self, uuid: str) -> dict[str, Any]:
        payload = self._request("GET", f"/event_types/{uuid}")
        resource = payload.get("resource")
        if not isinstance(resource, dict):
            raise CalendlyApiError(
                status_code=None,
                code="CALENDLY_EMPTY_RESPONSE",
                message="Calendly did not return an event type record",
                details={"backend": BACKEND_NAME, "endpoint": f"/event_types/{uuid}"},
            )
        return _normalize_event_type(resource)

    def list_events(
        self,
        *,
        user_uri: str,
        count: int = 20,
        min_start_time: str | None = None,
        max_start_time: str | None = None,
        status: str | None = None,
    ) -> dict[str, Any]:
        params: dict[str, Any] = {"user": user_uri, "count": min(count, 100)}
        if min_start_time:
            params["min_start_time"] = min_start_time
        if max_start_time:
            params["max_start_time"] = max_start_time
        if status:
            params["status"] = status
        payload = self._request("GET", "/scheduled_events", params=params)
        collection = payload.get("collection", [])
        events = [_normalize_event(item) for item in collection if isinstance(item, dict)]
        return {"events": events, "pagination": payload.get("pagination", {})}

    def get_event(self, uuid: str) -> dict[str, Any]:
        payload = self._request("GET", f"/scheduled_events/{uuid}")
        resource = payload.get("resource")
        if not isinstance(resource, dict):
            raise CalendlyApiError(
                status_code=None,
                code="CALENDLY_EMPTY_RESPONSE",
                message="Calendly did not return an event record",
                details={"backend": BACKEND_NAME, "endpoint": f"/scheduled_events/{uuid}"},
            )
        return _normalize_event(resource)

    def cancel_event(self, uuid: str, *, reason: str | None = None) -> dict[str, Any]:
        body: dict[str, Any] = {}
        if reason:
            body["reason"] = reason
        payload = self._request("POST", f"/scheduled_events/{uuid}/cancellation", body=body)
        resource = payload.get("resource") or payload
        return {
            "uri": resource.get("uri"),
            "canceled_by": resource.get("canceled_by"),
            "reason": resource.get("reason"),
            "created_at": resource.get("created_at"),
        }

    def list_invitees(self, event_uuid: str, *, count: int = 20, email: str | None = None) -> dict[str, Any]:
        params: dict[str, Any] = {"count": min(count, 100)}
        if email:
            params["email"] = email
        payload = self._request("GET", f"/scheduled_events/{event_uuid}/invitees", params=params)
        collection = payload.get("collection", [])
        invitees = [_normalize_invitee(item) for item in collection if isinstance(item, dict)]
        return {"invitees": invitees, "pagination": payload.get("pagination", {})}

    def get_availability(self, event_type_uuid: str, *, start_time: str | None = None, end_time: str | None = None) -> dict[str, Any]:
        params: dict[str, Any] = {"event_type": f"https://api.calendly.com/event_types/{event_type_uuid}"}
        if start_time:
            params["start_time"] = start_time
        if end_time:
            params["end_time"] = end_time
        payload = self._request("GET", "/event_type_available_times", params=params)
        collection = payload.get("collection", [])
        slots = [
            {
                "status": item.get("status"),
                "start_time": item.get("start_time"),
                "invitees_remaining": item.get("invitees_remaining"),
                "scheduling_url": item.get("scheduling_url"),
            }
            for item in collection
            if isinstance(item, dict)
        ]
        return {"slots": slots, "slot_count": len(slots)}

    def create_scheduling_link(self, event_type_uuid: str, *, max_event_count: int = 1) -> dict[str, Any]:
        body = {
            "owner": f"https://api.calendly.com/event_types/{event_type_uuid}",
            "owner_type": "EventType",
            "max_event_count": max_event_count,
        }
        payload = self._request("POST", "/scheduling_links", body=body)
        resource = payload.get("resource") or payload
        return {
            "booking_url": resource.get("booking_url"),
            "owner": resource.get("owner"),
            "owner_type": resource.get("owner_type"),
        }
