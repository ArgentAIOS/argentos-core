from __future__ import annotations

import base64
import json
from dataclasses import dataclass
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urljoin
from urllib.request import Request, urlopen

from .constants import BACKEND_NAME


@dataclass(slots=True)
class JiraApiError(Exception):
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


def _normalize_project(raw: dict[str, Any]) -> dict[str, Any]:
    lead = raw.get("lead") or {}
    return {
        "id": raw.get("id"),
        "key": raw.get("key"),
        "name": raw.get("name"),
        "projectTypeKey": raw.get("projectTypeKey"),
        "lead": lead.get("displayName") if isinstance(lead, dict) else None,
        "description": raw.get("description"),
        "raw": raw,
    }


def _normalize_issue(raw: dict[str, Any]) -> dict[str, Any]:
    fields = raw.get("fields") or {}
    assignee = fields.get("assignee") or {}
    status = fields.get("status") or {}
    issuetype = fields.get("issuetype") or {}
    priority = fields.get("priority") or {}
    return {
        "key": raw.get("key"),
        "id": raw.get("id"),
        "summary": fields.get("summary"),
        "description": fields.get("description"),
        "status": status.get("name") if isinstance(status, dict) else None,
        "assignee": assignee.get("displayName") if isinstance(assignee, dict) else None,
        "issuetype": issuetype.get("name") if isinstance(issuetype, dict) else None,
        "priority": priority.get("name") if isinstance(priority, dict) else None,
        "created": fields.get("created"),
        "updated": fields.get("updated"),
        "raw": raw,
    }


def _normalize_board(raw: dict[str, Any]) -> dict[str, Any]:
    location = raw.get("location") or {}
    return {
        "id": raw.get("id"),
        "name": raw.get("name"),
        "type": raw.get("type"),
        "project_key": location.get("projectKey") if isinstance(location, dict) else None,
        "raw": raw,
    }


def _normalize_sprint(raw: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": raw.get("id"),
        "name": raw.get("name"),
        "state": raw.get("state"),
        "startDate": raw.get("startDate"),
        "endDate": raw.get("endDate"),
        "goal": raw.get("goal"),
        "raw": raw,
    }


