from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any
from urllib import error, parse, request

from .errors import ConnectorError

DEFAULT_TIMEOUT_SECONDS = 10.0
API_KEY_HEADER = "X-MAKE-API-KEY"
ACCEPT_HEADER = "application/json"
CONTENT_TYPE_HEADER = "application/json"
USER_AGENT = "aos-make/0.1.0"


@dataclass(slots=True)
class MakeApiError(Exception):
    code: str
    message: str
    exit_code: int
    details: dict[str, Any] | None = None


def _present(value: str | None) -> bool:
    return bool(value and value.strip())


def _redact(value: str | None) -> str | None:
    if value is None:
        return None
    stripped = value.strip()
    if not stripped:
        return None
    if len(stripped) <= 6:
        return "***"
    return f"{stripped[:3]}...{stripped[-3:]}"


def _normalize_base_url(base_url: str) -> str:
    stripped = base_url.strip().rstrip("/")
    if not stripped:
        raise MakeApiError(
            code="MAKE_SETUP_REQUIRED",
            message="Make API URL is missing.",
            exit_code=2,
            details={"missing_keys": ["MAKE_API_URL"]},
        )
    parts = parse.urlsplit(stripped)
    if not parts.scheme or not parts.netloc:
        raise MakeApiError(
            code="MAKE_INVALID_URL",
            message="MAKE_API_URL must include a scheme and host, for example https://make.example.com.",
            exit_code=2,
            details={"api_url": stripped},
        )
    normalized_path = parts.path.rstrip("/")
    return parse.urlunsplit((parts.scheme, parts.netloc, normalized_path, parts.query, parts.fragment))


def _normalize_webhook_base_url(webhook_url: str) -> str:
    stripped = webhook_url.strip().rstrip("/")
    if not stripped:
        raise MakeApiError(
            code="MAKE_SETUP_REQUIRED",
            message="Make webhook base URL is missing.",
            exit_code=2,
            details={"missing_keys": ["MAKE_WEBHOOK_BASE_URL"]},
        )
    parts = parse.urlsplit(stripped)
    if not parts.scheme or not parts.netloc:
        raise MakeApiError(
            code="MAKE_INVALID_URL",
            message="MAKE_WEBHOOK_BASE_URL must include a scheme and host, for example https://hooks.example.com.",
            exit_code=2,
            details={"webhook_base_url": stripped},
        )
    return parse.urlunsplit((parts.scheme, parts.netloc, parts.path.rstrip("/"), parts.query, parts.fragment))


def _as_text(body: bytes | None) -> str:
    if not body:
        return ""
    return body.decode("utf-8", errors="replace")


def _decode_response(body: bytes | None) -> Any:
    text = _as_text(body)
    if not text.strip():
        return {}
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return text


def _response_kind(response: Any) -> str:
    if response in ({}, [], None, ""):
        return "empty"
    if isinstance(response, (dict, list)):
        return "json"
    if isinstance(response, str):
        return "text"
    return type(response).__name__


def _extract_execution_id(response: Any) -> str | None:
    if not isinstance(response, dict):
        return None
    for key in ("executionId", "execution_id", "executionID", "id", "run_id"):
        value = response.get(key)
        if value is not None and str(value).strip():
            return str(value).strip()
    return None


def _extract_response_status(response: Any) -> str | None:
    if not isinstance(response, dict):
        return None
    for key in ("status", "state", "result", "message"):
        value = response.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def _summarize_trigger_response(status_code: int, response: Any) -> dict[str, Any]:
    execution_id = _extract_execution_id(response)
    response_status = _extract_response_status(response)
    if execution_id and response_status:
        summary = f"Triggered execution {execution_id} ({response_status})."
    elif execution_id:
        summary = f"Triggered execution {execution_id}."
    elif response_status:
        summary = f"Triggered execution ({response_status})."
    else:
        summary = f"Triggered execution (HTTP {status_code})."
    return {
        "ok": 200 <= status_code < 300,
        "status_code": status_code,
        "response_kind": _response_kind(response),
        "execution_id": execution_id,
        "response_status": response_status,
        "summary": summary,
    }


