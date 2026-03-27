from __future__ import annotations

import base64
import json
import mimetypes
import os
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlparse
from urllib.request import Request, urlopen

from .constants import BACKEND_NAME


@dataclass(slots=True)
class OpenAIApiError(Exception):
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


def _load_binary_source(source: str, *, fallback_name: str) -> tuple[str, bytes, str]:
    if source.startswith(("http://", "https://")):
        with urlopen(source, timeout=30) as response:
            payload = response.read()
            content_type = response.headers.get("Content-Type") or _guess_content_type(fallback_name)
        parsed = urlparse(source)
        filename = Path(parsed.path).name or fallback_name
        return filename, payload, content_type

    path = Path(source).expanduser()
    payload = path.read_bytes()
    return path.name, payload, _guess_content_type(path.name)


def _build_multipart(
    *,
    fields: dict[str, str],
    files: dict[str, tuple[str, bytes, str]],
) -> tuple[bytes, str]:
    boundary = f"----aos-openai-{uuid.uuid4().hex}"
    chunks: list[bytes] = []
    for name, value in fields.items():
        chunks.extend(
            [
                f"--{boundary}\r\n".encode("utf-8"),
                f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode("utf-8"),
                value.encode("utf-8"),
                b"\r\n",
            ]
        )
    for name, (filename, payload, content_type) in files.items():
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
    return b"".join(chunks), f"multipart/form-data; boundary={boundary}"


def _normalize_chat_choice(raw: dict[str, Any]) -> dict[str, Any]:
    message = raw.get("message") or {}
    return {
        "index": raw.get("index"),
        "finish_reason": raw.get("finish_reason"),
        "role": message.get("role"),
        "content": message.get("content"),
        "tool_calls": message.get("tool_calls"),
        "raw": raw,
    }


def _normalize_image(raw: dict[str, Any]) -> dict[str, Any]:
    return {
        "url": raw.get("url"),
        "b64_json": raw.get("b64_json"),
        "revised_prompt": raw.get("revised_prompt"),
        "raw": raw,
    }


def _normalize_model(raw: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": raw.get("id"),
        "object": raw.get("object"),
        "created": raw.get("created"),
        "owned_by": raw.get("owned_by"),
        "raw": raw,
    }


