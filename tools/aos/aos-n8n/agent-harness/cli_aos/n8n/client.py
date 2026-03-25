from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any
from urllib import error, parse, request

from .errors import ConnectorError

DEFAULT_TIMEOUT_SECONDS = 10.0
API_KEY_HEADER = "X-N8N-API-KEY"
ACCEPT_HEADER = "application/json"
CONTENT_TYPE_HEADER = "application/json"
WEBHOOK_TRIGGER_PATH = "/aos-n8n/workflow-trigger"


def normalize_api_base_url(api_url: str) -> str:
    stripped = api_url.strip()
    if not stripped:
        raise ConnectorError(
            "N8N_SETUP_REQUIRED",
            "n8n API URL is missing.",
            2,
            details={"missing_keys": ["N8N_API_URL"]},
        )

    parts = parse.urlsplit(stripped.rstrip("/"))
    if not parts.scheme or not parts.netloc:
        raise ConnectorError(
            "N8N_INVALID_URL",
            "N8N_API_URL must include a scheme and host, for example https://n8n.example.com.",
            2,
            details={"api_url": stripped},
        )

    path = parts.path.rstrip("/")
    if path.endswith("/api/v1"):
        normalized_path = path
    elif path.endswith("/api"):
        normalized_path = f"{path}/v1"
    elif path:
        normalized_path = f"{path}/api/v1"
    else:
        normalized_path = "/api/v1"

    return parse.urlunsplit((parts.scheme, parts.netloc, normalized_path, parts.query, parts.fragment))


def normalize_webhook_base_url(webhook_url: str) -> str:
    stripped = webhook_url.strip()
    if not stripped:
        raise ConnectorError(
            "N8N_SETUP_REQUIRED",
            "n8n webhook base URL is missing.",
            2,
            details={"missing_keys": ["N8N_WEBHOOK_BASE_URL"]},
        )

    parts = parse.urlsplit(stripped.rstrip("/"))
    if not parts.scheme or not parts.netloc:
        raise ConnectorError(
            "N8N_INVALID_URL",
            "N8N_WEBHOOK_BASE_URL must include a scheme and host, for example https://hooks.example.com.",
            2,
            details={"webhook_base_url": stripped},
        )
    return parse.urlunsplit((parts.scheme, parts.netloc, parts.path.rstrip("/"), parts.query, parts.fragment))


def _redact(value: str | None) -> str | None:
    if value is None:
        return None
    stripped = value.strip()
    if not stripped:
        return None
    if len(stripped) <= 6:
        return "***"
    return f"{stripped[:3]}...{stripped[-3:]}"


def _as_text(body: bytes | None) -> str:
    if not body:
        return ""
    return body.decode("utf-8", errors="replace")


def _decode_response(body: bytes | None) -> Any:
    text = _as_text(body)
    if not text.strip():
        return {}
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return text


def _response_kind(response: Any) -> str:
    if response in ({}, [], None, ""):
        return "empty"
    if isinstance(response, (dict, list)):
        return "json"
    if isinstance(response, str):
        return "text"
    return type(response).__name__


def _extract_execution_id(response: Any) -> str | None:
    if not isinstance(response, dict):
        return None
    for key in ("executionId", "execution_id", "executionID", "id"):
        value = response.get(key)
        if value is not None and str(value).strip():
            return str(value).strip()
    return None


def _extract_response_status(response: Any) -> str | None:
    if not isinstance(response, dict):
        return None
    for key in ("status", "state", "result"):
        value = response.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def _summarize_trigger_response(status_code: int, response: Any) -> dict[str, Any]:
    execution_id = _extract_execution_id(response)
    response_status = _extract_response_status(response)
    if execution_id and response_status:
        summary = f"Triggered execution {execution_id} ({response_status})."
    elif execution_id:
        summary = f"Triggered execution {execution_id}."
    elif response_status:
        summary = f"Triggered webhook bridge ({response_status})."
    else:
        summary = f"Triggered webhook bridge (HTTP {status_code})."
    return {
        "ok": 200 <= status_code < 300,
        "status_code": status_code,
        "response_kind": _response_kind(response),
        "execution_id": execution_id,
        "response_status": response_status,
        "summary": summary,
    }


