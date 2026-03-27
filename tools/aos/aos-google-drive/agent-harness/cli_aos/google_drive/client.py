from __future__ import annotations

import base64
import json
import mimetypes
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, quote
from urllib.request import Request, urlopen

from .constants import BACKEND_NAME, DEFAULT_OAUTH_TOKEN_URL, DEFAULT_FOLDER_MIME


@dataclass(slots=True)
class GoogleDriveApiError(Exception):
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


def _escape_query_literal(value: str) -> str:
    return value.replace("\\", "\\\\").replace("'", "\\'")


def _read_binary(source: str, *, fallback_name: str) -> tuple[str, bytes, str]:
    path = Path(source).expanduser()
    data = path.read_bytes()
    return path.name or fallback_name, data, _guess_content_type(path.name or fallback_name)


def _normalize_owner(raw: dict[str, Any]) -> dict[str, Any]:
    return {
        "displayName": raw.get("displayName"),
        "emailAddress": raw.get("emailAddress"),
        "kind": raw.get("kind"),
        "me": raw.get("me"),
    }


def _normalize_file(raw: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": raw.get("id"),
        "name": raw.get("name"),
        "mimeType": raw.get("mimeType"),
        "kind": raw.get("kind"),
        "size": raw.get("size"),
        "modifiedTime": raw.get("modifiedTime"),
        "createdTime": raw.get("createdTime"),
        "parents": raw.get("parents") or [],
        "owners": [_normalize_owner(owner) for owner in _list_or_empty(raw.get("owners")) if isinstance(owner, dict)],
        "webViewLink": raw.get("webViewLink"),
        "webContentLink": raw.get("webContentLink"),
        "trashed": raw.get("trashed"),
        "raw": raw,
    }


def _normalize_permission(raw: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": raw.get("id"),
        "type": raw.get("type"),
        "role": raw.get("role"),
        "emailAddress": raw.get("emailAddress"),
        "displayName": raw.get("displayName"),
        "domain": raw.get("domain"),
        "allowFileDiscovery": raw.get("allowFileDiscovery"),
        "raw": raw,
    }


