from __future__ import annotations

import base64
import json
from dataclasses import dataclass
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen

from .constants import BACKEND_NAME


@dataclass(slots=True)
class ConnectWiseApiError(Exception):
    status_code: int | None
    code: str
    message: str
    details: dict[str, Any] | None = None


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


def _normalize_ticket(raw: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": raw.get("id"),
        "summary": raw.get("summary") or raw.get("name"),
        "status": raw.get("status", {}).get("name") if isinstance(raw.get("status"), dict) else raw.get("status"),
        "priority": raw.get("priority", {}).get("name") if isinstance(raw.get("priority"), dict) else raw.get("priority"),
        "company": raw.get("company") or raw.get("company", {}).get("name"),
        "board": raw.get("board") or raw.get("board", {}).get("name"),
        "assignee": raw.get("assignedBy") or raw.get("assignedBy", {}).get("identifier"),
        "created_at": raw.get("dateEntered") or raw.get("createdAt"),
        "updated_at": raw.get("lastUpdated") or raw.get("updatedAt"),
        "raw": raw,
    }


def _normalize_named_item(raw: dict[str, Any], *, name_keys: tuple[str, ...], extra_keys: tuple[str, ...] = ()) -> dict[str, Any]:
    name = next((raw.get(key) for key in name_keys if raw.get(key) is not None), None)
    normalized = {"id": raw.get("id"), "name": name, "raw": raw}
    for key in extra_keys:
        normalized[key] = raw.get(key)
    return normalized


def _normalize_contact(raw: dict[str, Any]) -> dict[str, Any]:
    first_name = raw.get("firstName")
    last_name = raw.get("lastName")
    return {
        "id": raw.get("id"),
        "first_name": first_name,
        "last_name": last_name,
        "email": raw.get("emailAddress"),
        "phone": raw.get("phoneNumber"),
        "company": raw.get("company", {}).get("name") if isinstance(raw.get("company"), dict) else raw.get("company"),
        "type": raw.get("contactType", {}).get("name") if isinstance(raw.get("contactType"), dict) else raw.get("contactType"),
        "name": " ".join(part for part in [first_name, last_name] if part),
        "raw": raw,
    }


