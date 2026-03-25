from __future__ import annotations

import base64
import json
from dataclasses import dataclass
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urljoin
from urllib.request import Request, urlopen

from .constants import BACKEND_NAME, DEFAULT_REVISION


@dataclass(slots=True)
class KlaviyoApiError(Exception):
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


def _attributes(raw: dict[str, Any]) -> dict[str, Any]:
    attrs = raw.get("attributes")
    return attrs if isinstance(attrs, dict) else {}


def _normalize_account(raw: dict[str, Any]) -> dict[str, Any]:
    attrs = _attributes(raw)
    return {
        "id": raw.get("id"),
        "type": raw.get("type"),
        "name": attrs.get("name") or attrs.get("company_name") or attrs.get("account_name") or raw.get("id"),
        "timezone": attrs.get("timezone"),
        "currency": attrs.get("currency"),
        "public_api_key": attrs.get("public_api_key"),
        "created": attrs.get("created"),
        "updated": attrs.get("updated"),
        "raw": raw,
    }


def _normalize_list(raw: dict[str, Any]) -> dict[str, Any]:
    attrs = _attributes(raw)
    subscriptions = attrs.get("subscriptions")
    if not isinstance(subscriptions, (list, dict)):
        subscriptions = []
    return {
        "id": raw.get("id"),
        "type": raw.get("type"),
        "name": attrs.get("name") or attrs.get("list_name") or raw.get("id"),
        "created": attrs.get("created"),
        "updated": attrs.get("updated"),
        "profile_count": attrs.get("profile_count") or attrs.get("member_count"),
        "subscriptions": subscriptions,
        "raw": raw,
    }


def _normalize_profile(raw: dict[str, Any]) -> dict[str, Any]:
    attrs = _attributes(raw)
    first_name = attrs.get("first_name")
    last_name = attrs.get("last_name")
    email = attrs.get("email")
    display_name = " ".join(part for part in [first_name, last_name] if part) or email or raw.get("id")
    return {
        "id": raw.get("id"),
        "type": raw.get("type"),
        "email": email,
        "first_name": first_name,
        "last_name": last_name,
        "display_name": display_name,
        "created": attrs.get("created"),
        "updated": attrs.get("updated"),
        "phone_number": attrs.get("phone_number"),
        "subscriptions": attrs.get("subscriptions") or {},
        "raw": raw,
    }


def _normalize_campaign(raw: dict[str, Any]) -> dict[str, Any]:
    attrs = _attributes(raw)
    name = attrs.get("name") or attrs.get("title") or raw.get("id")
    return {
        "id": raw.get("id"),
        "type": raw.get("type"),
        "name": name,
        "status": attrs.get("status"),
        "archived": attrs.get("archived"),
        "created": attrs.get("created"),
        "updated": attrs.get("updated"),
        "channel": attrs.get("channel") or attrs.get("messages", {}).get("channel") if isinstance(attrs.get("messages"), dict) else None,
        "raw": raw,
    }


