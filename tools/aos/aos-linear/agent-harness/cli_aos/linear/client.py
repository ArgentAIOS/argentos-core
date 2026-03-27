from __future__ import annotations

import json
from typing import Any
from urllib import error, request

from .config import runtime_config
from .errors import CliError


def _json_request(*, method: str, url: str, headers: dict[str, str], payload: dict[str, Any] | None = None) -> dict[str, Any]:
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = request.Request(url, data=data, headers=headers, method=method)
    try:
        with request.urlopen(req, timeout=30) as response:
            body = response.read().decode("utf-8")
            return json.loads(body) if body else {}
    except error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise CliError(
            code="UPSTREAM_HTTP_ERROR",
            message=f"Linear GraphQL returned HTTP {exc.code}.",
            details={"status": exc.code, "body": detail},
        ) from exc
    except error.URLError as exc:
        raise CliError(
            code="NETWORK_ERROR",
            message="Linear GraphQL is not reachable.",
            details={"reason": str(exc.reason)},
        ) from exc


def _graphql(query: str, variables: dict[str, Any] | None = None, ctx_obj: dict[str, Any] | None = None) -> dict[str, Any]:
    config = runtime_config(ctx_obj)
    api_key = str(config["api_key"] or "")
    if not api_key:
        raise CliError(code="AUTH_REQUIRED", message="LINEAR_API_KEY is not available.")
    payload: dict[str, Any] = {"query": query}
    if variables:
        payload["variables"] = variables
    response = _json_request(
        method="POST",
        url=str(config["base_url"]),
        headers={
            "Content-Type": "application/json",
            "Authorization": api_key,
            "Accept": "application/json",
        },
        payload=payload,
    )
    if response.get("errors"):
        first_error = response["errors"][0]
        raise CliError(
            code="GRAPHQL_ERROR",
            message=first_error.get("message", "Linear GraphQL error"),
            details={"errors": response["errors"]},
        )
    return response.get("data") or {}


