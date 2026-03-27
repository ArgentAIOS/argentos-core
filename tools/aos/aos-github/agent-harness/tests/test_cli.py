from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from click.testing import CliRunner

from cli_aos.github.cli import cli
import cli_aos.github.runtime as runtime


AGENT_HARNESS_ROOT = Path(__file__).resolve().parents[1]
CONNECTOR_PATH = AGENT_HARNESS_ROOT.parent / "connector.json"
PERMISSIONS_PATH = AGENT_HARNESS_ROOT / "permissions.json"


class FakeGitHubClient:
    def _request(self, method: str, path: str, **kwargs) -> Any:
        if path == "/user":
            return {"login": "testuser", "id": 12345}
        return {}

    def list_repos(self, *, owner: str | None = None, limit: int = 30) -> dict[str, Any]:
        return {"repos": [
            {"id": 1, "full_name": "testuser/repo1", "name": "repo1", "owner": "testuser", "description": "Test repo", "private": False, "default_branch": "main", "language": "Python", "updated_at": "2026-03-01T00:00:00Z"},
        ]}

    def get_repo(self, owner: str, repo: str) -> dict[str, Any]:
        return {"id": 1, "full_name": f"{owner}/{repo}", "name": repo, "owner": owner, "description": "Test repo", "private": False, "default_branch": "main"}

    def list_issues(self, owner: str, repo: str, *, limit: int = 30, state: str = "open") -> dict[str, Any]:
        return {"issues": [
            {"number": 1, "title": "Bug report", "state": "open", "assignee": None, "labels": ["bug"], "created_at": "2026-03-01T00:00:00Z"},
            {"number": 2, "title": "Feature request", "state": "open", "assignee": None, "labels": ["enhancement"], "created_at": "2026-03-02T00:00:00Z"},
        ][:limit]}

    def get_issue(self, owner: str, repo: str, number: int) -> dict[str, Any]:
        return {"number": number, "title": "Bug report", "state": "open", "assignee": None, "labels": ["bug"]}

    def create_issue(self, owner: str, repo: str, *, title: str, body: str | None = None, labels: list[str] | None = None, assignees: list[str] | None = None) -> dict[str, Any]:
        return {"number": 42, "title": title, "state": "open", "body": body, "labels": labels or []}

    def update_issue(self, owner: str, repo: str, number: int, **kwargs) -> dict[str, Any]:
        return {"number": number, "title": kwargs.get("title") or "Bug report", "state": kwargs.get("state") or "open"}

    def comment_issue(self, owner: str, repo: str, number: int, *, body: str) -> dict[str, Any]:
        return {"id": 100, "body": body}

    def list_prs(self, owner: str, repo: str, *, limit: int = 30, state: str = "open") -> dict[str, Any]:
        return {"prs": [
            {"number": 10, "title": "Add feature", "state": "open", "author": "testuser", "head_branch": "feat/new", "base_branch": "main"},
        ]}

    def get_pr(self, owner: str, repo: str, number: int) -> dict[str, Any]:
        return {"number": number, "title": "Add feature", "state": "open", "author": "testuser", "head_branch": "feat/new", "base_branch": "main"}

    def create_pr(self, owner: str, repo: str, *, title: str, head: str, base: str, body: str | None = None, draft: bool = False) -> dict[str, Any]:
        return {"number": 11, "title": title, "state": "open", "head_branch": head, "base_branch": base}

    def merge_pr(self, owner: str, repo: str, number: int, *, merge_method: str = "merge") -> dict[str, Any]:
        return {"merged": True, "sha": "abc123"}

    def review_pr(self, owner: str, repo: str, number: int, *, event: str = "APPROVE", body: str | None = None) -> dict[str, Any]:
        return {"id": 200, "state": event}

    def list_branches(self, owner: str, repo: str, *, limit: int = 30) -> dict[str, Any]:
        return {"branches": [
            {"name": "main", "commit_sha": "abc123def", "protected": True},
            {"name": "develop", "commit_sha": "def456ghi", "protected": False},
        ]}

    def create_branch(self, owner: str, repo: str, *, branch: str, sha: str) -> dict[str, Any]:
        return {"ref": f"refs/heads/{branch}", "object": {"sha": sha}}

    def list_workflow_runs(self, owner: str, repo: str, *, limit: int = 10) -> dict[str, Any]:
        return {"workflow_runs": [
            {"id": 500, "name": "CI", "status": "completed", "conclusion": "success", "head_branch": "main"},
        ], "total_count": 1}

    def trigger_workflow(self, owner: str, repo: str, *, workflow_id: str, ref: str = "main", inputs: dict | None = None) -> dict[str, Any]:
        return {"triggered": True, "workflow_id": workflow_id, "ref": ref}

    def list_releases(self, owner: str, repo: str, *, limit: int = 10) -> dict[str, Any]:
        return {"releases": [
            {"id": 300, "tag_name": "v1.0.0", "name": "v1.0.0", "draft": False, "prerelease": False, "published_at": "2026-03-01T00:00:00Z"},
        ]}

    def create_release(self, owner: str, repo: str, *, tag_name: str, name: str | None = None, body: str | None = None, draft: bool = False, prerelease: bool = False) -> dict[str, Any]:
        return {"id": 301, "tag_name": tag_name, "name": name or tag_name, "draft": draft, "prerelease": prerelease}


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
    assert manifest["scope"]["kind"] == "developer-tools"


