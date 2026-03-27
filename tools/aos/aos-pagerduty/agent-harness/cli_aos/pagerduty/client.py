from __future__ import annotations

import base64
import json
from dataclasses import dataclass
from typing import Any
from urllib import error, parse, request

from .constants import BACKEND_NAME, DEFAULT_API_BASE_URL

API_TIMEOUT_SECONDS = 20
USER_AGENT = "aos-pagerduty/0.1.0"
PAGERDUTY_MEDIA_TYPE = "application/vnd.pagerduty+json;version=2"


@dataclass(slots=True)
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


def _load_json(payload: bytes) -> Any:
    if not payload:
        return {}
    text = payload.decode("utf-8")
    if not text.strip():
        return {}
    return json.loads(text)


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
    def __init__(self, *, api_key: str, base_url: str = DEFAULT_API_BASE_URL) -> None:
        self._api_key = api_key.strip()
        self._base_url = base_url.rstrip("/")

    def _request_json(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        json_body: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        url = f"{self._base_url}{path}"
        if params:
            url = f"{url}?{parse.urlencode(_clean_dict(params), doseq=True)}"
        payload: bytes | None = None
        headers: dict[str, str] = {
            "Authorization": f"Bearer {self._api_key}",
            "Accept": PAGERDUTY_MEDIA_TYPE,
            "User-Agent": USER_AGENT,
        }
        if json_body is not None:
            payload = json.dumps(json_body).encode("utf-8")
            headers["Content-Type"] = PAGERDUTY_MEDIA_TYPE
        req = request.Request(url, data=payload, method=method.upper(), headers=headers)
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
                payload = json.loads(body) if body else {}
            except json.JSONDecodeError:
                payload = {}
            if isinstance(payload, dict) and payload:
                details["response"] = payload
                error_payload = payload.get("error")
                if isinstance(error_payload, dict):
                    message = str(error_payload.get("message") or error_payload.get("code") or message)
                elif error_payload:
                    message = str(error_payload)
                else:
                    message = str(payload.get("message") or message)
            if exc.code in {401, 403}:
                code = "PAGERDUTY_AUTH_ERROR"
                exit_code = 4
            elif exc.code == 404:
                code = "NOT_FOUND"
                exit_code = 6
            elif exc.code == 429:
                code = "RATE_LIMITED"
                exit_code = 5
            else:
                code = "PAGERDUTY_API_ERROR"
                exit_code = 5
            raise PagerDutyApiError(
                status_code=exc.code,
                code=code,
                message=message,
                details=details,
            ) from exc
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
            payload = json.loads(body)
        except json.JSONDecodeError as exc:
            raise PagerDutyApiError(
                status_code=None,
                code="PAGERDUTY_BAD_JSON",
                message="PagerDuty returned invalid JSON",
                details={"url": url, "body": body[:2000]},
            ) from exc
        return _dict_or_empty(payload)

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
        raw = self._request_json("GET", "/incidents", params=params)
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

    def get_incident(self, incident_id: str) -> dict[str, Any]:
        raw = self._request_json("GET", f"/incidents/{incident_id}")
        incident = raw.get("incident") if isinstance(raw.get("incident"), dict) else raw
        return _normalize_incident(_dict_or_empty(incident))

    def list_services(self, *, limit: int = 25) -> dict[str, Any]:
        raw = self._request_json("GET", "/services", params={"limit": max(1, min(limit, 100))})
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
        raw = self._request_json("GET", f"/services/{service_id}")
        service = raw.get("service") if isinstance(raw.get("service"), dict) else raw
        return _normalize_service(_dict_or_empty(service))

    def list_escalation_policies(self, *, limit: int = 25) -> dict[str, Any]:
        raw = self._request_json("GET", "/escalation_policies", params={"limit": max(1, min(limit, 100))})
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
        raw = self._request_json("GET", "/oncalls", params=params)
        oncalls = [_normalize_on_call(item) for item in _list_or_empty(raw.get("oncalls"))]
        return {
            "items": oncalls,
            "raw": raw,
            "count": len(oncalls),
            "more": bool(raw.get("more")),
            "limit": raw.get("limit", limit),
            "offset": raw.get("offset", 0),
            "total": raw.get("total"),
        }

    def list_alerts(self, *, limit: int = 25, incident_id: str | None = None) -> dict[str, Any]:
        if incident_id:
            raw = self._request_json("GET", f"/incidents/{incident_id}/alerts", params={"limit": max(1, min(limit, 100))})
            alerts = [_normalize_alert(item) for item in _list_or_empty(raw.get("alerts"))]
        else:
            raw = self._request_json("GET", "/alerts", params={"limit": max(1, min(limit, 100))})
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
