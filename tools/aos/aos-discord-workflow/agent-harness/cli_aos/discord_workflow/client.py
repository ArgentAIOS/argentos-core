from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qsl, quote, urlencode, urlsplit, urlunsplit
from urllib.request import Request, urlopen

from .constants import BACKEND_NAME


@dataclass(slots=True)
class DiscordApiError(Exception):
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


def _normalize_channel(raw: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": raw.get("id"),
        "name": raw.get("name"),
        "type": raw.get("type"),
        "position": raw.get("position"),
        "topic": raw.get("topic"),
        "nsfw": raw.get("nsfw"),
        "parent_id": raw.get("parent_id"),
        "raw": raw,
    }


def _normalize_message(raw: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": raw.get("id"),
        "channel_id": raw.get("channel_id"),
        "content": raw.get("content"),
        "embeds": raw.get("embeds") or [],
        "author": raw.get("author") or {},
        "timestamp": raw.get("timestamp"),
        "edited_timestamp": raw.get("edited_timestamp"),
        "raw": raw,
    }


def _normalize_role(raw: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": raw.get("id"),
        "name": raw.get("name"),
        "color": raw.get("color"),
        "position": raw.get("position"),
        "permissions": raw.get("permissions"),
        "managed": raw.get("managed"),
        "mentionable": raw.get("mentionable"),
        "raw": raw,
    }


def _normalize_member(raw: dict[str, Any]) -> dict[str, Any]:
    user = raw.get("user") if isinstance(raw.get("user"), dict) else {}
    return {
        "id": raw.get("id") or user.get("id"),
        "username": user.get("username"),
        "display_name": raw.get("nick") or user.get("global_name") or user.get("username"),
        "joined_at": raw.get("joined_at"),
        "roles": raw.get("roles") or [],
        "raw": raw,
    }


