from __future__ import annotations

from dataclasses import dataclass
import json
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from .constants import DEFAULT_TIMEOUT_SECONDS
from .errors import ClickUpAPIError, ClickUpNotSupportedError


@dataclass(frozen=True)
class ClickUpResponse:
    status: int
    data: Any
    headers: dict[str, str]


class ClickUpClient:
    def __init__(self, *, api_token: str, base_url: str, timeout: int = DEFAULT_TIMEOUT_SECONDS) -> None:
        self.api_token = api_token
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    def _request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, str | int | bool | None] | None = None,
        body: dict[str, Any] | None = None,
    ) -> ClickUpResponse:
        url = f"{self.base_url}/{path.lstrip('/')}"
        if params:
            encoded = urlencode({key: value for key, value in params.items() if value is not None})
            if encoded:
                url = f"{url}?{encoded}"
        headers = {"Authorization": self.api_token, "Accept": "application/json"}
        data: bytes | None = None
        if body is not None:
            headers["Content-Type"] = "application/json"
            data = json.dumps(body).encode("utf-8")
        request = Request(url, data=data, method=method.upper(), headers=headers)
        try:
            with urlopen(request, timeout=self.timeout) as response:
                raw = response.read().decode("utf-8")
                payload = json.loads(raw) if raw else None
                return ClickUpResponse(
                    status=getattr(response, "status", 200),
                    data=payload,
                    headers={key: value for key, value in response.headers.items()},
                )
        except HTTPError as exc:
            raw = exc.read().decode("utf-8") if hasattr(exc, "read") else ""
            raise ClickUpAPIError(
                f"ClickUp API request failed: {exc.code} {exc.reason}: {raw or exc}",
                details={"status_code": exc.code, "reason": exc.reason, "body": raw or None},
            ) from exc
        except URLError as exc:
            raise ClickUpAPIError(f"ClickUp API request failed: {exc.reason}") from exc

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

    # --- Workspace ---

    def list_workspaces(self) -> dict[str, Any]:
        response = self._request("GET", "/team")
        workspaces = self._unwrap_array(response.data, "teams")
        return {"workspaces": workspaces}

    # --- Space ---

    def list_spaces(self, workspace_id: str) -> dict[str, Any]:
        response = self._request("GET", f"/team/{workspace_id}/space")
        return {"spaces": self._unwrap_array(response.data, "spaces")}

    def get_space(self, space_id: str) -> dict[str, Any]:
        response = self._request("GET", f"/space/{space_id}")
        return {"space": response.data or {"id": space_id}}

    # --- List ---

    def list_lists(self, *, space_id: str | None = None) -> dict[str, Any]:
        if not space_id:
            raise ClickUpNotSupportedError("space_id is required to list ClickUp lists.")
        response = self._request("GET", f"/space/{space_id}/list")
        return {"lists": self._unwrap_array(response.data, "lists")}

    def get_list(self, list_id: str) -> dict[str, Any]:
        response = self._request("GET", f"/list/{list_id}")
        return {"list": response.data or {"id": list_id}}

    def create_list(self, *, space_id: str, name: str) -> dict[str, Any]:
        response = self._request("POST", f"/space/{space_id}/list", body={"name": name})
        return {"list": response.data}

    # --- Task ---

    def list_tasks(self, list_id: str, *, limit: int = 25) -> dict[str, Any]:
        response = self._request("GET", f"/list/{list_id}/task")
        tasks = self._unwrap_array(response.data, "tasks")[:limit]
        return {"tasks": tasks, "task_count": len(tasks)}

    def get_task(self, task_id: str) -> dict[str, Any]:
        response = self._request("GET", f"/task/{task_id}")
        return {"task": response.data or {"id": task_id}}

    def create_task(
        self,
        *,
        list_id: str,
        name: str,
        description: str | None = None,
        assignees: list[int] | None = None,
        priority: int | None = None,
        status: str | None = None,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {"name": name}
        if description is not None:
            body["description"] = description
        if assignees is not None:
            body["assignees"] = assignees
        if priority is not None:
            body["priority"] = priority
        if status is not None:
            body["status"] = status
        response = self._request("POST", f"/list/{list_id}/task", body=body)
        return {"task": response.data}

    def update_task(
        self,
        *,
        task_id: str,
        name: str | None = None,
        description: str | None = None,
        status: str | None = None,
        priority: int | None = None,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {}
        if name is not None:
            body["name"] = name
        if description is not None:
            body["description"] = description
        if status is not None:
            body["status"] = status
        if priority is not None:
            body["priority"] = priority
        response = self._request("PUT", f"/task/{task_id}", body=body)
        return {"task": response.data}

    def delete_task(self, task_id: str) -> dict[str, Any]:
        self._request("DELETE", f"/task/{task_id}")
        return {"deleted": True, "task_id": task_id}

    # --- Comment ---

    def list_comments(self, task_id: str) -> dict[str, Any]:
        response = self._request("GET", f"/task/{task_id}/comment")
        return {"comments": self._unwrap_array(response.data, "comments")}

    def create_comment(self, *, task_id: str, comment_text: str) -> dict[str, Any]:
        response = self._request("POST", f"/task/{task_id}/comment", body={"comment_text": comment_text})
        return {"comment": response.data}

    # --- Doc ---

    def list_docs(self, workspace_id: str) -> dict[str, Any]:
        response = self._request("GET", f"/team/{workspace_id}/doc")
        return {"docs": self._unwrap_array(response.data, "docs")}

    def get_doc(self, doc_id: str) -> dict[str, Any]:
        response = self._request("GET", f"/doc/{doc_id}")
        return {"doc": response.data or {"id": doc_id}}

    def create_doc(self, *, workspace_id: str, name: str, content: str | None = None) -> dict[str, Any]:
        body: dict[str, Any] = {"name": name}
        if content is not None:
            body["content"] = content
        response = self._request("POST", f"/team/{workspace_id}/doc", body=body)
        return {"doc": response.data}

    # --- Time Tracking ---

    def list_time_entries(self, task_id: str) -> dict[str, Any]:
        response = self._request("GET", f"/task/{task_id}/time")
        return {"time_entries": self._unwrap_array(response.data, "data")}

    def create_time_entry(self, *, task_id: str, duration: int, description: str | None = None) -> dict[str, Any]:
        body: dict[str, Any] = {"duration": duration}
        if description is not None:
            body["description"] = description
        response = self._request("POST", f"/task/{task_id}/time", body=body)
        return {"time_entry": response.data}

    # --- Goal ---

    def list_goals(self, workspace_id: str) -> dict[str, Any]:
        response = self._request("GET", f"/team/{workspace_id}/goal")
        return {"goals": self._unwrap_array(response.data, "goals")}

    def get_goal(self, goal_id: str) -> dict[str, Any]:
        response = self._request("GET", f"/goal/{goal_id}")
        return {"goal": response.data or {"id": goal_id}}
