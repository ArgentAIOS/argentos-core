from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urljoin
from urllib.request import Request, urlopen

from .constants import BACKEND_NAME


@dataclass(slots=True)
class SendGridApiError(Exception):
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


class SendGridClient:
    def __init__(self, *, api_key: str) -> None:
        self._api_key = api_key.strip()
        self._base_url = "https://api.sendgrid.com/v3"
        self._user_agent = "aos-sendgrid/0.1.0"

    def _request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        body: dict[str, Any] | None = None,
    ) -> dict[str, Any] | list[Any]:
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
                raw = _load_json(response.read())
                return raw if isinstance(raw, (dict, list)) else {}
        except HTTPError as err:
            details: dict[str, Any] = {}
            try:
                details = _dict_or_empty(_load_json(err.read()))
            except Exception:
                details = {}
            errors = details.get("errors")
            if isinstance(errors, list) and errors:
                first = errors[0] if isinstance(errors[0], dict) else {}
                code = str(first.get("field") or first.get("error_id") or "SENDGRID_API_ERROR")
                message = str(first.get("message") or first.get("help") or err.reason or "SendGrid API request failed")
            else:
                code = "SENDGRID_API_ERROR"
                message = str(details.get("message") or err.reason or "SendGrid API request failed")
            raise SendGridApiError(
                status_code=err.code,
                code=code,
                message=message,
                details=details,
            ) from err
        except URLError as err:
            raise SendGridApiError(
                status_code=None,
                code="SENDGRID_NETWORK_ERROR",
                message=str(getattr(err, "reason", err)),
                details={"backend": BACKEND_NAME, "url": url},
            ) from err

    # ── Mail Send ──────────────────────────────────────────────

    def send_email(
        self,
        *,
        to: str,
        from_email: str,
        subject: str,
        html_body: str,
    ) -> dict[str, Any]:
        body = {
            "personalizations": [{"to": [{"email": to}]}],
            "from": {"email": from_email},
            "subject": subject,
            "content": [{"type": "text/html", "value": html_body}],
        }
        self._request("POST", "/mail/send", body=body)
        return {"status": "accepted", "to": to, "from": from_email, "subject": subject}

    def send_template_email(
        self,
        *,
        to: str,
        from_email: str,
        template_id: str,
        dynamic_data: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        personalization: dict[str, Any] = {"to": [{"email": to}]}
        if dynamic_data:
            personalization["dynamic_template_data"] = dynamic_data
        body = {
            "personalizations": [personalization],
            "from": {"email": from_email},
            "template_id": template_id,
        }
        self._request("POST", "/mail/send", body=body)
        return {"status": "accepted", "to": to, "from": from_email, "template_id": template_id}

    # ── Contacts ───────────────────────────────────────────────

    def list_contacts(self, *, limit: int = 50) -> dict[str, Any]:
        payload = self._request("POST", "/marketing/contacts/search", body={
            "query": "email LIKE '%'",
            "page_size": max(1, min(limit, 1000)),
        })
        result = payload if isinstance(payload, dict) else {}
        contacts = result.get("result", [])
        if not isinstance(contacts, list):
            contacts = []
        return {"contacts": contacts, "contact_count": result.get("contact_count", len(contacts))}

    def add_contact(self, *, email: str, first_name: str | None = None, last_name: str | None = None, list_ids: list[str] | None = None) -> dict[str, Any]:
        contact: dict[str, Any] = {"email": email}
        if first_name:
            contact["first_name"] = first_name
        if last_name:
            contact["last_name"] = last_name
        body: dict[str, Any] = {"contacts": [contact]}
        if list_ids:
            body["list_ids"] = list_ids
        result = self._request("PUT", "/marketing/contacts", body=body)
        return _dict_or_empty(result) if isinstance(result, dict) else {}

    def search_contacts(self, *, query: str, limit: int = 50) -> dict[str, Any]:
        payload = self._request("POST", "/marketing/contacts/search", body={
            "query": query,
            "page_size": max(1, min(limit, 1000)),
        })
        result = payload if isinstance(payload, dict) else {}
        contacts = result.get("result", [])
        if not isinstance(contacts, list):
            contacts = []
        return {"contacts": contacts, "contact_count": result.get("contact_count", len(contacts))}

    # ── Lists ──────────────────────────────────────────────────

    def list_lists(self, *, limit: int = 50) -> dict[str, Any]:
        payload = self._request("GET", "/marketing/lists", params={"page_size": max(1, min(limit, 1000))})
        result = payload if isinstance(payload, dict) else {}
        lists = result.get("result", [])
        if not isinstance(lists, list):
            lists = []
        return {"lists": lists}

    def create_list(self, *, name: str) -> dict[str, Any]:
        result = self._request("POST", "/marketing/lists", body={"name": name})
        return _dict_or_empty(result) if isinstance(result, dict) else {}

    def add_contacts_to_list(self, *, list_id: str, contact_ids: list[str]) -> dict[str, Any]:
        result = self._request("PUT", "/marketing/contacts", body={
            "list_ids": [list_id],
            "contacts": [{"email": cid} for cid in contact_ids],
        })
        return _dict_or_empty(result) if isinstance(result, dict) else {}

    # ── Templates ──────────────────────────────────────────────

    def list_templates(self, *, limit: int = 50, generations: str = "dynamic") -> dict[str, Any]:
        payload = self._request("GET", "/templates", params={
            "page_size": max(1, min(limit, 200)),
            "generations": generations,
        })
        result = payload if isinstance(payload, dict) else {}
        templates = result.get("result") or result.get("templates", [])
        if not isinstance(templates, list):
            templates = []
        return {"templates": templates}

    def get_template(self, template_id: str) -> dict[str, Any]:
        result = self._request("GET", f"/templates/{template_id}")
        return _dict_or_empty(result) if isinstance(result, dict) else {}

    # ── Stats ──────────────────────────────────────────────────

    def global_stats(self, *, start_date: str = "2024-01-01") -> dict[str, Any]:
        payload = self._request("GET", "/stats", params={"start_date": start_date})
        stats = payload if isinstance(payload, list) else []
        return {"stats": stats}

    def category_stats(self, *, category: str, start_date: str = "2024-01-01") -> dict[str, Any]:
        payload = self._request("GET", f"/categories/{category}/stats", params={"start_date": start_date})
        stats = payload if isinstance(payload, list) else []
        return {"stats": stats, "category": category}

    # ── Probe ──────────────────────────────────────────────────

    def verify_api_key(self) -> dict[str, Any]:
        """Call the scopes endpoint to verify the API key is valid."""
        result = self._request("GET", "/scopes")
        scopes = result.get("scopes", []) if isinstance(result, dict) else []
        return {"scopes": scopes}