class GoogleDriveClient:
    def __init__(
        self,
        *,
        client_id: str,
        client_secret: str,
        refresh_token: str,
        base_url: str,
        token_url: str = DEFAULT_OAUTH_TOKEN_URL,
    ) -> None:
        self._client_id = client_id.strip()
        self._client_secret = client_secret.strip()
        self._refresh_token = refresh_token.strip()
        self._base_url = base_url.rstrip("/")
        self._token_url = token_url
        self._access_token: str | None = None
        self._access_token_expiry: float = 0.0
        self._user_agent = "aos-google-drive/0.1.0"

    def _refresh_access_token(self) -> str:
        form = urlencode(
            {
                "client_id": self._client_id,
                "client_secret": self._client_secret,
                "refresh_token": self._refresh_token,
                "grant_type": "refresh_token",
            }
        ).encode("utf-8")
        request = Request(
            self._token_url,
            data=form,
            method="POST",
            headers={
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
            message = str(details.get("error_description") or details.get("error") or err.reason or "Google token refresh failed")
            raise GoogleDriveApiError(
                status_code=err.code,
                code="GOOGLE_DRIVE_AUTH_ERROR",
                message=message,
                details=details or {"backend": BACKEND_NAME, "url": self._token_url},
            ) from err
        except URLError as err:
            raise GoogleDriveApiError(
                status_code=None,
                code="GOOGLE_DRIVE_NETWORK_ERROR",
                message=str(getattr(err, "reason", err)),
                details={"backend": BACKEND_NAME, "url": self._token_url},
            ) from err

        token = str(payload.get("access_token") or "").strip()
        if not token:
            raise GoogleDriveApiError(
                status_code=None,
                code="GOOGLE_DRIVE_AUTH_ERROR",
                message="Google token refresh response did not include an access_token",
                details={"backend": BACKEND_NAME, "response": payload},
            )
        expires_in = int(payload.get("expires_in") or 3600)
        self._access_token = token
        self._access_token_expiry = time.time() + max(60, expires_in - 60)
        return token

    def _auth_token(self) -> str:
        if self._access_token and time.time() < self._access_token_expiry:
            return self._access_token
        return self._refresh_access_token()

    def _headers(self, *, content_type: str | None = None, accept: str = "application/json") -> dict[str, str]:
        headers = {
            "Authorization": f"Bearer {self._auth_token()}",
            "Accept": accept,
            "User-Agent": self._user_agent,
        }
        if content_type:
            headers["Content-Type"] = content_type
        return headers

    def _request(
        self,
        method: str,
        path: str,
        *,
        query: dict[str, Any] | None = None,
        json_body: dict[str, Any] | None = None,
        multipart_fields: dict[str, str] | None = None,
        multipart_files: dict[str, tuple[str, bytes, str]] | None = None,
        expect_json: bool = True,
    ) -> Any:
        url = f"{self._base_url}{path}"
        if query:
            query_string = urlencode([(key, str(value)) for key, value in query.items() if value is not None])
            if query_string:
                url = f"{url}?{query_string}"
        data: bytes | None = None
        headers = self._headers()
        if json_body is not None:
            data = json.dumps(json_body).encode("utf-8")
            headers["Content-Type"] = "application/json"
        elif multipart_fields is not None or multipart_files is not None:
            boundary = f"----aos-google-drive-{int(time.time() * 1000)}"
            chunks: list[bytes] = []
            for name, value in (multipart_fields or {}).items():
                chunks.extend(
                    [
                        f"--{boundary}\r\n".encode("utf-8"),
                        f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode("utf-8"),
                        value.encode("utf-8"),
                        b"\r\n",
                    ]
                )
            for name, (filename, payload, content_type) in (multipart_files or {}).items():
                chunks.extend(
                    [
                        f"--{boundary}\r\n".encode("utf-8"),
                        (
                            f'Content-Disposition: form-data; name="{name}"; filename="{filename}"\r\n'
                            f"Content-Type: {content_type}\r\n\r\n"
                        ).encode("utf-8"),
                        payload,
                        b"\r\n",
                    ]
                )
            chunks.append(f"--{boundary}--\r\n".encode("utf-8"))
            data = b"".join(chunks)
            headers["Content-Type"] = f"multipart/form-data; boundary={boundary}"
        request = Request(url, data=data, method=method.upper(), headers=headers)
        try:
            with urlopen(request, timeout=60) as response:
                payload = response.read()
                if expect_json:
                    return _dict_or_empty(_load_json(payload))
                return {
                    "content_type": response.headers.get("Content-Type"),
                    "bytes": payload,
                }
        except HTTPError as err:
            details: dict[str, Any] = {}
            try:
                details = _dict_or_empty(_load_json(err.read()))
            except Exception:
                details = {}
            error_payload = _dict_or_empty(details.get("error"))
            code = str(error_payload.get("status") or error_payload.get("code") or "GOOGLE_DRIVE_API_ERROR")
            message = str(error_payload.get("message") or err.reason or "Google Drive API request failed")
            raise GoogleDriveApiError(
                status_code=err.code,
                code=code,
                message=message,
                details=details or {"backend": BACKEND_NAME, "url": url},
            ) from err
        except URLError as err:
            raise GoogleDriveApiError(
                status_code=None,
                code="GOOGLE_DRIVE_NETWORK_ERROR",
                message=str(getattr(err, "reason", err)),
                details={"backend": BACKEND_NAME, "url": url},
            ) from err

    def list_files(self, *, limit: int = 25, folder_id: str | None = None, mime_type: str | None = None, query_text: str | None = None) -> dict[str, Any]:
        q_parts = ["trashed = false"]
        if folder_id:
            q_parts.append(f"'{folder_id}' in parents")
        if mime_type:
            q_parts.append(f"mimeType = '{mime_type}'")
        if query_text:
            q_parts.append(f"fullText contains '{_escape_query_literal(query_text)}'")
        response = self._request(
            "GET",
            "/files",
            query={
                "pageSize": max(1, min(limit, 1000)),
                "q": " and ".join(q_parts),
                "fields": "nextPageToken,files(id,name,mimeType,size,modifiedTime,createdTime,parents,owners,webViewLink,webContentLink,trashed)",
                "supportsAllDrives": "true",
                "includeItemsFromAllDrives": "true",
            },
        )
        files = [_normalize_file(item) for item in _list_or_empty(response.get("files")) if isinstance(item, dict)]
        return {"files": files, "count": len(files), "raw": response}

    def get_file(self, file_id: str) -> dict[str, Any]:
        response = self._request(
            "GET",
            f"/files/{quote(file_id, safe='')}",
            query={
                "fields": "id,name,mimeType,size,modifiedTime,createdTime,parents,owners,webViewLink,webContentLink,trashed",
                "supportsAllDrives": "true",
            },
        )
        return _normalize_file(response)

    def create_file(self, *, name: str, mime_type: str | None = None, folder_id: str | None = None) -> dict[str, Any]:
        body: dict[str, Any] = {"name": name}
        if mime_type:
            body["mimeType"] = mime_type
        if folder_id:
            body["parents"] = [folder_id]
        response = self._request(
            "POST",
            "/files",
            query={"fields": "id,name,mimeType,parents,owners,webViewLink,webContentLink", "supportsAllDrives": "true"},
            json_body=body,
        )
        return _normalize_file(response)

    def copy_file(self, *, file_id: str, name: str | None = None) -> dict[str, Any]:
        body: dict[str, Any] = {}
        if name:
            body["name"] = name
        response = self._request(
            "POST",
            f"/files/{quote(file_id, safe='')}/copy",
            query={"fields": "id,name,mimeType,parents,owners,webViewLink,webContentLink", "supportsAllDrives": "true"},
            json_body=body,
        )
        return _normalize_file(response)

    def move_file(self, *, file_id: str, folder_id: str) -> dict[str, Any]:
        current = self.get_file(file_id)
        old_parents = ",".join(current.get("parents") or [])
        response = self._request(
            "PATCH",
            f"/files/{quote(file_id, safe='')}",
            query={
                "addParents": folder_id,
                "removeParents": old_parents,
                "fields": "id,name,mimeType,parents,owners,webViewLink,webContentLink",
                "supportsAllDrives": "true",
            },
            json_body={},
        )
        return _normalize_file(response)

    def delete_file(self, *, file_id: str) -> dict[str, Any]:
        self._request("DELETE", f"/files/{quote(file_id, safe='')}", query={"supportsAllDrives": "true"}, expect_json=False)
        return {"deleted": True, "id": file_id}

    def list_folders(self, *, limit: int = 25, folder_id: str | None = None) -> dict[str, Any]:
        return self.list_files(limit=limit, folder_id=folder_id, mime_type=DEFAULT_FOLDER_MIME)

    def create_folder(self, *, name: str, folder_id: str | None = None) -> dict[str, Any]:
        return self.create_file(name=name, mime_type=DEFAULT_FOLDER_MIME, folder_id=folder_id)

    def create_permission(self, *, file_id: str, email_address: str, role: str) -> dict[str, Any]:
        body = {"type": "user", "role": role, "emailAddress": email_address}
        response = self._request(
            "POST",
            f"/files/{quote(file_id, safe='')}/permissions",
            query={"sendNotificationEmail": "false", "supportsAllDrives": "true", "fields": "id,type,role,emailAddress,displayName,domain,allowFileDiscovery"},
            json_body=body,
        )
        return _normalize_permission(response)

    def list_permissions(self, *, file_id: str) -> dict[str, Any]:
        response = self._request(
            "GET",
            f"/files/{quote(file_id, safe='')}/permissions",
            query={"fields": "permissions(id,type,role,emailAddress,displayName,domain,allowFileDiscovery)", "supportsAllDrives": "true"},
        )
        permissions = [_normalize_permission(item) for item in _list_or_empty(response.get("permissions")) if isinstance(item, dict)]
        return {"permissions": permissions, "count": len(permissions), "raw": response}

    def export_file(self, *, file_id: str, mime_type: str) -> dict[str, Any]:
        result = self._request(
            "GET",
            f"/files/{quote(file_id, safe='')}/export",
            query={"mimeType": mime_type},
            expect_json=False,
        )
        payload = result["bytes"]
        return {
            "file_id": file_id,
            "mime_type": mime_type,
            "content_type": result["content_type"] or mime_type,
            "bytes_count": len(payload),
            "content_base64": base64.b64encode(payload).decode("utf-8"),
        }

    def search_files(self, *, query_text: str, limit: int = 25) -> dict[str, Any]:
        response = self._request(
            "GET",
            "/files",
            query={
                "pageSize": max(1, min(limit, 1000)),
                "q": query_text,
                "fields": "nextPageToken,files(id,name,mimeType,size,modifiedTime,createdTime,parents,owners,webViewLink,webContentLink,trashed)",
                "supportsAllDrives": "true",
                "includeItemsFromAllDrives": "true",
            },
        )
        files = [_normalize_file(item) for item in _list_or_empty(response.get("files")) if isinstance(item, dict)]
        return {"files": files, "count": len(files), "raw": response, "query": query_text}

    def read_account(self) -> dict[str, Any]:
        return self.list_files(limit=1)