def _http_request(
    url: str,
    *,
    method: str,
    headers: dict[str, str],
    body: bytes | None = None,
    timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS,
) -> tuple[int, Any]:
    req = request.Request(url, headers=headers, data=body, method=method)
    try:
        with request.urlopen(req, timeout=timeout_seconds) as response:
            return response.getcode(), _decode_response(response.read())
    except error.HTTPError as exc:
        body_text = _as_text(exc.read())
        details = {
            "url": url,
            "status": exc.code,
            "reason": exc.reason,
            "response": body_text[:500] if body_text else None,
        }
        code = "N8N_API_ERROR"
        if exc.code in {401, 403}:
            code = "N8N_AUTH_FAILED"
        elif exc.code == 404:
            code = "N8N_NOT_FOUND"
        raise ConnectorError(code, f"n8n request failed with HTTP {exc.code}.", 5, details=details) from exc
    except error.URLError as exc:
        raise ConnectorError(
            "N8N_UNREACHABLE",
            "Unable to reach the configured n8n endpoint.",
            5,
            details={"url": url, "reason": str(exc.reason)},
        ) from exc


def _extract_items(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]
    if not isinstance(payload, dict):
        return []

    for key in ("data", "workflows", "items", "results"):
        value = payload.get(key)
        if isinstance(value, list):
            return [item for item in value if isinstance(item, dict)]
        if isinstance(value, dict):
            nested = value.get("data")
            if isinstance(nested, list):
                return [item for item in nested if isinstance(item, dict)]
    return []


def _extract_workflow(payload: Any) -> dict[str, Any] | None:
    if isinstance(payload, dict):
        if {"id", "name"} & payload.keys():
            return payload
        data = payload.get("data")
        if isinstance(data, dict):
            return data
        workflow = payload.get("workflow")
        if isinstance(workflow, dict):
            return workflow
    return None


def _workflow_status(workflow: dict[str, Any]) -> str:
    active = workflow.get("active")
    if active is True:
        return "active"
    if active is False:
        return "inactive"
    status = workflow.get("status")
    if isinstance(status, str) and status.strip():
        return status.strip()
    return "unknown"


def _workflow_summary(workflow: dict[str, Any]) -> dict[str, Any]:
    workflow_id = workflow.get("id") or workflow.get("workflowId") or workflow.get("workflow_id")
    workflow_name = workflow.get("name") or workflow.get("workflowName") or workflow_id
    tags = workflow.get("tags")
    if isinstance(tags, list):
        tags_value = [tag.get("name", tag) if isinstance(tag, dict) else tag for tag in tags]
    else:
        tags_value = []

    return {
        "id": str(workflow_id) if workflow_id is not None else None,
        "name": str(workflow_name) if workflow_name is not None else None,
        "status": _workflow_status(workflow),
        "active": workflow.get("active"),
        "created_at": workflow.get("createdAt") or workflow.get("created_at"),
        "updated_at": workflow.get("updatedAt") or workflow.get("updated_at"),
        "tags": tags_value,
    }


def _picker_option(workflow: dict[str, Any]) -> dict[str, Any] | None:
    summary = _workflow_summary(workflow)
    workflow_id = summary.get("id")
    if not workflow_id:
        return None
    option: dict[str, Any] = {
        "value": workflow_id,
        "label": summary.get("name") or workflow_id,
        "resource": "workflow",
    }
    subtitle_parts = [summary.get("status")]
    updated_at = summary.get("updated_at")
    if updated_at:
        subtitle_parts.append(str(updated_at))
    subtitle = " | ".join(part for part in (str(item) for item in subtitle_parts) if part)
    if subtitle:
        option["subtitle"] = subtitle
    return option


def _effective_api_url(runtime: dict[str, Any]) -> str:
    api_base_url = runtime.get("api_base_url")
    if isinstance(api_base_url, str) and api_base_url.strip():
        return api_base_url.strip()
    api_url = runtime.get("api_url")
    if not isinstance(api_url, str) or not api_url.strip():
        raise ConnectorError(
            "N8N_SETUP_REQUIRED",
            "n8n API URL is missing.",
            2,
            details={"missing_keys": ["N8N_API_URL"]},
        )
    return normalize_api_base_url(api_url)


