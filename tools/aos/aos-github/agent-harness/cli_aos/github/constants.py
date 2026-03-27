from __future__ import annotations

from pathlib import Path

TOOL_NAME = "aos-github"
BACKEND_NAME = "github-api"
GITHUB_TOKEN_ENV = "GITHUB_TOKEN"
GITHUB_OWNER_ENV = "GITHUB_OWNER"
GITHUB_REPO_ENV = "GITHUB_REPO"
GITHUB_ISSUE_NUMBER_ENV = "GITHUB_ISSUE_NUMBER"
GITHUB_PR_NUMBER_ENV = "GITHUB_PR_NUMBER"

MODE_ORDER = ["readonly", "write", "full", "admin"]
HARNESS_ROOT = Path(__file__).resolve().parents[2]
CONNECTOR_PATH = HARNESS_ROOT.parent / "connector.json"
PERMISSIONS_PATH = HARNESS_ROOT / "permissions.json"
