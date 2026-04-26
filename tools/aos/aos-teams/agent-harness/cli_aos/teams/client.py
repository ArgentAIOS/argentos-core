from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib import error, parse, request


@dataclass(slots=True)
class GraphApiError(Exception):
    status_code: int | None
    code: str
    message: str
    details: dict[str, Any] | None = None


def _json_loads(payload: bytes) -> Any:
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


def _compact(value: Any) -> str | None:
    text = str(value or "").strip()
    return text or None


def _team_preview(raw: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": raw.get("id"),
        "label": _compact(raw.get("displayName")) or _compact(raw.get("id")) or "(unnamed team)",
        "subtitle": _compact(raw.get("description")) or _compact(raw.get("visibility")),
        "url": _compact(raw.get("webUrl")),
        "raw": raw,
    }


def _channel_preview(raw: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": raw.get("id"),
        "label": _compact(raw.get("displayName")) or _compact(raw.get("id")) or "(unnamed channel)",
        "subtitle": _compact(raw.get("membershipType")),
        "url": _compact(raw.get("webUrl")),
        "raw": raw,
    }


def _meeting_preview(raw: dict[str, Any]) -> dict[str, Any]:
    start = raw.get("start") if isinstance(raw.get("start"), dict) else {}
    end = raw.get("end") if isinstance(raw.get("end"), dict) else {}
    if not start and raw.get("startDateTime"):
        start = {"dateTime": raw.get("startDateTime")}
    if not end and raw.get("endDateTime"):
        end = {"dateTime": raw.get("endDateTime")}
    return {
        "id": raw.get("id"),
        "label": _compact(raw.get("subject")) or _compact(raw.get("id")) or "(no subject)",
        "subtitle": _compact(raw.get("location", {}).get("displayName") if isinstance(raw.get("location"), dict) else None),
        "start": start,
        "end": end,
        "url": _compact(raw.get("webLink")) or _compact(raw.get("joinWebUrl")),
        "raw": raw,
    }


