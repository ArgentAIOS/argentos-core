from __future__ import annotations

from dataclasses import dataclass
import json
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from .constants import DEFAULT_TIMEOUT_SECONDS
from .errors import DartAPIError, DartConfigurationError, DartNotFoundError


@dataclass(frozen=True)
class DartResponse:
    status: int
    data: Any
    headers: dict[str, str]


class DartClient:
    def __init__(self, *, api_key: str, base_url: str, timeout: int = DEFAULT_TIMEOUT_SECONDS) -> None:
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    def _request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, str | int | bool | None] | None = None,
        body: dict[str, Any] | None = None,
    ) -> DartResponse:
        url = f"{self.base_url}/{path.lstrip('/')}"
        if params:
            encoded = urlencode({key: value for key, value in params.items() if value is not None})
            if encoded:
                url = f"{url}?{encoded}"
        headers = {"Authorization": f"Bearer {self.api_key}", "Accept": "application/json"}
        data: bytes | None = None
        if body is not None:
            headers["Content-Type"] = "application/json"
            data = json.dumps(body).encode("utf-8")
        request = Request(url, data=data, method=method.upper(), headers=headers)
        try:
            with urlopen(request, timeout=self.timeout) as response:
                raw = response.read().decode("utf-8")
                payload = json.loads(raw) if raw else None
                return DartResponse(
                    status=getattr(response, "status", 200),
                    data=payload,
                    headers={key: value for key, value in response.headers.items()},
                )
        except HTTPError as exc:
            if exc.code in {401, 403}:
                raise DartConfigurationError(
                    f"Dart API authentication failed: {exc.code} {exc.reason}",
                    details={"status_code": exc.code, "reason": exc.reason},
                ) from exc
            if exc.code == 404:
                raise DartNotFoundError(
                    f"Dart API resource not found: {path}",
                    details={"status_code": exc.code, "path": path},
                ) from exc
            raise DartAPIError(
                f"Dart API request failed: {exc.code} {exc.reason}",
                details={"status_code": exc.code, "reason": exc.reason, "path": path},
            ) from exc
        except URLError as exc:
            raise DartAPIError(f"Dart API request failed: {exc.reason}") from exc

    @staticmethod
    def _unwrap_array(payload: Any, *keys: str) -> list[dict[str, Any]]:
        if isinstance(payload, dict):
            for key in keys:
                value = payload.get(key)
                if isinstance(value, list):
                    return value
        if isinstance(payload, list):
            return payload
        return []

    # --- Dartboard ---

    def list_dartboards(self, *, limit: int = 25) -> dict[str, Any]:
        response = self._request("GET", "/dartboards", params={"limit": limit})
        dartboards = self._unwrap_array(response.data, "results", "dartboards")
        return {"dartboards": dartboards[:limit]}

    def get_dartboard(self, dartboard_id: str) -> dict[str, Any]:
        response = self._request("GET", f"/dartboards/{dartboard_id}")
        return {"dartboard": response.data or {"id": dartboard_id}}

    # --- Task ---

    def list_tasks(self, *, dartboard_id: str | None = None, assignee: str | None = None, status: str | None = None, limit: int = 25) -> dict[str, Any]:
        params: dict[str, str | int | bool | None] = {"limit": limit}
        if dartboard_id:
            params["dartboard"] = dartboard_id
        if assignee:
            params["assignee"] = assignee
        if status:
            params["status"] = status
        response = self._request("GET", "/tasks", params=params)
        tasks = self._unwrap_array(response.data, "results", "tasks")
        return {"tasks": tasks[:limit], "task_count": min(len(tasks), limit)}

    def get_task(self, task_id: str) -> dict[str, Any]:
        response = self._request("GET", f"/tasks/{task_id}")
        return {"task": response.data or {"id": task_id}}

    def create_task(
        self,
        *,
        dartboard_id: str,
        title: str,
        description: str | None = None,
        assignee: str | None = None,
        priority: str | None = None,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {"dartboard_id": dartboard_id, "title": title}
        if description is not None:
            body["description"] = description
        if assignee is not None:
            body["assignee"] = assignee
        if priority is not None:
            body["priority"] = priority
        response = self._request("POST", "/tasks/create", body=body)
        return {"task": response.data}

    def update_task(
        self,
        *,
        task_id: str,
        title: str | None = None,
        description: str | None = None,
        status: str | None = None,
        assignee: str | None = None,
        priority: str | None = None,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {}
        if title is not None:
            body["title"] = title
        if description is not None:
            body["description"] = description
        if status is not None:
            body["status"] = status
        if assignee is not None:
            body["assignee"] = assignee
        if priority is not None:
            body["priority"] = priority
        response = self._request("PUT", f"/tasks/{task_id}", body=body)
        return {"task": response.data}

    def delete_task(self, task_id: str) -> dict[str, Any]:
        self._request("DELETE", f"/tasks/{task_id}")
        return {"deleted": True, "task_id": task_id}

    # --- Doc ---

    def list_docs(self, *, limit: int = 25) -> dict[str, Any]:
        response = self._request("GET", "/docs", params={"limit": limit})
        docs = self._unwrap_array(response.data, "results", "docs")
        return {"docs": docs[:limit]}

    def get_doc(self, doc_id: str) -> dict[str, Any]:
        response = self._request("GET", f"/docs/{doc_id}")
        return {"doc": response.data or {"id": doc_id}}

    def create_doc(self, *, title: str, content: str | None = None) -> dict[str, Any]:
        body: dict[str, Any] = {"title": title}
        if content is not None:
            body["text_content"] = content
        response = self._request("POST", "/docs/create", body=body)
        return {"doc": response.data}

    # --- Comment ---

    def list_comments(self, task_id: str) -> dict[str, Any]:
        response = self._request("GET", f"/tasks/{task_id}/comments")
        return {"comments": self._unwrap_array(response.data, "results", "comments")}

    def create_comment(self, *, task_id: str, text: str) -> dict[str, Any]:
        response = self._request("POST", f"/tasks/{task_id}/comments", body={"text": text})
        return {"comment": response.data}

    # --- Property ---

    def list_properties(self) -> dict[str, Any]:
        response = self._request("GET", "/properties")
        return {"properties": self._unwrap_array(response.data, "results", "properties")}
