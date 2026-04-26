from __future__ import annotations

from pathlib import Path

TOOL_NAME = "aos-google-drive"
BACKEND_NAME = "google-drive-api"

GOOGLE_DRIVE_CLIENT_ID_ENV = "GOOGLE_DRIVE_CLIENT_ID"
GOOGLE_DRIVE_CLIENT_SECRET_ENV = "GOOGLE_DRIVE_CLIENT_SECRET"
GOOGLE_DRIVE_REFRESH_TOKEN_ENV = "GOOGLE_DRIVE_REFRESH_TOKEN"
GOOGLE_DRIVE_FOLDER_ID_ENV = "GOOGLE_DRIVE_FOLDER_ID"
GOOGLE_DRIVE_FILE_ID_ENV = "GOOGLE_DRIVE_FILE_ID"
GOOGLE_DRIVE_MIME_TYPE_ENV = "GOOGLE_DRIVE_MIME_TYPE"
GOOGLE_DRIVE_QUERY_ENV = "GOOGLE_DRIVE_QUERY"
GOOGLE_DRIVE_BASE_URL_ENV = "GOOGLE_DRIVE_BASE_URL"

DEFAULT_BASE_URL = "https://www.googleapis.com/drive/v3"
DEFAULT_OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token"
DEFAULT_EXPORT_PDF_MIME = "application/pdf"
DEFAULT_EXPORT_DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
DEFAULT_FOLDER_MIME = "application/vnd.google-apps.folder"
MODE_ORDER = ["readonly", "write", "full", "admin"]

HARNESS_ROOT = Path(__file__).resolve().parents[2]
CONNECTOR_PATH = HARNESS_ROOT.parent / "connector.json"
PERMISSIONS_PATH = HARNESS_ROOT / "permissions.json"
