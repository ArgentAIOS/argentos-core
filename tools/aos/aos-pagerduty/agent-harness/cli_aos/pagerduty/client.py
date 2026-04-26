from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any
from urllib import error, parse, request

from .constants import BACKEND_NAME, DEFAULT_API_BASE_URL, DEFAULT_EVENTS_API_BASE_URL

API_TIMEOUT_SECONDS = 20
USER_AGENT = "aos-pagerduty/0.1.0"
PAGERDUTY_MEDIA_TYPE = "application/vnd.pagerduty+json;version=2"


@dataclass
class PagerDutyApiError(Exception):
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


def _dict_or_empty(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _list_or_empty(value: Any) -> list[dict[str, Any]]:
    if isinstance(value, list):
        return [item for item in value if isinstance(item, dict)]
    return []


def _clean_dict(values: dict[str, Any]) -> dict[str, Any]:
    cleaned: dict[str, Any] = {}
    for key, value in values.items():
        if value is None:
            continue
        if isinstance(value, str) and not value.strip():
            continue
        cleaned[key] = value
    return cleaned


def _normalize_incident(raw: dict[str, Any]) -> dict[str, Any]:
    service = raw.get("service") or {}
    escalation_policy = raw.get("escalation_policy") or {}
    assignments = raw.get("assignments") or []
    return {
        "id": raw.get("id"),
        "type": raw.get("type"),
        "summary": raw.get("summary"),
        "status": raw.get("status"),
        "urgency": raw.get("urgency"),
        "created_at": raw.get("created_at"),
        "updated_at": raw.get("updated_at"),
        "incident_number": raw.get("incident_number"),
        "title": raw.get("title") or raw.get("summary"),
        "service": service if isinstance(service, dict) else {},
        "escalation_policy": escalation_policy if isinstance(escalation_policy, dict) else {},
        "assignments": assignments if isinstance(assignments, list) else [],
        "raw": raw,
    }


def _normalize_service(raw: dict[str, Any]) -> dict[str, Any]:
    escalation_policy = raw.get("escalation_policy") or {}
    return {
        "id": raw.get("id"),
        "type": raw.get("type"),
        "summary": raw.get("summary"),
        "name": raw.get("name") or raw.get("summary"),
        "description": raw.get("description"),
        "status": raw.get("status"),
        "auto_resolve_timeout": raw.get("auto_resolve_timeout"),
        "alert_creation": raw.get("alert_creation"),
        "escalation_policy": escalation_policy if isinstance(escalation_policy, dict) else {},
        "teams": raw.get("teams") if isinstance(raw.get("teams"), list) else [],
        "raw": raw,
    }


def _normalize_escalation_policy(raw: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": raw.get("id"),
        "type": raw.get("type"),
        "summary": raw.get("summary"),
        "name": raw.get("name") or raw.get("summary"),
        "num_loops": raw.get("num_loops"),
        "escalation_rules": raw.get("escalation_rules") if isinstance(raw.get("escalation_rules"), list) else [],
        "teams": raw.get("teams") if isinstance(raw.get("teams"), list) else [],
        "services": raw.get("services") if isinstance(raw.get("services"), list) else [],
        "raw": raw,
    }


def _normalize_on_call(raw: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": raw.get("id"),
        "escalation_policy": raw.get("escalation_policy") if isinstance(raw.get("escalation_policy"), dict) else {},
        "schedule": raw.get("schedule") if isinstance(raw.get("schedule"), dict) else {},
        "user": raw.get("user") if isinstance(raw.get("user"), dict) else {},
        "escalation_level": raw.get("escalation_level"),
        "start": raw.get("start"),
        "end": raw.get("end"),
        "raw": raw,
    }


def _normalize_alert(raw: dict[str, Any]) -> dict[str, Any]:
    incident = raw.get("incident") or {}
    service = raw.get("service") or {}
    return {
        "id": raw.get("id"),
        "type": raw.get("type"),
        "status": raw.get("status"),
        "severity": raw.get("severity"),
        "summary": raw.get("summary"),
        "body": raw.get("body"),
        "created_at": raw.get("created_at"),
        "updated_at": raw.get("updated_at"),
        "incident": incident if isinstance(incident, dict) else {},
        "service": service if isinstance(service, dict) else {},
        "dedup_key": raw.get("dedup_key"),
        "raw": raw,
    }


class PagerDutyClient:
    def __init__(
        self,
        *,
        api_key: str | None = None,
        events_routing_key: str | None = None,
        base_url: str = DEFAULT_API_BASE_URL,
        events_base_url: str = DEFAULT_EVENTS_API_BASE_URL,
    ) -> None:
        self._api_key = (api_key or "").strip()
        self._events_routing_key = (events_routing_key or "").strip()
        self._base_url = base_url.rstrip("/")
        self._events_base_url = events_base_url.rstrip("/")

    def _request_json(
        self,
        method: str,
        url: str,
        *,
        params: dict[str, Any] | None = None,
        json_body: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
    ) -> dict[str, Any]:
        if params:
            url = f"{url}?{parse.urlencode(_clean_dict(params), doseq=True)}"

        payload: bytes | None = None
        request_headers = {"User-Agent": USER_AGENT, **(headers or {})}
        if json_body is not None:
            payload = json.dumps(json_body).encode("utf-8")
            request_headers.setdefault("Content-Type", "application/json")

        req = request.Request(url, data=payload, method=method.upper(), headers=request_headers)
        try:
            with request.urlopen(req, timeout=API_TIMEOUT_SECONDS) as response:
                charset = response.headers.get_content_charset("utf-8")
                body = response.read().decode(charset or "utf-8")
        except error.HTTPError as exc:
            charset = exc.headers.get_content_charset("utf-8") if exc.headers else "utf-8"
            body = exc.read().decode(charset or "utf-8", errors="replace")
            details: dict[str, Any] = {"status": exc.code, "url": url}
            message = body or str(exc)
            try:
                response_payload = json.loads(body) if body else {}
            except json.JSONDecodeError:
                response_payload = {}
            if isinstance(response_payload, dict) and response_payload:
                details["response"] = response_payload
                error_payload = response_payload.get("error")
                if isinstance(error_payload, dict):
                    message = str(error_payload.get("message") or error_payload.get("code") or message)
                elif error_payload:
                    message = str(error_payload)
                else:
                    message = str(response_payload.get("message") or message)
            if exc.code in {401, 403}:
                code = "PAGERDUTY_AUTH_ERROR"
            elif exc.code == 404:
                code = "NOT_FOUND"
            elif exc.code == 429:
                code = "RATE_LIMITED"
            else:
                code = "PAGERDUTY_API_ERROR"
            raise PagerDutyApiError(status_code=exc.code, code=code, message=message, details=details) from exc
        except error.URLError as exc:
            raise PagerDutyApiError(
                status_code=None,
                code="PAGERDUTY_NETWORK_ERROR",
                message="Failed to reach the PagerDuty API",
                details={"reason": str(getattr(exc, "reason", exc)), "url": url, "backend": BACKEND_NAME},
            ) from exc

        if not body:
            return {}
        try:
            parsed = json.loads(body)
        except json.JSONDecodeError as exc:
            raise PagerDutyApiError(
                status_code=None,
                code="PAGERDUTY_BAD_JSON",
                message="PagerDuty returned invalid JSON",
                details={"url": url, "body": body[:2000]},
            ) from exc
        return _dict_or_empty(parsed)

    def _rest_request_json(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        json_body: dict[str, Any] | None = None,
        from_email: str | None = None,
    ) -> dict[str, Any]:
        headers = {
            "Authorization": f"Token token={self._api_key}",
            "Accept": PAGERDUTY_MEDIA_TYPE,
        }
        if from_email:
            headers["From"] = from_email
        return self._request_json(method, f"{self._base_url}{path}", params=params, json_body=json_body, headers=headers)

    def _events_request_json(self, path: str, *, json_body: dict[str, Any]) -> dict[str, Any]:
        headers = {"Accept": "application/json"}
        return self._request_json("POST", f"{self._events_base_url}{path}", json_body=json_body, headers=headers)

    def list_incidents(
        self,
        *,
        limit: int = 25,
        statuses: list[str] | None = None,
        service_id: str | None = None,
    ) -> dict[str, Any]:
        params: dict[str, Any] = {"limit": max(1, min(limit, 100))}
        if statuses:
            params["statuses[]"] = statuses
        if service_id:
            params["service_ids[]"] = [service_id]
        raw = self._rest_request_json("GET", "/incidents", params=params)
        incidents = [_normalize_incident(item) for item in _list_or_empty(raw.get("incidents"))]
        return {
            "items": incidents,
            "raw": raw,
            "count": len(incidents),
            "more": bool(raw.get("more")),
            "limit": raw.get("limit", params["limit"]),
            "offset": raw.get("offset", 0),
            "total": raw.get("total"),
        }

    def create_incident(
        self,
        *,
        from_email: str,
        service_id: str,
        title: str,
        description: str | None = None,
        urgency: str | None = None,
        escalation_policy_id: str | None = None,
    ) -> dict[str, Any]:
        incident = {
            "type": "incident",
            "title": title,
            "service": {"id": service_id, "type": "service_reference"},
        }
        if urgency:
            incident["urgency"] = urgency
        if description:
            incident["body"] = {"type": "incident_body", "details": description}
        if escalation_policy_id:
            incident["escalation_policy"] = {"id": escalation_policy_id, "type": "escalation_policy_reference"}
        raw = self._rest_request_json("POST", "/incidents", json_body={"incident": incident}, from_email=from_email)
        created = raw.get("incident") if isinstance(raw.get("incident"), dict) else raw
        return _normalize_incident(_dict_or_empty(created))

    def get_incident(self, incident_id: str) -> dict[str, Any]:
        raw = self._rest_request_json("GET", f"/incidents/{incident_id}")
        incident = raw.get("incident") if isinstance(raw.get("incident"), dict) else raw
        return _normalize_incident(_dict_or_empty(incident))

    def manage_incident(
        self,
        incident_id: str,
        *,
        from_email: str,
        status: str,
        resolution: str | None = None,
    ) -> dict[str, Any]:
        incident: dict[str, Any] = {"id": incident_id, "type": "incident", "status": status}
        if resolution and status == "resolved":
            incident["resolution"] = resolution
        raw = self._rest_request_json(
            "PUT",
            "/incidents",
            json_body={"incidents": [incident]},
            from_email=from_email,
        )
        incidents = _list_or_empty(raw.get("incidents"))
        if incidents:
            return _normalize_incident(incidents[0])
        return _normalize_incident(_dict_or_empty(raw.get("incident")))

    def list_services(self, *, limit: int = 25) -> dict[str, Any]:
        raw = self._rest_request_json("GET", "/services", params={"limit": max(1, min(limit, 100))})
        services = [_normalize_service(item) for item in _list_or_empty(raw.get("services"))]
        return {
            "items": services,
            "raw": raw,
            "count": len(services),
            "more": bool(raw.get("more")),
            "limit": raw.get("limit", limit),
            "offset": raw.get("offset", 0),
            "total": raw.get("total"),
        }

    def get_service(self, service_id: str) -> dict[str, Any]:
        raw = self._rest_request_json("GET", f"/services/{service_id}")
        service = raw.get("service") if isinstance(raw.get("service"), dict) else raw
        return _normalize_service(_dict_or_empty(service))

    def list_escalation_policies(self, *, limit: int = 25) -> dict[str, Any]:
        raw = self._rest_request_json("GET", "/escalation_policies", params={"limit": max(1, min(limit, 100))})
        policies = [_normalize_escalation_policy(item) for item in _list_or_empty(raw.get("escalation_policies"))]
        return {
            "items": policies,
            "raw": raw,
            "count": len(policies),
            "more": bool(raw.get("more")),
            "limit": raw.get("limit", limit),
            "offset": raw.get("offset", 0),
            "total": raw.get("total"),
        }

    def list_on_calls(self, *, limit: int = 25, escalation_policy_id: str | None = None) -> dict[str, Any]:
        params: dict[str, Any] = {"limit": max(1, min(limit, 100))}
        if escalation_policy_id:
            params["escalation_policy_ids[]"] = [escalation_policy_id]
        raw = self._rest_request_json("GET", "/oncalls", params=params)
        on_calls = [_normalize_on_call(item) for item in _list_or_empty(raw.get("oncalls"))]
        return {
            "items": on_calls,
            "raw": raw,
            "count": len(on_calls),
            "more": bool(raw.get("more")),
            "limit": raw.get("limit", limit),
            "offset": raw.get("offset", 0),
            "total": raw.get("total"),
        }

    def list_alerts(self, *, limit: int = 25, incident_id: str | None = None) -> dict[str, Any]:
        if incident_id:
            path = f"/incidents/{incident_id}/alerts"
            params = {"limit": max(1, min(limit, 100))}
        else:
            path = "/alerts"
            params = {"limit": max(1, min(limit, 100))}
        raw = self._rest_request_json("GET", path, params=params)
        alerts = [_normalize_alert(item) for item in _list_or_empty(raw.get("alerts"))]
        return {
            "items": alerts,
            "raw": raw,
            "count": len(alerts),
            "more": bool(raw.get("more")),
            "limit": raw.get("limit", limit),
            "offset": raw.get("offset", 0),
            "total": raw.get("total"),
        }

    def create_change_event(
        self,
        *,
        summary: str,
        source: str,
        description: str | None = None,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {"routing_key": self._events_routing_key, "payload": {"summary": summary, "source": source}}
        if description:
            payload["payload"]["custom_details"] = {"description": description}
        return self._events_request_json("/change/enqueue", json_body=payload)