@dataclass(slots=True)
class N8NApiClient:
    runtime: dict[str, Any]
    timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS

    @property
    def api_base_url(self) -> str:
        return _effective_api_url(self.runtime)

    @property
    def api_key(self) -> str:
        api_key = self.runtime.get("api_key")
        if not isinstance(api_key, str) or not api_key.strip():
            raise ConnectorError(
                "N8N_SETUP_REQUIRED",
                "n8n API key is missing.",
                2,
                details={"missing_keys": ["N8N_API_KEY"]},
            )
        return api_key.strip()

    def request_json(self, path: str, *, params: dict[str, Any] | None = None) -> Any:
        url = f"{self.api_base_url}{path}"
        if params:
            encoded = parse.urlencode({key: value for key, value in params.items() if value is not None})
            if encoded:
                url = f"{url}?{encoded}"
        _, payload = _http_request(
            url,
            method="GET",
            headers={
                "Accept": ACCEPT_HEADER,
                API_KEY_HEADER: self.api_key,
            },
            timeout_seconds=self.timeout_seconds,
        )
        return payload

    def list_workflows(self, *, limit: int | None = None, active_only: bool | None = None) -> list[dict[str, Any]]:
        params: dict[str, Any] = {}
        if limit is not None:
            params["limit"] = max(limit, 1)
        if active_only is not None:
            params["active"] = "true" if active_only else "false"
        payload = self.request_json("/workflows", params=params)
        return _extract_items(payload)

    def get_workflow(self, workflow_id: str) -> dict[str, Any]:
        payload = self.request_json(f"/workflows/{workflow_id}")
        workflow = _extract_workflow(payload)
        if workflow is None:
            raise ConnectorError(
                "N8N_BAD_RESPONSE",
                "n8n API did not return a workflow object.",
                5,
                details={"workflow_id": workflow_id, "response_type": type(payload).__name__},
            )
        return workflow


@dataclass(slots=True)
class N8NWebhookClient:
    runtime: dict[str, Any]
    timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS

    @property
    def webhook_base_url(self) -> str:
        webhook_base_url = self.runtime.get("webhook_base_url")
        if not isinstance(webhook_base_url, str) or not webhook_base_url.strip():
            raise ConnectorError(
                "N8N_SETUP_REQUIRED",
                "n8n webhook base URL is missing.",
                2,
                details={"missing_keys": ["N8N_WEBHOOK_BASE_URL"]},
            )
        return normalize_webhook_base_url(webhook_base_url)

    @property
    def trigger_url(self) -> str:
        return f"{self.webhook_base_url}{WEBHOOK_TRIGGER_PATH}"

    def trigger(self, payload: dict[str, Any]) -> tuple[int, Any]:
        body = json.dumps(payload, sort_keys=True).encode("utf-8")
        return _http_request(
            self.trigger_url,
            method="POST",
            headers={
                "Accept": ACCEPT_HEADER,
                "Content-Type": CONTENT_TYPE_HEADER,
            },
            body=body,
            timeout_seconds=self.timeout_seconds,
        )


def probe_live_read(runtime: dict[str, Any]) -> dict[str, Any]:
    api_url_present = bool(runtime.get("api_url_present"))
    api_key_present = bool(runtime.get("api_key_present"))
    if not api_url_present or not api_key_present:
        missing_keys = []
        if not api_url_present:
            missing_keys.append(runtime.get("api_url_env") or "N8N_API_URL")
        if not api_key_present:
            missing_keys.append(runtime.get("api_key_env") or "N8N_API_KEY")
        return {
            "ok": False,
            "code": "N8N_SETUP_REQUIRED",
            "message": "n8n setup is incomplete.",
            "details": {
                "missing_keys": missing_keys,
                "probe_mode": "setup-required",
                "live_backend_available": False,
                "live_read_available": False,
                "write_bridge_available": False,
                "scaffold_only": False,
                "api_url_present": api_url_present,
                "api_key_present": api_key_present,
            },
        }

    client = N8NApiClient(runtime)
    try:
        workflows = client.list_workflows(limit=1, active_only=True)
    except ConnectorError as err:
        details = dict(err.details or {})
        details.update(
            {
                "probe_mode": "live-read",
                "live_backend_available": False,
                "live_read_available": False,
                "write_bridge_available": False,
                "scaffold_only": False,
                "api_base_url_redacted": _redact(runtime.get("api_base_url")),
            }
        )
        return {
            "ok": False,
            "code": err.code,
            "message": err.message,
            "details": details,
        }

    return {
        "ok": True,
        "code": "N8N_LIVE_READ_OK",
        "message": "n8n API is reachable and live read access is available.",
        "details": {
            "probe_mode": "live-read",
            "live_backend_available": True,
            "live_read_available": True,
            "write_bridge_available": False,
            "scaffold_only": False,
            "api_base_url_redacted": _redact(runtime.get("api_base_url")),
            "sample_count": len(workflows),
        },
    }


