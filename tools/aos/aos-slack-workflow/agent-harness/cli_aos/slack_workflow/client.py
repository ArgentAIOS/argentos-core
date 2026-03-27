from __future__ import annotations

import json
import mimetypes
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from .constants import BACKEND_NAME, DEFAULT_BASE_URL


@dataclass(slots=True)
class SlackApiError(Exception):
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


def _normalize_message(raw: dict[str, Any]) -> dict[str, Any]:
    return {
        "channel": raw.get("channel"),
        "ts": raw.get("ts"),
        "text": raw.get("text"),
        "user": raw.get("user"),
        "thread_ts": raw.get("thread_ts"),
        "reply_count": raw.get("reply_count"),
        "raw": raw,
    }


def _normalize_channel(raw: dict[str, Any]) -> dict[str, Any]:
    topic = raw.get("topic") if isinstance(raw.get("topic"), dict) else {}
    return {
        "id": raw.get("id"),
        "name": raw.get("name"),
        "is_private": raw.get("is_private"),
        "is_channel": raw.get("is_channel"),
        "is_archived": raw.get("is_archived"),
        "num_members": raw.get("num_members"),
        "topic": topic.get("value") if isinstance(topic, dict) else None,
        "raw": raw,
    }


def _normalize_user(raw: dict[str, Any]) -> dict[str, Any]:
    profile = raw.get("profile") if isinstance(raw.get("profile"), dict) else {}
    return {
        "id": raw.get("id"),
        "name": raw.get("name"),
        "real_name": raw.get("real_name"),
        "email": profile.get("email"),
        "is_bot": raw.get("is_bot"),
        "deleted": raw.get("deleted"),
        "raw": raw,
    }


def _normalize_file(raw: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": raw.get("id"),
        "title": raw.get("title") or raw.get("name"),
        "name": raw.get("name"),
        "mimetype": raw.get("mimetype"),
        "size": raw.get("size"),
        "channels": raw.get("channels"),
        "url_private": raw.get("url_private"),
        "raw": raw,
    }


