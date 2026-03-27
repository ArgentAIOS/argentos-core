from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin
from urllib.request import Request, urlopen

from .constants import BACKEND_NAME


@dataclass(slots=True)
class ResendApiError(Exception):
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


class ResendClient:
    def __init__(self, *, api_key: str) -> None:
        self._api_key = api_key.strip()
        self._base_url = "https://api.resend.com"
        self._user_agent = "aos-resend/0.1.0"

    def _request(
        self,
        method: str,
        path: str,
        *,
        body: dict[str, Any] | list[dict[str, Any]] | None = None,
    ) -> dict[str, Any] | list[Any]:
        url = urljoin(self._base_url + "/", path.lstrip("/"))
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
                raw = _load_json(response.read())
                return raw if isinstance(raw, (dict, list)) else {}
        except HTTPError as err:
            details: dict[str, Any] = {}
            try:
                details = _dict_or_empty(_load_json(err.read()))
            except Exception:
                details = {}
            code = str(details.get("name") or details.get("error") or "RESEND_API_ERROR")
            message = str(details.get("message") or err.reason or "Resend API request failed")
            raise ResendApiError(
                status_code=err.code,
                code=code,
                message=message,
                details=details,
            ) from err
        except URLError as err:
            raise ResendApiError(
                status_code=None,
                code="RESEND_NETWORK_ERROR",
                message=str(getattr(err, "reason", err)),
                details={"backend": BACKEND_NAME, "url": url},
            ) from err

    # ── Email ──────────────────────────────────────────────────

    def send_email(
        self,
        *,
        to: str | list[str],
        from_email: str,
        subject: str,
        html: str,
    ) -> dict[str, Any]:
        to_list = [to] if isinstance(to, str) else to
        result = self._request("POST", "/emails", body={
            "from": from_email,
            "to": to_list,
            "subject": subject,
            "html": html,
        })
        return _dict_or_empty(result) if isinstance(result, dict) else {"id": None}

    def batch_send(
        self,
        *,
        emails: list[dict[str, Any]],
    ) -> dict[str, Any]:
        result = self._request("POST", "/emails/batch", body=emails)
        return _dict_or_empty(result) if isinstance(result, dict) else {"data": result if isinstance(result, list) else []}

    # ── Domains ────────────────────────────────────────────────

    def list_domains(self) -> dict[str, Any]:
        result = self._request("GET", "/domains")
        if isinstance(result, dict):
            domains = result.get("data", [])
        elif isinstance(result, list):
            domains = result
        else:
            domains = []
        return {"domains": domains if isinstance(domains, list) else []}

    def verify_domain(self, domain_id: str) -> dict[str, Any]:
        result = self._request("POST", f"/domains/{domain_id}/verify")
        return _dict_or_empty(result) if isinstance(result, dict) else {}

    # ── Audiences ──────────────────────────────────────────────

    def list_audiences(self) -> dict[str, Any]:
        result = self._request("GET", "/audiences")
        if isinstance(result, dict):
            audiences = result.get("data", [])
        elif isinstance(result, list):
            audiences = result
        else:
            audiences = []
        return {"audiences": audiences if isinstance(audiences, list) else []}

    def create_audience(self, *, name: str) -> dict[str, Any]:
        result = self._request("POST", "/audiences", body={"name": name})
        return _dict_or_empty(result) if isinstance(result, dict) else {}

    # ── Contacts ───────────────────────────────────────────────

    def list_contacts(self, *, audience_id: str) -> dict[str, Any]:
        result = self._request("GET", f"/audiences/{audience_id}/contacts")
        if isinstance(result, dict):
            contacts = result.get("data", [])
        elif isinstance(result, list):
            contacts = result
        else:
            contacts = []
        return {"contacts": contacts if isinstance(contacts, list) else []}

    def create_contact(self, *, audience_id: str, email: str, first_name: str | None = None, last_name: str | None = None) -> dict[str, Any]:
        body: dict[str, Any] = {"email": email}
        if first_name:
            body["first_name"] = first_name
        if last_name:
            body["last_name"] = last_name
        result = self._request("POST", f"/audiences/{audience_id}/contacts", body=body)
        return _dict_or_empty(result) if isinstance(result, dict) else {}

    def remove_contact(self, *, audience_id: str, contact_id: str) -> dict[str, Any]:
        result = self._request("DELETE", f"/audiences/{audience_id}/contacts/{contact_id}")
        return _dict_or_empty(result) if isinstance(result, dict) else {}

    # ── Probe ──────────────────────────────────────────────────

    def verify_api_key(self) -> dict[str, Any]:
        """List domains as a lightweight probe to verify the API key."""
        return self.list_domains()
