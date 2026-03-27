from __future__ import annotations

import base64
import json
from dataclasses import dataclass
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from .constants import BACKEND_NAME


@dataclass(slots=True)
class TwilioApiError(Exception):
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


def _normalize_message(raw: dict[str, Any]) -> dict[str, Any]:
    return {
        "sid": raw.get("sid"),
        "from": raw.get("from"),
        "to": raw.get("to"),
        "body": raw.get("body"),
        "status": raw.get("status"),
        "direction": raw.get("direction"),
        "date_sent": raw.get("date_sent"),
        "date_created": raw.get("date_created"),
        "price": raw.get("price"),
        "price_unit": raw.get("price_unit"),
        "error_code": raw.get("error_code"),
        "error_message": raw.get("error_message"),
        "num_segments": raw.get("num_segments"),
        "raw": raw,
    }


def _normalize_call(raw: dict[str, Any]) -> dict[str, Any]:
    return {
        "sid": raw.get("sid"),
        "from": raw.get("from"),
        "to": raw.get("to"),
        "status": raw.get("status"),
        "direction": raw.get("direction"),
        "start_time": raw.get("start_time"),
        "end_time": raw.get("end_time"),
        "duration": raw.get("duration"),
        "price": raw.get("price"),
        "price_unit": raw.get("price_unit"),
        "answered_by": raw.get("answered_by"),
        "raw": raw,
    }


def _normalize_lookup(raw: dict[str, Any]) -> dict[str, Any]:
    carrier = raw.get("carrier") or {}
    caller_name = raw.get("caller_name") or {}
    return {
        "phone_number": raw.get("phone_number"),
        "country_code": raw.get("country_code"),
        "national_format": raw.get("national_format"),
        "carrier_name": carrier.get("name") if isinstance(carrier, dict) else None,
        "carrier_type": carrier.get("type") if isinstance(carrier, dict) else None,
        "caller_name": caller_name.get("caller_name") if isinstance(caller_name, dict) else None,
        "caller_type": caller_name.get("caller_type") if isinstance(caller_name, dict) else None,
        "line_type": carrier.get("type") if isinstance(carrier, dict) else None,
        "raw": raw,
    }


