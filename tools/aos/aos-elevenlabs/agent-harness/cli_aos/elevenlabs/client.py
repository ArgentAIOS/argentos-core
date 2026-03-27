from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode, urljoin
from urllib.request import Request, urlopen

from .constants import (
    BACKEND_NAME,
    DEFAULT_BASE_URL,
    DEFAULT_SIMILARITY_BOOST,
    DEFAULT_STABILITY,
    DEFAULT_STYLE,
    DEFAULT_SYNTHESIS_OUTPUT_FORMAT,
)


@dataclass(slots=True)
class ElevenLabsApiError(Exception):
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


def _content_type_for_output_format(output_format: str) -> str:
    lowered = output_format.lower()
    if lowered.startswith("mp3"):
        return "audio/mpeg"
    if lowered.startswith("wav"):
        return "audio/wav"
    if lowered.startswith("pcm"):
        return "audio/L16"
    if lowered.startswith("ogg"):
        return "audio/ogg"
    return "application/octet-stream"


def _response_header(headers: Any, name: str) -> str | None:
    if headers is None:
        return None
    getter = getattr(headers, "get", None)
    if callable(getter):
        value = getter(name)
        if value is not None:
            return str(value)
        value = getter(name.lower())
        if value is not None:
            return str(value)
        value = getter(name.upper())
        if value is not None:
            return str(value)
    return None


