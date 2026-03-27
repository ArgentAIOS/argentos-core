from __future__ import annotations

import base64
import json
import mimetypes
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen

from .constants import BACKEND_NAME, DEFAULT_API_BASE_URL, DEFAULT_UPLOAD_BASE_URL


@dataclass(slots=True)
class BoxApiError(Exception):
    status_code: int | None
    code: str
    message: str
    details: dict[str, Any] | None = None


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


def _guess_type(filename: str) -> str:
    return mimetypes.guess_type(filename)[0] or "application/octet-stream"


def _multipart(fields: dict[str, str], files: dict[str, tuple[str, bytes, str]]) -> tuple[bytes, str]:
    boundary = f"----aos-box-{uuid.uuid4().hex}"
    parts: list[bytes] = []
    for name, value in fields.items():
        parts.extend(
            [
                f"--{boundary}\r\n".encode(),
                f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode(),
                value.encode(),
                b"\r\n",
            ]
        )
    for name, (filename, payload, content_type) in files.items():
        parts.extend(
            [
                f"--{boundary}\r\n".encode(),
                (
                    f'Content-Disposition: form-data; name="{name}"; filename="{filename}"\r\n'
                    f"Content-Type: {content_type}\r\n\r\n"
                ).encode(),
                payload,
                b"\r\n",
            ]
        )
    parts.append(f"--{boundary}--\r\n".encode())
    return b"".join(parts), f"multipart/form-data; boundary={boundary}"


def _normalize_item(raw: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": raw.get("id"),
        "type": raw.get("type"),
        "name": raw.get("name"),
        "size": raw.get("size"),
        "created_at": raw.get("created_at"),
        "modified_at": raw.get("modified_at"),
        "owned_by": raw.get("owned_by"),
        "shared_link": raw.get("shared_link"),
        "raw": raw,
    }


def _normalize_collaboration(raw: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": raw.get("id"),
        "type": raw.get("type"),
        "role": raw.get("role"),
        "status": raw.get("status"),
        "accessible_by": raw.get("accessible_by"),
        "created_at": raw.get("created_at"),
        "item": raw.get("item"),
        "raw": raw,
    }


