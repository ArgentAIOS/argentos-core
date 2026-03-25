from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urljoin
from urllib.request import Request, urlopen

from .constants import BACKEND_NAME, DEFAULT_NOTION_VERSION


@dataclass(slots=True)
class NotionApiError(Exception):
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


def _load_json(payload: bytes) -> dict[str, Any]:
    if not payload:
        return {}
    decoded = payload.decode("utf-8")
    if not decoded.strip():
        return {}
    value = json.loads(decoded)
    return value if isinstance(value, dict) else {"value": value}


def _stringify(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    if isinstance(value, (int, float, bool)):
        return str(value)
    return json.dumps(value, sort_keys=True, default=str)


def _format_rich_text(rich_text: list[dict[str, Any]] | None) -> str:
    if not rich_text:
        return ""
    parts: list[str] = []
    for part in rich_text:
        if not isinstance(part, dict):
            continue
        text = part.get("plain_text") or part.get("text", {}).get("content") or ""
        if text:
            parts.append(str(text))
    return "".join(parts)


def _flatten_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    if isinstance(value, (int, float, bool)):
        return str(value)
    if isinstance(value, list):
        return " ".join(_flatten_text(item) for item in value if _flatten_text(item))
    if isinstance(value, dict):
        if "plain_text" in value or "text" in value:
            return _format_rich_text([value])
        parts: list[str] = []
        for nested in value.values():
            text = _flatten_text(nested)
            if text:
                parts.append(text)
        return " ".join(parts)
    return str(value)


class NotionClient:
    def __init__(self, *, token: str, version: str = DEFAULT_NOTION_VERSION, base_url: str = "https://api.notion.com/v1"):
        self._token = token.strip()
        self._version = version.strip() or DEFAULT_NOTION_VERSION
        self._base_url = base_url.rstrip("/")

    def _request(
        self,
        method: str,
        path: str,
        *,
        body: dict[str, Any] | None = None,
        params: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        url = urljoin(self._base_url + "/", path.lstrip("/"))
        if params:
            query = urlencode([(key, str(value)) for key, value in params.items() if value is not None])
            if query:
                url = f"{url}?{query}"

        payload = json.dumps(body).encode("utf-8") if body is not None else None
        headers = {
            "Authorization": f"Bearer {self._token}",
            "Notion-Version": self._version,
            "Accept": "application/json",
        }
        if payload is not None:
            headers["Content-Type"] = "application/json"

        request = Request(url, data=payload, method=method.upper(), headers=headers)
        try:
            with urlopen(request, timeout=30) as response:
                data = response.read()
                return _load_json(data)
        except HTTPError as err:
            details = {}
            try:
                details = _load_json(err.read())
            except Exception:
                details = {}
            raise NotionApiError(
                status_code=err.code,
                code=str(details.get("code") or "NOTION_API_ERROR"),
                message=str(details.get("message") or err.reason or "Notion API request failed"),
                details=details,
            ) from err
        except URLError as err:
            raise NotionApiError(
                status_code=None,
                code="NOTION_NETWORK_ERROR",
                message=str(getattr(err, "reason", err)),
                details={"backend": BACKEND_NAME, "url": url},
            ) from err

    def current_user(self) -> dict[str, Any]:
        return self._request("GET", "/users/me")

    def search(
        self,
        *,
        query: str,
        limit: int = 10,
        filter_object: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {"query": query, "page_size": max(1, min(limit, 100))}
        if filter_object is not None:
            body["filter"] = filter_object
        return self._request("POST", "/search", body=body)

    def list_databases(self, *, limit: int = 10) -> dict[str, Any]:
        response = self.search(query="", limit=limit, filter_object={"property": "object", "value": "database"})
        results = [item for item in response.get("results", []) if isinstance(item, dict)]
        return {
            "object": "list",
            "results": results[:limit],
            "has_more": bool(response.get("has_more")),
            "next_cursor": response.get("next_cursor"),
        }

    def query_database(
        self,
        database_id: str,
        *,
        limit: int = 10,
        filter_expression: str | None = None,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {"page_size": max(1, min(limit, 100))}
        filter_mode = "none"
        raw_filter = (filter_expression or "").strip()
        if raw_filter:
            try:
                parsed = json.loads(raw_filter)
                if isinstance(parsed, dict):
                    body["filter"] = parsed
                    filter_mode = "notion-json"
                else:
                    filter_mode = "client-text"
            except json.JSONDecodeError:
                filter_mode = "client-text"

        response = self._request("POST", f"/databases/{database_id}/query", body=body)
        results = [item for item in response.get("results", []) if isinstance(item, dict)]
        if raw_filter and filter_mode == "client-text":
            needle = raw_filter.casefold()
            results = [item for item in results if needle in _flatten_text(item).casefold()]
        return {
            "object": "list",
            "database_id": database_id,
            "results": results[:limit],
            "has_more": bool(response.get("has_more")),
            "next_cursor": response.get("next_cursor"),
            "filter_expression": raw_filter or None,
            "filter_mode": filter_mode,
        }

    def read_page(self, page_id: str, *, block_depth: int = 2) -> dict[str, Any]:
        page = self._request("GET", f"/pages/{page_id}")
        blocks = self.block_tree(page_id, max_depth=block_depth)
        return {
            "page": page,
            "blocks": blocks,
        }

    def read_block(self, block_id: str, *, max_depth: int = 2) -> dict[str, Any]:
        block = self._request("GET", f"/blocks/{block_id}")
        return {
            "block": block,
            "children": self.block_children(block_id, max_depth=max_depth),
        }

    def block_children(self, block_id: str, *, max_depth: int = 2) -> list[dict[str, Any]]:
        response = self._request("GET", f"/blocks/{block_id}/children", params={"page_size": 100})
        children = [item for item in response.get("results", []) if isinstance(item, dict)]
        if max_depth <= 0:
            return children
        enriched: list[dict[str, Any]] = []
        for child in children:
            child_copy = dict(child)
            if child_copy.get("has_children"):
                child_copy["children"] = self.block_children(str(child_copy.get("id", "")), max_depth=max_depth - 1)
            enriched.append(child_copy)
        return enriched

    def block_tree(self, block_id: str, *, max_depth: int = 2) -> dict[str, Any]:
        block = self._request("GET", f"/blocks/{block_id}")
        node = dict(block)
        if node.get("has_children"):
            node["children"] = self.block_children(block_id, max_depth=max_depth)
        return node