class ElevenLabsClient:
    def __init__(self, *, api_key: str, base_url: str = DEFAULT_BASE_URL) -> None:
        self._api_key = api_key.strip()
        self._base_url = base_url.rstrip("/") or DEFAULT_BASE_URL

    def _compose_url(self, path: str, *, params: dict[str, Any] | None = None) -> str:
        url = urljoin(self._base_url + "/", path.lstrip("/"))
        if params:
            query = urlencode([(key, str(value)) for key, value in params.items() if value is not None])
            if query:
                url = f"{url}?{query}"
        return url

    def _request_json(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        body: dict[str, Any] | None = None,
    ) -> Any:
        url = self._compose_url(path, params=params)
        payload = json.dumps(body).encode("utf-8") if body is not None else None
        headers = {
            "xi-api-key": self._api_key,
            "Accept": "application/json",
        }
        if payload is not None:
            headers["Content-Type"] = "application/json"
        request = Request(url, data=payload, method=method.upper(), headers=headers)
        try:
            with urlopen(request, timeout=30) as response:
                return _load_json(response.read())
        except HTTPError as err:
            details: dict[str, Any] = {}
            try:
                loaded = _load_json(err.read())
                details = loaded if isinstance(loaded, dict) else {"value": loaded}
            except Exception:
                details = {}
            raise ElevenLabsApiError(
                status_code=err.code,
                code=str(details.get("code") or details.get("error") or details.get("type") or "ELEVENLABS_API_ERROR"),
                message=str(details.get("detail") or details.get("message") or err.reason or "ElevenLabs API request failed"),
                details=details,
            ) from err
        except URLError as err:
            raise ElevenLabsApiError(
                status_code=None,
                code="ELEVENLABS_NETWORK_ERROR",
                message=str(getattr(err, "reason", err)),
                details={"backend": BACKEND_NAME, "url": url},
            ) from err

    def read_user(self) -> dict[str, Any]:
        payload = self._request_json("GET", "/v1/user")
        return payload if isinstance(payload, dict) else {"value": payload}

    def list_voices(
        self,
        *,
        page_size: int = 10,
        cursor: str | None = None,
        search: str | None = None,
    ) -> dict[str, Any]:
        payload = self._request_json(
            "GET",
            "/v2/voices",
            params={
                "page_size": max(1, min(page_size, 100)),
                "next_page_token": cursor,
                "search": search,
            },
        )
        return payload if isinstance(payload, dict) else {"voices": payload}

    def read_voice(self, voice_id: str) -> dict[str, Any]:
        payload = self._request_json("GET", f"/v1/voices/{voice_id}")
        return payload if isinstance(payload, dict) else {"value": payload}

    def list_models(self) -> list[dict[str, Any]]:
        payload = self._request_json("GET", "/v1/models")
        if isinstance(payload, list):
            return [item for item in payload if isinstance(item, dict)]
        if isinstance(payload, dict) and isinstance(payload.get("models"), list):
            return [item for item in payload["models"] if isinstance(item, dict)]
        return []

    def list_history(
        self,
        *,
        page_size: int = 100,
        cursor: str | None = None,
        voice_id: str | None = None,
        model_id: str | None = None,
    ) -> dict[str, Any]:
        payload = self._request_json(
            "GET",
            "/v1/history",
            params={
                "page_size": max(1, min(page_size, 1000)),
                "start_after_history_item_id": cursor,
                "voice_id": voice_id,
                "model_id": model_id,
            },
        )
        return payload if isinstance(payload, dict) else {"history": payload}

    def read_history_item(self, history_item_id: str) -> dict[str, Any]:
        payload = self._request_json("GET", f"/v1/history/{history_item_id}")
        return payload if isinstance(payload, dict) else {"value": payload}

    def synthesize(
        self,
        text: str,
        *,
        voice_id: str,
        model_id: str | None = None,
        output_format: str = DEFAULT_SYNTHESIS_OUTPUT_FORMAT,
        stability: float | None = None,
        similarity_boost: float | None = None,
        style: float | None = None,
    ) -> dict[str, Any]:
        request_body: dict[str, Any] = {"text": text}
        if model_id:
            request_body["model_id"] = model_id
        voice_settings: dict[str, Any] = {}
        if stability is not None:
            voice_settings["stability"] = max(0.0, min(1.0, stability))
        if similarity_boost is not None:
            voice_settings["similarity_boost"] = max(0.0, min(1.0, similarity_boost))
        if style is not None:
            voice_settings["style"] = max(0.0, min(1.0, style))
        if voice_settings:
            request_body["voice_settings"] = voice_settings

        url = self._compose_url(
            f"/v1/text-to-speech/{quote(voice_id, safe='')}",
            params={"output_format": output_format},
        )
        payload = json.dumps(request_body).encode("utf-8")
        content_type = _content_type_for_output_format(output_format)
        request = Request(
            url,
            data=payload,
            method="POST",
            headers={
                "xi-api-key": self._api_key,
                "Accept": content_type,
                "Content-Type": "application/json",
            },
        )
        try:
            with urlopen(request, timeout=90) as response:
                audio = response.read()
                headers = getattr(response, "headers", None)
                return {
                    "audio": audio,
                    "content_type": _response_header(headers, "Content-Type") or content_type,
                    "request_id": _response_header(headers, "x-request-id") or _response_header(headers, "request-id"),
                    "character_count": (
                        int(count)
                        if (count := _response_header(headers, "x-character-count")) and count.isdigit()
                        else None
                    ),
                    "output_format": output_format,
                    "voice_id": voice_id,
                    "model_id": model_id,
                    "request": {
                        "method": "POST",
                        "url": url,
                        "text_length": len(text),
                    },
                }
        except HTTPError as err:
            details: dict[str, Any] = {}
            try:
                loaded = _load_json(err.read())
                details = loaded if isinstance(loaded, dict) else {"value": loaded}
            except Exception:
                details = {}
            raise ElevenLabsApiError(
                status_code=err.code,
                code=str(details.get("code") or details.get("error") or details.get("type") or "ELEVENLABS_API_ERROR"),
                message=str(details.get("detail") or details.get("message") or err.reason or "ElevenLabs API request failed"),
                details=details,
            ) from err
        except URLError as err:
            raise ElevenLabsApiError(
                status_code=None,
                code="ELEVENLABS_NETWORK_ERROR",
                message=str(getattr(err, "reason", err)),
                details={"backend": BACKEND_NAME, "url": url},
            ) from err

    def synthesize_stream(
        self,
        text: str,
        *,
        voice_id: str,
        model_id: str | None = None,
        output_format: str = DEFAULT_SYNTHESIS_OUTPUT_FORMAT,
        stability: float | None = None,
        similarity_boost: float | None = None,
        style: float | None = None,
    ) -> dict[str, Any]:
        """Streaming TTS — reads chunks and returns concatenated audio bytes."""
        request_body: dict[str, Any] = {"text": text}
        if model_id:
            request_body["model_id"] = model_id
        voice_settings: dict[str, Any] = {}
        if stability is not None:
            voice_settings["stability"] = max(0.0, min(1.0, stability))
        if similarity_boost is not None:
            voice_settings["similarity_boost"] = max(0.0, min(1.0, similarity_boost))
        if style is not None:
            voice_settings["style"] = max(0.0, min(1.0, style))
        if voice_settings:
            request_body["voice_settings"] = voice_settings

        url = self._compose_url(
            f"/v1/text-to-speech/{quote(voice_id, safe='')}/stream",
            params={"output_format": output_format},
        )
        payload = json.dumps(request_body).encode("utf-8")
        content_type = _content_type_for_output_format(output_format)
        request = Request(
            url,
            data=payload,
            method="POST",
            headers={
                "xi-api-key": self._api_key,
                "Accept": content_type,
                "Content-Type": "application/json",
            },
        )
        try:
            with urlopen(request, timeout=120) as response:
                chunks: list[bytes] = []
                while True:
                    chunk = response.read(8192)
                    if not chunk:
                        break
                    chunks.append(chunk)
                audio = b"".join(chunks)
                headers = getattr(response, "headers", None)
                return {
                    "audio": audio,
                    "content_type": _response_header(headers, "Content-Type") or content_type,
                    "request_id": _response_header(headers, "x-request-id") or _response_header(headers, "request-id"),
                    "output_format": output_format,
                    "voice_id": voice_id,
                    "model_id": model_id,
                    "chunk_count": len(chunks),
                    "request": {
                        "method": "POST",
                        "url": url,
                        "text_length": len(text),
                    },
                }
        except HTTPError as err:
            details: dict[str, Any] = {}
            try:
                loaded = _load_json(err.read())
                details = loaded if isinstance(loaded, dict) else {"value": loaded}
            except Exception:
                details = {}
            raise ElevenLabsApiError(
                status_code=err.code,
                code=str(details.get("code") or details.get("error") or details.get("type") or "ELEVENLABS_API_ERROR"),
                message=str(details.get("detail") or details.get("message") or err.reason or "ElevenLabs API request failed"),
                details=details,
            ) from err
        except URLError as err:
            raise ElevenLabsApiError(
                status_code=None,
                code="ELEVENLABS_NETWORK_ERROR",
                message=str(getattr(err, "reason", err)),
                details={"backend": BACKEND_NAME, "url": url},
            ) from err

    def clone_voice(
        self,
        *,
        name: str,
        description: str | None = None,
        files: list[str],
    ) -> dict[str, Any]:
        """Create an instant voice clone from audio sample files."""
        import mimetypes
        from email.mime.multipart import MIMEMultipart

        url = self._compose_url("/v1/voices/add")
        boundary = "----AosElevenLabsBoundary"
        body_parts: list[bytes] = []

        body_parts.append(f"--{boundary}\r\nContent-Disposition: form-data; name=\"name\"\r\n\r\n{name}\r\n".encode())
        if description:
            body_parts.append(f"--{boundary}\r\nContent-Disposition: form-data; name=\"description\"\r\n\r\n{description}\r\n".encode())

        from pathlib import Path as _Path
        for file_path in files:
            p = _Path(file_path).expanduser()
            if not p.is_absolute():
                p = _Path.cwd() / p
            if not p.exists():
                raise ElevenLabsApiError(
                    status_code=None,
                    code="ELEVENLABS_FILE_NOT_FOUND",
                    message=f"Audio sample file not found: {p}",
                    details={"path": str(p)},
                )
            mime = mimetypes.guess_type(str(p))[0] or "application/octet-stream"
            file_data = p.read_bytes()
            body_parts.append(
                f"--{boundary}\r\nContent-Disposition: form-data; name=\"files\"; filename=\"{p.name}\"\r\nContent-Type: {mime}\r\n\r\n".encode()
                + file_data
                + b"\r\n"
            )

        body_parts.append(f"--{boundary}--\r\n".encode())
        full_body = b"".join(body_parts)

        request = Request(
            url,
            data=full_body,
            method="POST",
            headers={
                "xi-api-key": self._api_key,
                "Accept": "application/json",
                "Content-Type": f"multipart/form-data; boundary={boundary}",
            },
        )
        try:
            with urlopen(request, timeout=120) as response:
                return _load_json(response.read())
        except HTTPError as err:
            details: dict[str, Any] = {}
            try:
                loaded = _load_json(err.read())
                details = loaded if isinstance(loaded, dict) else {"value": loaded}
            except Exception:
                details = {}
            raise ElevenLabsApiError(
                status_code=err.code,
                code=str(details.get("code") or details.get("error") or details.get("type") or "ELEVENLABS_API_ERROR"),
                message=str(details.get("detail") or details.get("message") or err.reason or "Voice clone failed"),
                details=details,
            ) from err
        except URLError as err:
            raise ElevenLabsApiError(
                status_code=None,
                code="ELEVENLABS_NETWORK_ERROR",
                message=str(getattr(err, "reason", err)),
                details={"backend": BACKEND_NAME, "url": url},
            ) from err

    def generate_sound_effect(
        self,
        text: str,
        *,
        duration_seconds: float | None = None,
        prompt_influence: float | None = None,
    ) -> dict[str, Any]:
        """Generate a sound effect from a text prompt."""
        request_body: dict[str, Any] = {"text": text}
        if duration_seconds is not None:
            request_body["duration_seconds"] = duration_seconds
        if prompt_influence is not None:
            request_body["prompt_influence"] = max(0.0, min(1.0, prompt_influence))

        url = self._compose_url("/v1/sound-generation")
        payload = json.dumps(request_body).encode("utf-8")
        request = Request(
            url,
            data=payload,
            method="POST",
            headers={
                "xi-api-key": self._api_key,
                "Accept": "audio/mpeg",
                "Content-Type": "application/json",
            },
        )
        try:
            with urlopen(request, timeout=120) as response:
                audio = response.read()
                headers = getattr(response, "headers", None)
                return {
                    "audio": audio,
                    "content_type": _response_header(headers, "Content-Type") or "audio/mpeg",
                    "request_id": _response_header(headers, "x-request-id") or _response_header(headers, "request-id"),
                    "request": {
                        "method": "POST",
                        "url": url,
                        "prompt_length": len(text),
                    },
                }
        except HTTPError as err:
            details: dict[str, Any] = {}
            try:
                loaded = _load_json(err.read())
                details = loaded if isinstance(loaded, dict) else {"value": loaded}
            except Exception:
                details = {}
            raise ElevenLabsApiError(
                status_code=err.code,
                code=str(details.get("code") or details.get("error") or details.get("type") or "ELEVENLABS_API_ERROR"),
                message=str(details.get("detail") or details.get("message") or err.reason or "Sound effect generation failed"),
                details=details,
            ) from err
        except URLError as err:
            raise ElevenLabsApiError(
                status_code=None,
                code="ELEVENLABS_NETWORK_ERROR",
                message=str(getattr(err, "reason", err)),
                details={"backend": BACKEND_NAME, "url": url},
            ) from err

    def isolate_audio(self, audio_data: bytes) -> dict[str, Any]:
        """Remove background noise from audio using audio isolation API."""
        boundary = "----AosElevenLabsIsolateBoundary"
        body = (
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"audio\"; filename=\"input.mp3\"\r\nContent-Type: audio/mpeg\r\n\r\n".encode()
            + audio_data
            + f"\r\n--{boundary}--\r\n".encode()
        )
        url = self._compose_url("/v1/audio-isolation")
        request = Request(
            url,
            data=body,
            method="POST",
            headers={
                "xi-api-key": self._api_key,
                "Accept": "audio/mpeg",
                "Content-Type": f"multipart/form-data; boundary={boundary}",
            },
        )
        try:
            with urlopen(request, timeout=120) as response:
                audio = response.read()
                headers = getattr(response, "headers", None)
                return {
                    "audio": audio,
                    "content_type": _response_header(headers, "Content-Type") or "audio/mpeg",
                    "request_id": _response_header(headers, "x-request-id") or _response_header(headers, "request-id"),
                    "request": {
                        "method": "POST",
                        "url": url,
                        "input_size_bytes": len(audio_data),
                    },
                }
        except HTTPError as err:
            details: dict[str, Any] = {}
            try:
                loaded = _load_json(err.read())
                details = loaded if isinstance(loaded, dict) else {"value": loaded}
            except Exception:
                details = {}
            raise ElevenLabsApiError(
                status_code=err.code,
                code=str(details.get("code") or details.get("error") or details.get("type") or "ELEVENLABS_API_ERROR"),
                message=str(details.get("detail") or details.get("message") or err.reason or "Audio isolation failed"),
                details=details,
            ) from err
        except URLError as err:
            raise ElevenLabsApiError(
                status_code=None,
                code="ELEVENLABS_NETWORK_ERROR",
                message=str(getattr(err, "reason", err)),
                details={"backend": BACKEND_NAME, "url": url},
            ) from err

    def download_history_audio(self, history_item_id: str) -> dict[str, Any]:
        """Download the audio file for a history item."""
        url = self._compose_url(f"/v1/history/{quote(history_item_id, safe='')}/audio")
        request = Request(
            url,
            method="GET",
            headers={
                "xi-api-key": self._api_key,
                "Accept": "audio/mpeg",
            },
        )
        try:
            with urlopen(request, timeout=90) as response:
                audio = response.read()
                headers = getattr(response, "headers", None)
                return {
                    "audio": audio,
                    "content_type": _response_header(headers, "Content-Type") or "audio/mpeg",
                    "history_item_id": history_item_id,
                    "request": {
                        "method": "GET",
                        "url": url,
                    },
                }
        except HTTPError as err:
            details: dict[str, Any] = {}
            try:
                loaded = _load_json(err.read())
                details = loaded if isinstance(loaded, dict) else {"value": loaded}
            except Exception:
                details = {}
            raise ElevenLabsApiError(
                status_code=err.code,
                code=str(details.get("code") or details.get("error") or details.get("type") or "ELEVENLABS_API_ERROR"),
                message=str(details.get("detail") or details.get("message") or err.reason or "History audio download failed"),
                details=details,
            ) from err
        except URLError as err:
            raise ElevenLabsApiError(
                status_code=None,
                code="ELEVENLABS_NETWORK_ERROR",
                message=str(getattr(err, "reason", err)),
                details={"backend": BACKEND_NAME, "url": url},
            ) from err
