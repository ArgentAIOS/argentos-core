from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urljoin
from urllib.request import Request, urlopen

from .constants import BACKEND_NAME


@dataclass(slots=True)
class GitHubApiError(Exception):
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


def _normalize_repo(raw: dict[str, Any]) -> dict[str, Any]:
    owner = raw.get("owner") or {}
    return {
        "id": raw.get("id"),
        "full_name": raw.get("full_name"),
        "name": raw.get("name"),
        "owner": owner.get("login") if isinstance(owner, dict) else None,
        "description": raw.get("description"),
        "private": raw.get("private"),
        "default_branch": raw.get("default_branch"),
        "language": raw.get("language"),
        "stargazers_count": raw.get("stargazers_count"),
        "open_issues_count": raw.get("open_issues_count"),
        "updated_at": raw.get("updated_at"),
        "html_url": raw.get("html_url"),
        "raw": raw,
    }


def _normalize_issue(raw: dict[str, Any]) -> dict[str, Any]:
    assignee = raw.get("assignee") or {}
    labels = raw.get("labels") or []
    return {
        "number": raw.get("number"),
        "title": raw.get("title"),
        "state": raw.get("state"),
        "assignee": assignee.get("login") if isinstance(assignee, dict) else None,
        "labels": [lbl.get("name") if isinstance(lbl, dict) else str(lbl) for lbl in labels] if isinstance(labels, list) else [],
        "body": raw.get("body"),
        "created_at": raw.get("created_at"),
        "updated_at": raw.get("updated_at"),
        "html_url": raw.get("html_url"),
        "raw": raw,
    }


def _normalize_pr(raw: dict[str, Any]) -> dict[str, Any]:
    user = raw.get("user") or {}
    head = raw.get("head") or {}
    base = raw.get("base") or {}
    return {
        "number": raw.get("number"),
        "title": raw.get("title"),
        "state": raw.get("state"),
        "author": user.get("login") if isinstance(user, dict) else None,
        "head_branch": head.get("ref") if isinstance(head, dict) else None,
        "base_branch": base.get("ref") if isinstance(base, dict) else None,
        "mergeable": raw.get("mergeable"),
        "draft": raw.get("draft"),
        "body": raw.get("body"),
        "created_at": raw.get("created_at"),
        "updated_at": raw.get("updated_at"),
        "html_url": raw.get("html_url"),
        "raw": raw,
    }


def _normalize_branch(raw: dict[str, Any]) -> dict[str, Any]:
    commit = raw.get("commit") or {}
    return {
        "name": raw.get("name"),
        "commit_sha": commit.get("sha") if isinstance(commit, dict) else None,
        "protected": raw.get("protected"),
        "raw": raw,
    }


def _normalize_workflow_run(raw: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": raw.get("id"),
        "name": raw.get("name"),
        "status": raw.get("status"),
        "conclusion": raw.get("conclusion"),
        "head_branch": raw.get("head_branch"),
        "event": raw.get("event"),
        "created_at": raw.get("created_at"),
        "updated_at": raw.get("updated_at"),
        "html_url": raw.get("html_url"),
        "raw": raw,
    }


def _normalize_release(raw: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": raw.get("id"),
        "tag_name": raw.get("tag_name"),
        "name": raw.get("name"),
        "draft": raw.get("draft"),
        "prerelease": raw.get("prerelease"),
        "body": raw.get("body"),
        "published_at": raw.get("published_at"),
        "html_url": raw.get("html_url"),
        "raw": raw,
    }


