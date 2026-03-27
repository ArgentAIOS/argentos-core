from click.testing import CliRunner

import cli_aos.linear.client as client
from cli_aos.linear.cli import cli


def test_capabilities_json() -> None:
    result = CliRunner().invoke(cli, ["--json", "capabilities"])
    assert result.exit_code == 0
    assert '"tool": "aos-linear"' in result.output
    assert '"create-issue"' in result.output


def test_config_show_redacts_api_key() -> None:
    result = CliRunner().invoke(
        cli,
        ["--json", "config", "show"],
        env={"LINEAR_API_KEY": "secret-linear-key", "LINEAR_TEAM_KEY": "OPS"},
    )
    assert result.exit_code == 0
    assert "secret-linear-key" not in result.output
    assert '"team_key": "OPS"' in result.output


def test_list_issues_filters_locally(monkeypatch) -> None:
    monkeypatch.setattr(
        client,
        "_resolve_team",
        lambda ctx_obj=None: {"id": "team-1", "name": "Webdevtoday", "key": "WEB"},
    )
    monkeypatch.setattr(
        client,
        "_fetch_team_issues",
        lambda **kwargs: {
            "team": {
                "issues": {
                    "nodes": [
                        {
                            "id": "issue-1",
                            "identifier": "WEB-1",
                            "title": "Kernel recovery",
                            "description": "Restore memory continuity",
                            "priority": 1,
                            "state": {"id": "state-1", "name": "Todo", "type": "unstarted"},
                            "assignee": {"id": "user-1", "name": "Jason", "email": "jason@example.com"},
                            "project": {"id": "proj-1", "name": "ArgentOS"},
                            "team": {"id": "team-1", "name": "Webdevtoday", "key": "WEB"},
                        },
                        {
                            "id": "issue-2",
                            "identifier": "WEB-2",
                            "title": "Installer fix",
                            "description": "Unrelated",
                            "priority": 2,
                            "state": {"id": "state-2", "name": "Done", "type": "completed"},
                            "assignee": {"id": "user-2", "name": "Other", "email": "other@example.com"},
                            "project": {"id": "proj-2", "name": "Website"},
                            "team": {"id": "team-1", "name": "Webdevtoday", "key": "WEB"},
                        },
                    ],
                    "pageInfo": {"hasNextPage": False, "endCursor": None},
                }
            }
        },
    )
    result = CliRunner().invoke(cli, ["--json", "list-issues", "--query", "kernel", "--project", "ArgentOS", "--limit", "5"])
    assert result.exit_code == 0
    assert '"WEB-1"' in result.output
    assert '"WEB-2"' not in result.output


def test_create_issue_uses_graphql_mutation(monkeypatch) -> None:
    monkeypatch.setattr(
        client,
        "_resolve_team",
        lambda ctx_obj=None: {"id": "team-1", "name": "Webdevtoday", "key": "WEB"},
    )
    monkeypatch.setattr(
        client,
        "_resolve_project",
        lambda project_ref, ctx_obj=None: {"id": "proj-1", "name": project_ref},
    )
    monkeypatch.setattr(
        client,
        "_resolve_state",
        lambda status_ref, team_key=None, ctx_obj=None: {"id": "state-1", "name": status_ref, "type": "backlog"},
    )
    monkeypatch.setattr(
        client,
        "_resolve_user",
        lambda user_ref, ctx_obj=None: {"id": "user-1", "name": user_ref, "email": "jason@example.com"},
    )
    monkeypatch.setattr(
        client,
        "_graphql",
        lambda query, variables=None, ctx_obj=None: {
            "issueCreate": {
                "success": True,
                "issue": {
                    "id": "issue-1",
                    "identifier": "WEB-123",
                    "title": variables["input"]["title"],
                    "description": variables["input"].get("description"),
                    "priority": variables["input"].get("priority"),
                    "url": "https://linear.app/webdevtoday/issue/WEB-123/test",
                    "archivedAt": None,
                    "createdAt": "2026-03-24T00:00:00Z",
                    "updatedAt": "2026-03-24T00:00:00Z",
                    "state": {"id": "state-1", "name": "Todo", "type": "backlog"},
                    "assignee": {"id": "user-1", "name": "Jason", "email": "jason@example.com"},
                    "project": {"id": "proj-1", "name": "ArgentOS"},
                    "team": {"id": "team-1", "name": "Webdevtoday", "key": "WEB"},
                },
            }
        },
    )
    result = CliRunner().invoke(
        cli,
        [
            "--json",
            "--mode",
            "write",
            "create-issue",
            "--title",
            "Recover kernel",
            "--description",
            "Restore memory continuity",
            "--project",
            "ArgentOS",
            "--priority",
            "1",
            "--status",
            "Todo",
            "--assignee",
            "Jason",
        ],
    )
    assert result.exit_code == 0
    assert '"WEB-123"' in result.output
    assert '"Recover kernel"' in result.output


def test_update_issue_uses_graphql_mutation(monkeypatch) -> None:
    monkeypatch.setattr(
        client,
        "_resolve_team",
        lambda ctx_obj=None: {"id": "team-1", "name": "Webdevtoday", "key": "WEB"},
    )
    monkeypatch.setattr(
        client,
        "_resolve_project",
        lambda project_ref, ctx_obj=None: {"id": "proj-1", "name": project_ref},
    )
    monkeypatch.setattr(
        client,
        "_resolve_state",
        lambda status_ref, team_key=None, ctx_obj=None: {"id": "state-2", "name": status_ref, "type": "in_progress"},
    )
    monkeypatch.setattr(
        client,
        "_resolve_user",
        lambda user_ref, ctx_obj=None: {"id": "user-2", "name": user_ref, "email": "jason@example.com"},
    )
    monkeypatch.setattr(
        client,
        "_graphql",
        lambda query, variables=None, ctx_obj=None: {
            "issueUpdate": {
                "success": True,
                "issue": {
                    "id": variables["id"],
                    "identifier": "WEB-123",
                    "title": variables["input"].get("title", "Existing title"),
                    "description": variables["input"].get("description"),
                    "priority": variables["input"].get("priority"),
                    "url": "https://linear.app/webdevtoday/issue/WEB-123/test",
                    "archivedAt": None,
                    "createdAt": "2026-03-24T00:00:00Z",
                    "updatedAt": "2026-03-24T00:00:00Z",
                    "state": {"id": "state-2", "name": "In Progress", "type": "in_progress"},
                    "assignee": {"id": "user-2", "name": "Jason", "email": "jason@example.com"},
                    "project": {"id": "proj-1", "name": "ArgentOS"},
                    "team": {"id": "team-1", "name": "Webdevtoday", "key": "WEB"},
                },
            }
        },
    )
    result = CliRunner().invoke(
        cli,
        [
            "--json",
            "--mode",
            "write",
            "update-issue",
            "WEB-123",
            "--title",
            "Recover kernel",
            "--description",
            "Restore memory continuity",
            "--project",
            "ArgentOS",
            "--priority",
            "1",
            "--status",
            "In Progress",
            "--assignee",
            "Jason",
        ],
    )
    assert result.exit_code == 0
    assert '"WEB-123"' in result.output
    assert '"In Progress"' in result.output
