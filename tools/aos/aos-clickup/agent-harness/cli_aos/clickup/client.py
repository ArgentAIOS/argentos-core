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

    def list_workspaces(self) -> dict[str, Any]:
        response = self._request("GET", "/team")
        workspaces = self._unwrap_array(response.data, "teams")
        return {"workspaces": workspaces}

    def read_workspace(self, workspace_id: str) -> dict[str, Any]:
        workspaces = self.list_workspaces()["workspaces"]
        workspace = next((item for item in workspaces if str(item.get("id")) == str(workspace_id)), {"id": workspace_id})
        spaces = self.list_spaces(workspace_id)["spaces"]
        workspace = {**workspace, "spaces": spaces, "space_count": len(spaces)}
        return {"workspace": workspace}

    def list_spaces(self, workspace_id: str) -> dict[str, Any]:
        response = self._request("GET", f"/team/{workspace_id}/space")
        return {"spaces": self._unwrap_array(response.data, "spaces")}

    def read_space(self, space_id: str) -> dict[str, Any]:
        response = self._request("GET", f"/space/{space_id}")
        return {"space": response.data or {"id": space_id}}

    def list_folders(self, space_id: str) -> dict[str, Any]:
        response = self._request("GET", f"/space/{space_id}/folder")
        return {"folders": self._unwrap_array(response.data, "folders")}

    def read_folder(self, folder_id: str) -> dict[str, Any]:
        response = self._request("GET", f"/folder/{folder_id}")
        return {"folder": response.data or {"id": folder_id}}

    def list_lists(self, *, space_id: str | None = None, folder_id: str | None = None) -> dict[str, Any]:
        if folder_id:
            response = self._request("GET", f"/folder/{folder_id}/list")
        elif space_id:
            response = self._request("GET", f"/space/{space_id}/list")
        else:
            raise ClickUpNotSupportedError("Either space_id or folder_id is required to list ClickUp lists.")
        return {"lists": self._unwrap_array(response.data, "lists")}

    def read_list(self, list_id: str) -> dict[str, Any]:
        response = self._request("GET", f"/list/{list_id}")
        return {"list": response.data or {"id": list_id}}

    def list_tasks(self, list_id: str, *, limit: int = 25) -> dict[str, Any]:
        response = self._request("GET", f"/list/{list_id}/task")
        tasks = self._unwrap_array(response.data, "tasks")[:limit]
        return {"tasks": tasks, "task_count": len(tasks)}

    def read_task(self, task_id: str) -> dict[str, Any]:
        response = self._request("GET", f"/task/{task_id}")
        return {"task": response.data or {"id": task_id}}

    def create_task_draft(self, *, list_id: str, name: str, description: str | None = None, due_date: str | None = None) -> dict[str, Any]:
        return {
            "supported": False,
            "status": "scaffold_write_only",
            "reason": "ClickUp task creation is scaffolded until a live write bridge is approved.",
            "task": {"list_id": list_id, "name": name, "description": description, "due_date": due_date},
        }

    def update_task_draft(
        self,
        *,
        task_id: str,
        name: str | None = None,
        description: str | None = None,
        list_id: str | None = None,
        due_date: str | None = None,
        status: str | None = None,
    ) -> dict[str, Any]:
        return {
            "supported": False,
            "status": "scaffold_write_only",
            "reason": "ClickUp task updates are scaffolded until a live write bridge is approved.",
            "task": {
                "task_id": task_id,
                "name": name,
                "description": description,
                "list_id": list_id,
                "due_date": due_date,
                "status": status,
            },
        }