class TeamsClient:
    def __init__(
        self,
        *,
        tenant_id: str,
        client_id: str,
        client_secret: str,
        graph_base_url: str = "https://graph.microsoft.com/v1.0",
        timeout_seconds: float = 20.0,
        token_url: str | None = None,
    ) -> None:
        self._tenant_id = tenant_id.strip()
        self._client_id = client_id.strip()
        self._client_secret = client_secret.strip()
        self._graph_base_url = graph_base_url.rstrip("/")
        self._timeout_seconds = timeout_seconds
        self._token_url = token_url or f"https://login.microsoftonline.com/{self._tenant_id}/oauth2/v2.0/token"

    def _request(
        self,
        method: str,
        url: str,
        *,
        headers: dict[str, str] | None = None,
        query: dict[str, Any] | None = None,
        payload: dict[str, Any] | None = None,
        form_encoded: bool = False,
    ) -> Any:
        if query:
            parts = [(key, str(value)) for key, value in query.items() if value is not None]
            if parts:
                url = f"{url}?{parse.urlencode(parts, doseq=True)}"
        request_headers = {"Accept": "application/json"}
        if headers:
            request_headers.update(headers)
        body: bytes | None = None
        if payload is not None:
            if form_encoded:
                body = parse.urlencode(payload).encode("utf-8")
                request_headers["Content-Type"] = "application/x-www-form-urlencoded"
            else:
                body = json.dumps(payload).encode("utf-8")
                request_headers["Content-Type"] = "application/json"
        req = request.Request(url, data=body, headers=request_headers, method=method.upper())
        try:
            with request.urlopen(req, timeout=self._timeout_seconds) as resp:
                raw = resp.read()
        except error.HTTPError as exc:
            body_text = exc.read().decode("utf-8", "replace") if hasattr(exc, "read") else ""
            details: dict[str, Any] = {"url": url, "status": exc.code}
            if body_text:
                details["body"] = body_text[:2000]
                try:
                    details["response"] = json.loads(body_text)
                except json.JSONDecodeError:
                    pass
            code = "GRAPH_HTTP_ERROR"
            message = f"Graph request failed with HTTP {exc.code}"
            if exc.code in {401, 403}:
                code = "TEAMS_AUTH_ERROR"
                message = "Microsoft Graph authentication or authorization failed."
            raise GraphApiError(exc.code, code, message, details) from exc
        except error.URLError as exc:
            raise GraphApiError(None, "GRAPH_UNREACHABLE", f"Unable to reach Microsoft Graph: {exc.reason}", {"url": url}) from exc
        return _json_loads(raw)

    def _graph(self, method: str, path: str, *, query: dict[str, Any] | None = None, payload: dict[str, Any] | None = None) -> Any:
        token = self._get_access_token()
        return self._request(
            method,
            f"{self._graph_base_url}/{path.lstrip('/')}",
            headers={"Authorization": f"Bearer {token}"},
            query=query,
            payload=payload,
        )

    def _get_access_token(self) -> str:
        payload = {
            "client_id": self._client_id,
            "client_secret": self._client_secret,
            "grant_type": "client_credentials",
            "scope": "https://graph.microsoft.com/.default",
        }
        token_payload = self._request("POST", self._token_url, payload=payload, form_encoded=True)
        token = token_payload.get("access_token")
        if not token:
            raise GraphApiError(None, "GRAPH_TOKEN_MISSING", "Microsoft Graph token response did not include an access token.", {"response": token_payload})
        return str(token)

    def list_teams(self, *, limit: int = 20) -> dict[str, Any]:
        payload = self._graph(
            "GET",
            "/groups",
            query={
                "$top": max(1, min(limit, 50)),
                "$select": "id,displayName,description,visibility,mailNickname,webUrl",
                "$filter": "resourceProvisioningOptions/Any(x:x eq 'Team')",
            },
        )
        items = [_team_preview(item) for item in _list_or_empty(payload.get("value")) if isinstance(item, dict)]
        return {"items": items, "count": len(items), "raw": payload}

    def list_channels(self, *, team_id: str, limit: int = 20) -> dict[str, Any]:
        payload = self._graph(
            "GET",
            f"/teams/{parse.quote(team_id, safe='')}/channels",
            query={
                "$top": max(1, min(limit, 50)),
                "$select": "id,displayName,description,membershipType,webUrl",
            },
        )
        items = [_channel_preview(item) for item in _list_or_empty(payload.get("value")) if isinstance(item, dict)]
        return {"items": items, "count": len(items), "raw": payload}

    def list_meetings(self, *, user_id: str, limit: int = 10) -> dict[str, Any]:
        payload = self._graph(
            "GET",
            f"/users/{parse.quote(user_id, safe='')}/events",
            query={
                "$top": max(1, min(limit, 50)),
                "$select": "id,subject,start,end,location,isOnlineMeeting,webLink",
                "$filter": "isOnlineMeeting eq true",
                "$orderby": "start/dateTime desc",
            },
        )
        items = [_meeting_preview(item) for item in _list_or_empty(payload.get("value")) if isinstance(item, dict)]
        return {"items": items, "count": len(items), "raw": payload}

    def create_channel(self, *, team_id: str, display_name: str, description: str | None = None) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "displayName": display_name,
            "membershipType": "standard",
        }
        if description:
            payload["description"] = description
        return self._graph("POST", f"/teams/{parse.quote(team_id, safe='')}/channels", payload=payload)

    def create_online_meeting(
        self,
        *,
        user_id: str,
        subject: str,
        start_iso: str,
        end_iso: str,
    ) -> dict[str, Any]:
        return self._graph(
            "POST",
            f"/users/{parse.quote(user_id, safe='')}/onlineMeetings",
            payload={
                "subject": subject,
                "startDateTime": start_iso,
                "endDateTime": end_iso,
            },
        )