class DiscordClient:
    def __init__(self, *, bot_token: str, api_base_url: str) -> None:
        self._bot_token = bot_token.strip()
        self._api_base_url = api_base_url.rstrip("/")
        self._user_agent = "aos-discord-workflow/0.1.0"

    def _headers(self, *, include_auth: bool = True) -> dict[str, str]:
        headers = {
            "Accept": "application/json",
            "User-Agent": self._user_agent,
        }
        if include_auth:
            headers["Authorization"] = f"Bot {self._bot_token}"
        return headers

    def _request(
        self,
        method: str,
        url: str,
        *,
        json_body: dict[str, Any] | None = None,
        expect_json: bool = True,
        include_auth: bool = True,
    ) -> Any:
        data: bytes | None = None
        headers = self._headers(include_auth=include_auth)
        if json_body is not None:
            data = json.dumps(json_body).encode("utf-8")
            headers["Content-Type"] = "application/json"
        request = Request(url, data=data, method=method.upper(), headers=headers)
        try:
            with urlopen(request, timeout=60) as response:
                payload = response.read()
                if expect_json:
                    return _dict_or_empty(_load_json(payload))
                return {"status_code": response.status, "content_type": response.headers.get("Content-Type"), "bytes": payload}
        except HTTPError as err:
            details: dict[str, Any] = {}
            try:
                details = _dict_or_empty(_load_json(err.read()))
            except Exception:
                details = {}
            code = str(details.get("code") or details.get("error") or "DISCORD_API_ERROR")
            message = str(details.get("message") or err.reason or "Discord API request failed")
            raise DiscordApiError(
                status_code=err.code,
                code=code,
                message=message,
                details=details or {"backend": BACKEND_NAME, "url": url},
            ) from err
        except URLError as err:
            raise DiscordApiError(
                status_code=None,
                code="DISCORD_NETWORK_ERROR",
                message=str(getattr(err, "reason", err)),
                details={"backend": BACKEND_NAME, "url": url},
            ) from err

    def read_bot_user(self) -> dict[str, Any]:
        raw = self._request("GET", f"{self._api_base_url}/users/@me")
        return {
            "id": raw.get("id"),
            "username": raw.get("username"),
            "global_name": raw.get("global_name"),
            "bot": raw.get("bot"),
            "raw": raw,
        }

    def list_channels(self, *, guild_id: str) -> dict[str, Any]:
        raw = self._request("GET", f"{self._api_base_url}/guilds/{guild_id}/channels")
        channels = [_normalize_channel(item) for item in _list_or_empty(raw) if isinstance(item, dict)]
        return {"channels": channels, "count": len(channels), "raw": raw}

    def create_channel(self, *, guild_id: str, name: str, channel_type: int = 0, topic: str | None = None) -> dict[str, Any]:
        body: dict[str, Any] = {"name": name, "type": channel_type}
        if topic:
            body["topic"] = topic
        raw = self._request("POST", f"{self._api_base_url}/guilds/{guild_id}/channels", json_body=body)
        return _normalize_channel(raw)

    def send_message(self, *, channel_id: str, content: str | None = None, embeds: list[dict[str, Any]] | None = None) -> dict[str, Any]:
        body: dict[str, Any] = {}
        if content:
            body["content"] = content
        if embeds:
            body["embeds"] = embeds
        raw = self._request("POST", f"{self._api_base_url}/channels/{channel_id}/messages", json_body=body)
        return _normalize_message(raw)

    def edit_message(self, *, channel_id: str, message_id: str, content: str | None = None, embeds: list[dict[str, Any]] | None = None) -> dict[str, Any]:
        body: dict[str, Any] = {}
        if content:
            body["content"] = content
        if embeds:
            body["embeds"] = embeds
        raw = self._request("PATCH", f"{self._api_base_url}/channels/{channel_id}/messages/{message_id}", json_body=body)
        return _normalize_message(raw)

    def delete_message(self, *, channel_id: str, message_id: str) -> dict[str, Any]:
        raw = self._request("DELETE", f"{self._api_base_url}/channels/{channel_id}/messages/{message_id}", expect_json=False)
        return {"deleted": True, "status_code": raw["status_code"], "raw": raw}

    def add_reaction(self, *, channel_id: str, message_id: str, emoji: str) -> dict[str, Any]:
        encoded = quote(emoji, safe="")
        raw = self._request("PUT", f"{self._api_base_url}/channels/{channel_id}/messages/{message_id}/reactions/{encoded}/@me", expect_json=False)
        return {"added": True, "status_code": raw["status_code"], "raw": raw}

    def create_thread(
        self,
        *,
        channel_id: str,
        message_id: str | None = None,
        name: str,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {"name": name, "auto_archive_duration": 1440}
        if message_id:
            raw = self._request("POST", f"{self._api_base_url}/channels/{channel_id}/messages/{message_id}/threads", json_body=body)
        else:
            body["type"] = 11
            raw = self._request("POST", f"{self._api_base_url}/channels/{channel_id}/threads", json_body=body)
        return _normalize_channel(raw)

    def send_embed(self, *, channel_id: str, embed: dict[str, Any], content: str | None = None) -> dict[str, Any]:
        body: dict[str, Any] = {"embeds": [embed]}
        if content:
            body["content"] = content
        raw = self._request("POST", f"{self._api_base_url}/channels/{channel_id}/messages", json_body=body)
        return _normalize_message(raw)

    def list_roles(self, *, guild_id: str) -> dict[str, Any]:
        raw = self._request("GET", f"{self._api_base_url}/guilds/{guild_id}/roles")
        roles = [_normalize_role(item) for item in _list_or_empty(raw) if isinstance(item, dict)]
        return {"roles": roles, "count": len(roles), "raw": raw}

    def assign_role(self, *, guild_id: str, member_id: str, role_id: str) -> dict[str, Any]:
        raw = self._request("PUT", f"{self._api_base_url}/guilds/{guild_id}/members/{member_id}/roles/{role_id}", expect_json=False)
        return {"assigned": True, "status_code": raw["status_code"], "raw": raw}

    def list_members(self, *, guild_id: str, limit: int = 20) -> dict[str, Any]:
        raw = self._request("GET", f"{self._api_base_url}/guilds/{guild_id}/members?limit={limit}")
        members = [_normalize_member(item) for item in _list_or_empty(raw) if isinstance(item, dict)]
        return {"members": members, "count": len(members), "raw": raw}

    def send_webhook(
        self,
        *,
        webhook_url: str,
        content: str | None = None,
        embed: dict[str, Any] | None = None,
        username: str | None = None,
        avatar_url: str | None = None,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {}
        if content:
            body["content"] = content
        if embed:
            body["embeds"] = [embed]
        if username:
            body["username"] = username
        if avatar_url:
            body["avatar_url"] = avatar_url
        url = webhook_url if webhook_url.startswith(("http://", "https://")) else f"{self._api_base_url}{webhook_url}"
        raw = self._request("POST", _webhook_url_with_wait(url), json_body=body, include_auth=False)
        if isinstance(raw, dict):
            return raw
        return {"raw": raw}


def _webhook_url_with_wait(url: str) -> str:
    parts = urlsplit(url)
    query = dict(parse_qsl(parts.query, keep_blank_values=True))
    query["wait"] = "true"
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query), parts.fragment))
