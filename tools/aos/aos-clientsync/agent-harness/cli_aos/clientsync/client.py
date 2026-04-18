from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urljoin
from urllib.request import Request, urlopen

from .constants import BACKEND_NAME, DEFAULT_API_URL


@dataclass(slots=True)
class ClientSyncApiError(Exception):
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


def _ensure_list(value: Any) -> list[dict[str, Any]]:
    if isinstance(value, list):
        return [item for item in value if isinstance(item, dict)]
    return []


class ClientSyncClient:
    def __init__(self, *, api_key: str, api_url: str | None = None) -> None:
        self._api_key = api_key.strip()
        self._base_url = (api_url or DEFAULT_API_URL).rstrip("/")
        self._user_agent = "aos-clientsync/0.1.0"

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
            code = str(details.get("code") or details.get("error") or "CLIENTSYNC_API_ERROR")
            message = str(details.get("message") or details.get("detail") or err.reason or "ClientSync API request failed")
            raise ClientSyncApiError(
                status_code=err.code,
                code=code,
                message=message,
                details=details,
            ) from err
        except URLError as err:
            raise ClientSyncApiError(
                status_code=None,
                code="CLIENTSYNC_NETWORK_ERROR",
                message=str(getattr(err, "reason", err)),
                details={"backend": BACKEND_NAME, "url": url},
            ) from err

    # --- Clients ---

    def list_clients(self, *, limit: int = 25) -> dict[str, Any]:
        payload = self._request("GET", "/clients", params={"limit": max(1, min(limit, 100))})
        return {"clients": _ensure_list(payload.get("data")), "total": payload.get("total", 0), "raw": payload}

    def get_client(self, client_id: str) -> dict[str, Any]:
        payload = self._request("GET", f"/clients/{client_id}")
        data = payload.get("data") if isinstance(payload, dict) else payload
        if not isinstance(data, dict):
            raise ClientSyncApiError(status_code=None, code="CLIENTSYNC_EMPTY_RESPONSE", message="ClientSync did not return a client record", details={"endpoint": f"/clients/{client_id}"})
        return data

    def create_client(self, *, name: str, contact_email: str | None = None, plan: str | None = None) -> dict[str, Any]:
        body: dict[str, Any] = {"name": name}
        if contact_email:
            body["contact_email"] = contact_email
        if plan:
            body["plan"] = plan
        payload = self._request("POST", "/clients", body=body)
        return payload.get("data", payload)

    def update_client(self, client_id: str, *, updates: dict[str, Any]) -> dict[str, Any]:
        payload = self._request("PATCH", f"/clients/{client_id}", body=updates)
        return payload.get("data", payload)

    def get_client_portal(self, client_id: str) -> dict[str, Any]:
        payload = self._request("GET", f"/clients/{client_id}/portal")
        return payload.get("data", payload)

    # --- Tickets ---

    def list_tickets(self, *, client_id: str | None = None, technician_id: str | None = None, priority: str | None = None, status: str | None = None, limit: int = 25) -> dict[str, Any]:
        params: dict[str, Any] = {"limit": max(1, min(limit, 100))}
        if client_id:
            params["client_id"] = client_id
        if technician_id:
            params["technician_id"] = technician_id
        if priority:
            params["priority"] = priority
        if status:
            params["status"] = status
        payload = self._request("GET", "/tickets", params=params)
        return {"tickets": _ensure_list(payload.get("data")), "total": payload.get("total", 0), "raw": payload}

    def get_ticket(self, ticket_id: str) -> dict[str, Any]:
        payload = self._request("GET", f"/tickets/{ticket_id}")
        data = payload.get("data") if isinstance(payload, dict) else payload
        if not isinstance(data, dict):
            raise ClientSyncApiError(status_code=None, code="CLIENTSYNC_EMPTY_RESPONSE", message="ClientSync did not return a ticket record", details={"endpoint": f"/tickets/{ticket_id}"})
        return data

    def create_ticket(self, *, client_id: str, subject: str, description: str | None = None, priority: str | None = None) -> dict[str, Any]:
        body: dict[str, Any] = {"client_id": client_id, "subject": subject}
        if description:
            body["description"] = description
        if priority:
            body["priority"] = priority
        payload = self._request("POST", "/tickets", body=body)
        return payload.get("data", payload)

    def update_ticket(self, ticket_id: str, *, updates: dict[str, Any]) -> dict[str, Any]:
        payload = self._request("PATCH", f"/tickets/{ticket_id}", body=updates)
        return payload.get("data", payload)

    def assign_ticket(self, ticket_id: str, *, technician_id: str) -> dict[str, Any]:
        payload = self._request("POST", f"/tickets/{ticket_id}/assign", body={"technician_id": technician_id})
        return payload.get("data", payload)

    def resolve_ticket(self, ticket_id: str, *, resolution: str | None = None) -> dict[str, Any]:
        body: dict[str, Any] = {"status": "resolved"}
        if resolution:
            body["resolution"] = resolution
        payload = self._request("POST", f"/tickets/{ticket_id}/resolve", body=body)
        return payload.get("data", payload)

    # --- Technicians ---

    def list_technicians(self, *, limit: int = 25) -> dict[str, Any]:
        payload = self._request("GET", "/technicians", params={"limit": max(1, min(limit, 100))})
        return {"technicians": _ensure_list(payload.get("data")), "total": payload.get("total", 0), "raw": payload}

    def get_technician(self, technician_id: str) -> dict[str, Any]:
        payload = self._request("GET", f"/technicians/{technician_id}")
        data = payload.get("data") if isinstance(payload, dict) else payload
        if not isinstance(data, dict):
            raise ClientSyncApiError(status_code=None, code="CLIENTSYNC_EMPTY_RESPONSE", message="ClientSync did not return a technician record", details={"endpoint": f"/technicians/{technician_id}"})
        return data

    def get_technician_availability(self, technician_id: str) -> dict[str, Any]:
        payload = self._request("GET", f"/technicians/{technician_id}/availability")
        return payload.get("data", payload)

    # --- Compliance ---

    def list_compliance(self, *, limit: int = 25) -> dict[str, Any]:
        payload = self._request("GET", "/compliance", params={"limit": max(1, min(limit, 100))})
        return {"frameworks": _ensure_list(payload.get("data")), "total": payload.get("total", 0), "raw": payload}

    def get_compliance(self, compliance_id: str) -> dict[str, Any]:
        payload = self._request("GET", f"/compliance/{compliance_id}")
        data = payload.get("data") if isinstance(payload, dict) else payload
        if not isinstance(data, dict):
            raise ClientSyncApiError(status_code=None, code="CLIENTSYNC_EMPTY_RESPONSE", message="ClientSync did not return a compliance record", details={"endpoint": f"/compliance/{compliance_id}"})
        return data

    def check_compliance(self, *, client_id: str, compliance_id: str) -> dict[str, Any]:
        payload = self._request("POST", f"/compliance/{compliance_id}/check", body={"client_id": client_id})
        return payload.get("data", payload)

    def generate_compliance_report(self, *, client_id: str, compliance_id: str) -> dict[str, Any]:
        payload = self._request("POST", f"/compliance/{compliance_id}/report", body={"client_id": client_id})
        return payload.get("data", payload)

    # --- Assets ---

    def list_assets(self, *, client_id: str | None = None, limit: int = 25) -> dict[str, Any]:
        params: dict[str, Any] = {"limit": max(1, min(limit, 100))}
        if client_id:
            params["client_id"] = client_id
        payload = self._request("GET", "/assets", params=params)
        return {"assets": _ensure_list(payload.get("data")), "total": payload.get("total", 0), "raw": payload}

    def get_asset(self, asset_id: str) -> dict[str, Any]:
        payload = self._request("GET", f"/assets/{asset_id}")
        data = payload.get("data") if isinstance(payload, dict) else payload
        if not isinstance(data, dict):
            raise ClientSyncApiError(status_code=None, code="CLIENTSYNC_EMPTY_RESPONSE", message="ClientSync did not return an asset record", details={"endpoint": f"/assets/{asset_id}"})
        return data

    def create_asset(self, *, client_id: str, name: str, asset_type: str | None = None, serial: str | None = None) -> dict[str, Any]:
        body: dict[str, Any] = {"client_id": client_id, "name": name}
        if asset_type:
            body["type"] = asset_type
        if serial:
            body["serial"] = serial
        payload = self._request("POST", "/assets", body=body)
        return payload.get("data", payload)

    # --- Contracts ---

    def list_contracts(self, *, client_id: str | None = None, limit: int = 25) -> dict[str, Any]:
        params: dict[str, Any] = {"limit": max(1, min(limit, 100))}
        if client_id:
            params["client_id"] = client_id
        payload = self._request("GET", "/contracts", params=params)
        return {"contracts": _ensure_list(payload.get("data")), "total": payload.get("total", 0), "raw": payload}

    def get_contract(self, contract_id: str) -> dict[str, Any]:
        payload = self._request("GET", f"/contracts/{contract_id}")
        data = payload.get("data") if isinstance(payload, dict) else payload
        if not isinstance(data, dict):
            raise ClientSyncApiError(status_code=None, code="CLIENTSYNC_EMPTY_RESPONSE", message="ClientSync did not return a contract record", details={"endpoint": f"/contracts/{contract_id}"})
        return data

    def renew_contract(self, contract_id: str, *, duration_months: int | None = None) -> dict[str, Any]:
        body: dict[str, Any] = {}
        if duration_months:
            body["duration_months"] = duration_months
        payload = self._request("POST", f"/contracts/{contract_id}/renew", body=body)
        return payload.get("data", payload)

    # --- Analytics ---

    def get_analytics_dashboard(self, *, report_type: str | None = None, date_range: str | None = None) -> dict[str, Any]:
        params: dict[str, Any] = {}
        if report_type:
            params["report_type"] = report_type
        if date_range:
            params["date_range"] = date_range
        payload = self._request("GET", "/analytics/dashboard", params=params)
        return payload.get("data", payload)

    def get_client_health(self, client_id: str) -> dict[str, Any]:
        payload = self._request("GET", f"/analytics/clients/{client_id}/health")
        return payload.get("data", payload)

    def get_sla_performance(self, *, sla_id: str | None = None, date_range: str | None = None) -> dict[str, Any]:
        params: dict[str, Any] = {}
        if sla_id:
            params["sla_id"] = sla_id
        if date_range:
            params["date_range"] = date_range
        payload = self._request("GET", "/analytics/sla", params=params)
        return payload.get("data", payload)

    # --- Reports ---

    def generate_report(self, *, report_type: str, client_id: str | None = None, date_range: str | None = None) -> dict[str, Any]:
        body: dict[str, Any] = {"report_type": report_type}
        if client_id:
            body["client_id"] = client_id
        if date_range:
            body["date_range"] = date_range
        payload = self._request("POST", "/reports", body=body)
        return payload.get("data", payload)

    def list_reports(self, *, limit: int = 25) -> dict[str, Any]:
        payload = self._request("GET", "/reports", params={"limit": max(1, min(limit, 100))})
        return {"reports": _ensure_list(payload.get("data")), "total": payload.get("total", 0), "raw": payload}

    # --- Audit ---

    def list_audit(self, *, date_range: str | None = None, limit: int = 25) -> dict[str, Any]:
        params: dict[str, Any] = {"limit": max(1, min(limit, 100))}
        if date_range:
            params["date_range"] = date_range
        payload = self._request("GET", "/audit", params=params)
        return {"entries": _ensure_list(payload.get("data")), "total": payload.get("total", 0), "raw": payload}

    def create_audit_entry(self, *, action: str, resource_type: str, resource_id: str, details: str | None = None) -> dict[str, Any]:
        body: dict[str, Any] = {"action": action, "resource_type": resource_type, "resource_id": resource_id}
        if details:
            body["details"] = details
        payload = self._request("POST", "/audit", body=body)
        return payload.get("data", payload)