class OpenAIClient:
    def __init__(
        self,
        *,
        api_key: str,
        base_url: str,
        organization_id: str | None = None,
        project_id: str | None = None,
    ) -> None:
        self._api_key = api_key.strip()
        self._base_url = base_url.rstrip("/")
        self._organization_id = (organization_id or "").strip()
        self._project_id = (project_id or "").strip()
        self._user_agent = "aos-openai/0.1.0"

    def _headers(self) -> dict[str, str]:
        headers = {
            "Authorization": f"Bearer {self._api_key}",
            "Accept": "application/json",
            "User-Agent": self._user_agent,
        }
        if self._organization_id:
            headers["OpenAI-Organization"] = self._organization_id
        if self._project_id:
            headers["OpenAI-Project"] = self._project_id
        return headers

    def _request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        json_body: dict[str, Any] | None = None,
        multipart_fields: dict[str, str] | None = None,
        multipart_files: dict[str, tuple[str, bytes, str]] | None = None,
        expect_json: bool = True,
    ) -> Any:
        url = f"{self._base_url}{path}"
        if params:
            query = urlencode([(key, str(value)) for key, value in params.items() if value is not None])
            if query:
                url = f"{url}?{query}"

        data: bytes | None = None
        headers = self._headers()

        if json_body is not None:
            data = json.dumps(json_body).encode("utf-8")
            headers["Content-Type"] = "application/json"
        elif multipart_fields is not None or multipart_files is not None:
            data, content_type = _build_multipart(
                fields=multipart_fields or {},
                files=multipart_files or {},
            )
            headers["Content-Type"] = content_type

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
            code = str(error_payload.get("code") or error_payload.get("type") or "OPENAI_API_ERROR")
            message = str(error_payload.get("message") or err.reason or "OpenAI API request failed")
            raise OpenAIApiError(
                status_code=err.code,
                code=code,
                message=message,
                details=details or {"backend": BACKEND_NAME, "url": url},
            ) from err
        except URLError as err:
            raise OpenAIApiError(
                status_code=None,
                code="OPENAI_NETWORK_ERROR",
                message=str(getattr(err, "reason", err)),
                details={"backend": BACKEND_NAME, "url": url},
            ) from err

    def list_models(self, *, limit: int = 50) -> dict[str, Any]:
        raw = self._request("GET", "/models")
        models = [_normalize_model(item) for item in _list_or_empty(raw.get("data")) if isinstance(item, dict)]
        return {
            "models": models[: max(1, limit)],
            "count": min(len(models), max(1, limit)),
            "raw": raw,
        }

    def create_chat_completion(
        self,
        *,
        model: str,
        messages: list[dict[str, Any]],
        max_tokens: int | None = None,
        temperature: float | None = None,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {
            "model": model,
            "messages": messages,
        }
        if max_tokens is not None:
            body["max_tokens"] = max_tokens
        if temperature is not None:
            body["temperature"] = temperature
        raw = self._request("POST", "/chat/completions", json_body=body)
        choices = [_normalize_chat_choice(item) for item in _list_or_empty(raw.get("choices")) if isinstance(item, dict)]
        return {
            "id": raw.get("id"),
            "object": raw.get("object"),
            "created": raw.get("created"),
            "model": raw.get("model"),
            "choices": choices,
            "usage": raw.get("usage"),
            "raw": raw,
        }

    def create_embedding(self, *, model: str, input_text: str) -> dict[str, Any]:
        raw = self._request("POST", "/embeddings", json_body={"model": model, "input": input_text})
        data = _list_or_empty(raw.get("data"))
        return {
            "model": raw.get("model") or model,
            "object": raw.get("object"),
            "data": data,
            "usage": raw.get("usage"),
            "embedding_count": len(data),
            "dimensions": len(data[0].get("embedding", [])) if data and isinstance(data[0], dict) else 0,
            "raw": raw,
        }

    def generate_image(self, *, model: str, prompt: str, size: str | None = None) -> dict[str, Any]:
        body: dict[str, Any] = {"model": model, "prompt": prompt}
        if size:
            body["size"] = size
        raw = self._request("POST", "/images/generations", json_body=body)
        images = [_normalize_image(item) for item in _list_or_empty(raw.get("data")) if isinstance(item, dict)]
        return {"created": raw.get("created"), "images": images, "raw": raw}

    def edit_image(self, *, model: str, image_file: str, prompt: str, size: str | None = None) -> dict[str, Any]:
        filename, payload, content_type = _load_binary_source(image_file, fallback_name="image.png")
        fields = {"model": model, "prompt": prompt}
        if size:
            fields["size"] = size
        raw = self._request(
            "POST",
            "/images/edits",
            multipart_fields=fields,
            multipart_files={"image": (filename, payload, content_type)},
        )
        images = [_normalize_image(item) for item in _list_or_empty(raw.get("data")) if isinstance(item, dict)]
        return {"created": raw.get("created"), "images": images, "raw": raw}

    def transcribe_audio(self, *, model: str, audio_file: str) -> dict[str, Any]:
        filename, payload, content_type = _load_binary_source(audio_file, fallback_name="audio.mp3")
        raw = self._request(
            "POST",
            "/audio/transcriptions",
            multipart_fields={"model": model},
            multipart_files={"file": (filename, payload, content_type)},
        )
        return raw

    def synthesize_speech(self, *, model: str, voice: str, input_text: str) -> dict[str, Any]:
        raw = self._request(
            "POST",
            "/audio/speech",
            json_body={"model": model, "voice": voice, "input": input_text},
            expect_json=False,
        )
        content_type = raw.get("content_type") or "audio/mpeg"
        payload = raw.get("bytes") or b""
        ext = mimetypes.guess_extension(content_type.split(";")[0].strip()) or ".mp3"
        return {
            "format": ext.lstrip("."),
            "content_type": content_type,
            "bytes_count": len(payload),
            "audio_base64": base64.b64encode(payload).decode("utf-8"),
        }

    def check_moderation(self, *, model: str, input_text: str) -> dict[str, Any]:
        raw = self._request("POST", "/moderations", json_body={"model": model, "input": input_text})
        results = _list_or_empty(raw.get("results"))
        flagged = any(bool(item.get("flagged")) for item in results if isinstance(item, dict))
        return {"id": raw.get("id"), "model": raw.get("model") or model, "results": results, "flagged": flagged, "raw": raw}