def test_capabilities_exposes_manifest():
    payload = invoke_json(["capabilities"])
    assert payload["tool"] == "aos-github"
    assert payload["data"]["backend"] == "github-api"
    assert "issue.list" in json.dumps(payload["data"])
    assert "pr.create" in json.dumps(payload["data"])


def test_health_requires_token(monkeypatch):
    monkeypatch.delenv("GITHUB_TOKEN", raising=False)
    payload = invoke_json(["health"])
    assert payload["data"]["status"] == "needs_setup"
    assert "GITHUB_TOKEN" in json.dumps(payload["data"])


def test_health_ready_with_fake_client(monkeypatch):
    monkeypatch.setenv("GITHUB_TOKEN", "ghp_test123")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeGitHubClient())
    payload = invoke_json(["health"])
    assert payload["data"]["status"] == "ready"
    assert payload["data"]["probe"]["ok"] is True


def test_repo_list_returns_picker_metadata(monkeypatch):
    monkeypatch.setenv("GITHUB_TOKEN", "ghp_test123")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeGitHubClient())
    payload = invoke_json(["repo", "list"])
    data = payload["data"]
    assert data["repo_count"] == 1
    assert data["picker"]["kind"] == "repo"
    assert data["scope_preview"]["command_id"] == "repo.list"


def test_issue_list_returns_picker_metadata(monkeypatch):
    monkeypatch.setenv("GITHUB_TOKEN", "ghp_test123")
    monkeypatch.setenv("GITHUB_OWNER", "testuser")
    monkeypatch.setenv("GITHUB_REPO", "repo1")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeGitHubClient())
    payload = invoke_json(["issue", "list"])
    data = payload["data"]
    assert data["issue_count"] == 2
    assert data["picker"]["kind"] == "issue"
    assert data["scope_preview"]["selection_surface"] == "issue"


def test_issue_create_requires_write_mode(monkeypatch):
    monkeypatch.setenv("GITHUB_TOKEN", "ghp_test123")
    monkeypatch.setenv("GITHUB_OWNER", "testuser")
    monkeypatch.setenv("GITHUB_REPO", "repo1")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeGitHubClient())
    result = CliRunner().invoke(cli, ["--json", "--mode", "readonly", "issue", "create", "--title", "Test"])
    assert result.exit_code != 0


def test_issue_create_with_write_mode(monkeypatch):
    monkeypatch.setenv("GITHUB_TOKEN", "ghp_test123")
    monkeypatch.setenv("GITHUB_OWNER", "testuser")
    monkeypatch.setenv("GITHUB_REPO", "repo1")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeGitHubClient())
    payload = invoke_json_with_mode("write", ["issue", "create", "--title", "New bug"])
    assert payload["data"]["status"] == "live_write"
    assert payload["data"]["issue"]["number"] == 42


def test_pr_list_returns_picker_metadata(monkeypatch):
    monkeypatch.setenv("GITHUB_TOKEN", "ghp_test123")
    monkeypatch.setenv("GITHUB_OWNER", "testuser")
    monkeypatch.setenv("GITHUB_REPO", "repo1")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeGitHubClient())
    payload = invoke_json(["pr", "list"])
    data = payload["data"]
    assert data["pr_count"] == 1
    assert data["picker"]["kind"] == "pr"


def test_branch_list_returns_picker_metadata(monkeypatch):
    monkeypatch.setenv("GITHUB_TOKEN", "ghp_test123")
    monkeypatch.setenv("GITHUB_OWNER", "testuser")
    monkeypatch.setenv("GITHUB_REPO", "repo1")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeGitHubClient())
    payload = invoke_json(["branch", "list"])
    data = payload["data"]
    assert data["branch_count"] == 2
    assert data["picker"]["kind"] == "branch"


def test_release_list_returns_picker_metadata(monkeypatch):
    monkeypatch.setenv("GITHUB_TOKEN", "ghp_test123")
    monkeypatch.setenv("GITHUB_OWNER", "testuser")
    monkeypatch.setenv("GITHUB_REPO", "repo1")
    monkeypatch.setattr(runtime, "create_client", lambda ctx_obj: FakeGitHubClient())
    payload = invoke_json(["release", "list"])
    data = payload["data"]
    assert data["release_count"] == 1
    assert data["picker"]["kind"] == "release"