def _http_request(
    url: str,
    *,
    method: str,
    headers: dict[str, str],
    body: bytes | None = None,
    timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS,
) -> tuple[int, Any]:
    req = request.Request(url, headers=headers, data=body, method=method)
    try:
        with request.urlopen(req, timeout=timeout_seconds) as response:
            return response.getcode(), _decode_response(response.read())
    except error.HTTPError as exc:
        body_text = _as_text(exc.read())
        details = {
            "url": url,
            "status": exc.code,
            "reason": exc.reason,
            "response": body_text[:500] if body_text else None,
        }
        code = "MAKE_API_ERROR"
        if exc.code in {401, 403}:
            code = "MAKE_AUTH_FAILED"
        elif exc.code == 404:
            code = "NOT_FOUND"
        elif exc.code == 429:
            code = "MAKE_RATE_LIMITED"
        raise MakeApiError(code, f"Make request failed with HTTP {exc.code}.", 5, details=details) from exc
    except error.URLError as exc:
        raise MakeApiError(
            "MAKE_UNREACHABLE",
            "Unable to reach the configured Make endpoint.",
            5,
            details={"url": url, "reason": str(exc.reason)},
        ) from exc


def _extract_items(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]
    if not isinstance(payload, dict):
        return []
    for key in ("data", "organizations", "teams", "scenarios", "connections", "executions", "runs", "items", "results"):
        value = payload.get(key)
        if isinstance(value, list):
            return [item for item in value if isinstance(item, dict)]
        if isinstance(value, dict):
            nested = value.get("data")
            if isinstance(nested, list):
                return [item for item in nested if isinstance(item, dict)]
    return []


def _extract_record(payload: Any, *keys: str) -> dict[str, Any] | None:
    if isinstance(payload, dict):
        for key in keys:
            value = payload.get(key)
            if isinstance(value, dict):
                return value
        if any(k in payload for k in ("id", "name", "status", "title")):
            return payload
        data = payload.get("data")
        if isinstance(data, dict):
            return _extract_record(data, *keys) or data
    return None


def _normalize_base_query(values: dict[str, Any] | None) -> dict[str, Any]:
    cleaned: dict[str, Any] = {}
    if not values:
        return cleaned
    for key, value in values.items():
        if value is None:
            continue
        if isinstance(value, str) and not value.strip():
            continue
        cleaned[key] = value
    return cleaned


