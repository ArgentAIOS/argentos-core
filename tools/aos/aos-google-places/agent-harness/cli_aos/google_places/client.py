from __future__ import annotations

import json
from typing import Any
from urllib import error, parse, request

from .config import runtime_config
from .constants import DETAILS_FIELD_MASK, RESOLVE_FIELD_MASK, SEARCH_FIELD_MASK
from .errors import CliError


def _json_request(*, method: str, url: str, headers: dict[str, str], payload: dict[str, Any] | None = None) -> dict[str, Any]:
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = request.Request(url, data=data, headers=headers, method=method)
    try:
        with request.urlopen(req, timeout=20) as response:
            body = response.read().decode("utf-8")
            return json.loads(body) if body else {}
    except error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise CliError(
            code="UPSTREAM_HTTP_ERROR",
            message=f"Google Places API returned HTTP {exc.code}.",
            details={"status": exc.code, "body": detail},
        ) from exc
    except error.URLError as exc:
        raise CliError(
            code="NETWORK_ERROR",
            message="Google Places API is not reachable.",
            details={"reason": str(exc.reason)},
        ) from exc


def _headers(field_mask: str, ctx_obj: dict | None = None) -> dict[str, str]:
    config = runtime_config(ctx_obj)
    api_key = str(config["api_key"] or "")
    if not api_key:
        raise CliError(
            code="AUTH_REQUIRED",
            message="GOOGLE_PLACES_API_KEY is not available.",
        )
    return {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": api_key,
        "X-Goog-FieldMask": field_mask,
    }


def search_places(query: str, *, limit: int = 10, type_filter: str = "", min_rating: float | None = None, keyword: str = "", open_now: bool | None = None, page_token: str = "", ctx_obj: dict | None = None) -> dict[str, Any]:
    config = runtime_config(ctx_obj)
    text_query = " ".join(part for part in [query.strip(), keyword.strip()] if part).strip()
    if not text_query:
        raise CliError(code="INVALID_ARGUMENT", message="query is required")
    body: dict[str, Any] = {"textQuery": text_query, "pageSize": max(1, min(int(limit), 20))}
    if type_filter.strip():
        body["includedType"] = type_filter.strip()
    if min_rating is not None:
        body["minRating"] = min_rating
    if open_now is not None:
        body["openNow"] = bool(open_now)
    if page_token.strip():
        body["pageToken"] = page_token.strip()
    url = f"{config['base_url']}/places:searchText"
    return _json_request(method="POST", url=url, headers=_headers(SEARCH_FIELD_MASK, ctx_obj), payload=body)


def resolve_location(location_text: str, *, limit: int = 5, ctx_obj: dict | None = None) -> dict[str, Any]:
    if not location_text.strip():
        raise CliError(code="INVALID_ARGUMENT", message="location_text is required")
    config = runtime_config(ctx_obj)
    url = f"{config['base_url']}/places:searchText"
    body = {"textQuery": location_text.strip(), "pageSize": max(1, min(int(limit), 10))}
    return _json_request(method="POST", url=url, headers=_headers(RESOLVE_FIELD_MASK, ctx_obj), payload=body)


def get_place(place_id: str, ctx_obj: dict | None = None) -> dict[str, Any]:
    if not place_id.strip():
        raise CliError(code="INVALID_ARGUMENT", message="place_id is required")
    config = runtime_config(ctx_obj)
    encoded = parse.quote(place_id.strip(), safe="")
    url = f"{config['base_url']}/places/{encoded}"
    return _json_request(method="GET", url=url, headers=_headers(DETAILS_FIELD_MASK, ctx_obj))
