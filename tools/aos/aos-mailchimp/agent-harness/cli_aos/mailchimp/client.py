from __future__ import annotations

import base64
import hashlib
import json
from dataclasses import dataclass
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urljoin
from urllib.request import Request, urlopen

from .constants import BACKEND_NAME


@dataclass(slots=True)
class MailchimpApiError(Exception):
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


def subscriber_hash(email: str) -> str:
    return hashlib.md5(email.strip().lower().encode("utf-8")).hexdigest()


def _load_json(payload: bytes) -> dict[str, Any]:
    if not payload:
        return {}
    text = payload.decode("utf-8")
    if not text.strip():
        return {}
    value = json.loads(text)
    return value if isinstance(value, dict) else {"value": value}


class MailchimpClient:
    def __init__(self, *, api_key: str, server_prefix: str) -> None:
        self._api_key = api_key.strip()
        self._server_prefix = server_prefix.strip()
        self._base_url = f"https://{self._server_prefix}.api.mailchimp.com/3.0"
        token = base64.b64encode(f"anystring:{self._api_key}".encode("utf-8")).decode("utf-8")
        self._auth_header = f"Basic {token}"

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
        }
        if payload is not None:
            headers["Content-Type"] = "application/json"
        request = Request(url, data=payload, method=method.upper(), headers=headers)
        try:
            with urlopen(request, timeout=30) as response:
                return _load_json(response.read())
        except HTTPError as err:
            details = {}
            try:
                details = _load_json(err.read())
            except Exception:
                details = {}
            raise MailchimpApiError(
                status_code=err.code,
                code=str(details.get("type") or details.get("title") or "MAILCHIMP_API_ERROR"),
                message=str(details.get("detail") or details.get("title") or err.reason or "Mailchimp API request failed"),
                details=details,
            ) from err
        except URLError as err:
            raise MailchimpApiError(
                status_code=None,
                code="MAILCHIMP_NETWORK_ERROR",
                message=str(getattr(err, "reason", err)),
                details={"backend": BACKEND_NAME, "url": url},
            ) from err

    def ping(self) -> dict[str, Any]:
        return self._request("GET", "/ping")

    def read_account(self) -> dict[str, Any]:
        return self._request("GET", "/account")

    def list_audiences(self, *, limit: int = 10) -> dict[str, Any]:
        return self._request("GET", "/lists", params={"count": max(1, min(limit, 100))})

    def read_audience(self, audience_id: str) -> dict[str, Any]:
        return self._request("GET", f"/lists/{audience_id}")

    def list_members(self, audience_id: str, *, limit: int = 10) -> dict[str, Any]:
        return self._request("GET", f"/lists/{audience_id}/members", params={"count": max(1, min(limit, 100))})

    def read_member(self, audience_id: str, email: str) -> dict[str, Any]:
        return self._request("GET", f"/lists/{audience_id}/members/{subscriber_hash(email)}")

    def list_campaigns(self, *, limit: int = 10, status: str | None = None) -> dict[str, Any]:
        params = {"count": max(1, min(limit, 100))}
        if status:
            params["status"] = status
        return self._request("GET", "/campaigns", params=params)

    def read_campaign(self, campaign_id: str) -> dict[str, Any]:
        return self._request("GET", f"/campaigns/{campaign_id}")

    def list_reports(self, *, limit: int = 10) -> dict[str, Any]:
        return self._request("GET", "/reports", params={"count": max(1, min(limit, 100))})

    def read_report(self, campaign_id: str) -> dict[str, Any]:
        return self._request("GET", f"/reports/{campaign_id}")