@dataclass(slots=True)
class MakeBridgeClient:
    runtime: dict[str, Any]
    timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS

    @classmethod
    def from_runtime(cls, runtime: dict[str, Any]) -> "MakeBridgeClient":
        return cls(runtime)

    @property
    def api_base_url(self) -> str:
        api_url = self.runtime.get("api_url")
        if not isinstance(api_url, str) or not api_url.strip():
            raise MakeApiError(
                code="MAKE_SETUP_REQUIRED",
                message="Make API URL is missing.",
                exit_code=2,
                details={"missing_keys": [self.runtime.get("api_url_env") or "MAKE_API_URL"]},
            )
        return _normalize_base_url(api_url)

    @property
    def api_key(self) -> str:
        api_key = self.runtime.get("api_key")
        if not isinstance(api_key, str) or not api_key.strip():
            raise MakeApiError(
                code="MAKE_SETUP_REQUIRED",
                message="Make API key is missing.",
                exit_code=2,
                details={"missing_keys": [self.runtime.get("api_key_env") or "MAKE_API_KEY"]},
            )
        return api_key.strip()

    @property
    def webhook_base_url(self) -> str | None:
        webhook_base_url = self.runtime.get("webhook_base_url")
        if not isinstance(webhook_base_url, str) or not webhook_base_url.strip():
            return None
        return _normalize_webhook_base_url(webhook_base_url)

    def _headers(self) -> dict[str, str]:
        headers = {
            "Accept": ACCEPT_HEADER,
            "Authorization": f"Bearer {self.api_key}",
            API_KEY_HEADER: self.api_key,
            "User-Agent": USER_AGENT,
        }
        if self.webhook_base_url:
            headers["X-Webhook-Base-Url"] = self.webhook_base_url
        return headers

    def _build_url(self, path: str, query: dict[str, Any] | None = None) -> str:
        base_parts = parse.urlsplit(self.api_base_url)
        base_path = base_parts.path.rstrip("/")
        normalized_path = path if path.startswith("/") else f"/{path}"
        if base_path and normalized_path.startswith(base_path):
            final_path = normalized_path
        else:
            final_path = f"{base_path}{normalized_path}" if base_path else normalized_path
        url = parse.urlunsplit(
            (base_parts.scheme, base_parts.netloc, final_path, base_parts.query, base_parts.fragment),
        )
        cleaned_query = _normalize_base_query(query)
        if cleaned_query:
            url = f"{url}?{parse.urlencode(cleaned_query, doseq=True)}"
        return url

    def _request_raw(
        self,
        method: str,
        path: str,
        *,
        query: dict[str, Any] | None = None,
        body: Any | None = None,
    ) -> dict[str, Any]:
        url = self._build_url(path, query=query)
        headers = self._headers()
        data: bytes | None = None
        if body is not None:
            headers["Content-Type"] = CONTENT_TYPE_HEADER
            data = json.dumps(body, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
        req = request.Request(url, data=data, method=method.upper(), headers=headers)
        try:
            with request.urlopen(req, timeout=self.timeout_seconds) as response:
                charset = response.headers.get_content_charset("utf-8")
                body_text = response.read().decode(charset or "utf-8")
                return {
                    "status": getattr(response, "status", 200),
                    "headers": response.headers,
                    "body": body_text,
                    "url": url,
                }
        except error.HTTPError as exc:
            charset = exc.headers.get_content_charset("utf-8") if exc.headers else "utf-8"
            body_text = exc.read().decode(charset or "utf-8", errors="replace")
            details: dict[str, Any] = {"status": exc.code, "url": url}
            payload = _decode_response(body_text.encode("utf-8")) if body_text else {}
            if payload:
                details["response"] = payload
            if exc.code in {401, 403}:
                code = "MAKE_AUTH_ERROR"
                exit_code = 4
                message = "Configured Make bridge rejected the API key"
            elif exc.code == 404:
                code = "NOT_FOUND"
                exit_code = 6
                message = f"Configured Make bridge endpoint was not found: {path}"
            elif exc.code == 429:
                code = "MAKE_RATE_LIMITED"
                exit_code = 5
                message = "Configured Make bridge rate limited the request"
            else:
                code = "MAKE_API_ERROR"
                exit_code = 5
                message = f"Configured Make bridge returned HTTP {exc.code}"
            raise MakeApiError(code=code, message=message, exit_code=exit_code, details=details) from exc
        except error.URLError as exc:
            raise MakeApiError(
                code="MAKE_BACKEND_UNAVAILABLE",
                message="Failed to reach the configured Make bridge",
                exit_code=5,
                details={"reason": str(exc.reason), "url": url},
            ) from exc

    def _request_json(self, method: str, path: str, *, query: dict[str, Any] | None = None, body: Any | None = None) -> Any:
        result = self._request_raw(method, path, query=query, body=body)
        return _decode_response(str(result["body"]).encode("utf-8"))

    def probe(self) -> dict[str, Any]:
        attempts: list[tuple[str, dict[str, Any] | None]] = [
            ("/health", None),
            ("/api/health", None),
            ("/api/v1/organizations", {"limit": 1}),
        ]
        last_not_found: MakeApiError | None = None
        for path, query in attempts:
            try:
                payload = self._request_json("GET", path, query=query)
                return {"endpoint": path, "payload": payload}
            except MakeApiError as err:
                if err.code == "NOT_FOUND":
                    last_not_found = err
                    continue
                raise
        raise MakeApiError(
            code="MAKE_PROBE_FAILED",
            message="Configured Make bridge did not expose a live read endpoint",
            exit_code=5,
            details={"attempts": [path for path, _ in attempts], "last_error": last_not_found.details if last_not_found else None},
        )

    def probe_trigger(self, scenario_id: str | None = None) -> dict[str, Any]:
        attempts: list[str] = []
        if scenario_id:
            attempts.extend([
                f"/api/v1/scenarios/{parse.quote(scenario_id, safe='')}/execute",
                f"/api/v1/scenarios/{parse.quote(scenario_id, safe='')}/trigger",
            ])
        attempts.append("/api/v1/executions/run")
        last_not_found: MakeApiError | None = None
        for path in attempts:
            try:
                result = self._request_raw("OPTIONS", path)
                headers = result.get("headers")
                allow = headers.get("Allow") if headers else None
                return {"endpoint": path, "available": True, "method": "OPTIONS", "allow": allow}
            except MakeApiError as err:
                if err.code == "NOT_FOUND":
                    last_not_found = err
                    continue
                if err.code == "MAKE_API_ERROR" and err.details and err.details.get("status") == 405:
                    headers = err.details.get("response") if isinstance(err.details.get("response"), dict) else None
                    allow = headers.get("Allow") if isinstance(headers, dict) else None
                    if allow and "POST" in {part.strip().upper() for part in str(allow).split(",") if part.strip()}:
                        return {"endpoint": path, "available": True, "method": "OPTIONS", "allow": allow}
                raise
        raise MakeApiError(
            code="MAKE_TRIGGER_ENDPOINT_NOT_FOUND",
            message="Configured Make bridge did not expose a trigger endpoint",
            exit_code=5,
            details={"attempts": attempts, "last_error": last_not_found.details if last_not_found else None},
        )

    def list_organizations(self, *, limit: int) -> Any:
        return self._request_json("GET", "/api/v1/organizations", query={"limit": max(limit, 1)})

    def list_teams(self, *, limit: int, organization_id: str | None = None, organization_name: str | None = None) -> Any:
        return self._request_json(
            "GET",
            "/api/v1/teams",
            query={"limit": max(limit, 1), "organization_id": organization_id, "organization_name": organization_name},
        )

    def list_scenarios(
        self,
        *,
        limit: int,
        status: str | None = None,
        organization_id: str | None = None,
        organization_name: str | None = None,
        team_id: str | None = None,
        team_name: str | None = None,
    ) -> Any:
        return self._request_json(
            "GET",
            "/api/v1/scenarios",
            query={
                "limit": max(limit, 1),
                "status": status,
                "organization_id": organization_id,
                "organization_name": organization_name,
                "team_id": team_id,
                "team_name": team_name,
            },
        )

    def get_scenario(self, scenario_id: str) -> Any:
        return self._request_json("GET", f"/api/v1/scenarios/{parse.quote(scenario_id, safe='')}")

    def list_connections(
        self,
        *,
        limit: int,
        organization_id: str | None = None,
        organization_name: str | None = None,
    ) -> Any:
        return self._request_json(
            "GET",
            "/api/v1/connections",
            query={"limit": max(limit, 1), "organization_id": organization_id, "organization_name": organization_name},
        )

    def list_executions(
        self,
        *,
        limit: int,
        scenario_id: str | None = None,
        status: str | None = None,
    ) -> Any:
        return self._request_json(
            "GET",
            "/api/v1/executions",
            query={"limit": max(limit, 1), "scenario_id": scenario_id, "status": status},
        )

    def get_execution(self, execution_id: str) -> Any:
        return self._request_json("GET", f"/api/v1/executions/{parse.quote(execution_id, safe='')}")

    def trigger_scenario(
        self,
        scenario_id: str | None,
        *,
        event: str,
        payload: dict[str, Any] | None,
        organization_name: str | None = None,
        team_name: str | None = None,
        connection_id: str | None = None,
    ) -> Any:
        body = {
            "event": event,
            "payload": payload or {},
            "scenario_id": scenario_id,
            "organization_name": organization_name,
            "team_name": team_name,
            "connection_id": connection_id,
            "trigger_url_redacted": _redact(self.runtime.get("webhook_base_url")),
        }
        if scenario_id:
            path = f"/api/v1/scenarios/{parse.quote(scenario_id, safe='')}/execute"
        else:
            path = "/api/v1/executions/run"
        return self._request_json("POST", path, body=body)
