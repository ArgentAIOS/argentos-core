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

from .constants import API_BASE_URL


@dataclass(slots=True)
class CanvaApiError(Exception):
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


def _base64_name(name: str) -> str:
    return base64.b64encode(name.encode("utf-8")).decode("ascii")


def _guess_mime(path: str) -> str:
    return mimetypes.guess_type(path)[0] or "application/octet-stream"


def _normalize_thumbnail(raw: Any) -> dict[str, Any] | None:
    return raw if isinstance(raw, dict) else None


def _normalize_design(raw: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": raw.get("id"),
        "title": raw.get("title"),
        "created_at": raw.get("created_at"),
        "updated_at": raw.get("updated_at"),
        "page_count": raw.get("page_count"),
        "thumbnail": _normalize_thumbnail(raw.get("thumbnail")),
        "owner": raw.get("owner"),
        "urls": raw.get("urls"),
        "raw": raw,
    }


def _normalize_folder(raw: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": raw.get("id"),
        "name": raw.get("name"),
        "created_at": raw.get("created_at"),
        "updated_at": raw.get("updated_at"),
        "thumbnail": _normalize_thumbnail(raw.get("thumbnail")),
        "raw": raw,
    }


def _normalize_asset(raw: dict[str, Any]) -> dict[str, Any]:
    return {
        "type": raw.get("type"),
        "id": raw.get("id"),
        "name": raw.get("name"),
        "tags": raw.get("tags"),
        "created_at": raw.get("created_at"),
        "updated_at": raw.get("updated_at"),
        "thumbnail": _normalize_thumbnail(raw.get("thumbnail")),
        "owner": raw.get("owner"),
        "raw": raw,
    }


def _normalize_brand_template(raw: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": raw.get("id"),
        "title": raw.get("title"),
        "view_url": raw.get("view_url"),
        "create_url": raw.get("create_url"),
        "created_at": raw.get("created_at"),
        "updated_at": raw.get("updated_at"),
        "thumbnail": _normalize_thumbnail(raw.get("thumbnail")),
        "raw": raw,
    }