class GitHubClient:
    def __init__(self, *, token: str) -> None:
        self._token = token.strip()
        self._base_url = "https://api.github.com"
        self._user_agent = "aos-github/0.1.0"

    def _request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        body: dict[str, Any] | None = None,
    ) -> Any:
        url = urljoin(self._base_url + "/", path.lstrip("/"))
        if params:
            query = urlencode([(key, str(value)) for key, value in params.items() if value is not None])
            if query:
                url = f"{url}?{query}"
        payload = json.dumps(body).encode("utf-8") if body is not None else None
        headers = {
            "Authorization": f"Bearer {self._token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": self._user_agent,
        }
        if payload is not None:
            headers["Content-Type"] = "application/json"
        request = Request(url, data=payload, method=method.upper(), headers=headers)
        try:
            with urlopen(request, timeout=30) as response:
                raw = _load_json(response.read())
                return raw
        except HTTPError as err:
            details: dict[str, Any] = {}
            try:
                details = _dict_or_empty(_load_json(err.read()))
            except Exception:
                details = {}
            code = str(details.get("message") or "GITHUB_API_ERROR")
            message = str(details.get("message") or err.reason or "GitHub API request failed")
            raise GitHubApiError(
                status_code=err.code,
                code=code,
                message=message,
                details=details,
            ) from err
        except URLError as err:
            raise GitHubApiError(
                status_code=None,
                code="GITHUB_NETWORK_ERROR",
                message=str(getattr(err, "reason", err)),
                details={"backend": BACKEND_NAME, "url": url},
            ) from err

    # --- Repos ---

    def list_repos(self, *, owner: str | None = None, limit: int = 30) -> dict[str, Any]:
        if owner:
            path = f"/users/{owner}/repos"
        else:
            path = "/user/repos"
        data = self._request("GET", path, params={"per_page": min(limit, 100), "sort": "updated"})
        repos = [_normalize_repo(item) for item in data if isinstance(item, dict)] if isinstance(data, list) else []
        return {"repos": repos}

    def get_repo(self, owner: str, repo: str) -> dict[str, Any]:
        data = self._request("GET", f"/repos/{owner}/{repo}")
        if not isinstance(data, dict):
            raise GitHubApiError(status_code=None, code="GITHUB_EMPTY_RESPONSE", message="GitHub did not return a repo record", details={"backend": BACKEND_NAME})
        return _normalize_repo(data)

    # --- Issues ---

    def list_issues(self, owner: str, repo: str, *, limit: int = 30, state: str = "open") -> dict[str, Any]:
        data = self._request("GET", f"/repos/{owner}/{repo}/issues", params={"per_page": min(limit, 100), "state": state})
        issues = [_normalize_issue(item) for item in data if isinstance(item, dict) and "pull_request" not in item] if isinstance(data, list) else []
        return {"issues": issues}

    def get_issue(self, owner: str, repo: str, number: int) -> dict[str, Any]:
        data = self._request("GET", f"/repos/{owner}/{repo}/issues/{number}")
        if not isinstance(data, dict):
            raise GitHubApiError(status_code=None, code="GITHUB_EMPTY_RESPONSE", message="GitHub did not return an issue record", details={"backend": BACKEND_NAME})
        return _normalize_issue(data)

    def create_issue(self, owner: str, repo: str, *, title: str, body: str | None = None, labels: list[str] | None = None, assignees: list[str] | None = None) -> dict[str, Any]:
        payload: dict[str, Any] = {"title": title}
        if body:
            payload["body"] = body
        if labels:
            payload["labels"] = labels
        if assignees:
            payload["assignees"] = assignees
        data = self._request("POST", f"/repos/{owner}/{repo}/issues", body=payload)
        return _normalize_issue(data) if isinstance(data, dict) else {}

    def update_issue(self, owner: str, repo: str, number: int, *, title: str | None = None, body: str | None = None, state: str | None = None, labels: list[str] | None = None, assignees: list[str] | None = None) -> dict[str, Any]:
        payload: dict[str, Any] = {}
        if title is not None:
            payload["title"] = title
        if body is not None:
            payload["body"] = body
        if state is not None:
            payload["state"] = state
        if labels is not None:
            payload["labels"] = labels
        if assignees is not None:
            payload["assignees"] = assignees
        data = self._request("PATCH", f"/repos/{owner}/{repo}/issues/{number}", body=payload)
        return _normalize_issue(data) if isinstance(data, dict) else {}

    def comment_issue(self, owner: str, repo: str, number: int, *, body: str) -> dict[str, Any]:
        data = self._request("POST", f"/repos/{owner}/{repo}/issues/{number}/comments", body={"body": body})
        return _dict_or_empty(data)

    # --- Pull Requests ---

    def list_prs(self, owner: str, repo: str, *, limit: int = 30, state: str = "open") -> dict[str, Any]:
        data = self._request("GET", f"/repos/{owner}/{repo}/pulls", params={"per_page": min(limit, 100), "state": state})
        prs = [_normalize_pr(item) for item in data if isinstance(item, dict)] if isinstance(data, list) else []
        return {"prs": prs}

    def get_pr(self, owner: str, repo: str, number: int) -> dict[str, Any]:
        data = self._request("GET", f"/repos/{owner}/{repo}/pulls/{number}")
        if not isinstance(data, dict):
            raise GitHubApiError(status_code=None, code="GITHUB_EMPTY_RESPONSE", message="GitHub did not return a PR record", details={"backend": BACKEND_NAME})
        return _normalize_pr(data)

    def create_pr(self, owner: str, repo: str, *, title: str, head: str, base: str, body: str | None = None, draft: bool = False) -> dict[str, Any]:
        payload: dict[str, Any] = {"title": title, "head": head, "base": base, "draft": draft}
        if body:
            payload["body"] = body
        data = self._request("POST", f"/repos/{owner}/{repo}/pulls", body=payload)
        return _normalize_pr(data) if isinstance(data, dict) else {}

    def merge_pr(self, owner: str, repo: str, number: int, *, merge_method: str = "merge") -> dict[str, Any]:
        data = self._request("PUT", f"/repos/{owner}/{repo}/pulls/{number}/merge", body={"merge_method": merge_method})
        return _dict_or_empty(data)

    def review_pr(self, owner: str, repo: str, number: int, *, event: str = "APPROVE", body: str | None = None) -> dict[str, Any]:
        payload: dict[str, Any] = {"event": event}
        if body:
            payload["body"] = body
        data = self._request("POST", f"/repos/{owner}/{repo}/pulls/{number}/reviews", body=payload)
        return _dict_or_empty(data)

    # --- Branches ---

    def list_branches(self, owner: str, repo: str, *, limit: int = 30) -> dict[str, Any]:
        data = self._request("GET", f"/repos/{owner}/{repo}/branches", params={"per_page": min(limit, 100)})
        branches = [_normalize_branch(item) for item in data if isinstance(item, dict)] if isinstance(data, list) else []
        return {"branches": branches}

    def create_branch(self, owner: str, repo: str, *, branch: str, sha: str) -> dict[str, Any]:
        data = self._request("POST", f"/repos/{owner}/{repo}/git/refs", body={"ref": f"refs/heads/{branch}", "sha": sha})
        return _dict_or_empty(data)

    # --- Actions ---

    def list_workflow_runs(self, owner: str, repo: str, *, limit: int = 10) -> dict[str, Any]:
        data = self._request("GET", f"/repos/{owner}/{repo}/actions/runs", params={"per_page": min(limit, 100)})
        runs_data = data.get("workflow_runs") if isinstance(data, dict) else []
        runs = [_normalize_workflow_run(item) for item in runs_data if isinstance(item, dict)] if isinstance(runs_data, list) else []
        return {"workflow_runs": runs, "total_count": data.get("total_count") if isinstance(data, dict) else 0}

    def trigger_workflow(self, owner: str, repo: str, *, workflow_id: str, ref: str = "main", inputs: dict[str, Any] | None = None) -> dict[str, Any]:
        payload: dict[str, Any] = {"ref": ref}
        if inputs:
            payload["inputs"] = inputs
        self._request("POST", f"/repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches", body=payload)
        return {"triggered": True, "workflow_id": workflow_id, "ref": ref}

    # --- Releases ---

    def list_releases(self, owner: str, repo: str, *, limit: int = 10) -> dict[str, Any]:
        data = self._request("GET", f"/repos/{owner}/{repo}/releases", params={"per_page": min(limit, 100)})
        releases = [_normalize_release(item) for item in data if isinstance(item, dict)] if isinstance(data, list) else []
        return {"releases": releases}

    def create_release(self, owner: str, repo: str, *, tag_name: str, name: str | None = None, body: str | None = None, draft: bool = False, prerelease: bool = False) -> dict[str, Any]:
        payload: dict[str, Any] = {"tag_name": tag_name, "draft": draft, "prerelease": prerelease}
        if name:
            payload["name"] = name
        if body:
            payload["body"] = body
        data = self._request("POST", f"/repos/{owner}/{repo}/releases", body=payload)
        return _normalize_release(data) if isinstance(data, dict) else {}
