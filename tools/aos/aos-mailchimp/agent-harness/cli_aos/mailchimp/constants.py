from __future__ import annotations

from pathlib import Path

TOOL_NAME = "aos-mailchimp"
BACKEND_NAME = "mailchimp-marketing-api"
MAILCHIMP_API_KEY_ENV = "MAILCHIMP_API_KEY"
MAILCHIMP_SERVER_PREFIX_ENV = "MAILCHIMP_SERVER_PREFIX"
MAILCHIMP_AUDIENCE_ID_ENV = "MAILCHIMP_AUDIENCE_ID"
MAILCHIMP_CAMPAIGN_ID_ENV = "MAILCHIMP_CAMPAIGN_ID"
MAILCHIMP_MEMBER_EMAIL_ENV = "MAILCHIMP_MEMBER_EMAIL"

MODE_ORDER = ["readonly", "write", "full", "admin"]
HARNESS_ROOT = Path(__file__).resolve().parents[2]
CONNECTOR_PATH = HARNESS_ROOT.parent / "connector.json"
PERMISSIONS_PATH = HARNESS_ROOT / "permissions.json"