class CanvaClient:
    def __init__(self, *, api_key: str, api_base_url: str = API_BASE_URL) -> None:
        self._api_key = api_key.strip()
        self._api_base_url = api_base_url.rstrip("/")

    def _request(
        self,
        method: str,
        path: str,
        *,
        query: dict[str, Any] | None = None,
        json_body: dict[str, Any] | None = None,
        binary_body: bytes | None = None,
        headers: dict[str, str] | None = None,
        expect_json: bool = True,
    ) -> Any:
        url = f"{self._api_base_url}{path}"
        if query:
            encoded = urlencode([(k, str(v)) for k, v in query.items() if v is not None])
            if encoded:
                url = f"{url}?{encoded}"
        req_headers = {
            "Authorization": f"Bearer {self._api_key}",
            "Accept": "application/json",
        }
        if headers:
            req_headers.update(headers)
        payload: bytes | None = None
        if json_body is not None:
            payload = json.dumps(json_body).encode("utf-8")
            req_headers["Content-Type"] = "application/json"
        elif binary_body is not None:
            payload = binary_body
        request = Request(url, data=payload, method=method.upper(), headers=req_headers)
        try:
            with urlopen(request, timeout=60) as response:
                body = response.read()
                if expect_json:
                    return _dict_or_empty(_load_json(body))
                return {"bytes": body, "content_type": response.headers.get("Content-Type"), "final_url": response.geturl()}
        except HTTPError as err:
            details: dict[str, Any] = {}
            try:
                details = _dict_or_empty(_load_json(err.read()))
            except Exception:
                details = {}
            code = str(details.get("error", {}).get("code") or details.get("code") or "CANVA_API_ERROR")
            message = str(details.get("error", {}).get("message") or details.get("message") or err.reason or "Canva API request failed")
            raise CanvaApiError(status_code=err.code, code=code, message=message, details=details or {"url": url}) from err
        except URLError as err:
            raise CanvaApiError(status_code=None, code="CANVA_NETWORK_ERROR", message=str(getattr(err, "reason", err)), details={"url": url}) from err

    def list_designs(self, *, limit: int = 25, continuation: str | None = None, query: str | None = None, ownership: str | None = None, sort_by: str | None = None) -> dict[str, Any]:
        raw = self._request(
            "GET",
            "/designs",
            query={"limit": max(1, limit), "continuation": continuation, "query": query, "ownership": ownership, "sort_by": sort_by},
        )
        items = [_normalize_design(item) for item in _list_or_empty(raw.get("items")) if isinstance(item, dict)]
        return {"items": items, "continuation": raw.get("continuation"), "raw": raw}

    def get_design(self, design_id: str) -> dict[str, Any]:
        raw = self._request("GET", f"/designs/{design_id}")
        return _normalize_design(_dict_or_empty(raw.get("design")) or raw)

    def create_design(
        self,
        *,
        title: str | None = None,
        design_type: dict[str, Any] | None = None,
        asset_id: str | None = None,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {}
        if design_type:
            body["design_type"] = design_type
        if asset_id:
            body["asset_id"] = asset_id
        if title:
            body["title"] = title
        raw = self._request("POST", "/designs", json_body=body)
        return _normalize_design(_dict_or_empty(raw.get("design")) or raw)

    def list_brand_templates(self, *, limit: int = 25, continuation: str | None = None) -> dict[str, Any]:
        raw = self._request("GET", "/brand-templates", query={"limit": max(1, limit), "continuation": continuation})
        items = [_normalize_brand_template(item) for item in _list_or_empty(raw.get("items")) if isinstance(item, dict)]
        return {"items": items, "continuation": raw.get("continuation"), "raw": raw}

    def get_brand_template(self, brand_template_id: str) -> dict[str, Any]:
        raw = self._request("GET", f"/brand-templates/{brand_template_id}")
        return _normalize_brand_template(_dict_or_empty(raw.get("brand_template")) or raw)

    def get_brand_template_dataset(self, brand_template_id: str) -> dict[str, Any]:
        return self._request("GET", f"/brand-templates/{brand_template_id}/dataset")

    def create_design_autofill_job(
        self,
        *,
        brand_template_id: str,
        data: dict[str, Any],
        title: str | None = None,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {"brand_template_id": brand_template_id, "data": data}
        if title:
            body["title"] = title
        return self._request("POST", "/autofills", json_body=body)

    def get_design_autofill_job(self, job_id: str) -> dict[str, Any]:
        return self._request("GET", f"/autofills/{job_id}")

    def list_folder_items(self, folder_id: str, *, limit: int = 25, continuation: str | None = None, item_types: list[str] | None = None, sort_by: str | None = None) -> dict[str, Any]:
        raw = self._request(
            "GET",
            f"/folders/{folder_id}/items",
            query={
                "limit": max(1, limit),
                "continuation": continuation,
                "item_types": ",".join(item_types) if item_types else None,
                "sort_by": sort_by,
            },
        )
        items: list[dict[str, Any]] = []
        for item in _list_or_empty(raw.get("items")):
            if not isinstance(item, dict):
                continue
            if item.get("type") == "folder" and isinstance(item.get("folder"), dict):
                items.append({"type": "folder", "folder": _normalize_folder(item["folder"]), "raw": item})
            elif item.get("type") == "design" and isinstance(item.get("design"), dict):
                items.append({"type": "design", "design": _normalize_design(item["design"]), "raw": item})
            elif item.get("type") == "image" and isinstance(item.get("image"), dict):
                items.append({"type": "image", "image": _normalize_asset(item["image"]), "raw": item})
            else:
                items.append({"raw": item})
        return {"items": items, "continuation": raw.get("continuation"), "raw": raw}

    def get_folder(self, folder_id: str) -> dict[str, Any]:
        raw = self._request("GET", f"/folders/{folder_id}")
        return _normalize_folder(_dict_or_empty(raw.get("folder")) or raw)

    def create_folder(self, *, name: str, parent_folder_id: str) -> dict[str, Any]:
        raw = self._request("POST", "/folders", json_body={"name": name, "parent_folder_id": parent_folder_id})
        return _normalize_folder(_dict_or_empty(raw.get("folder")) or raw)

    def create_asset_upload_job(self, *, file_path: str, name: str | None = None) -> dict[str, Any]:
        path = Path(file_path).expanduser()
        metadata = {"name_base64": _base64_name(name or path.name)}
        raw = self._request(
            "POST",
            "/asset-uploads",
            binary_body=path.read_bytes(),
            headers={
                "Content-Type": "application/octet-stream",
                "Asset-Upload-Metadata": json.dumps(metadata),
            },
        )
        return raw

    def create_url_asset_upload_job(self, *, name: str, url: str) -> dict[str, Any]:
        return self._request("POST", "/url-asset-uploads", json_body={"name": name, "url": url})

    def get_asset_upload_job(self, job_id: str) -> dict[str, Any]:
        return self._request("GET", f"/asset-uploads/{job_id}")

    def get_url_asset_upload_job(self, job_id: str) -> dict[str, Any]:
        return self._request("GET", f"/url-asset-uploads/{job_id}")

    def create_export_job(self, *, design_id: str, export_format: str) -> dict[str, Any]:
        return self._request("POST", "/exports", json_body={"design_id": design_id, "format": export_format})

    def get_export_job(self, export_id: str) -> dict[str, Any]:
        return self._request("GET", f"/exports/{export_id}")
