from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

from .config import runtime_config
from .errors import CliError


def _json_request(url: str, *, method: str = "GET", headers: dict[str, str] | None = None, payload: dict[str, Any] | None = None, timeout_seconds: float = 25.0) -> dict[str, Any]:
    data = None
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(url, data=data, method=method.upper(), headers=headers or {})
    try:
        with urllib.request.urlopen(request, timeout=timeout_seconds) as response:
            body = response.read().decode(response.headers.get_content_charset("utf-8"))
            return json.loads(body) if body else {}
    except urllib.error.HTTPError as exc:
        body = exc.read().decode(exc.headers.get_content_charset("utf-8") if exc.headers else "utf-8", errors="replace")
        raise CliError(
            code="HTTP_ERROR",
            message=body or str(exc),
            exit_code=5,
            details={"status": exc.code, "url": url},
        ) from exc
    except urllib.error.URLError as exc:
        raise CliError(
            code="NETWORK_ERROR",
            message="Failed to reach endpoint",
            exit_code=5,
            details={"reason": str(exc.reason), "url": url},
        ) from exc


def check_proxy(ctx_obj: dict[str, Any] | None = None) -> dict[str, Any]:
    config = runtime_config(ctx_obj)
    url = f"{config['proxy_base_url']}/api/health"
    return _json_request(url, timeout_seconds=float(config["request_timeout_s"]))


def scrape_url(
    url: str,
    *,
    only_main_content: bool = True,
    timeout_seconds: int | None = None,
    max_age_ms: int | None = None,
    proxy_mode: str = "auto",
    store_in_cache: bool = True,
    formats: list[str] | None = None,
    ctx_obj: dict[str, Any] | None = None,
) -> dict[str, Any]:
    config = runtime_config(ctx_obj)
    request_timeout = float(timeout_seconds or config["request_timeout_s"])
    payload = {
        "url": url,
        "formats": formats or ["markdown"],
        "onlyMainContent": only_main_content,
        "timeout": int(request_timeout * 1000),
        "maxAge": max_age_ms,
        "proxy": proxy_mode,
        "storeInCache": store_in_cache,
    }

    if config["proxy_enabled"]:
        try:
            return _json_request(
                f"{config['proxy_base_url']}/api/proxy/fetch/firecrawl",
                method="POST",
                headers={"Content-Type": "application/json", "Accept": "application/json"},
                payload=payload,
                timeout_seconds=request_timeout,
            )
        except CliError:
            if not config["api_key_present"]:
                raise

    if not config["api_key_present"]:
        raise CliError(
            code="SETUP_REQUIRED",
            message="FIRECRAWL_API_KEY is required when the local dashboard proxy is unavailable",
            exit_code=4,
            details={"missing": ["FIRECRAWL_API_KEY"], "proxy_base_url": config["proxy_base_url"]},
        )

    return _json_request(
        f"{config['direct_base_url']}/v2/scrape",
        method="POST",
        headers={
            "Authorization": f"Bearer {config['api_key']}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        payload=payload,
        timeout_seconds=request_timeout,
    )
