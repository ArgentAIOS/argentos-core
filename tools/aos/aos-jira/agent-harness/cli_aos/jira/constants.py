from __future__ import annotations

from pathlib import Path

TOOL_NAME = "aos-jira"
BACKEND_NAME = "jira-api"
JIRA_BASE_URL_ENV = "JIRA_BASE_URL"
JIRA_EMAIL_ENV = "JIRA_EMAIL"
JIRA_API_TOKEN_ENV = "JIRA_API_TOKEN"
JIRA_PROJECT_KEY_ENV = "JIRA_PROJECT_KEY"
JIRA_ISSUE_KEY_ENV = "JIRA_ISSUE_KEY"
JIRA_BOARD_ID_ENV = "JIRA_BOARD_ID"
JIRA_SPRINT_ID_ENV = "JIRA_SPRINT_ID"

MODE_ORDER = ["readonly", "write", "full", "admin"]
HARNESS_ROOT = Path(__file__).resolve().parents[2]
CONNECTOR_PATH = HARNESS_ROOT.parent / "connector.json"
PERMISSIONS_PATH = HARNESS_ROOT / "permissions.json"