def _stringify(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    return str(value)


def _matches_text(haystack: str | None, needle: str | None) -> bool:
    if not needle:
        return True
    if not haystack:
        return False
    return needle.strip().lower() in haystack.strip().lower()


def _resolve_team(ctx_obj: dict[str, Any] | None = None) -> dict[str, Any]:
    config = runtime_config(ctx_obj)
    if config["team_id"]:
        data = _graphql(
            "query TeamById($id: String!) { team(id: $id) { id name key } }",
            {"id": config["team_id"]},
            ctx_obj,
        )
        team = data.get("team")
        if team:
            return team
    data = _graphql(
        "query Teams { teams { nodes { id name key } } }",
        None,
        ctx_obj,
    )
    target_key = config["team_key"].strip().lower()
    for team in data.get("teams", {}).get("nodes", []) or []:
        if _stringify(team.get("key")).strip().lower() == target_key:
            return team
    nodes = data.get("teams", {}).get("nodes", []) or []
    if not nodes:
        raise CliError(code="NOT_FOUND", message="No Linear teams were returned by the API.")
    return nodes[0]


def _resolve_project(project_ref: str, ctx_obj: dict[str, Any] | None = None) -> dict[str, Any]:
    target = project_ref.strip().lower()
    data = _graphql(
        "query Projects { projects { nodes { id name } } }",
        None,
        ctx_obj,
    )
    for project in data.get("projects", {}).get("nodes", []) or []:
        if _stringify(project.get("id")).strip().lower() == target:
            return project
        if _stringify(project.get("name")).strip().lower() == target:
            return project
    raise CliError(code="NOT_FOUND", message=f'No Linear project matched "{project_ref}".')


def _resolve_state(status_ref: str, *, team_key: str | None = None, ctx_obj: dict[str, Any] | None = None) -> dict[str, Any]:
    target = status_ref.strip().lower()
    data = _graphql(
        "query WorkflowStates { workflowStates { nodes { id name type team { id name key } } } }",
        None,
        ctx_obj,
    )
    states = data.get("workflowStates", {}).get("nodes", []) or []
    for state in states:
        state_team = state.get("team") or {}
        if team_key and _stringify(state_team.get("key")).strip().lower() not in {"", team_key.strip().lower()}:
            continue
        if _stringify(state.get("id")).strip().lower() == target:
            return state
        if _stringify(state.get("name")).strip().lower() == target:
            return state
        if _stringify(state.get("type")).strip().lower() == target:
            return state
    raise CliError(code="NOT_FOUND", message=f'No Linear workflow state matched "{status_ref}".')


def _resolve_user(user_ref: str, ctx_obj: dict[str, Any] | None = None) -> dict[str, Any]:
    target = user_ref.strip().lower()
    data = _graphql(
        "query Users { users { nodes { id name email } } }",
        None,
        ctx_obj,
    )
    for user in data.get("users", {}).get("nodes", []) or []:
        if _stringify(user.get("id")).strip().lower() == target:
            return user
        if _stringify(user.get("name")).strip().lower() == target:
            return user
        if _stringify(user.get("email")).strip().lower() == target:
            return user
    raise CliError(code="NOT_FOUND", message=f'No Linear user matched "{user_ref}".')


def _issue_fields() -> str:
    return (
        "id identifier title description priority url archivedAt createdAt updatedAt "
        "state { id name type } "
        "assignee { id name email } "
        "project { id name } "
        "team { id name key }"
    )


def _normalize_issue(issue: dict[str, Any]) -> dict[str, Any]:
    state = issue.get("state") or {}
    assignee = issue.get("assignee") or {}
    project = issue.get("project") or {}
    team = issue.get("team") or {}
    return {
        "id": issue.get("id"),
        "identifier": issue.get("identifier"),
        "title": issue.get("title"),
        "description": issue.get("description"),
        "priority": issue.get("priority"),
        "url": issue.get("url"),
        "archivedAt": issue.get("archivedAt"),
        "createdAt": issue.get("createdAt"),
        "updatedAt": issue.get("updatedAt"),
        "state": {
            "id": state.get("id"),
            "name": state.get("name"),
            "type": state.get("type"),
        },
        "assignee": {
            "id": assignee.get("id"),
            "name": assignee.get("name"),
            "email": assignee.get("email"),
        },
        "project": {
            "id": project.get("id"),
            "name": project.get("name"),
        },
        "team": {
            "id": team.get("id"),
            "name": team.get("name"),
            "key": team.get("key"),
        },
    }


def _project_issue_count(project_id: str, ctx_obj: dict[str, Any] | None = None) -> int:
    total = 0
    after: str | None = None
    while True:
        data = _graphql(
            "query ProjectIssues($id: String!, $after: String) { project(id: $id) { issues(first: 100, after: $after) { nodes { id } pageInfo { hasNextPage endCursor } } } }",
            {"id": project_id, "after": after},
            ctx_obj,
        )
        issues = (((data.get("project") or {}).get("issues") or {}).get("nodes") or [])
        total += len(issues)
        page_info = ((data.get("project") or {}).get("issues") or {}).get("pageInfo") or {}
        if not page_info.get("hasNextPage"):
            return total
        after = page_info.get("endCursor")


def list_projects(*, limit: int = 100, ctx_obj: dict[str, Any] | None = None) -> dict[str, Any]:
    data = _graphql(
        "query Projects { projects { nodes { id name description } } }",
        None,
        ctx_obj,
    )
    projects = []
    for project in (data.get("projects", {}).get("nodes", []) or [])[: max(1, min(int(limit), 1000))]:
        count = _project_issue_count(_stringify(project.get("id")), ctx_obj)
        projects.append(
            {
                "id": project.get("id"),
                "name": project.get("name"),
                "description": project.get("description"),
                "issueCount": count,
            }
        )
    return {"projects": projects, "count": len(projects)}


def _fetch_team_issues(*, team_id: str, include_archived: bool, after: str | None, limit: int, ctx_obj: dict[str, Any] | None = None) -> dict[str, Any]:
    return _graphql(
        f"query TeamIssues($id: String!, $after: String, $first: Int!, $includeArchived: Boolean) {{ team(id: $id) {{ issues(first: $first, after: $after, includeArchived: $includeArchived) {{ nodes {{ {_issue_fields()} }} pageInfo {{ hasNextPage endCursor }} }} }} }}",
        {"id": team_id, "after": after, "first": limit, "includeArchived": include_archived},
        ctx_obj,
    )


def _issue_matches(issue: dict[str, Any], *, query: str | None = None, project: str | None = None, status: str | None = None, assignee: str | None = None) -> bool:
    if project:
        project_target = project.strip().lower()
        project_obj = issue.get("project") or {}
        if project_target not in {
            _stringify(project_obj.get("id")).strip().lower(),
            _stringify(project_obj.get("name")).strip().lower(),
        }:
            return False
    if status:
        status_target = status.strip().lower()
        state_obj = issue.get("state") or {}
        if status_target not in {
            _stringify(state_obj.get("id")).strip().lower(),
            _stringify(state_obj.get("name")).strip().lower(),
            _stringify(state_obj.get("type")).strip().lower(),
        }:
            return False
    if assignee:
        assignee_target = assignee.strip().lower()
        assignee_obj = issue.get("assignee") or {}
        if assignee_target not in {
            _stringify(assignee_obj.get("id")).strip().lower(),
            _stringify(assignee_obj.get("name")).strip().lower(),
            _stringify(assignee_obj.get("email")).strip().lower(),
        }:
            return False
    if query:
        haystack = " | ".join(
            filter(
                None,
                [
                    _stringify(issue.get("identifier")),
                    _stringify(issue.get("title")),
                    _stringify(issue.get("description")),
                    _stringify((issue.get("project") or {}).get("name")),
                    _stringify((issue.get("state") or {}).get("name")),
                    _stringify((issue.get("assignee") or {}).get("name")),
                    _stringify((issue.get("assignee") or {}).get("email")),
                ],
            )
        )
        if not _matches_text(haystack, query):
            return False
    return True


def list_issues(
    *,
    limit: int = 20,
    query: str | None = None,
    project: str | None = None,
    status: str | None = None,
    assignee: str | None = None,
    include_archived: bool = False,
    cursor: str | None = None,
    ctx_obj: dict[str, Any] | None = None,
) -> dict[str, Any]:
    team = _resolve_team(ctx_obj)
    team_id = _stringify(team.get("id"))
    after = cursor
    matched: list[dict[str, Any]] = []
    page_size = max(1, min(int(limit), 100))
    while len(matched) < limit:
        data = _fetch_team_issues(
            team_id=team_id,
            include_archived=include_archived,
            after=after,
            limit=page_size,
            ctx_obj=ctx_obj,
        )
        team_issue_conn = ((data.get("team") or {}).get("issues") or {})
        nodes = team_issue_conn.get("nodes", []) or []
        for issue in nodes:
            if _issue_matches(issue, query=query, project=project, status=status, assignee=assignee):
                matched.append(_normalize_issue(issue))
                if len(matched) >= limit:
                    break
        page_info = team_issue_conn.get("pageInfo") or {}
        if not page_info.get("hasNextPage"):
            break
        after = page_info.get("endCursor")
        if not after:
            break
    return {
        "team": {"id": team_id, "name": team.get("name"), "key": team.get("key")},
        "count": len(matched),
        "issues": matched,
        "filters": {
            "query": query,
            "project": project,
            "status": status,
            "assignee": assignee,
            "include_archived": include_archived,
            "cursor": cursor,
        },
    }


def search_issues(*, query: str, limit: int = 20, project: str | None = None, status: str | None = None, assignee: str | None = None, include_archived: bool = False, ctx_obj: dict[str, Any] | None = None) -> dict[str, Any]:
    return list_issues(
        limit=limit,
        query=query,
        project=project,
        status=status,
        assignee=assignee,
        include_archived=include_archived,
        ctx_obj=ctx_obj,
    )


def get_issue(issue_identifier: str, ctx_obj: dict[str, Any] | None = None) -> dict[str, Any]:
    data = _graphql(
        "query Issue($id: String!) { issue(id: $id) { id identifier title description priority url archivedAt createdAt updatedAt state { id name type } assignee { id name email } project { id name } team { id name key } } }",
        {"id": issue_identifier},
        ctx_obj,
    )
    issue = data.get("issue")
    if not issue:
        raise CliError(code="NOT_FOUND", message=f'No Linear issue matched "{issue_identifier}".')
    return {"issue": _normalize_issue(issue)}


def create_issue(
    *,
    title: str,
    description: str | None = None,
    project: str | None = None,
    priority: int | None = None,
    status: str | None = None,
    assignee: str | None = None,
    team_key: str | None = None,
    ctx_obj: dict[str, Any] | None = None,
) -> dict[str, Any]:
    team = _resolve_team({**(ctx_obj or {}), "team_key": team_key or (ctx_obj or {}).get("team_key")})
    input_payload: dict[str, Any] = {"title": title.strip(), "teamId": _stringify(team.get("id"))}
    if description and description.strip():
        input_payload["description"] = description.strip()
    if priority is not None:
        input_payload["priority"] = int(priority)
    if project and project.strip():
        input_payload["projectId"] = _resolve_project(project, ctx_obj).get("id")
    if status and status.strip():
        input_payload["stateId"] = _resolve_state(status, team_key=_stringify(team.get("key")), ctx_obj=ctx_obj).get("id")
    if assignee and assignee.strip():
        input_payload["assigneeId"] = _resolve_user(assignee, ctx_obj).get("id")
    data = _graphql(
        "mutation CreateIssue($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { id identifier title } } }",
        {"input": input_payload},
        ctx_obj,
    )
    result = data.get("issueCreate") or {}
    return {"success": bool(result.get("success")), "issue": _normalize_issue(result.get("issue") or {})}


def update_issue(
    *,
    issue_id: str,
    title: str | None = None,
    description: str | None = None,
    project: str | None = None,
    priority: int | None = None,
    status: str | None = None,
    assignee: str | None = None,
    team_key: str | None = None,
    ctx_obj: dict[str, Any] | None = None,
) -> dict[str, Any]:
    team = _resolve_team({**(ctx_obj or {}), "team_key": team_key or (ctx_obj or {}).get("team_key")})
    input_payload: dict[str, Any] = {}
    if title and title.strip():
        input_payload["title"] = title.strip()
    if description and description.strip():
        input_payload["description"] = description.strip()
    if priority is not None:
        input_payload["priority"] = int(priority)
    if project and project.strip():
        input_payload["projectId"] = _resolve_project(project, ctx_obj).get("id")
    if status and status.strip():
        input_payload["stateId"] = _resolve_state(status, team_key=_stringify(team.get("key")), ctx_obj=ctx_obj).get("id")
    if assignee and assignee.strip():
        input_payload["assigneeId"] = _resolve_user(assignee, ctx_obj).get("id")
    data = _graphql(
        "mutation UpdateIssue($id: String!, $input: IssueUpdateInput!) { issueUpdate(id: $id, input: $input) { success issue { id identifier title } } }",
        {"id": issue_id, "input": input_payload},
        ctx_obj,
    )
    result = data.get("issueUpdate") or {}
    return {"success": bool(result.get("success")), "issue": _normalize_issue(result.get("issue") or {})}
