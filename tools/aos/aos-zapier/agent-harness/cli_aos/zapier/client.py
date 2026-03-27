from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any
from urllib import error, parse, request

from .config import resolve_runtime_values

API_TIMEOUT_SECONDS = 20
USER_AGENT = "aos-zapier/0.1.0"


@dataclass
class ZapierApiError(Exception):
    code: str
    message: str
    exit_code: int
    details: dict[str, Any] | None = None


def _clean_query(values: dict[str, Any] | None) -> dict[str, Any]:
    if not values:
        return {}
    cleaned: dict[str, Any] = {}
    for key, value in values.items():
        if value is None:
            continue
        if isinstance(value, str) and not value.strip():
            continue
        cleaned[key] = value
    return cleaned


def _normalize_base_url(base_url: str) -> str:
    normalized = base_url.strip().rstrip("/")
    if not normalized:
        raise ValueError("base_url must not be empty")
    return normalized


def _parse_json(body: str, *, url: str) -> Any:
    if not body.strip():
        return {}
    try:
        return json.loads(body)
    except json.JSONDecodeError as exc:
        raise ZapierApiError(
            code="ZAPIER_BAD_JSON",
            message="Configured Zapier bridge returned invalid JSON",
            exit_code=5,
            details={"url": url, "body": body[:2000]},
        ) from exc


def _allow_post(headers: Any) -> bool:
    if not headers:
        return False
    allow = headers.get("Allow") if hasattr(headers, "get") else None
    if not allow:
        return False
    return "POST" in {part.strip().upper() for part in str(allow).split(",") if part.strip()}