class KlaviyoClient:
    def __init__(self, *, api_key: str, revision: str | None = None) -> None:
        self._api_key = api_key.strip()
        self._revision = (revision or DEFAULT_REVISION).strip() or DEFAULT_REVISION
        self._base_url = "https://a.klaviyo.com/api"
        token = base64.b64encode(f"api:{self._api_key}".encode("utf-8")).decode("utf-8")
        self._auth_header = f"Klaviyo-API-Key {self._api_key}"
        self._user_agent = "aos-klaviyo/0.1.0"
        self._basic_token = token

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
            "Authorization": self._auth_header,
            "Accept": "application/json",
            "revision": self._revision,
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
            errors = details.get("errors")
            if isinstance(errors, list) and errors:
                first = errors[0] if isinstance(errors[0], dict) else {}
                code = str(first.get("code") or first.get("title") or "KLAVIYO_API_ERROR")
                message = str(first.get("detail") or first.get("title") or err.reason or "Klaviyo API request failed")
            else:
                code = str(details.get("code") or details.get("title") or "KLAVIYO_API_ERROR")
                message = str(details.get("detail") or details.get("title") or err.reason or "Klaviyo API request failed")
            raise KlaviyoApiError(
                status_code=err.code,
                code=code,
                message=message,
                details=details,
            ) from err
        except URLError as err:
            raise KlaviyoApiError(
                status_code=None,
                code="KLAVIYO_NETWORK_ERROR",
                message=str(getattr(err, "reason", err)),
                details={"backend": BACKEND_NAME, "url": url},
            ) from err

    def read_account(self) -> dict[str, Any]:
        payload = self._request("GET", "/accounts")
        data = payload.get("data")
        if not isinstance(data, list) or not data:
            raise KlaviyoApiError(
                status_code=None,
                code="KLAVIYO_EMPTY_RESPONSE",
                message="Klaviyo did not return an account record",
                details={"backend": BACKEND_NAME, "endpoint": "/accounts"},
            )
        account = data[0] if isinstance(data[0], dict) else {}
        return _normalize_account(account)

    def list_lists(self, *, limit: int = 10) -> dict[str, Any]:
        payload = self._request("GET", "/lists", params={"page[size]": max(1, min(limit, 100))})
        data = payload.get("data")
        lists = [
            _normalize_list(item)
            for item in data
            if isinstance(item, dict)
        ] if isinstance(data, list) else []
        return {"lists": lists, "raw": payload}

    def read_list(self, list_id: str) -> dict[str, Any]:
        payload = self._request("GET", f"/lists/{list_id}")
        data = payload.get("data") if isinstance(payload, dict) else None
        if not isinstance(data, dict):
            raise KlaviyoApiError(
                status_code=None,
                code="KLAVIYO_EMPTY_RESPONSE",
                message="Klaviyo did not return a list record",
                details={"backend": BACKEND_NAME, "endpoint": f"/lists/{list_id}"},
            )
        return _normalize_list(data)

    def list_profiles(self, *, list_id: str | None = None, limit: int = 10, email: str | None = None) -> dict[str, Any]:
        path = "/profiles" if not list_id else f"/lists/{list_id}/profiles"
        params: dict[str, Any] = {"page[size]": max(1, min(limit, 100))}
        if email:
            params["filter"] = f'equals(email,"{email}")'
        payload = self._request("GET", path, params=params)
        data = payload.get("data")
        profiles = [
            _normalize_profile(item)
            for item in data
            if isinstance(item, dict)
        ] if isinstance(data, list) else []
        return {"profiles": profiles, "raw": payload, "list_id": list_id, "email": email}

    def read_profile(self, profile_id: str) -> dict[str, Any]:
        payload = self._request("GET", f"/profiles/{profile_id}")
        data = payload.get("data") if isinstance(payload, dict) else None
        if not isinstance(data, dict):
            raise KlaviyoApiError(
                status_code=None,
                code="KLAVIYO_EMPTY_RESPONSE",
                message="Klaviyo did not return a profile record",
                details={"backend": BACKEND_NAME, "endpoint": f"/profiles/{profile_id}"},
            )
        return _normalize_profile(data)

    def find_profile_by_email(self, email: str) -> dict[str, Any]:
        payload = self.list_profiles(limit=1, email=email)
        profiles = payload.get("profiles", [])
        if not profiles:
            raise KlaviyoApiError(
                status_code=404,
                code="KLAVIYO_PROFILE_NOT_FOUND",
                message=f"No profile matched email {email}",
                details={"email": email},
            )
        return profiles[0]

    def list_campaigns(self, *, limit: int = 10) -> dict[str, Any]:
        payload = self._request(
            "GET",
            "/campaigns",
            params={"page[size]": max(1, min(limit, 100)), "filter": 'equals(messages.channel,"email")'},
        )
        data = payload.get("data")
        campaigns = [
            _normalize_campaign(item)
            for item in data
            if isinstance(item, dict)
        ] if isinstance(data, list) else []
        return {"campaigns": campaigns, "raw": payload}

    def read_campaign(self, campaign_id: str) -> dict[str, Any]:
        payload = self._request("GET", f"/campaigns/{campaign_id}")
        data = payload.get("data") if isinstance(payload, dict) else None
        if not isinstance(data, dict):
            raise KlaviyoApiError(
                status_code=None,
                code="KLAVIYO_EMPTY_RESPONSE",
                message="Klaviyo did not return a campaign record",
                details={"backend": BACKEND_NAME, "endpoint": f"/campaigns/{campaign_id}"},
            )
        return _normalize_campaign(data)
