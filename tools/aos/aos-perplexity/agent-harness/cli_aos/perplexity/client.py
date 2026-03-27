from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from .constants import BACKEND_NAME, DEFAULT_BASE_URL


@dataclass(slots=True)
class PerplexityApiError(Exception):
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


def _extract_text(payload: dict[str, Any]) -> str | None:
    answer = payload.get("answer")
    if isinstance(answer, str) and answer.strip():
        return answer.strip()
    output_text = payload.get("output_text")
    if isinstance(output_text, str) and output_text.strip():
        return output_text.strip()
    choices = payload.get("choices")
    if isinstance(choices, list) and choices:
        first = choices[0] if isinstance(choices[0], dict) else {}
        message = first.get("message") if isinstance(first.get("message"), dict) else {}
        if isinstance(message.get("content"), str) and message["content"].strip():
            return message["content"].strip()
        delta = first.get("delta") if isinstance(first.get("delta"), dict) else {}
        if isinstance(delta.get("content"), str) and delta["content"].strip():
            return delta["content"].strip()
    content = payload.get("content")
    if isinstance(content, str) and content.strip():
        return content.strip()
    return None


def _extract_citations(payload: dict[str, Any]) -> list[Any]:
    for key in ("citations", "sources", "references"):
        value = payload.get(key)
        if isinstance(value, list):
            return value
    choices = payload.get("choices")
    if isinstance(choices, list) and choices:
        first = choices[0] if isinstance(choices[0], dict) else {}
        message = first.get("message") if isinstance(first.get("message"), dict) else {}
        for key in ("citations", "sources", "references"):
            value = message.get(key)
            if isinstance(value, list):
                return value
    return []


def _normalize_search_result(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "title": item.get("title") or item.get("name") or item.get("source"),
        "url": item.get("url") or item.get("link"),
        "snippet": item.get("snippet") or item.get("content") or item.get("text"),
        "source": item.get("source") or item.get("domain"),
        "raw": item,
    }