class BoxClient:
    def __init__(self, *, access_token: str, api_base_url: str = DEFAULT_API_BASE_URL, upload_base_url: str = DEFAULT_UPLOAD_BASE_URL) -> None:
        self._access_token = access_token.strip()
        self._api_base_url = api_base_url.rstrip("/")
        self._upload_base_url = upload_base_url.rstrip("/")
        self._user_agent = "aos-box/0.1.0"

    def _request(
        self,
        method: str,
        url: str,
        *,
        query: dict[str, Any] | None = None,
        json_body: dict[str, Any] | None = None,
        multipart_fields: dict[str, str] | None = None,
        multipart_files: dict[str, tuple[str, bytes, str]] | None = None,
        expect_json: bool = True,
    ) -> Any:
        if query:
            url = f"{url}?{urlencode([(k, str(v)) for k, v in query.items() if v is not None])}"
        headers = {
            "Authorization": f"Bearer {self._access_token}",
            "Accept": "application/json",
            "User-Agent": self._user_agent,
        }
        payload: bytes | None = None
        if json_body is not None:
            payload = json.dumps(json_body).encode("utf-8")
            headers["Content-Type"] = "application/json"
        elif multipart_fields is not None or multipart_files is not None:
            payload, content_type = _multipart(multipart_fields or {}, multipart_files or {})
            headers["Content-Type"] = content_type
        request = Request(url, data=payload, method=method.upper(), headers=headers)
        try:
            with urlopen(request, timeout=60) as response:
                data = response.read()
                if expect_json:
                    return _dict_or_empty(_load_json(data))
                return {"content_type": response.headers.get("Content-Type"), "bytes": data, "final_url": response.geturl()}
        except HTTPError as err:
            details: dict[str, Any] = {}
            try:
                details = _dict_or_empty(_load_json(err.read()))
            except Exception:
                details = {}
            ctx = _dict_or_empty(details.get("context_info"))
            code = str(ctx.get("errors", [{}])[0].get("reason") if isinstance(ctx.get("errors"), list) and ctx.get("errors") else details.get("code") or "BOX_API_ERROR")
            message = str(details.get("message") or err.reason or "Box API request failed")
            raise BoxApiError(status_code=err.code, code=code, message=message, details=details or {"backend": BACKEND_NAME, "url": url}) from err
        except URLError as err:
            raise BoxApiError(status_code=None, code="BOX_NETWORK_ERROR", message=str(getattr(err, "reason", err)), details={"backend": BACKEND_NAME, "url": url}) from err

    def get_folder(self, folder_id: str) -> dict[str, Any]:
        raw = self._request("GET", f"{self._api_base_url}/folders/{quote(folder_id, safe='')}")
        return _normalize_item(raw)

    def list_folder_items(self, folder_id: str, *, limit: int = 25) -> dict[str, Any]:
        raw = self._request("GET", f"{self._api_base_url}/folders/{quote(folder_id, safe='')}/items", query={"limit": max(1, limit)})
        items = [_normalize_item(item) for item in _list_or_empty(raw.get("entries")) if isinstance(item, dict)]
        return {"items": items, "total_count": raw.get("total_count", len(items)), "raw": raw}

    def get_file(self, file_id: str) -> dict[str, Any]:
        raw = self._request("GET", f"{self._api_base_url}/files/{quote(file_id, safe='')}")
        return _normalize_item(raw)

    def download_file(self, file_id: str) -> dict[str, Any]:
        raw = self._request("GET", f"{self._api_base_url}/files/{quote(file_id, safe='')}/content", expect_json=False)
        payload = raw.get("bytes") or b""
        return {
            "content_type": raw.get("content_type"),
            "bytes_count": len(payload),
            "download_url": raw.get("final_url"),
            "content_base64": base64.b64encode(payload).decode("utf-8"),
        }

    def upload_file(self, *, folder_id: str, file_path: str, name: str | None = None) -> dict[str, Any]:
        path = Path(file_path).expanduser()
        filename = name or path.name
        payload = path.read_bytes()
        raw = self._request(
            "POST",
            f"{self._upload_base_url}/files/content",
            multipart_fields={"attributes": json.dumps({"name": filename, "parent": {"id": folder_id}})},
            multipart_files={"file": (filename, payload, _guess_type(filename))},
        )
        entries = [_normalize_item(item) for item in _list_or_empty(raw.get("entries")) if isinstance(item, dict)]
        return {"entries": entries, "raw": raw}

    def copy_file(self, *, file_id: str, parent_id: str, name: str | None = None) -> dict[str, Any]:
        body: dict[str, Any] = {"parent": {"id": parent_id}}
        if name:
            body["name"] = name
        raw = self._request("POST", f"{self._api_base_url}/files/{quote(file_id, safe='')}/copy", json_body=body)
        return _normalize_item(raw)

    def move_file(self, *, file_id: str, parent_id: str) -> dict[str, Any]:
        raw = self._request("PUT", f"{self._api_base_url}/files/{quote(file_id, safe='')}", json_body={"parent": {"id": parent_id}})
        return _normalize_item(raw)

    def create_folder(self, *, name: str, parent_id: str) -> dict[str, Any]:
        raw = self._request("POST", f"{self._api_base_url}/folders", json_body={"name": name, "parent": {"id": parent_id}})
        return _normalize_item(raw)

    def update_shared_link(self, *, file_id: str, access: str | None = None) -> dict[str, Any]:
        body: dict[str, Any] = {"shared_link": {}}
        if access:
            body["shared_link"]["access"] = access
        raw = self._request("PUT", f"{self._api_base_url}/files/{quote(file_id, safe='')}", json_body=body)
        return _normalize_item(raw)

    def list_collaborations(self, folder_id: str) -> dict[str, Any]:
        raw = self._request("GET", f"{self._api_base_url}/folders/{quote(folder_id, safe='')}/collaborations")
        entries = [_normalize_collaboration(item) for item in _list_or_empty(raw.get("entries")) if isinstance(item, dict)]
        return {"entries": entries, "total_count": raw.get("total_count", len(entries)), "raw": raw}

    def create_collaboration(self, *, folder_id: str, email: str, role: str = "editor") -> dict[str, Any]:
        raw = self._request(
            "POST",
            f"{self._api_base_url}/collaborations",
            json_body={"item": {"type": "folder", "id": folder_id}, "accessible_by": {"type": "user", "login": email}, "role": role},
        )
        return _normalize_collaboration(raw)

    def search(self, *, query_text: str, limit: int = 25) -> dict[str, Any]:
        raw = self._request("GET", f"{self._api_base_url}/search", query={"query": query_text, "limit": max(1, limit)})
        entries = [_normalize_item(item) for item in _list_or_empty(raw.get("entries")) if isinstance(item, dict)]
        return {"entries": entries, "total_count": raw.get("total_count", len(entries)), "raw": raw}

    def get_metadata(self, *, file_id: str) -> dict[str, Any]:
        return self._request("GET", f"{self._api_base_url}/files/{quote(file_id, safe='')}/metadata")

    def set_metadata(self, *, file_id: str, scope: str, template: str, values: dict[str, Any]) -> dict[str, Any]:
        return self._request("POST", f"{self._api_base_url}/files/{quote(file_id, safe='')}/metadata/{quote(scope, safe='')}/{quote(template, safe='')}", json_body=values)