class SlackClient:
    def __init__(self, *, bot_token: str, base_url: str = DEFAULT_BASE_URL) -> None:
        self._bot_token = bot_token.strip()
        self._base_url = base_url.rstrip("/")
        self._user_agent = "aos-slack-workflow/0.1.0"

    def _request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        body: dict[str, Any] | None = None,
        expect_json: bool = True,
        token_in_body: bool = True,
    ) -> Any:
        url = f"{self._base_url}{path}"
        headers = {
            "Authorization": f"Bearer {self._bot_token}",
            "Accept": "application/json",
            "User-Agent": self._user_agent,
        }
        payload: bytes | None = None
        if params:
            query = urlencode([(key, str(value)) for key, value in params.items() if value is not None])
            if query:
                url = f"{url}?{query}"
        if body is not None:
            form = dict(body)
            if token_in_body:
                form.setdefault("token", self._bot_token)
            payload = urlencode([(key, json.dumps(value) if isinstance(value, (dict, list)) else str(value)) for key, value in form.items() if value is not None]).encode("utf-8")
            headers["Content-Type"] = "application/x-www-form-urlencoded; charset=utf-8"
        request = Request(url, data=payload, method=method.upper(), headers=headers)
        try:
            with urlopen(request, timeout=60) as response:
                payload_bytes = response.read()
                if expect_json:
                    return _dict_or_empty(_load_json(payload_bytes))
                return payload_bytes
        except HTTPError as err:
            details: dict[str, Any] = {}
            try:
                details = _dict_or_empty(_load_json(err.read()))
            except Exception:
                details = {}
            code = str(details.get("error") or "SLACK_API_ERROR")
            message = str(details.get("error") or err.reason or "Slack API request failed")
            raise SlackApiError(
                status_code=err.code,
                code=code,
                message=message,
                details=details or {"backend": BACKEND_NAME, "url": url},
            ) from err
        except URLError as err:
            raise SlackApiError(
                status_code=None,
                code="SLACK_NETWORK_ERROR",
                message=str(getattr(err, "reason", err)),
                details={"backend": BACKEND_NAME, "url": url},
            ) from err

    def _request_form(self, method: str, path: str, *, body: dict[str, Any]) -> dict[str, Any]:
        raw = self._request(method, path, body=body)
        if isinstance(raw, dict) and not raw.get("ok", True):
            raise SlackApiError(
                status_code=None,
                code=str(raw.get("error") or "SLACK_API_ERROR"),
                message=str(raw.get("error") or "Slack API request failed"),
                details={"response": raw, "backend": BACKEND_NAME},
            )
        return raw

    def auth_test(self) -> dict[str, Any]:
        raw = self._request_form("GET", "/auth.test", body={})
        return raw

    def list_channels(self, *, limit: int = 20, cursor: str | None = None) -> dict[str, Any]:
        raw = self._request(
            "GET",
            "/conversations.list",
            params={
                "types": "public_channel,private_channel",
                "limit": max(1, min(limit, 1000)),
                "cursor": cursor or None,
                "exclude_archived": True,
            },
        )
        channels = [_normalize_channel(item) for item in _list_or_empty(raw.get("channels")) if isinstance(item, dict)]
        next_cursor = ""
        metadata = raw.get("response_metadata")
        if isinstance(metadata, dict):
            next_cursor = str(metadata.get("next_cursor") or "")
        return {"channels": channels, "next_cursor": next_cursor, "raw": raw}

    def create_channel(self, *, name: str, is_private: bool = False) -> dict[str, Any]:
        raw = self._request_form("POST", "/conversations.create", body={"name": name, "is_private": str(bool(is_private)).lower()})
        channel = _normalize_channel(_dict_or_empty(raw.get("channel")))
        return {"channel": channel, "raw": raw}

    def archive_channel(self, *, channel_id: str) -> dict[str, Any]:
        raw = self._request_form("POST", "/conversations.archive", body={"channel": channel_id})
        return {"channel_id": channel_id, "archived": bool(raw.get("ok", True)), "raw": raw}

    def post_message(self, *, channel_id: str, text: str, thread_ts: str | None = None) -> dict[str, Any]:
        body: dict[str, Any] = {"channel": channel_id, "text": text}
        if thread_ts:
            body["thread_ts"] = thread_ts
        raw = self._request_form("POST", "/chat.postMessage", body=body)
        return _normalize_message(raw)

    def update_message(self, *, channel_id: str, ts: str, text: str) -> dict[str, Any]:
        raw = self._request_form("POST", "/chat.update", body={"channel": channel_id, "ts": ts, "text": text})
        return _normalize_message(raw)

    def delete_message(self, *, channel_id: str, ts: str) -> dict[str, Any]:
        raw = self._request_form("POST", "/chat.delete", body={"channel": channel_id, "ts": ts})
        return {"channel": channel_id, "ts": ts, "deleted": bool(raw.get("ok", True)), "raw": raw}

    def add_reaction(self, *, channel_id: str, timestamp: str, emoji: str) -> dict[str, Any]:
        raw = self._request_form("POST", "/reactions.add", body={"channel": channel_id, "timestamp": timestamp, "name": emoji})
        return {"channel": channel_id, "timestamp": timestamp, "emoji": emoji, "ok": bool(raw.get("ok", True)), "raw": raw}

    def list_users(self, *, limit: int = 20, cursor: str | None = None) -> dict[str, Any]:
        raw = self._request(
            "GET",
            "/users.list",
            params={"limit": max(1, min(limit, 1000)), "cursor": cursor or None, "include_locale": False},
        )
        users = [_normalize_user(item) for item in _list_or_empty(raw.get("members")) if isinstance(item, dict)]
        next_cursor = ""
        metadata = raw.get("response_metadata")
        if isinstance(metadata, dict):
            next_cursor = str(metadata.get("next_cursor") or "")
        return {"users": users, "next_cursor": next_cursor, "raw": raw}

    def create_reminder(self, *, text: str, time_value: str, user_id: str | None = None) -> dict[str, Any]:
        body: dict[str, Any] = {"text": text, "time": time_value}
        if user_id:
            body["user"] = user_id
        raw = self._request_form("POST", "/reminders.add", body=body)
        return {"reminder": raw.get("reminder") or raw, "raw": raw}

    def _canvas_document_content(self, *, title: str, content: str | None) -> dict[str, Any]:
        payload = {"type": "markdown"}
        if content:
            payload["markdown"] = content
        else:
            payload["markdown"] = f"# {title}\n"
        return payload

    def create_canvas(
        self,
        *,
        title: str,
        content: str | None = None,
        channel_id: str | None = None,
        owner_id: str | None = None,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {"title": title}
        if channel_id:
            body["channel_id"] = channel_id
            body["document_content"] = self._canvas_document_content(title=title, content=content)
            raw = self._request_form("POST", "/conversations.canvases.create", body=body)
        else:
            if owner_id:
                body["owner_id"] = owner_id
            body["content"] = self._canvas_document_content(title=title, content=content)
            raw = self._request_form("POST", "/canvases.create", body=body)
        return {"canvas_id": raw.get("canvas_id"), "raw": raw}

    def update_canvas(
        self,
        *,
        canvas_id: str,
        content: str | None = None,
        changes_json: str | None = None,
    ) -> dict[str, Any]:
        if changes_json:
            changes = json.loads(changes_json)
        else:
            changes = [
                {
                    "operation": "replace",
                    "document_content": self._canvas_document_content(title=canvas_id, content=content),
                }
            ]
        raw = self._request_form("POST", "/canvases.edit", body={"canvas_id": canvas_id, "changes": changes})
        return {"canvas_id": canvas_id, "changes": changes, "raw": raw}

    def get_upload_url(self, *, filename: str, length: int, alt_txt: str | None = None, snippet_type: str | None = None) -> dict[str, Any]:
        body: dict[str, Any] = {"filename": filename, "length": length}
        if alt_txt:
            body["alt_txt"] = alt_txt
        if snippet_type:
            body["snippet_type"] = snippet_type
        raw = self._request_form("GET", "/files.getUploadURLExternal", body=body)
        return {"upload_url": raw.get("upload_url"), "file_id": raw.get("file_id"), "raw": raw}

    def _upload_bytes(self, *, upload_url: str, filename: str, data: bytes) -> None:
        headers = {
            "Content-Type": mimetypes.guess_type(filename)[0] or "application/octet-stream",
            "User-Agent": self._user_agent,
        }
        request = Request(upload_url, data=data, method="POST", headers=headers)
        with urlopen(request, timeout=60) as response:
            response.read()

    def complete_upload(
        self,
        *,
        file_id: str,
        channel_id: str | None = None,
        thread_ts: str | None = None,
        title: str | None = None,
        initial_comment: str | None = None,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {"files": json.dumps([{"id": file_id, "title": title or file_id}])}
        if channel_id:
            body["channel_id"] = channel_id
        if thread_ts:
            body["thread_ts"] = thread_ts
        if initial_comment:
            body["initial_comment"] = initial_comment
        raw = self._request_form("POST", "/files.completeUploadExternal", body=body)
        files = [_normalize_file(item) for item in _list_or_empty(raw.get("files")) if isinstance(item, dict)]
        return {"files": files, "raw": raw}

    def upload_file(
        self,
        *,
        file_path: str,
        filename: str | None = None,
        channel_id: str | None = None,
        thread_ts: str | None = None,
        title: str | None = None,
        initial_comment: str | None = None,
    ) -> dict[str, Any]:
        path = Path(file_path).expanduser()
        data = path.read_bytes()
        resolved_filename = filename or path.name
        upload = self.get_upload_url(filename=resolved_filename, length=len(data))
        upload_url = str(upload["upload_url"] or "")
        file_id = str(upload["file_id"] or "")
        if not upload_url or not file_id:
            raise SlackApiError(
                status_code=None,
                code="SLACK_UPLOAD_URL_ERROR",
                message="Slack did not return an upload URL",
                details={"backend": BACKEND_NAME, "file_path": file_path},
            )
        self._upload_bytes(upload_url=upload_url, filename=resolved_filename, data=data)
        complete = self.complete_upload(
            file_id=file_id,
            channel_id=channel_id,
            thread_ts=thread_ts,
            title=title or resolved_filename,
            initial_comment=initial_comment,
        )
        return {
            "file_id": file_id,
            "filename": resolved_filename,
            "channel_id": channel_id,
            "thread_ts": thread_ts,
            "uploaded_bytes": len(data),
            "complete": complete,
            "raw": {"upload": upload, "complete": complete},
        }