class ConnectWiseClient:
    def __init__(
        self,
        *,
        company_id: str,
        public_key: str,
        private_key: str,
        site_url: str,
    ) -> None:
        self._company_id = company_id.strip()
        self._public_key = public_key.strip()
        self._private_key = private_key.strip()
        self._site_url = site_url.strip().rstrip("/")
        self._user_agent = "aos-connectwise/0.1.0"
        credentials = base64.b64encode(f"{self._company_id}+{self._public_key}:{self._private_key}".encode("utf-8")).decode("utf-8")
        self._auth_header = f"Basic {credentials}"
        self._base_url = f"https://{self._site_url}/v4_6_release/apis/3.0"

    def _request(
        self,
        method: str,
        url: str,
        *,
        query: dict[str, Any] | None = None,
        json_body: dict[str, Any] | None = None,
    ) -> Any:
        if query:
            url = f"{url}?{urlencode([(k, str(v)) for k, v in query.items() if v is not None])}"
        headers = {
            "Authorization": self._auth_header,
            "Accept": "application/json",
            "User-Agent": self._user_agent,
            "clientid": self._public_key,
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
            code = str(details.get("code") or "CONNECTWISE_API_ERROR")
            message = str(details.get("message") or err.reason or "ConnectWise API request failed")
            raise ConnectWiseApiError(status_code=err.code, code=code, message=message, details=details or {"backend": BACKEND_NAME, "url": url}) from err
        except URLError as err:
            raise ConnectWiseApiError(status_code=None, code="CONNECTWISE_NETWORK_ERROR", message=str(getattr(err, "reason", err)), details={"backend": BACKEND_NAME, "url": url}) from err

    def health_probe(self) -> dict[str, Any]:
        return self.list_boards(limit=1)

    def list_tickets(self, *, board_id: str | None = None, status: str | None = None, priority: str | None = None, limit: int = 25) -> dict[str, Any]:
        conditions = []
        if board_id:
            conditions.append(f"board/id={board_id}")
        if status:
            conditions.append(f"status/name='{status}'")
        if priority:
            conditions.append(f"priority/name='{priority}'")
        query: dict[str, Any] = {"pageSize": max(1, min(limit, 100))}
        if conditions:
            query["conditions"] = " AND ".join(conditions)
        raw = self._request("GET", f"{self._base_url}/service/tickets", query=query)
        tickets = [_normalize_ticket(item) for item in _list_or_empty(raw) if isinstance(item, dict)]
        return {"tickets": tickets, "raw": raw}

    def get_ticket(self, ticket_id: str) -> dict[str, Any]:
        raw = self._request("GET", f"{self._base_url}/service/tickets/{quote(ticket_id, safe='')}")
        return _normalize_ticket(_dict_or_empty(raw))

    def create_ticket(self, payload: dict[str, Any]) -> dict[str, Any]:
        raw = self._request("POST", f"{self._base_url}/service/tickets", json_body=payload)
        return _normalize_ticket(_dict_or_empty(raw))

    def update_ticket(self, ticket_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        raw = self._request("PATCH", f"{self._base_url}/service/tickets/{quote(ticket_id, safe='')}", json_body=payload)
        return _normalize_ticket(_dict_or_empty(raw))

    def list_companies(self, *, limit: int = 25) -> dict[str, Any]:
        raw = self._request("GET", f"{self._base_url}/company/companies", query={"pageSize": max(1, min(limit, 100))})
        companies = [_normalize_named_item(item, name_keys=("name", "identifier")) for item in _list_or_empty(raw) if isinstance(item, dict)]
        return {"companies": companies, "raw": raw}

    def get_company(self, company_id: str) -> dict[str, Any]:
        raw = self._request("GET", f"{self._base_url}/company/companies/{quote(company_id, safe='')}")
        return _normalize_named_item(_dict_or_empty(raw), name_keys=("name", "identifier"))

    def create_company(self, payload: dict[str, Any]) -> dict[str, Any]:
        raw = self._request("POST", f"{self._base_url}/company/companies", json_body=payload)
        return _normalize_named_item(_dict_or_empty(raw), name_keys=("name", "identifier"))

    def list_contacts(self, *, company_id: str | None = None, limit: int = 25) -> dict[str, Any]:
        query: dict[str, Any] = {"pageSize": max(1, min(limit, 100))}
        if company_id:
            query["conditions"] = f"company/id={company_id}"
        raw = self._request("GET", f"{self._base_url}/company/contacts", query=query)
        contacts = [_normalize_contact(item) for item in _list_or_empty(raw) if isinstance(item, dict)]
        return {"contacts": contacts, "raw": raw}

    def get_contact(self, contact_id: str) -> dict[str, Any]:
        raw = self._request("GET", f"{self._base_url}/company/contacts/{quote(contact_id, safe='')}")
        return _normalize_contact(_dict_or_empty(raw))

    def create_contact(self, payload: dict[str, Any]) -> dict[str, Any]:
        raw = self._request("POST", f"{self._base_url}/company/contacts", json_body=payload)
        return _normalize_contact(_dict_or_empty(raw))

    def list_projects(self, *, limit: int = 25) -> dict[str, Any]:
        raw = self._request("GET", f"{self._base_url}/project/projects", query={"pageSize": max(1, min(limit, 100))})
        projects = [_normalize_named_item(item, name_keys=("name",), extra_keys=("status", "company", "manager")) for item in _list_or_empty(raw) if isinstance(item, dict)]
        return {"projects": projects, "raw": raw}

    def get_project(self, project_id: str) -> dict[str, Any]:
        raw = self._request("GET", f"{self._base_url}/project/projects/{quote(project_id, safe='')}")
        return _normalize_named_item(_dict_or_empty(raw), name_keys=("name",), extra_keys=("status", "company", "manager"))

    def list_boards(self, *, limit: int = 25) -> dict[str, Any]:
        raw = self._request("GET", f"{self._base_url}/service/boards", query={"pageSize": max(1, min(limit, 100))})
        boards = [_normalize_named_item(item, name_keys=("name",), extra_keys=("location", "department", "project_flag")) for item in _list_or_empty(raw) if isinstance(item, dict)]
        return {"boards": boards, "raw": raw}

    def list_statuses(self, board_id: str, *, limit: int = 25) -> dict[str, Any]:
        raw = self._request("GET", f"{self._base_url}/service/boards/{quote(board_id, safe='')}/statuses", query={"pageSize": max(1, min(limit, 100))})
        statuses = [_normalize_named_item(item, name_keys=("name",), extra_keys=("board", "closed_flag")) for item in _list_or_empty(raw) if isinstance(item, dict)]
        return {"statuses": statuses, "raw": raw}

    def list_members(self, *, limit: int = 25) -> dict[str, Any]:
        raw = self._request("GET", f"{self._base_url}/system/members", query={"pageSize": max(1, min(limit, 100))})
        members = [_normalize_named_item(item, name_keys=("identifier", "firstName", "lastName"), extra_keys=("email", "title", "officeEmail")) for item in _list_or_empty(raw) if isinstance(item, dict)]
        return {"members": members, "raw": raw}

    def create_time_entry(self, ticket_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        raw = self._request("POST", f"{self._base_url}/time/entries", json_body={"ticket": {"id": ticket_id}, **payload})
        return _dict_or_empty(raw)

    def list_configurations(self, *, company_id: str | None = None, limit: int = 25) -> dict[str, Any]:
        query: dict[str, Any] = {"pageSize": max(1, min(limit, 100))}
        if company_id:
            query["conditions"] = f"company/id={company_id}"
        raw = self._request("GET", f"{self._base_url}/company/configurations", query=query)
        configs = [_normalize_named_item(item, name_keys=("name",), extra_keys=("type", "status", "company", "serialNumber", "model")) for item in _list_or_empty(raw) if isinstance(item, dict)]
        return {"configurations": configs, "raw": raw}

    def get_configuration(self, configuration_id: str) -> dict[str, Any]:
        raw = self._request("GET", f"{self._base_url}/company/configurations/{quote(configuration_id, safe='')}")
        return _normalize_named_item(_dict_or_empty(raw), name_keys=("name",), extra_keys=("type", "status", "company", "serialNumber", "model"))