class JiraClient:
    def __init__(self, *, base_url: str, email: str, api_token: str) -> None:
        self._base_url = base_url.rstrip("/")
        self._email = email.strip()
        self._api_token = api_token.strip()
        self._user_agent = "aos-jira/0.1.0"
        token = base64.b64encode(f"{self._email}:{self._api_token}".encode("utf-8")).decode("utf-8")
        self._auth_header = f"Basic {token}"

    def _request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        body: dict[str, Any] | None = None,
        api_prefix: str = "/rest/api/3",
    ) -> Any:
        url = f"{self._base_url}{api_prefix}{path}"
        if params:
            query = urlencode([(key, str(value)) for key, value in params.items() if value is not None])
            if query:
                url = f"{url}?{query}"
        payload = json.dumps(body).encode("utf-8") if body is not None else None
        headers = {
            "Authorization": self._auth_header,
            "Accept": "application/json",
            "User-Agent": self._user_agent,
        }
        if payload is not None:
            headers["Content-Type"] = "application/json"
        request = Request(url, data=payload, method=method.upper(), headers=headers)
        try:
            with urlopen(request, timeout=30) as response:
                return _load_json(response.read())
        except HTTPError as err:
            details: dict[str, Any] = {}
            try:
                details = _dict_or_empty(_load_json(err.read()))
            except Exception:
                details = {}
            errors = details.get("errorMessages")
            if isinstance(errors, list) and errors:
                message = "; ".join(str(e) for e in errors)
            else:
                message = str(details.get("message") or err.reason or "Jira API request failed")
            raise JiraApiError(
                status_code=err.code,
                code="JIRA_API_ERROR",
                message=message,
                details=details,
            ) from err
        except URLError as err:
            raise JiraApiError(
                status_code=None,
                code="JIRA_NETWORK_ERROR",
                message=str(getattr(err, "reason", err)),
                details={"backend": BACKEND_NAME, "url": url},
            ) from err

    # --- Projects ---

    def list_projects(self, *, limit: int = 50) -> dict[str, Any]:
        data = self._request("GET", "/project/search", params={"maxResults": min(limit, 100)})
        values = data.get("values") if isinstance(data, dict) else []
        projects = [_normalize_project(item) for item in values if isinstance(item, dict)] if isinstance(values, list) else []
        return {"projects": projects}

    def get_project(self, project_key: str) -> dict[str, Any]:
        data = self._request("GET", f"/project/{project_key}")
        if not isinstance(data, dict):
            raise JiraApiError(status_code=None, code="JIRA_EMPTY_RESPONSE", message="Jira did not return a project record", details={"backend": BACKEND_NAME})
        return _normalize_project(data)

    # --- Issues ---

    def list_issues(self, project_key: str, *, limit: int = 50) -> dict[str, Any]:
        jql = f"project = {project_key} ORDER BY updated DESC"
        return self.search_jql(jql=jql, limit=limit)

    def get_issue(self, issue_key: str) -> dict[str, Any]:
        data = self._request("GET", f"/issue/{issue_key}")
        if not isinstance(data, dict):
            raise JiraApiError(status_code=None, code="JIRA_EMPTY_RESPONSE", message="Jira did not return an issue record", details={"backend": BACKEND_NAME})
        return _normalize_issue(data)

    def create_issue(self, *, project_key: str, summary: str, issue_type: str = "Task", description: str | None = None, assignee: str | None = None) -> dict[str, Any]:
        fields: dict[str, Any] = {
            "project": {"key": project_key},
            "summary": summary,
            "issuetype": {"name": issue_type},
        }
        if description:
            fields["description"] = {
                "type": "doc",
                "version": 1,
                "content": [{"type": "paragraph", "content": [{"type": "text", "text": description}]}],
            }
        if assignee:
            fields["assignee"] = {"accountId": assignee}
        data = self._request("POST", "/issue", body={"fields": fields})
        if not isinstance(data, dict) or "key" not in data:
            return _dict_or_empty(data)
        # Fetch the created issue for full normalization
        return self.get_issue(data["key"])

    def update_issue(self, issue_key: str, *, summary: str | None = None, description: str | None = None, assignee: str | None = None) -> dict[str, Any]:
        fields: dict[str, Any] = {}
        if summary is not None:
            fields["summary"] = summary
        if description is not None:
            fields["description"] = {
                "type": "doc",
                "version": 1,
                "content": [{"type": "paragraph", "content": [{"type": "text", "text": description}]}],
            }
        if assignee is not None:
            fields["assignee"] = {"accountId": assignee}
        self._request("PUT", f"/issue/{issue_key}", body={"fields": fields})
        return self.get_issue(issue_key)

    def transition_issue(self, issue_key: str, *, transition_name: str) -> dict[str, Any]:
        # First get available transitions
        data = self._request("GET", f"/issue/{issue_key}/transitions")
        transitions = data.get("transitions") if isinstance(data, dict) else []
        target = None
        if isinstance(transitions, list):
            for t in transitions:
                if isinstance(t, dict) and (t.get("name") or "").lower() == transition_name.lower():
                    target = t
                    break
        if not target:
            available = [t.get("name") for t in transitions if isinstance(t, dict)] if isinstance(transitions, list) else []
            raise JiraApiError(
                status_code=None,
                code="JIRA_TRANSITION_NOT_FOUND",
                message=f"Transition '{transition_name}' not found. Available: {', '.join(available)}",
                details={"available_transitions": available},
            )
        self._request("POST", f"/issue/{issue_key}/transitions", body={"transition": {"id": target["id"]}})
        return self.get_issue(issue_key)

    def comment_issue(self, issue_key: str, *, body: str) -> dict[str, Any]:
        adf_body = {
            "type": "doc",
            "version": 1,
            "content": [{"type": "paragraph", "content": [{"type": "text", "text": body}]}],
        }
        data = self._request("POST", f"/issue/{issue_key}/comment", body={"body": adf_body})
        return _dict_or_empty(data)

    # --- Boards (Agile API) ---

    def list_boards(self, *, limit: int = 50, project_key: str | None = None) -> dict[str, Any]:
        params: dict[str, Any] = {"maxResults": min(limit, 100)}
        if project_key:
            params["projectKeyOrId"] = project_key
        data = self._request("GET", "/board", params=params, api_prefix="/rest/agile/1.0")
        values = data.get("values") if isinstance(data, dict) else []
        boards = [_normalize_board(item) for item in values if isinstance(item, dict)] if isinstance(values, list) else []
        return {"boards": boards}

    def get_board(self, board_id: int) -> dict[str, Any]:
        data = self._request("GET", f"/board/{board_id}", api_prefix="/rest/agile/1.0")
        if not isinstance(data, dict):
            raise JiraApiError(status_code=None, code="JIRA_EMPTY_RESPONSE", message="Jira did not return a board record", details={"backend": BACKEND_NAME})
        return _normalize_board(data)

    # --- Sprints (Agile API) ---

    def list_sprints(self, board_id: int, *, limit: int = 50) -> dict[str, Any]:
        data = self._request("GET", f"/board/{board_id}/sprint", params={"maxResults": min(limit, 100)}, api_prefix="/rest/agile/1.0")
        values = data.get("values") if isinstance(data, dict) else []
        sprints = [_normalize_sprint(item) for item in values if isinstance(item, dict)] if isinstance(values, list) else []
        return {"sprints": sprints}

    def get_sprint(self, sprint_id: int) -> dict[str, Any]:
        data = self._request("GET", f"/sprint/{sprint_id}", api_prefix="/rest/agile/1.0")
        if not isinstance(data, dict):
            raise JiraApiError(status_code=None, code="JIRA_EMPTY_RESPONSE", message="Jira did not return a sprint record", details={"backend": BACKEND_NAME})
        return _normalize_sprint(data)

    def sprint_issues(self, sprint_id: int, *, limit: int = 50) -> dict[str, Any]:
        data = self._request("GET", f"/sprint/{sprint_id}/issue", params={"maxResults": min(limit, 100)}, api_prefix="/rest/agile/1.0")
        issues_data = data.get("issues") if isinstance(data, dict) else []
        issues = [_normalize_issue(item) for item in issues_data if isinstance(item, dict)] if isinstance(issues_data, list) else []
        return {"issues": issues}

    # --- Search ---

    def search_jql(self, *, jql: str, limit: int = 50) -> dict[str, Any]:
        data = self._request("GET", "/search", params={"jql": jql, "maxResults": min(limit, 100)})
        issues_data = data.get("issues") if isinstance(data, dict) else []
        issues = [_normalize_issue(item) for item in issues_data if isinstance(item, dict)] if isinstance(issues_data, list) else []
        return {"issues": issues, "total": data.get("total") if isinstance(data, dict) else 0}

    # --- Probe ---

    def myself(self) -> dict[str, Any]:
        data = self._request("GET", "/myself")
        return _dict_or_empty(data)
