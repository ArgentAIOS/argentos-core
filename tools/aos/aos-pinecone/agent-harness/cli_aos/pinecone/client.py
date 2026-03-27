from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from .constants import BACKEND_NAME, DEFAULT_API_VERSION, DEFAULT_CONTROL_BASE_URL


@dataclass(slots=True)
class PineconeApiError(Exception):
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


class PineconeClient:
    def __init__(
        self,
        *,
        api_key: str,
        base_url: str = DEFAULT_CONTROL_BASE_URL,
        api_version: str = DEFAULT_API_VERSION,
        index_host: str | None = None,
        default_namespace: str | None = None,
        timeout: int = 30,
    ) -> None:
        self._api_key = api_key.strip()
        self._base_url = base_url.rstrip("/")
        self._api_version = api_version.strip() or DEFAULT_API_VERSION
        self._index_host = index_host.strip().rstrip("/") if index_host else None
        self._default_namespace = default_namespace.strip() if default_namespace else None
        self._timeout = timeout
        self._user_agent = "aos-pinecone/0.1.0"

    def _headers(self, *, json_body: bool = True) -> dict[str, str]:
        headers = {
            "Api-Key": self._api_key,
            "X-Pinecone-Api-Version": self._api_version,
            "User-Agent": self._user_agent,
            "Accept": "application/json",
        }
        if json_body:
            headers["Content-Type"] = "application/json"
        return headers

    def _request(
        self,
        method: str,
        url: str,
        *,
        query: dict[str, Any] | None = None,
        json_body: dict[str, Any] | None = None,
        use_index_host: bool = False,
    ) -> dict[str, Any]:
        target = url
        if query:
            query_string = urlencode([(key, str(value)) for key, value in query.items() if value is not None])
            if query_string:
                target = f"{target}?{query_string}"
        data: bytes | None = None
        headers = self._headers(json_body=json_body is not None)
        if json_body is not None:
            data = json.dumps(json_body).encode("utf-8")
        request = Request(target, data=data, method=method.upper(), headers=headers)
        try:
            with urlopen(request, timeout=self._timeout) as response:
                return _dict_or_empty(_load_json(response.read()))
        except HTTPError as err:
            details: dict[str, Any] = {}
            try:
                details = _dict_or_empty(_load_json(err.read()))
            except Exception:
                details = {}
            message = str(details.get("message") or details.get("error") or err.reason or "Pinecone API request failed")
            code = str(details.get("code") or details.get("name") or "PINECONE_API_ERROR")
            raise PineconeApiError(status_code=err.code, code=code, message=message, details=details) from err
        except URLError as err:
            raise PineconeApiError(
                status_code=None,
                code="PINECONE_NETWORK_ERROR",
                message=str(getattr(err, "reason", err)),
                details={"backend": BACKEND_NAME, "url": target, "use_index_host": use_index_host},
            ) from err

    def _index_data_base(self, index_name: str | None = None) -> str:
        def _normalize_host(value: str) -> str:
            host = value.strip()
            host = host.removeprefix("https://")
            host = host.removeprefix("http://")
            return host.rstrip("/")

        if self._index_host:
            return f"https://{_normalize_host(self._index_host)}"
        if index_name:
            described = self.describe_index(index_name)
            host = str(described.get("host") or "").strip()
            if host:
                return f"https://{_normalize_host(host)}"
        raise PineconeApiError(
            status_code=None,
            code="PINECONE_INDEX_HOST_REQUIRED",
            message="An index host or index name is required for data-plane operations",
            details={"backend": BACKEND_NAME},
        )

    def _data_request(
        self,
        method: str,
        index_name: str | None,
        path: str,
        *,
        query: dict[str, Any] | None = None,
        json_body: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        base = self._index_data_base(index_name)
        return self._request(method, f"{base}{path}", query=query, json_body=json_body, use_index_host=True)

    def list_indexes(self, *, limit: int = 50) -> dict[str, Any]:
        raw = self._request("GET", f"{self._base_url}/indexes", query={"limit": max(1, limit)})
        indexes_raw = raw.get("indexes") or raw.get("data") or []
        indexes = [_dict_or_empty(item) for item in _list_or_empty(indexes_raw)]
        return {"indexes": indexes, "count": len(indexes), "raw": raw}

    def create_index(
        self,
        *,
        index_name: str,
        dimension: int,
        metric: str = "cosine",
        cloud: str = "aws",
        region: str = "us-east-1",
    ) -> dict[str, Any]:
        raw = self._request(
            "POST",
            f"{self._base_url}/indexes",
            json_body={
                "name": index_name,
                "dimension": dimension,
                "metric": metric,
                "spec": {"serverless": {"cloud": cloud, "region": region}},
            },
        )
        return {"index": _dict_or_empty(raw), "raw": raw}

    def describe_index(self, index_name: str) -> dict[str, Any]:
        raw = self._request("GET", f"{self._base_url}/indexes/{index_name}")
        return _dict_or_empty(raw)

    def delete_index(self, index_name: str) -> dict[str, Any]:
        raw = self._request("DELETE", f"{self._base_url}/indexes/{index_name}")
        return {"deleted": True, "raw": raw}

    def upsert_vectors(
        self,
        *,
        index_name: str | None,
        vectors: list[dict[str, Any]],
        namespace: str | None = None,
    ) -> dict[str, Any]:
        payload = {"vectors": vectors}
        if namespace or self._default_namespace:
            payload["namespace"] = namespace or self._default_namespace
        raw = self._data_request("POST", index_name, "/vectors/upsert", json_body=payload)
        return {"upserted_count": raw.get("upsertedCount") or raw.get("upserted_count"), "raw": raw}

    def query_vectors(
        self,
        *,
        index_name: str | None,
        vector: list[float],
        top_k: int = 10,
        namespace: str | None = None,
        filter: dict[str, Any] | None = None,
        include_values: bool = False,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {"vector": vector, "topK": top_k, "includeValues": include_values}
        if namespace or self._default_namespace:
            payload["namespace"] = namespace or self._default_namespace
        if filter is not None:
            payload["filter"] = filter
        raw = self._data_request("POST", index_name, "/query", json_body=payload)
        matches = [_dict_or_empty(item) for item in _list_or_empty(raw.get("matches"))]
        return {"matches": matches, "raw": raw}

    def fetch_vectors(
        self,
        *,
        index_name: str | None,
        ids: list[str],
        namespace: str | None = None,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {"ids": ids}
        if namespace or self._default_namespace:
            payload["namespace"] = namespace or self._default_namespace
        raw = self._data_request("POST", index_name, "/vectors/fetch", json_body=payload)
        vectors = raw.get("vectors") or {}
        return {"vectors": _dict_or_empty(vectors), "raw": raw}

    def delete_vectors(
        self,
        *,
        index_name: str | None,
        ids: list[str] | None = None,
        delete_all: bool = False,
        namespace: str | None = None,
        filter: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {}
        if ids:
            payload["ids"] = ids
        if delete_all:
            payload["deleteAll"] = True
        if namespace or self._default_namespace:
            payload["namespace"] = namespace or self._default_namespace
        if filter is not None:
            payload["filter"] = filter
        raw = self._data_request("POST", index_name, "/vectors/delete", json_body=payload)
        return {"deleted": True, "raw": raw}

    def list_namespaces(
        self,
        *,
        index_name: str | None,
        prefix: str | None = None,
        limit: int = 50,
    ) -> dict[str, Any]:
        raw = self._data_request(
            "GET",
            index_name,
            "/namespaces",
            query={"prefix": prefix, "limit": max(1, limit)},
        )
        namespaces_raw = raw.get("namespaces") or []
        namespaces = [_dict_or_empty(item) for item in _list_or_empty(namespaces_raw)]
        return {"namespaces": namespaces, "count": len(namespaces), "raw": raw}
