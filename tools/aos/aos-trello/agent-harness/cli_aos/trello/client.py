from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urljoin
from urllib.request import Request, urlopen

from .constants import BACKEND_NAME, DEFAULT_API_BASE_URL, DEFAULT_API_BASE_URL_ENV


@dataclass(slots=True)
class TrelloApiError(Exception):
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


def _list_or_empty(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, dict)]


def _normalize_member(raw: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": raw.get("id"),
        "full_name": raw.get("fullName") or raw.get("full_name") or raw.get("username") or raw.get("id"),
        "username": raw.get("username"),
        "initials": raw.get("initials"),
        "avatar_url": raw.get("avatarUrl"),
        "confirmed": raw.get("confirmed"),
        "board_ids": raw.get("idBoards") if isinstance(raw.get("idBoards"), list) else [],
        "organization_ids": raw.get("idOrganizations") if isinstance(raw.get("idOrganizations"), list) else [],
        "url": raw.get("url"),
        "raw": raw,
    }


def _normalize_board(raw: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": raw.get("id"),
        "name": raw.get("name") or raw.get("id"),
        "desc": raw.get("desc"),
        "closed": raw.get("closed"),
        "starred": raw.get("starred"),
        "url": raw.get("url"),
        "short_url": raw.get("shortUrl"),
        "organization_id": raw.get("idOrganization"),
        "member_count": len(raw.get("members")) if isinstance(raw.get("members"), list) else None,
        "list_count": len(raw.get("lists")) if isinstance(raw.get("lists"), list) else None,
        "raw": raw,
    }


def _normalize_list(raw: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": raw.get("id"),
        "name": raw.get("name") or raw.get("id"),
        "closed": raw.get("closed"),
        "board_id": raw.get("idBoard"),
        "pos": raw.get("pos"),
        "url": raw.get("url"),
        "raw": raw,
    }


def _normalize_card(raw: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": raw.get("id"),
        "name": raw.get("name") or raw.get("id"),
        "desc": raw.get("desc"),
        "closed": raw.get("closed"),
        "due": raw.get("due"),
        "due_complete": raw.get("dueComplete"),
        "board_id": raw.get("idBoard"),
        "list_id": raw.get("idList"),
        "member_ids": raw.get("idMembers") if isinstance(raw.get("idMembers"), list) else [],
        "label_ids": raw.get("idLabels") if isinstance(raw.get("idLabels"), list) else [],
        "url": raw.get("url"),
        "short_url": raw.get("shortUrl"),
        "raw": raw,
    }


class TrelloClient:
    def __init__(self, *, api_key: str, token: str, base_url: str = DEFAULT_API_BASE_URL) -> None:
        self._api_key = api_key.strip()
        self._token = token.strip()
        self._base_url = base_url.rstrip("/") or DEFAULT_API_BASE_URL

    def _request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
    ) -> Any:
        url = urljoin(self._base_url + "/", path.lstrip("/"))
        query_params: list[tuple[str, str]] = [("key", self._api_key), ("token", self._token)]
        if params:
            query_params.extend((key, str(value)) for key, value in params.items() if value is not None)
        query = urlencode(query_params, doseq=True)
        if query:
            url = f"{url}?{query}"
        request = Request(url, method=method.upper(), headers={"Accept": "application/json"})
        try:
            with urlopen(request, timeout=30) as response:
                return _load_json(response.read())
        except HTTPError as err:
            details: dict[str, Any] = {}
            try:
                details = _dict_or_empty(_load_json(err.read()))
            except Exception:
                details = {}
            raise TrelloApiError(
                status_code=err.code,
                code=str(details.get("error") or details.get("code") or "TRELLO_API_ERROR"),
                message=str(details.get("message") or details.get("error") or err.reason or "Trello API request failed"),
                details=details,
            ) from err
        except URLError as err:
            raise TrelloApiError(
                status_code=None,
                code="TRELLO_NETWORK_ERROR",
                message=str(getattr(err, "reason", err)),
                details={"backend": BACKEND_NAME, "url": url},
            ) from err

    def current_member(self) -> dict[str, Any]:
        return _normalize_member(_dict_or_empty(self._request("GET", "/members/me", params={"fields": "all"})))

    def read_member(self, member_id: str) -> dict[str, Any]:
        return _normalize_member(_dict_or_empty(self._request("GET", f"/members/{member_id}", params={"fields": "all"})))

    def list_boards(self, *, limit: int = 10) -> list[dict[str, Any]]:
        payload = self._request("GET", "/members/me/boards", params={"fields": "all", "limit": max(1, min(limit, 100))})
        return [_normalize_board(item) for item in _list_or_empty(payload)][:limit]

    def read_board(self, board_id: str) -> dict[str, Any]:
        return _normalize_board(_dict_or_empty(self._request("GET", f"/boards/{board_id}", params={"fields": "all"})))

    def list_board_members(self, board_id: str, *, limit: int = 50) -> list[dict[str, Any]]:
        payload = self._request("GET", f"/boards/{board_id}/members", params={"fields": "all", "limit": max(1, min(limit, 100))})
        return [_normalize_member(item) for item in _list_or_empty(payload)][:limit]

    def list_lists(self, board_id: str) -> list[dict[str, Any]]:
        payload = self._request("GET", f"/boards/{board_id}/lists", params={"fields": "all"})
        return [_normalize_list(item) for item in _list_or_empty(payload)]

    def read_list(self, list_id: str) -> dict[str, Any]:
        return _normalize_list(_dict_or_empty(self._request("GET", f"/lists/{list_id}", params={"fields": "all"})))

    def list_cards(self, list_id: str) -> list[dict[str, Any]]:
        payload = self._request("GET", f"/lists/{list_id}/cards", params={"fields": "all"})
        return [_normalize_card(item) for item in _list_or_empty(payload)]

    def read_card(self, card_id: str) -> dict[str, Any]:
        return _normalize_card(_dict_or_empty(self._request("GET", f"/cards/{card_id}", params={"fields": "all"})))

    def create_card(self, *, list_id: str, name: str, desc: str = "") -> dict[str, Any]:
        return _normalize_card(
            _dict_or_empty(
                self._request(
                    "POST",
                    "/cards",
                    params={
                        "idList": list_id,
                        "name": name,
                        "desc": desc,
                    },
                )
            )
        )

    def update_card(self, card_id: str, *, name: str | None = None, desc: str | None = None) -> dict[str, Any]:
        params = {key: value for key, value in {"name": name, "desc": desc}.items() if value is not None}
        return _normalize_card(_dict_or_empty(self._request("PUT", f"/cards/{card_id}", params=params)))
