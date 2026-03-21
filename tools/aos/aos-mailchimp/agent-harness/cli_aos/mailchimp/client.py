from __future__ import annotations

import base64
import json
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Any

from .config import runtime_config
from .constants import DEFAULT_TIMEOUT_SECONDS
from .errors import CliError


@dataclass(slots=True)
class MailchimpClient:
    base_url: str
    api_key: str
    timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS

    @classmethod
    def from_context(cls, ctx_obj: dict[str, Any] | None = None) -> "MailchimpClient":
        config = runtime_config(ctx_obj)
        if not config["api_key_present"]:
            raise CliError(
                code="SETUP_REQUIRED",
                message="MAILCHIMP_API_KEY is required",
                exit_code=4,
                details={"missing": ["MAILCHIMP_API_KEY"]},
            )
        if not config["base_url_present"]:
            raise CliError(
                code="SETUP_REQUIRED",
                message="Unable to resolve a Mailchimp server prefix",
                exit_code=4,
                details={"missing": ["MAILCHIMP_SERVER_PREFIX"], "api_key_has_datacenter": bool(config["inferred_server_prefix"])},
            )
        return cls(
            base_url=config["base_url"],
            api_key=config["api_key"],
            timeout_seconds=float(config["request_timeout_s"]),
        )

    def _headers(self) -> dict[str, str]:
        token = base64.b64encode(f"anystring:{self.api_key}".encode("utf-8")).decode("ascii")
        return {
            "Authorization": f"Basic {token}",
            "Accept": "application/json",
            "Content-Type": "application/json",
            "User-Agent": "aos-mailchimp/0.1.0",
        }

    def request_json(
        self,
        method: str,
        path: str,
        *,
        query: dict[str, Any] | None = None,
        payload: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        url = f"{self.base_url.rstrip('/')}/{path.lstrip('/')}"
        if query:
            url = f"{url}?{urllib.parse.urlencode(query, doseq=True)}"

        data = None
        if payload is not None:
            data = json.dumps(payload).encode("utf-8")

        request = urllib.request.Request(url, data=data, headers=self._headers(), method=method.upper())

        try:
            with urllib.request.urlopen(request, timeout=self.timeout_seconds) as response:
                body = response.read().decode(response.headers.get_content_charset("utf-8"))
                return json.loads(body) if body else {}
        except urllib.error.HTTPError as exc:
            body = exc.read().decode(exc.headers.get_content_charset("utf-8") if exc.headers else "utf-8", errors="replace")
            response_payload: dict[str, Any] = {}
            if body:
                try:
                    parsed = json.loads(body)
                    if isinstance(parsed, dict):
                        response_payload = parsed
                except json.JSONDecodeError:
                    response_payload = {}

            code = "MAILCHIMP_API_ERROR"
            exit_code = 5
            if exc.code in (401, 403):
                code = "AUTH_ERROR"
                exit_code = 4
            elif exc.code == 404:
                code = "NOT_FOUND"
                exit_code = 6
            elif exc.code == 429:
                code = "RATE_LIMITED"
                exit_code = 5
            elif exc.code >= 500:
                code = "BACKEND_UNAVAILABLE"
                exit_code = 5

            message = body or str(exc)
            if response_payload:
                message = str(response_payload.get("detail") or response_payload.get("title") or response_payload.get("error") or message)

            raise CliError(
                code=code,
                message=message,
                exit_code=exit_code,
                details={"status": exc.code, "url": url, "response": response_payload or None},
            ) from exc
        except urllib.error.URLError as exc:
            raise CliError(
                code="NETWORK_ERROR",
                message="Failed to reach Mailchimp API",
                exit_code=5,
                details={"reason": str(exc.reason), "url": url},
            ) from exc

    def ping(self) -> dict[str, Any]:
        return self.request_json("GET", "/ping")

    def root(self) -> dict[str, Any]:
        return self.request_json("GET", "/")

    def list_audiences(self, *, count: int = 10, offset: int = 0) -> dict[str, Any]:
        return self.request_json("GET", "/lists", query={"count": count, "offset": offset})

    def read_audience(self, audience_id: str) -> dict[str, Any]:
        return self.request_json("GET", f"/lists/{urllib.parse.quote(audience_id, safe='')}")

    def list_campaigns(self, *, count: int = 10, offset: int = 0) -> dict[str, Any]:
        return self.request_json("GET", "/campaigns", query={"count": count, "offset": offset})

    def read_campaign(self, campaign_id: str) -> dict[str, Any]:
        return self.request_json("GET", f"/campaigns/{urllib.parse.quote(campaign_id, safe='')}")

    def list_members(self, audience_id: str, *, count: int = 10, offset: int = 0) -> dict[str, Any]:
        return self.request_json("GET", f"/lists/{urllib.parse.quote(audience_id, safe='')}/members", query={"count": count, "offset": offset})

    def read_member(self, audience_id: str, subscriber_hash: str) -> dict[str, Any]:
        return self.request_json(
            "GET",
            f"/lists/{urllib.parse.quote(audience_id, safe='')}/members/{urllib.parse.quote(subscriber_hash, safe='')}",
        )

