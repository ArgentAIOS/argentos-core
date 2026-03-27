from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from click.testing import CliRunner

from cli_aos.jira.cli import cli
import cli_aos.jira.runtime as runtime


AGENT_HARNESS_ROOT = Path(__file__).resolve().parents[1]
CONNECTOR_PATH = AGENT_HARNESS_ROOT.parent / "connector.json"
PERMISSIONS_PATH = AGENT_HARNESS_ROOT / "permissions.json"


class FakeJiraClient:
    def myself(self) -> dict[str, Any]:
        return {"displayName": "Jason Brashear", "emailAddress": "jason@example.com", "accountId": "abc123"}

    def list_projects(self, *, limit: int = 50) -> dict[str, Any]:
        return {"projects": [
            {"id": "10001", "key": "ARG", "name": "ArgentOS", "projectTypeKey": "software", "lead": "Jason Brashear"},
            {"id": "10002", "key": "TITAN", "name": "Titan Agent", "projectTypeKey": "software", "lead": "Jason Brashear"},
        ][:limit]}

    def get_project(self, project_key: str) -> dict[str, Any]:
        return {"id": "10001", "key": project_key, "name": "ArgentOS", "projectTypeKey": "software", "lead": "Jason Brashear"}

    def list_issues(self, project_key: str, *, limit: int = 50) -> dict[str, Any]:
        return self.search_jql(jql=f"project = {project_key}", limit=limit)

    def get_issue(self, issue_key: str) -> dict[str, Any]:
        return {"key": issue_key, "id": "10100", "summary": "Fix login bug", "status": "To Do", "assignee": "Jason Brashear", "issuetype": "Bug", "priority": "High"}

    def create_issue(self, *, project_key: str, summary: str, issue_type: str = "Task", description: str | None = None, assignee: str | None = None) -> dict[str, Any]:
        return {"key": f"{project_key}-99", "id": "10199", "summary": summary, "status": "To Do", "issuetype": issue_type}

    def update_issue(self, issue_key: str, *, summary: str | None = None, description: str | None = None, assignee: str | None = None) -> dict[str, Any]:
        return {"key": issue_key, "id": "10100", "summary": summary or "Fix login bug", "status": "To Do"}

    def transition_issue(self, issue_key: str, *, transition_name: str) -> dict[str, Any]:
        return {"key": issue_key, "id": "10100", "summary": "Fix login bug", "status": transition_name}

    def comment_issue(self, issue_key: str, *, body: str) -> dict[str, Any]:
        return {"id": "20001", "body": body}

    def list_boards(self, *, limit: int = 50, project_key: str | None = None) -> dict[str, Any]:
        return {"boards": [
            {"id": 1, "name": "ARG board", "type": "scrum", "project_key": "ARG"},
        ]}

    def get_board(self, board_id: int) -> dict[str, Any]:
        return {"id": board_id, "name": "ARG board", "type": "scrum"}

    def list_sprints(self, board_id: int, *, limit: int = 50) -> dict[str, Any]:
        return {"sprints": [
            {"id": 100, "name": "Sprint 1", "state": "active", "startDate": "2026-03-15", "endDate": "2026-03-29", "goal": "Ship v1"},
        ]}

    def get_sprint(self, sprint_id: int) -> dict[str, Any]:
        return {"id": sprint_id, "name": "Sprint 1", "state": "active", "goal": "Ship v1"}

    def sprint_issues(self, sprint_id: int, *, limit: int = 50) -> dict[str, Any]:
        return {"issues": [
            {"key": "ARG-1", "summary": "Fix login bug", "status": "In Progress"},
            {"key": "ARG-2", "summary": "Add dashboard", "status": "To Do"},
        ][:limit]}

    def search_jql(self, *, jql: str, limit: int = 50) -> dict[str, Any]:
        return {"issues": [
            {"key": "ARG-1", "summary": "Fix login bug", "status": "To Do", "issuetype": "Bug"},
            {"key": "ARG-2", "summary": "Add dashboard", "status": "In Progress", "issuetype": "Story"},
        ][:limit], "total": 2}


def invoke_json(args: list[str]) -> dict[str, Any]:
    result = CliRunner().invoke(cli, ["--json", *args])
    assert result.exit_code == 0, result.output
    return json.loads(result.output)


def invoke_json_with_mode(mode: str, args: list[str]) -> dict[str, Any]:
    result = CliRunner().invoke(cli, ["--json", "--mode", mode, *args])
    assert result.exit_code == 0, result.output
    return json.loads(result.output)


def test_manifest_and_permissions_are_in_sync():
    manifest = json.loads(CONNECTOR_PATH.read_text())
    permissions = json.loads(PERMISSIONS_PATH.read_text())["permissions"]
    command_ids = [command["id"] for command in manifest["commands"]]
    assert set(command_ids) == set(permissions.keys())
    assert manifest["scope"]["kind"] == "project-management"


def test_capabilities_exposes_manifest():
    payload = invoke_json(["capabilities"])
    assert payload["tool"] == "aos-jira"
    assert payload["data"]["backend"] == "jira-api"
    assert "issue.list" in json.dumps(payload["data"])
    assert "sprint.list" in json.dumps(payload["data"])