def probe_write_bridge(runtime: dict[str, Any]) -> dict[str, Any]:
    webhook_base_url = runtime.get("webhook_base_url")
    webhook_base_url_present = bool(webhook_base_url and str(webhook_base_url).strip())
    if not webhook_base_url_present:
        return {
            "ok": False,
            "code": "N8N_WRITE_BRIDGE_REQUIRED",
            "message": "n8n webhook bridge is not configured.",
            "details": {
                "missing_keys": [runtime.get("webhook_base_url_env") or "N8N_WEBHOOK_BASE_URL"],
                "probe_mode": "setup-required",
                "write_bridge_available": False,
                "scaffold_only": False,
            },
        }

    try:
        client = N8NWebhookClient(runtime)
        trigger_url = client.trigger_url
        normalized_base = client.webhook_base_url
    except ConnectorError as err:
        return {
            "ok": False,
            "code": err.code,
            "message": err.message,
            "details": {**(err.details or {}), "probe_mode": "write-bridge", "write_bridge_available": False, "scaffold_only": False},
        }

    return {
        "ok": True,
        "code": "N8N_WRITE_BRIDGE_READY",
        "message": "n8n webhook bridge is configured.",
        "details": {
            "probe_mode": "write-bridge",
            "write_bridge_available": True,
            "scaffold_only": False,
            "webhook_base_url_redacted": _redact(normalized_base),
            "trigger_url_redacted": _redact(trigger_url),
        },
    }


def list_workflow_summaries(runtime: dict[str, Any], *, limit: int, active_only: bool | None) -> dict[str, Any]:
    client = N8NApiClient(runtime)
    workflows = client.list_workflows(limit=limit, active_only=active_only)
    summaries = [_workflow_summary(workflow) for workflow in workflows]
    picker_options = [option for workflow in workflows if (option := _picker_option(workflow)) is not None]
    return {
        "workflows": summaries,
        "picker_options": picker_options,
        "count": len(summaries),
    }


def get_workflow_summary(runtime: dict[str, Any], workflow_id: str) -> dict[str, Any]:
    client = N8NApiClient(runtime)
    workflow = client.get_workflow(workflow_id)
    summary = _workflow_summary(workflow)
    picker_option = _picker_option(workflow)
    return {
        "workflow": summary,
        "picker_options": [picker_option] if picker_option else [],
    }


def find_workflow_by_name(runtime: dict[str, Any], workflow_name: str) -> dict[str, Any] | None:
    client = N8NApiClient(runtime)
    workflows = client.list_workflows(limit=1000, active_only=None)
    matches = [
        workflow
        for workflow in workflows
        if str(workflow.get("name") or "").strip().casefold() == workflow_name.strip().casefold()
    ]
    if not matches:
        return None
    if len(matches) > 1:
        raise ConnectorError(
            "N8N_AMBIGUOUS_WORKFLOW",
            f"Multiple workflows matched the name '{workflow_name}'.",
            2,
            details={"workflow_name": workflow_name, "match_count": len(matches)},
        )
    return matches[0]


def trigger_workflow_execution(runtime: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
    client = N8NWebhookClient(runtime)
    status_code, response = client.trigger(payload)
    normalized = _summarize_trigger_response(status_code, response)
    return {
        **normalized,
        "status_code": status_code,
        "response": response,
        "trigger_url_redacted": _redact(client.trigger_url),
    }
