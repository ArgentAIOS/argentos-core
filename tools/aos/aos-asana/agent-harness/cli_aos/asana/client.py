from __future__ import annotations

from dataclasses import dataclass
import json
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from .constants import DEFAULT_TIMEOUT_SECONDS
from .errors import AsanaAPIError


@dataclass(frozen=True)
class AsanaResponse:
    status: int
    data: Any
    headers: dict[str, str]


class AsanaClient:
    def __init__(self, *, access_token: str, base_url: str, timeout: int = DEFAULT_TIMEOUT_SECONDS) -> None:
        self.access_token = access_token
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    def _request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, str | int | bool | None] | None = None,
        body: dict[str, Any] | None = None,
    ) -> AsanaResponse:
        url = f"{self.base_url}/{path.lstrip('/')}"
        if params:
            encoded = urlencode({key: value for key, value in params.items() if value is not None})
            if encoded:
                url = f"{url}?{encoded}"
        headers = {"Authorization": f"Bearer {self.access_token}", "Accept": "application/json"}
        data: bytes | None = None
        if body is not None:
            headers["Content-Type"] = "application/json"
            data = json.dumps({"data": body}).encode("utf-8")
        request = Request(url, data=data, method=method.upper(), headers=headers)
        try:
            with urlopen(request, timeout=self.timeout) as response:
                raw = response.read().decode("utf-8")
                payload = json.loads(raw) if raw else None
                return AsanaResponse(
                    status=getattr(response, "status", 200),
                    data=payload,
                    headers={key: value for key, value in response.headers.items()},
                )
        except HTTPError as exc:
            raw = exc.read().decode("utf-8") if hasattr(exc, "read") else ""
            raise AsanaAPIError(
                f"Asana API request failed: {exc.code} {exc.reason}: {raw or exc}",
                details={"status_code": exc.code, "reason": exc.reason, "body": raw or None},
            ) from exc
        except URLError as exc:
            raise AsanaAPIError(f"Asana API request failed: {exc.reason}") from exc

    @staticmethod
    def _unwrap_data(payload: Any) -> list[dict[str, Any]]:
        if isinstance(payload, dict):
            data = payload.get("data")
            if isinstance(data, list):
                return data
        return []

    @staticmethod
    def _unwrap_single(payload: Any) -> dict[str, Any]:
        if isinstance(payload, dict):
            data = payload.get("data")
            if isinstance(data, dict):
                return data
        return payload or {}

    # --- Project ---

    def list_projects(self, workspace_gid: str, *, limit: int = 25) -> dict[str, Any]:
        response = self._request("GET", f"/workspaces/{workspace_gid}/projects", params={"limit": limit})
        projects = self._unwrap_data(response.data)
        return {"projects": projects[:limit]}

    def get_project(self, project_gid: str) -> dict[str, Any]:
        response = self._request("GET", f"/projects/{project_gid}")
        return {"project": self._unwrap_single(response.data)}

    def list_project_sections(self, project_gid: str) -> dict[str, Any]:
        response = self._request("GET", f"/projects/{project_gid}/sections")
        return {"sections": self._unwrap_data(response.data)}

    # --- Section ---

    def list_sections(self, project_gid: str) -> dict[str, Any]:
        response = self._request("GET", f"/projects/{project_gid}/sections")
        return {"sections": self._unwrap_data(response.data)}

    def list_section_tasks(self, section_gid: str, *, limit: int = 25) -> dict[str, Any]:
        response = self._request("GET", f"/sections/{section_gid}/tasks", params={"limit": limit})
        tasks = self._unwrap_data(response.data)
        return {"tasks": tasks[:limit], "task_count": min(len(tasks), limit)}

    # --- Task ---

    def list_tasks(self, project_gid: str, *, limit: int = 25) -> dict[str, Any]:
        response = self._request("GET", f"/projects/{project_gid}/tasks", params={"limit": limit})
        tasks = self._unwrap_data(response.data)
        return {"tasks": tasks[:limit], "task_count": min(len(tasks), limit)}

    def get_task(self, task_gid: str) -> dict[str, Any]:
        response = self._request("GET", f"/tasks/{task_gid}")
        return {"task": self._unwrap_single(response.data)}

    def create_task(
        self,
        *,
        project_gid: str,
        name: str,
        notes: str | None = None,
        assignee: str | None = None,
        due_on: str | None = None,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {"name": name, "projects": [project_gid]}
        if notes is not None:
            body["notes"] = notes
        if assignee is not None:
            body["assignee"] = assignee
        if due_on is not None:
            body["due_on"] = due_on
        response = self._request("POST", "/tasks", body=body)
        return {"task": self._unwrap_single(response.data)}

    def update_task(
        self,
        *,
        task_gid: str,
        name: str | None = None,
        notes: str | None = None,
        assignee: str | None = None,
        due_on: str | None = None,
        completed: bool | None = None,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {}
        if name is not None:
            body["name"] = name
        if notes is not None:
            body["notes"] = notes
        if assignee is not None:
            body["assignee"] = assignee
        if due_on is not None:
            body["due_on"] = due_on
        if completed is not None:
            body["completed"] = completed
        response = self._request("PUT", f"/tasks/{task_gid}", body=body)
        return {"task": self._unwrap_single(response.data)}

    # --- Comment (Stories) ---

    def list_comments(self, task_gid: str) -> dict[str, Any]:
        response = self._request("GET", f"/tasks/{task_gid}/stories")
        stories = self._unwrap_data(response.data)
        comments = [s for s in stories if s.get("type") == "comment" or s.get("resource_subtype") == "comment_added"]
        return {"comments": comments}

    def create_comment(self, *, task_gid: str, text: str) -> dict[str, Any]:
        response = self._request("POST", f"/tasks/{task_gid}/stories", body={"text": text})
        return {"comment": self._unwrap_single(response.data)}

    # --- Portfolio ---

    def list_portfolios(self, workspace_gid: str, *, owner: str = "me") -> dict[str, Any]:
        response = self._request("GET", "/portfolios", params={"workspace": workspace_gid, "owner": owner})
        return {"portfolios": self._unwrap_data(response.data)}

    def get_portfolio(self, portfolio_gid: str) -> dict[str, Any]:
        response = self._request("GET", f"/portfolios/{portfolio_gid}")
        return {"portfolio": self._unwrap_single(response.data)}

    # --- Search ---

    def search_tasks(self, workspace_gid: str, *, query: str) -> dict[str, Any]:
        response = self._request("GET", f"/workspaces/{workspace_gid}/tasks/search", params={"text": query})
        tasks = self._unwrap_data(response.data)
        return {"tasks": tasks, "task_count": len(tasks)}
