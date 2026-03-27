from __future__ import annotations

import base64
import json
import mimetypes
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from .constants import BACKEND_NAME, DEFAULT_API_BASE_URL, DEFAULT_CONTENT_BASE_URL


@dataclass(slots=True)
class DropboxApiError(Exception):
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


def _list_or_empty(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def _guess_content_type(filename: str) -> str:
    return mimetypes.guess_type(filename)[0] or "application/octet-stream"


def _load_source_file(source: str) -> tuple[str, bytes, str]:
    path = Path(source).expanduser()
    payload = path.read_bytes()
    return path.name, payload, _guess_content_type(path.name)


def _normalize_entry(raw: dict[str, Any]) -> dict[str, Any]:
    tag = raw.get(".tag")
    return {
        "id": raw.get("id"),
        "name": raw.get("name"),
        "path_lower": raw.get("path_lower"),
        "path_display": raw.get("path_display"),
        "tag": tag,
        "size": raw.get("size"),
        "server_modified": raw.get("server_modified"),
        "content_hash": raw.get("content_hash"),
        "client_modified": raw.get("client_modified"),
        "raw": raw,
    }


def _normalize_folder(raw: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": raw.get("id"),
        "name": raw.get("name"),
        "path_lower": raw.get("path_lower"),
        "path_display": raw.get("path_display"),
        "tag": raw.get(".tag"),
        "raw": raw,
    }


def _normalize_shared_link(raw: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": raw.get("id"),
        "url": raw.get("url"),
        "name": raw.get("name"),
        "path_lower": raw.get("path_lower"),
        "visibility": (raw.get("link_permissions") or {}).get("visibility", {}).get(".tag"),
        "expires": raw.get("expires"),
        "raw": raw,
    }


class DropboxClient:
    def __init__(
        self,
        *,
        app_key: str,
        app_secret: str,
        refresh_token: str,
        api_base_url: str = DEFAULT_API_BASE_URL,
        content_base_url: str = DEFAULT_CONTENT_BASE_URL,
    ) -> None:
        self._app_key = app_key.strip()
        self._app_secret = app_secret.strip()
        self._refresh_token = refresh_token.strip()
        self._api_base_url = api_base_url.rstrip("/")
        self._content_base_url = content_base_url.rstrip("/")
        credentials = f"{self._app_key}:{self._app_secret}".encode("utf-8")
        self._basic_auth = base64.b64encode(credentials).decode("utf-8")
        self._access_token: str | None = None
        self._user_agent = "aos-dropbox/0.1.0"

    def _refresh_access_token(self) -> str:
        form = urlencode(
            {
                "grant_type": "refresh_token",
                "refresh_token": self._refresh_token,
                "client_id": self._app_key,
                "client_secret": self._app_secret,
            }
        ).encode("utf-8")
        request = Request(
            f"{self._api_base_url}/oauth2/token",
            data=form,
            method="POST",
            headers={
                "Authorization": f"Basic {self._basic_auth}",
                "Content-Type": "application/x-www-form-urlencoded",
                "Accept": "application/json",
                "User-Agent": self._user_agent,
            },
        )
        try:
            with urlopen(request, timeout=60) as response:
                payload = _dict_or_empty(_load_json(response.read()))
        except HTTPError as err:
            details: dict[str, Any] = {}
            try:
                details = _dict_or_empty(_load_json(err.read()))
            except Exception:
                details = {}
            message = str(details.get("error_description") or details.get("error") or err.reason or "Dropbox token refresh failed")
            raise DropboxApiError(
                status_code=err.code,
                code="DROPBOX_AUTH_ERROR",
                message=message,
                details=details or {"backend": BACKEND_NAME},
            ) from err
        except URLError as err:
            raise DropboxApiError(
                status_code=None,
                code="DROPBOX_NETWORK_ERROR",
                message=str(getattr(err, "reason", err)),
                details={"backend": BACKEND_NAME},
            ) from err
        token = str(payload.get("access_token") or "").strip()
        if not token:
            raise DropboxApiError(
                status_code=None,
                code="DROPBOX_AUTH_ERROR",
                message="Dropbox token refresh did not return an access token",
                details={"backend": BACKEND_NAME, "response": payload},
            )
        self._access_token = token
        return token

    def _access_token_value(self) -> str:
        if self._access_token:
            return self._access_token
        return self._refresh_access_token()

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self._access_token_value()}",
            "User-Agent": self._user_agent,
            "Accept": "application/json",
        }

    def _request_json(
        self,
        method: str,
        path: str,
        *,
        body: dict[str, Any] | None = None,
        api_base_url: str | None = None,
        headers: dict[str, str] | None = None,
    ) -> dict[str, Any]:
        url = f"{(api_base_url or self._api_base_url).rstrip('/')}{path}"
        data: bytes | None = None
        req_headers = self._headers()
        if headers:
            req_headers.update(headers)
        if body is not None:
            data = json.dumps(body).encode("utf-8")
            req_headers["Content-Type"] = "application/json"
        request = Request(url, data=data, method=method.upper(), headers=req_headers)
        try:
            with urlopen(request, timeout=60) as response:
                return _dict_or_empty(_load_json(response.read()))
        except HTTPError as err:
            details: dict[str, Any] = {}
            try:
                details = _dict_or_empty(_load_json(err.read()))
            except Exception:
                details = {}
            summary = str(details.get("error_summary") or details.get("error") or err.reason or "Dropbox API request failed")
            raise DropboxApiError(
                status_code=err.code,
                code="DROPBOX_API_ERROR",
                message=summary,
                details=details or {"backend": BACKEND_NAME, "url": url},
            ) from err
        except URLError as err:
            raise DropboxApiError(
                status_code=None,
                code="DROPBOX_NETWORK_ERROR",
                message=str(getattr(err, "reason", err)),
                details={"backend": BACKEND_NAME, "url": url},
            ) from err

    def _request_bytes(
        self,
        method: str,
        path: str,
        *,
        body: bytes | None = None,
        api_base_url: str | None = None,
        headers: dict[str, str] | None = None,
    ) -> dict[str, Any]:
        url = f"{(api_base_url or self._content_base_url).rstrip('/')}{path}"
        req_headers = self._headers()
        req_headers["Accept"] = "application/octet-stream"
        if headers:
            req_headers.update(headers)
        request = Request(url, data=body, method=method.upper(), headers=req_headers)
        try:
            with urlopen(request, timeout=60) as response:
                return {
                    "content_type": response.headers.get("Content-Type"),
                    "bytes": response.read(),
                    "headers": dict(response.headers.items()),
                }
        except HTTPError as err:
            details: dict[str, Any] = {}
            try:
                details = _dict_or_empty(_load_json(err.read()))
            except Exception:
                details = {}
            summary = str(details.get("error_summary") or details.get("error") or err.reason or "Dropbox content request failed")
            raise DropboxApiError(
                status_code=err.code,
                code="DROPBOX_API_ERROR",
                message=summary,
                details=details or {"backend": BACKEND_NAME, "url": url},
            ) from err
        except URLError as err:
            raise DropboxApiError(
                status_code=None,
                code="DROPBOX_NETWORK_ERROR",
                message=str(getattr(err, "reason", err)),
                details={"backend": BACKEND_NAME, "url": url},
            ) from err

    def read_account(self) -> dict[str, Any]:
        return self._request_json("POST", "/2/users/get_current_account", body={})

    def list_folder(self, *, path: str = "", cursor: str | None = None, limit: int = 25) -> dict[str, Any]:
        if cursor:
            raw = self._request_json("POST", "/2/files/list_folder/continue", body={"cursor": cursor})
        else:
            raw = self._request_json(
                "POST",
                "/2/files/list_folder",
                body={
                    "path": path,
                    "recursive": False,
                    "include_media_info": False,
                    "include_deleted": False,
                    "include_has_explicit_shared_members": False,
                    "include_mounted_folders": True,
                    "limit": max(1, min(limit, 2000)),
                },
            )
        entries = [_normalize_entry(item) for item in _list_or_empty(raw.get("entries")) if isinstance(item, dict)]
        return {"entries": entries, "cursor": raw.get("cursor"), "has_more": bool(raw.get("has_more")), "raw": raw}

    def list_files(self, *, path: str = "", cursor: str | None = None, limit: int = 25) -> dict[str, Any]:
        folder = self.list_folder(path=path, cursor=cursor, limit=limit)
        files = [entry for entry in folder["entries"] if entry.get("tag") == "file"]
        return {"files": files, "cursor": folder["cursor"], "has_more": folder["has_more"], "raw": folder["raw"]}

    def list_folders(self, *, path: str = "", cursor: str | None = None, limit: int = 25) -> dict[str, Any]:
        folder = self.list_folder(path=path, cursor=cursor, limit=limit)
        folders = [entry for entry in folder["entries"] if entry.get("tag") == "folder"]
        return {"folders": folders, "cursor": folder["cursor"], "has_more": folder["has_more"], "raw": folder["raw"]}

    def get_file(self, *, path_or_id: str) -> dict[str, Any]:
        raw = self._request_json("POST", "/2/files/get_metadata", body={"path": path_or_id})
        return _normalize_entry(raw)

    def upload_file(self, *, dropbox_path: str, source_file: str) -> dict[str, Any]:
        filename, payload, content_type = _load_source_file(source_file)
        headers = {
            "Dropbox-API-Arg": json.dumps({"path": dropbox_path, "mode": "add", "autorename": True, "mute": False}),
            "Content-Type": content_type or "application/octet-stream",
        }
        raw = self._request_bytes(
            "POST",
            "/2/files/upload",
            body=payload,
            headers=headers,
        )
        return {
            "status": "uploaded",
            "source_file": filename,
            "metadata": _normalize_entry(_dict_or_empty(_load_json(raw["bytes"])) if raw["content_type"] and "json" in raw["content_type"] else {}),
            "raw": raw,
        }

    def download_file(self, *, path_or_id: str) -> dict[str, Any]:
        raw = self._request_bytes(
            "POST",
            "/2/files/download",
            headers={"Dropbox-API-Arg": json.dumps({"path": path_or_id})},
        )
        metadata = {}
        if raw.get("headers", {}).get("dropbox-api-result"):
            try:
                metadata = _dict_or_empty(json.loads(raw["headers"]["dropbox-api-result"]))
            except Exception:
                metadata = {}
        return {
            "metadata": _normalize_entry(metadata),
            "content_type": raw.get("content_type"),
            "bytes": raw.get("bytes", b""),
            "content_base64": base64.b64encode(raw.get("bytes", b"")).decode("utf-8"),
            "raw": raw,
        }

    def delete_file(self, *, path_or_id: str) -> dict[str, Any]:
        raw = self._request_json("POST", "/2/files/delete_v2", body={"path": path_or_id})
        metadata = _dict_or_empty(raw.get("metadata"))
        return {"metadata": _normalize_entry(metadata), "raw": raw}

    def move_file(self, *, source_path: str, dest_path: str) -> dict[str, Any]:
        raw = self._request_json("POST", "/2/files/move_v2", body={"from_path": source_path, "to_path": dest_path})
        metadata = _dict_or_empty(raw.get("metadata"))
        return {"metadata": _normalize_entry(metadata), "raw": raw}

    def create_folder(self, *, path: str) -> dict[str, Any]:
        raw = self._request_json("POST", "/2/files/create_folder_v2", body={"path": path, "autorename": False})
        metadata = _dict_or_empty(raw.get("metadata"))
        return {"metadata": _normalize_folder(metadata), "raw": raw}

    def create_shared_link(self, *, path: str, settings: dict[str, Any] | None = None) -> dict[str, Any]:
        if settings:
            raw = self._request_json(
                "POST",
                "/2/sharing/create_shared_link_with_settings",
                body={"path": path, "settings": settings},
            )
        else:
            raw = self._request_json("POST", "/2/sharing/create_shared_link_with_settings", body={"path": path})
        return {"shared_link": _normalize_shared_link(_dict_or_empty(raw.get("url") and raw or raw)), "raw": raw}

    def list_shared_links(self, *, path: str) -> dict[str, Any]:
        raw = self._request_json("POST", "/2/sharing/list_shared_links", body={"path": path, "direct_only": True})
        links = [_normalize_shared_link(item) for item in _list_or_empty(raw.get("links")) if isinstance(item, dict)]
        return {"links": links, "has_more": bool(raw.get("has_more")), "raw": raw}

    def search(
        self,
        *,
        query: str,
        path: str = "",
        cursor: str | None = None,
        limit: int = 25,
    ) -> dict[str, Any]:
        if cursor:
            raw = self._request_json("POST", "/2/files/search/continue_v2", body={"cursor": cursor})
        else:
            raw = self._request_json(
                "POST",
                "/2/files/search_v2",
                body={
                    "query": query,
                    "options": {
                        "path": path,
                        "max_results": max(1, min(limit, 200)),
                        "filename_only": False,
                        "file_status": "active",
                    },
                },
            )
        matches: list[dict[str, Any]] = []
        for item in _list_or_empty(raw.get("matches")):
            if not isinstance(item, dict):
                continue
            metadata = item.get("metadata")
            if isinstance(metadata, dict) and metadata.get(".tag") == "metadata":
                metadata = metadata.get("metadata")
            if isinstance(metadata, dict):
                matches.append(_normalize_entry(metadata))
        return {"matches": matches, "cursor": raw.get("cursor"), "has_more": bool(raw.get("has_more")), "raw": raw}
