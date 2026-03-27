from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from .constants import BACKEND_NAME


@dataclass(slots=True)
class AnthropicApiError(Exception):
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


def _list_or_empty(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def _normalize_message(raw: dict[str, Any]) -> dict[str, Any]:
    text_parts: list[str] = []
    for item in _list_or_empty(raw.get("content")):
        if isinstance(item, dict) and item.get("type") == "text":
            text_parts.append(str(item.get("text") or ""))
    return {
        "id": raw.get("id"),
        "type": raw.get("type"),
        "role": raw.get("role"),
        "model": raw.get("model"),
        "stop_reason": raw.get("stop_reason"),
        "stop_sequence": raw.get("stop_sequence"),
        "usage": raw.get("usage"),
        "text": "".join(text_parts),
        "content": raw.get("content"),
        "raw": raw,
    }


def _normalize_model(raw: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": raw.get("id"),
        "display_name": raw.get("display_name"),
        "type": raw.get("type"),
        "created_at": raw.get("created_at"),
        "raw": raw,
    }


class AnthropicClient:
    def __init__(self, *, api_key: str, base_url: str, version: str) -> None:
        self._api_key = api_key.strip()
        self._base_url = base_url.rstrip("/")
        self._version = version.strip()
        self._user_agent = "aos-anthropic/0.1.0"

    def _headers(self, *, accept: str = "application/json") -> dict[str, str]:
        return {
            "x-api-key": self._api_key,
            "anthropic-version": self._version,
            "content-type": "application/json",
            "accept": accept,
            "user-agent": self._user_agent,
        }

    def _request_json(self, method: str, path: str, *, body: dict[str, Any] | None = None) -> dict[str, Any]:
        data = json.dumps(body or {}).encode("utf-8") if body is not None else None
        request = Request(
            f"{self._base_url}{path}",
            data=data,
            method=method.upper(),
            headers=self._headers(),
        )
        try:
            with urlopen(request, timeout=60) as response:
                return _dict_or_empty(_load_json(response.read()))
        except HTTPError as err:
            details: dict[str, Any] = {}
            try:
                details = _dict_or_empty(_load_json(err.read()))
            except Exception:
                details = {}
            error_payload = _dict_or_empty(details.get("error"))
            code = str(error_payload.get("type") or "ANTHROPIC_API_ERROR")
            message = str(error_payload.get("message") or err.reason or "Anthropic API request failed")
            raise AnthropicApiError(
                status_code=err.code,
                code=code,
                message=message,
                details=details or {"backend": BACKEND_NAME},
            ) from err
        except URLError as err:
            raise AnthropicApiError(
                status_code=None,
                code="ANTHROPIC_NETWORK_ERROR",
                message=str(getattr(err, "reason", err)),
                details={"backend": BACKEND_NAME},
            ) from err

    def _request_sse(self, path: str, *, body: dict[str, Any]) -> list[dict[str, Any]]:
        request = Request(
            f"{self._base_url}{path}",
            data=json.dumps(body).encode("utf-8"),
            method="POST",
            headers=self._headers(accept="text/event-stream"),
        )
        events: list[dict[str, Any]] = []
        try:
            with urlopen(request, timeout=60) as response:
                event_name: str | None = None
                data_lines: list[str] = []
                for raw_line in response:
                    line = raw_line.decode("utf-8").rstrip("\n")
                    if not line.strip():
                        if data_lines:
                            payload_text = "\n".join(data_lines)
                            payload = {}
                            if payload_text != "[DONE]":
                                payload = _dict_or_empty(json.loads(payload_text))
                            events.append({"event": event_name or "message", "data": payload})
                            event_name = None
                            data_lines = []
                        continue
                    if line.startswith("event:"):
                        event_name = line.split(":", 1)[1].strip()
                    elif line.startswith("data:"):
                        data_lines.append(line.split(":", 1)[1].strip())
                if data_lines:
                    payload = _dict_or_empty(json.loads("\n".join(data_lines)))
                    events.append({"event": event_name or "message", "data": payload})
            return events
        except HTTPError as err:
            details: dict[str, Any] = {}
            try:
                details = _dict_or_empty(_load_json(err.read()))
            except Exception:
                details = {}
            error_payload = _dict_or_empty(details.get("error"))
            code = str(error_payload.get("type") or "ANTHROPIC_API_ERROR")
            message = str(error_payload.get("message") or err.reason or "Anthropic streaming request failed")
            raise AnthropicApiError(status_code=err.code, code=code, message=message, details=details) from err
        except URLError as err:
            raise AnthropicApiError(
                status_code=None,
                code="ANTHROPIC_NETWORK_ERROR",
                message=str(getattr(err, "reason", err)),
                details={"backend": BACKEND_NAME},
            ) from err

    def _message_body(
        self,
        *,
        model: str,
        messages: list[dict[str, Any]],
        max_tokens: int,
        system_prompt: str | None,
        temperature: float | None,
        thinking_budget: int | None,
        stream: bool,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {
            "model": model,
            "messages": messages,
            "max_tokens": max_tokens,
            "stream": stream,
        }
        if system_prompt:
            body["system"] = system_prompt
        if temperature is not None:
            body["temperature"] = temperature
        if thinking_budget is not None:
            body["thinking"] = {"type": "enabled", "budget_tokens": thinking_budget}
        return body

    def create_message(
        self,
        *,
        model: str,
        messages: list[dict[str, Any]],
        max_tokens: int,
        system_prompt: str | None = None,
        temperature: float | None = None,
        thinking_budget: int | None = None,
    ) -> dict[str, Any]:
        raw = self._request_json(
            "POST",
            "/v1/messages",
            body=self._message_body(
                model=model,
                messages=messages,
                max_tokens=max_tokens,
                system_prompt=system_prompt,
                temperature=temperature,
                thinking_budget=thinking_budget,
                stream=False,
            ),
        )
        return _normalize_message(raw)

    def stream_message(
        self,
        *,
        model: str,
        messages: list[dict[str, Any]],
        max_tokens: int,
        system_prompt: str | None = None,
        temperature: float | None = None,
        thinking_budget: int | None = None,
    ) -> dict[str, Any]:
        events = self._request_sse(
            "/v1/messages",
            body=self._message_body(
                model=model,
                messages=messages,
                max_tokens=max_tokens,
                system_prompt=system_prompt,
                temperature=temperature,
                thinking_budget=thinking_budget,
                stream=True,
            ),
        )
        text_parts: list[str] = []
        for event in events:
            data = _dict_or_empty(event.get("data"))
            delta = _dict_or_empty(data.get("delta"))
            if event.get("event") == "content_block_delta" and delta.get("type") == "text_delta":
                text_parts.append(str(delta.get("text") or ""))
        return {
            "events": events,
            "event_count": len(events),
            "text": "".join(text_parts),
        }

    def list_models(self, *, limit: int = 50) -> dict[str, Any]:
        raw = self._request_json("GET", "/v1/models")
        models = [_normalize_model(item) for item in _list_or_empty(raw.get("data")) if isinstance(item, dict)]
        return {"models": models[: max(1, limit)], "count": min(len(models), max(1, limit)), "raw": raw}