class ZapierBridgeClient:
    def __init__(self, base_url: str, api_key: str, *, webhook_base_url: str | None = None):
        self.base_url = _normalize_base_url(base_url)
        self.api_key = api_key.strip()
        self.webhook_base_url = webhook_base_url.strip() if webhook_base_url and webhook_base_url.strip() else None

    @classmethod
    def from_ctx(cls, ctx_obj: dict[str, Any]) -> "ZapierBridgeClient":
        runtime = resolve_runtime_values(ctx_obj)
        missing = []
        if not runtime["api_url_present"]:
            missing.append(runtime["api_url_env"])
        if not runtime["api_key_present"]:
            missing.append(runtime["api_key_env"])
        if missing:
            raise ZapierApiError(
                code="ZAPIER_SETUP_REQUIRED",
                message="Zapier bridge configuration is incomplete",
                exit_code=4,
                details={
                    "missing_keys": missing,
                    "api_url_env": runtime["api_url_env"],
                    "api_key_env": runtime["api_key_env"],
                    "live_backend_available": False,
                    "live_read_available": False,
                    "write_bridge_available": False,
                },
            )
        api_url = str(runtime["api_url"])
        parsed = parse.urlparse(api_url)
        if not parsed.scheme or not parsed.netloc:
            raise ZapierApiError(
                code="ZAPIER_SETUP_REQUIRED",
                message="ZAPIER_API_URL must be an absolute URL",
                exit_code=4,
                details={
                    "api_url_env": runtime["api_url_env"],
                    "api_url": api_url,
                    "live_backend_available": False,
                    "live_read_available": False,
                    "write_bridge_available": False,
                },
            )
        return cls(
            api_url,
            str(runtime["api_key"]),
            webhook_base_url=str(runtime["webhook_base_url"]) if runtime["webhook_base_url"] else None,
        )

    def _headers(self) -> dict[str, str]:
        headers = {
            "Accept": "application/json",
            "Authorization": f"Bearer {self.api_key}",
            "User-Agent": USER_AGENT,
            "X-API-Key": self.api_key,
        }
        if self.webhook_base_url:
            headers["X-Webhook-Base-Url"] = self.webhook_base_url
        return headers

    def _build_url(self, path: str, query: dict[str, Any] | None = None) -> str:
        normalized_path = path if path.startswith("/") else f"/{path}"
        url = f"{self.base_url}{normalized_path}"
        cleaned_query = _clean_query(query)
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
            headers["Content-Type"] = "application/json"
            data = json.dumps(body, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
        req = request.Request(url, data=data, method=method.upper(), headers=headers)
        try:
            with request.urlopen(req, timeout=API_TIMEOUT_SECONDS) as response:
                charset = response.headers.get_content_charset("utf-8")
                body = response.read().decode(charset or "utf-8")
                return {
                    "status": getattr(response, "status", 200),
                    "headers": response.headers,
                    "body": body,
                    "url": url,
                }
        except error.HTTPError as exc:
            charset = exc.headers.get_content_charset("utf-8") if exc.headers else "utf-8"
            body = exc.read().decode(charset or "utf-8", errors="replace")
            details: dict[str, Any] = {"status": exc.code, "url": url}
            payload = _parse_json(body, url=url) if body else {}
            if payload:
                details["response"] = payload

            if exc.code in {401, 403}:
                code = "ZAPIER_AUTH_ERROR"
                exit_code = 4
                message = "Configured Zapier bridge rejected the API key"
            elif exc.code == 404:
                code = "NOT_FOUND"
                exit_code = 6
                message = f"Configured Zapier bridge endpoint was not found: {path}"
            elif exc.code == 429:
                code = "ZAPIER_RATE_LIMITED"
                exit_code = 5
                message = "Configured Zapier bridge rate limited the request"
            else:
                code = "ZAPIER_API_ERROR"
                exit_code = 5
                message = f"Configured Zapier bridge returned HTTP {exc.code}"

            if payload and isinstance(payload, dict):
                error_payload = payload.get("error")
                if isinstance(error_payload, dict):
                    message = str(error_payload.get("message") or error_payload.get("type") or message)
                elif error_payload:
                    message = str(error_payload)
                elif payload.get("message"):
                    message = str(payload.get("message"))

            if method.upper() in {"HEAD", "OPTIONS"} and exc.code in {405} and exc.headers and _allow_post(exc.headers):
                return {
                    "status": exc.code,
                    "headers": exc.headers,
                    "body": body,
                    "url": url,
                }

            raise ZapierApiError(code=code, message=message, exit_code=exit_code, details=details) from exc
        except error.URLError as exc:
            raise ZapierApiError(
                code="ZAPIER_BACKEND_UNAVAILABLE",
                message="Failed to reach the configured Zapier bridge",
                exit_code=5,
                details={"reason": str(exc.reason), "url": url},
            ) from exc

    def _request_json(self, method: str, path: str, *, query: dict[str, Any] | None = None, body: Any | None = None) -> Any:
        result = self._request_raw(method, path, query=query, body=body)
        return _parse_json(str(result["body"]), url=str(result["url"]))

    def probe(self) -> dict[str, Any]:
        attempts: list[tuple[str, dict[str, Any] | None]] = [
            ("/health", None),
            ("/api/health", None),
            ("/zaps", {"limit": 1}),
            ("/api/zaps", {"limit": 1}),
        ]
        last_not_found: ZapierApiError | None = None
        for path, query in attempts:
            try:
                payload = self._request_json("GET", path, query=query)
                return {"endpoint": path, "payload": payload}
            except ZapierApiError as err:
                if err.code == "NOT_FOUND":
                    last_not_found = err
                    continue
                raise

        raise ZapierApiError(
            code="ZAPIER_PROBE_FAILED",
            message="Configured Zapier bridge did not expose a live read endpoint",
            exit_code=5,
            details={
                "attempts": [path for path, _ in attempts],
                "last_error": last_not_found.details if last_not_found else None,
                "live_backend_available": False,
                "live_read_available": False,
                "write_bridge_available": False,
            },
        )

    def probe_trigger(self) -> dict[str, Any]:
        attempts: list[str] = ["/trigger", "/api/trigger"]
        last_not_found: ZapierApiError | None = None
        for path in attempts:
            try:
                result = self._request_raw("OPTIONS", path)
                headers = result.get("headers")
                allow = headers.get("Allow") if headers else None
                return {
                    "endpoint": path,
                    "available": True,
                    "method": "OPTIONS",
                    "allow": allow,
                }
            except ZapierApiError as err:
                if err.code == "NOT_FOUND":
                    last_not_found = err
                    continue
                if err.code == "ZAPIER_API_ERROR" and err.details and err.details.get("status") == 405:
                    headers = err.details.get("response") if isinstance(err.details.get("response"), dict) else None
                    allow = None
                    if headers and isinstance(headers, dict):
                        allow = headers.get("Allow")
                    if allow and "POST" in {part.strip().upper() for part in str(allow).split(",") if part.strip()}:
                        return {
                            "endpoint": path,
                            "available": True,
                            "method": "OPTIONS",
                            "allow": allow,
                        }
                raise

        raise ZapierApiError(
            code="ZAPIER_TRIGGER_ENDPOINT_NOT_FOUND",
            message="Configured Zapier bridge did not expose a trigger endpoint",
            exit_code=5,
            details={
                "attempts": attempts,
                "last_error": last_not_found.details if last_not_found else None,
                "write_bridge_available": False,
            },
        )

    def list_zaps(
        self,
        *,
        limit: int,
        status: str | None = None,
        workspace_name: str | None = None,
    ) -> Any:
        query = {"limit": limit, "status": status, "workspace_name": workspace_name}
        last_not_found: ZapierApiError | None = None
        for path in ("/zaps", "/api/zaps"):
            try:
                return self._request_json("GET", path, query=query)
            except ZapierApiError as err:
                if err.code == "NOT_FOUND":
                    last_not_found = err
                    continue
                raise

        raise ZapierApiError(
            code="ZAPIER_ZAPS_ENDPOINT_NOT_FOUND",
            message="Configured Zapier bridge did not expose a zap listing endpoint",
            exit_code=5,
            details={"query": _clean_query(query), "last_error": last_not_found.details if last_not_found else None},
        )

    def get_zap(
        self,
        zap_id: str,
        *,
        status: str | None = None,
        workspace_name: str | None = None,
    ) -> Any:
        zap_key = zap_id.strip()
        if not zap_key:
            raise ZapierApiError(
                code="ZAPIER_ZAP_ID_REQUIRED",
                message="zap_id is required to read zap status",
                exit_code=4,
                details={"missing_keys": ["zap_id"]},
            )

        query = {"status": status, "workspace_name": workspace_name}
        encoded_id = parse.quote(zap_key, safe="")
        last_not_found: ZapierApiError | None = None
        for path in (f"/zaps/{encoded_id}", f"/api/zaps/{encoded_id}"):
            try:
                return self._request_json("GET", path, query=query)
            except ZapierApiError as err:
                if err.code == "NOT_FOUND":
                    last_not_found = err
                    continue
                raise

        raise ZapierApiError(
            code="ZAPIER_ZAP_ENDPOINT_NOT_FOUND",
            message="Configured Zapier bridge did not expose a zap status endpoint",
            exit_code=5,
            details={
                "zap_id": zap_key,
                "query": _clean_query(query),
                "last_error": last_not_found.details if last_not_found else None,
            },
        )

    def trigger_zap(
        self,
        zap_id: str,
        *,
        event: str,
        payload: dict[str, Any] | None = None,
        workspace_name: str | None = None,
    ) -> Any:
        zap_key = zap_id.strip()
        if not zap_key:
            raise ZapierApiError(
                code="ZAPIER_ZAP_ID_REQUIRED",
                message="zap_id is required to trigger a zap",
                exit_code=4,
                details={"missing_keys": ["zap_id"]},
            )

        request_body = {
            "zap_id": zap_key,
            "event": event,
            "payload": payload or {},
        }
        if workspace_name:
            request_body["workspace_name"] = workspace_name
        if self.webhook_base_url:
            request_body["webhook_base_url"] = self.webhook_base_url

        last_not_found: ZapierApiError | None = None
        for path in ("/trigger", "/api/trigger"):
            try:
                return self._request_json("POST", path, body=request_body)
            except ZapierApiError as err:
                if err.code == "NOT_FOUND":
                    last_not_found = err
                    continue
                raise

        raise ZapierApiError(
            code="ZAPIER_TRIGGER_ENDPOINT_NOT_FOUND",
            message="Configured Zapier bridge did not expose a zap trigger endpoint",
            exit_code=5,
            details={
                "zap_id": zap_key,
                "event": event,
                "last_error": last_not_found.details if last_not_found else None,
                "write_bridge_available": False,
            },
        )