class TwilioClient:
    def __init__(self, *, account_sid: str, auth_token: str) -> None:
        self._account_sid = account_sid.strip()
        self._auth_token = auth_token.strip()
        self._base_url = f"https://api.twilio.com/2010-04-01/Accounts/{self._account_sid}"
        self._lookup_url = "https://lookups.twilio.com/v1/PhoneNumbers"
        credentials = base64.b64encode(f"{self._account_sid}:{self._auth_token}".encode("utf-8")).decode("utf-8")
        self._auth_header = f"Basic {credentials}"
        self._user_agent = "aos-twilio/0.1.0"

    def _request(
        self,
        method: str,
        url: str,
        *,
        params: dict[str, Any] | None = None,
        form_data: dict[str, str] | None = None,
    ) -> dict[str, Any]:
        if params:
            query = urlencode([(key, str(value)) for key, value in params.items() if value is not None])
            if query:
                url = f"{url}?{query}"
        payload: bytes | None = None
        headers: dict[str, str] = {
            "Authorization": self._auth_header,
            "Accept": "application/json",
            "User-Agent": self._user_agent,
        }
        if form_data is not None:
            payload = urlencode(form_data).encode("utf-8")
            headers["Content-Type"] = "application/x-www-form-urlencoded"
        request = Request(url, data=payload, method=method.upper(), headers=headers)
        try:
            with urlopen(request, timeout=30) as response:
                return _dict_or_empty(_load_json(response.read()))
        except HTTPError as err:
            details: dict[str, Any] = {}
            try:
                details = _dict_or_empty(_load_json(err.read()))
            except Exception:
                details = {}
            code = str(details.get("code") or "TWILIO_API_ERROR")
            message = str(details.get("message") or err.reason or "Twilio API request failed")
            raise TwilioApiError(
                status_code=err.code,
                code=code,
                message=message,
                details=details,
            ) from err
        except URLError as err:
            raise TwilioApiError(
                status_code=None,
                code="TWILIO_NETWORK_ERROR",
                message=str(getattr(err, "reason", err)),
                details={"backend": BACKEND_NAME, "url": url},
            ) from err

    # ── SMS ──────────────────────────────────────────────────────────

    def send_sms(
        self,
        *,
        from_number: str,
        to_number: str,
        body: str,
        status_callback: str | None = None,
    ) -> dict[str, Any]:
        form: dict[str, str] = {"From": from_number, "To": to_number, "Body": body}
        if status_callback:
            form["StatusCallback"] = status_callback
        raw = self._request("POST", f"{self._base_url}/Messages.json", form_data=form)
        return _normalize_message(raw)

    def list_messages(self, *, limit: int = 20, from_number: str | None = None) -> dict[str, Any]:
        params: dict[str, Any] = {"PageSize": max(1, min(limit, 100))}
        if from_number:
            params["From"] = from_number
        raw = self._request("GET", f"{self._base_url}/Messages.json", params=params)
        messages_raw = raw.get("messages", [])
        messages = [_normalize_message(m) for m in messages_raw if isinstance(m, dict)]
        return {"messages": messages, "raw": raw}

    def read_message(self, message_sid: str) -> dict[str, Any]:
        raw = self._request("GET", f"{self._base_url}/Messages/{message_sid}.json")
        return _normalize_message(raw)

    # ── Voice Calls ──────────────────────────────────────────────────

    def create_call(
        self,
        *,
        from_number: str,
        to_number: str,
        voice_url: str | None = None,
        say_text: str | None = None,
        status_callback: str | None = None,
    ) -> dict[str, Any]:
        form: dict[str, str] = {"From": from_number, "To": to_number}
        if voice_url and voice_url.startswith(("http://", "https://")):
            form["Url"] = voice_url
        elif say_text or voice_url:
            text = say_text or voice_url or ""
            twiml = f'<Response><Say>{text}</Say></Response>'
            form["Twiml"] = twiml
        else:
            form["Twiml"] = "<Response><Say>Hello from ArgentOS.</Say></Response>"
        if status_callback:
            form["StatusCallback"] = status_callback
        raw = self._request("POST", f"{self._base_url}/Calls.json", form_data=form)
        return _normalize_call(raw)

    def list_calls(self, *, limit: int = 20) -> dict[str, Any]:
        params: dict[str, Any] = {"PageSize": max(1, min(limit, 100))}
        raw = self._request("GET", f"{self._base_url}/Calls.json", params=params)
        calls_raw = raw.get("calls", [])
        calls = [_normalize_call(c) for c in calls_raw if isinstance(c, dict)]
        return {"calls": calls, "raw": raw}

    def get_call(self, call_sid: str) -> dict[str, Any]:
        raw = self._request("GET", f"{self._base_url}/Calls/{call_sid}.json")
        return _normalize_call(raw)

    # ── WhatsApp ─────────────────────────────────────────────────────

    def send_whatsapp(
        self,
        *,
        from_number: str,
        to_number: str,
        body: str,
        status_callback: str | None = None,
    ) -> dict[str, Any]:
        wa_from = from_number if from_number.startswith("whatsapp:") else f"whatsapp:{from_number}"
        wa_to = to_number if to_number.startswith("whatsapp:") else f"whatsapp:{to_number}"
        form: dict[str, str] = {"From": wa_from, "To": wa_to, "Body": body}
        if status_callback:
            form["StatusCallback"] = status_callback
        raw = self._request("POST", f"{self._base_url}/Messages.json", form_data=form)
        return _normalize_message(raw)

    def list_whatsapp_messages(self, *, limit: int = 20, from_number: str | None = None) -> dict[str, Any]:
        params: dict[str, Any] = {"PageSize": max(1, min(limit, 100))}
        if from_number:
            wa_from = from_number if from_number.startswith("whatsapp:") else f"whatsapp:{from_number}"
            params["From"] = wa_from
        raw = self._request("GET", f"{self._base_url}/Messages.json", params=params)
        messages_raw = raw.get("messages", [])
        whatsapp = [
            _normalize_message(m) for m in messages_raw
            if isinstance(m, dict) and (
                str(m.get("from", "")).startswith("whatsapp:") or str(m.get("to", "")).startswith("whatsapp:")
            )
        ]
        return {"messages": whatsapp, "raw": raw}

    # ── Lookup ───────────────────────────────────────────────────────

    def lookup_phone(self, phone_number: str) -> dict[str, Any]:
        params: dict[str, Any] = {"Type": "carrier,caller-name"}
        raw = self._request("GET", f"{self._lookup_url}/{phone_number}", params=params)
        return _normalize_lookup(raw)

    # ── Account Probe ────────────────────────────────────────────────

    def read_account(self) -> dict[str, Any]:
        raw = self._request("GET", f"{self._base_url}.json")
        return {
            "sid": raw.get("sid"),
            "friendly_name": raw.get("friendly_name"),
            "status": raw.get("status"),
            "type": raw.get("type"),
            "date_created": raw.get("date_created"),
        }