def test_health_requires_credentials(monkeypatch):
    monkeypatch.delenv("JIRA_BASE_URL", raising=False)
    monkeypatch.delenv("JIRA_EMAIL", raising=False)
    monkeypatch.delenv("JIRA_API_TOKEN", raising=False)
    payload = invoke_json(["health"])
    assert payload["data"]["status"] == "needs_setup"
    assert "JIRA_API_TOKEN" in json.dumps(payload["data"])


def test_health_ready_with_fake_client(monkeypatch):
    monkeypatch.setenv("JIRA_BASE_URL", "https://test.atlassian.net")
    monkeypatch.setenv("JIRA_EMAIL", "jason@example.com")
    monkeypatch.setenv("JIRA_API_TOKEN", "test_token_abc")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeJiraClient())
    payload = invoke_json(["health"])
    assert payload["data"]["status"] == "ready"
    assert payload["data"]["probe"]["ok"] is True


def test_project_list_returns_picker_metadata(monkeypatch):
    monkeypatch.setenv("JIRA_BASE_URL", "https://test.atlassian.net")
    monkeypatch.setenv("JIRA_EMAIL", "jason@example.com")
    monkeypatch.setenv("JIRA_API_TOKEN", "test_token_abc")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeJiraClient())
    payload = invoke_json(["project", "list"])
    data = payload["data"]
    assert data["project_count"] == 2
    assert data["picker"]["kind"] == "project"
    assert data["scope_preview"]["command_id"] == "project.list"


def test_issue_list_returns_picker_metadata(monkeypatch):
    monkeypatch.setenv("JIRA_BASE_URL", "https://test.atlassian.net")
    monkeypatch.setenv("JIRA_EMAIL", "jason@example.com")
    monkeypatch.setenv("JIRA_API_TOKEN", "test_token_abc")
    monkeypatch.setenv("JIRA_PROJECT_KEY", "ARG")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeJiraClient())
    payload = invoke_json(["issue", "list"])
    data = payload["data"]
    assert data["issue_count"] == 2
    assert data["picker"]["kind"] == "issue"
    assert data["scope_preview"]["selection_surface"] == "issue"


def test_issue_create_requires_write_mode(monkeypatch):
    monkeypatch.setenv("JIRA_BASE_URL", "https://test.atlassian.net")
    monkeypatch.setenv("JIRA_EMAIL", "jason@example.com")
    monkeypatch.setenv("JIRA_API_TOKEN", "test_token_abc")
    monkeypatch.setenv("JIRA_PROJECT_KEY", "ARG")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeJiraClient())
    result = CliRunner().invoke(cli, ["--json", "--mode", "readonly", "issue", "create", "--summary", "Test"])
    assert result.exit_code != 0


def test_issue_create_with_write_mode(monkeypatch):
    monkeypatch.setenv("JIRA_BASE_URL", "https://test.atlassian.net")
    monkeypatch.setenv("JIRA_EMAIL", "jason@example.com")
    monkeypatch.setenv("JIRA_API_TOKEN", "test_token_abc")
    monkeypatch.setenv("JIRA_PROJECT_KEY", "ARG")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeJiraClient())
    payload = invoke_json_with_mode("write", ["issue", "create", "--summary", "New task"])
    assert payload["data"]["status"] == "live_write"
    assert payload["data"]["issue"]["key"] == "ARG-99"


def test_board_list_returns_picker_metadata(monkeypatch):
    monkeypatch.setenv("JIRA_BASE_URL", "https://test.atlassian.net")
    monkeypatch.setenv("JIRA_EMAIL", "jason@example.com")
    monkeypatch.setenv("JIRA_API_TOKEN", "test_token_abc")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeJiraClient())
    payload = invoke_json(["board", "list"])
    data = payload["data"]
    assert data["board_count"] == 1
    assert data["picker"]["kind"] == "board"


def test_sprint_list_returns_picker_metadata(monkeypatch):
    monkeypatch.setenv("JIRA_BASE_URL", "https://test.atlassian.net")
    monkeypatch.setenv("JIRA_EMAIL", "jason@example.com")
    monkeypatch.setenv("JIRA_API_TOKEN", "test_token_abc")
    monkeypatch.setenv("JIRA_BOARD_ID", "1")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeJiraClient())
    payload = invoke_json(["sprint", "list"])
    data = payload["data"]
    assert data["sprint_count"] == 1
    assert data["picker"]["kind"] == "sprint"


def test_search_jql_returns_results(monkeypatch):
    monkeypatch.setenv("JIRA_BASE_URL", "https://test.atlassian.net")
    monkeypatch.setenv("JIRA_EMAIL", "jason@example.com")
    monkeypatch.setenv("JIRA_API_TOKEN", "test_token_abc")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeJiraClient())
    payload = invoke_json(["search", "jql", "--jql", "project = ARG"])
    data = payload["data"]
    assert data["issue_count"] == 2
    assert data["total"] == 2
    assert data["jql"] == "project = ARG"