class PerplexityClient:
    def __init__(self, *, api_key: str, base_url: str = DEFAULT_BASE_URL, timeout: int = 60) -> None:
        self._api_key = api_key.strip()
        self._base_url = base_url.rstrip("/")
        self._timeout = max(1, int(timeout))
        self._user_agent = "aos-perplexity/0.1.0"

    def _request(
        self,
        method: str,
        path: str,
        *,
        body: dict[str, Any] | None = None,
        stream: bool = False,
    ) -> Any:
        url = f"{self._base_url}{path}"
        headers = {
            "Authorization": f"Bearer {self._api_key}",
            "Accept": "application/json",
            "User-Agent": self._user_agent,
        }
        data: bytes | None = None
        if body is not None:
            data = json.dumps(body).encode("utf-8")
            headers["Content-Type"] = "application/json"
            if stream:
                headers["Accept"] = "text/event-stream"
        request = Request(url, data=data, method=method.upper(), headers=headers)
        try:
            with urlopen(request, timeout=self._timeout) as response:
                if stream:
                    return self._read_stream_response(response)
                return _dict_or_empty(_load_json(response.read()))
        except HTTPError as err:
            details: dict[str, Any] = {}
            try:
                details = _dict_or_empty(_load_json(err.read()))
            except Exception:
                details = {}
            code = str(details.get("error") or details.get("code") or "PERPLEXITY_API_ERROR")
            message = str(
                details.get("message")
                or details.get("error")
                or err.reason
                or "Perplexity API request failed"
            )
            raise PerplexityApiError(
                status_code=err.code,
                code=code,
                message=message,
                details=details or {"backend": BACKEND_NAME, "url": url},
            ) from err
        except URLError as err:
            raise PerplexityApiError(
                status_code=None,
                code="PERPLEXITY_NETWORK_ERROR",
                message=str(getattr(err, "reason", err)),
                details={"backend": BACKEND_NAME, "url": url},
            ) from err

    def _read_stream_response(self, response: Any) -> dict[str, Any]:
        events: list[dict[str, Any]] = []
        answer_parts: list[str] = []
        citations: list[Any] = []
        final_payload: dict[str, Any] = {}
        for raw_line in response:
            line = raw_line.decode("utf-8", errors="ignore").strip()
            if not line or not line.startswith("data:"):
                continue
            data = line[5:].strip()
            if data == "[DONE]":
                break
            try:
                payload = json.loads(data)
            except json.JSONDecodeError:
                continue
            if isinstance(payload, dict):
                final_payload = payload
                text = _extract_text(payload)
                if text:
                    answer_parts.append(text)
                extracted_citations = _extract_citations(payload)
                if extracted_citations:
                    citations = extracted_citations
                events.append({"raw": payload, "text": text})
        answer = "".join(answer_parts).strip()
        if not answer and final_payload:
            answer = _extract_text(final_payload) or ""
        return {
            "answer": answer,
            "citations": citations,
            "events": events,
            "raw": final_payload,
        }

    def search_query(
        self,
        *,
        query: str,
        model: str | None = None,
        search_domain_filter: list[str] | None = None,
        max_results: int | None = None,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {"query": query}
        if model:
            body["model"] = model
        if search_domain_filter:
            body["search_domain_filter"] = search_domain_filter
        if max_results is not None:
            body["max_results"] = max(1, int(max_results))
        raw = _dict_or_empty(self._request("POST", "/search", body=body))
        results = raw.get("results")
        if isinstance(results, dict):
            results = results.get("data") or results.get("items") or []
        normalized_results = [
            _normalize_search_result(item)
            for item in _list_or_empty(results)
            if isinstance(item, dict)
        ]
        answer = _extract_text(raw)
        citations = _extract_citations(raw)
        return {
            "query": query,
            "model": model,
            "search_domain_filter": search_domain_filter or [],
            "max_results": max_results,
            "answer": answer,
            "citations": citations,
            "results": normalized_results,
            "result_count": len(normalized_results),
            "raw": raw,
        }

    def chat_complete(
        self,
        *,
        messages: list[dict[str, Any]],
        model: str | None = None,
        search_domain_filter: list[str] | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
        system_prompt: str | None = None,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {"messages": messages}
        if model:
            body["model"] = model
        if search_domain_filter:
            body["search_domain_filter"] = search_domain_filter
        if temperature is not None:
            body["temperature"] = temperature
        if max_tokens is not None:
            body["max_tokens"] = max_tokens
        if system_prompt:
            body["system_prompt"] = system_prompt
        raw = _dict_or_empty(self._request("POST", "/chat/completions", body=body))
        answer = _extract_text(raw)
        citations = _extract_citations(raw)
        return {
            "model": model,
            "messages": messages,
            "search_domain_filter": search_domain_filter or [],
            "temperature": temperature,
            "max_tokens": max_tokens,
            "system_prompt": system_prompt,
            "answer": answer,
            "citations": citations,
            "usage": raw.get("usage") if isinstance(raw.get("usage"), dict) else {},
            "raw": raw,
        }

    def chat_stream(
        self,
        *,
        messages: list[dict[str, Any]],
        model: str | None = None,
        search_domain_filter: list[str] | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
        system_prompt: str | None = None,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {"messages": messages, "stream": True}
        if model:
            body["model"] = model
        if search_domain_filter:
            body["search_domain_filter"] = search_domain_filter
        if temperature is not None:
            body["temperature"] = temperature
        if max_tokens is not None:
            body["max_tokens"] = max_tokens
        if system_prompt:
            body["system_prompt"] = system_prompt
        raw = self._request("POST", "/chat/completions", body=body, stream=True)
        return {
            "model": model,
            "messages": messages,
            "search_domain_filter": search_domain_filter or [],
            "temperature": temperature,
            "max_tokens": max_tokens,
            "system_prompt": system_prompt,
            "answer": raw.get("answer", ""),
            "citations": raw.get("citations", []),
            "chunks": raw.get("events", []),
            "raw": raw.get("raw", {}),
        }

    def search_chat(
        self,
        *,
        query: str,
        model: str | None = None,
        search_domain_filter: list[str] | None = None,
        system_prompt: str | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
    ) -> dict[str, Any]:
        messages = [{"role": "user", "content": query}]
        return self.chat_complete(
            messages=messages,
            model=model,
            search_domain_filter=search_domain_filter,
            temperature=temperature,
            max_tokens=max_tokens,
            system_prompt=system_prompt,
        )
