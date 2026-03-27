from __future__ import annotations

import json
import os
from datetime import date, timedelta
from pathlib import Path
from typing import Any

from .client import CodeRabbitApiError, CodeRabbitClient
from .config import config_snapshot, resolve_runtime_values
from .constants import BACKEND_NAME, CONNECTOR_PATH
from .errors import CliError


def _load_manifest() -> dict[str, Any]:
    return json.loads(CONNECTOR_PATH.read_text())


def _picker(items: list[dict[str, Any]], *, kind: str, label_key: str = "label") -> dict[str, Any]:
    return {"kind": kind, "items": items, "count": len(items), "label_key": label_key}


def _scope_preview(command_id: str, surface: str, extra: dict[str, Any] | None = None) -> dict[str, Any]:
    payload = {"selection_surface": surface, "command_id": command_id, "backend": BACKEND_NAME}
    if extra:
        payload.update(extra)
    return payload


def _require_arg(value: str | None, *, code: str, message: str, detail_key: str, detail_value: str) -> str:
    resolved = (value or "").strip()
    if resolved:
        return resolved
    raise CliError(code=code, message=message, exit_code=4, details={detail_key: detail_value})


def _mask(value: str | None) -> str | None:
    if not value:
        return None
    if len(value) <= 8:
        return "*" * len(value)
    return f"{value[:4]}***{value[-4:]}"


def _default_date_window(days: int = 7) -> tuple[str, str]:
    end = date.today()
    start = end - timedelta(days=days)
    return start.isoformat(), end.isoformat()


def _read_json_file(path: Path) -> dict[str, Any] | None:
    if not path.exists():
        return None
    raw = path.read_text(encoding="utf-8")
    return {"content": raw, "path": str(path), "exists": True}


def _write_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def _state_path(runtime: dict[str, Any]) -> Path:
    return runtime["state_path"]


def _load_state(runtime: dict[str, Any]) -> dict[str, Any]:
    path = _state_path(runtime)
    if not path.exists():
        return {"requests": [], "reports": []}
    try:
        parsed = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {"requests": [], "reports": []}
    return parsed if isinstance(parsed, dict) else {"requests": [], "reports": []}


def _save_state(runtime: dict[str, Any], state: dict[str, Any]) -> None:
    path = _state_path(runtime)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(state, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def _latest_request(runtime: dict[str, Any]) -> dict[str, Any] | None:
    state = _load_state(runtime)
    requests = state.get("requests", [])
    if not isinstance(requests, list) or not requests:
      return None
    last = requests[-1]
    return last if isinstance(last, dict) else None


def capabilities_snapshot() -> dict[str, Any]:
    manifest = _load_manifest()
    read_support: dict[str, bool] = {}
    write_support: dict[str, bool] = {}
    for command in manifest["commands"]:
        target = read_support if command["required_mode"] == "readonly" else write_support
        target[command["id"]] = True
    return {
        "tool": manifest["tool"],
        "backend": manifest["backend"],
        "manifest_schema_version": manifest.get("manifest_schema_version", "1.0.0"),
        "connector": manifest["connector"],
        "auth": manifest["auth"],
        "scope": manifest.get("scope", {}),
        "commands": manifest["commands"],
        "read_support": read_support,
        "write_support": write_support,
    }


def create_client(ctx_obj: dict[str, Any]) -> CodeRabbitClient:
    runtime = resolve_runtime_values(ctx_obj)
    if not runtime["api_key_present"]:
        raise CliError(
            code="CODERABBIT_SETUP_REQUIRED",
            message="CodeRabbit connector is missing required credentials",
            exit_code=4,
            details={"missing_keys": [runtime["api_key_env"]]},
        )
    return CodeRabbitClient(api_key=runtime["api_key"], base_url=runtime["base_url"])


def probe_runtime(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    if not runtime["api_key_present"]:
        return {
            "ok": False,
            "code": "CODERABBIT_SETUP_REQUIRED",
            "message": "CodeRabbit connector is missing required credentials",
            "details": {"missing_keys": [runtime["api_key_env"]], "live_backend_available": False},
        }
    try:
        client = create_client(ctx_obj)
        reports = client.metrics_reviews(
            start_date=runtime["report_start_date"],
            end_date=runtime["report_end_date"],
            limit=1,
        )
    except CliError as err:
        return {"ok": False, "code": err.code, "message": err.message, "details": err.details}
    except CodeRabbitApiError as err:
        code = "CODERABBIT_AUTH_FAILED" if err.status_code in {401, 403} else "CODERABBIT_API_ERROR"
        return {
            "ok": False,
            "code": code,
            "message": err.message,
            "details": {**(err.details or {}), "status_code": err.status_code, "live_backend_available": False},
        }
    return {
        "ok": True,
        "code": "OK",
        "message": "CodeRabbit live runtime is ready",
        "details": {"live_backend_available": True, "report_count": len(reports["reports"])},
    }


def health_snapshot(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    probe = probe_runtime(ctx_obj)
    status = "ready" if probe["ok"] else ("needs_setup" if probe["code"] == "CODERABBIT_SETUP_REQUIRED" else "degraded")
    bridge_ready = os.access(runtime["config_path"].parent, os.W_OK) or runtime["config_path"].parent.exists()
    return {
        "status": status,
        "summary": probe["message"],
        "connector": {
            "backend": BACKEND_NAME,
            "live_backend_available": bool(probe.get("ok")),
            "live_read_available": bool(probe.get("ok")),
            "write_bridge_available": True,
            "scaffold_only": False,
        },
        "auth": {
            "api_key_env": runtime["api_key_env"],
            "api_key_present": runtime["api_key_present"],
            "api_key_masked": _mask(runtime["api_key"]),
        },
        "scope": {
            "repo": runtime["repo"] or None,
            "pr_number": runtime["pr_number"] or None,
            "review_id": runtime["review_id"] or None,
            "config_path": str(runtime["config_path"]),
            "state_path": str(runtime["state_path"]),
        },
        "checks": [
            {"name": "required_env", "ok": runtime["api_key_present"], "details": {"missing_keys": [] if runtime["api_key_present"] else [runtime["api_key_env"]]}},
            {"name": "live_backend", "ok": bool(probe.get("ok")), "details": probe.get("details", {})},
            {"name": "bridge", "ok": bridge_ready, "details": {"config_path": str(runtime["config_path"]), "state_path": str(runtime["state_path"])}},
        ],
        "runtime_ready": bool(probe.get("ok")) and bridge_ready,
        "live_backend_available": bool(probe.get("ok")),
        "live_read_available": bool(probe.get("ok")),
        "write_bridge_available": True,
        "scaffold_only": False,
        "probe": probe,
        "next_steps": [
            f"Set {runtime['api_key_env']} in API Keys.",
            f"Set {runtime['repo_env']} to scope repository-specific commands.",
            "Use report.list to confirm the metrics endpoint is reachable.",
        ],
    }


def doctor_snapshot(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    probe = probe_runtime(ctx_obj)
    ready = bool(probe.get("ok"))
    return {
        "status": "ready" if ready else ("needs_setup" if probe.get("code") == "CODERABBIT_SETUP_REQUIRED" else "degraded"),
        "summary": "CodeRabbit connector diagnostics.",
        "runtime": {
            "implementation_mode": "hybrid_live_read_bridge",
            "command_readiness": {
                "review.request": ready and runtime["repo_present"],
                "review.status": ready and runtime["repo_present"],
                "review.get": ready and runtime["repo_present"],
                "report.list": ready and runtime["repo_present"],
                "report.get": ready and runtime["repo_present"],
                "config.get": runtime["repo_present"],
                "config.update": runtime["repo_present"],
            },
            "state_path": str(runtime["state_path"]),
            "config_path": str(runtime["config_path"]),
        },
        "checks": [
            {"name": "required_env", "ok": runtime["api_key_present"]},
            {"name": "repository_scope", "ok": runtime["repo_present"], "details": {"env": runtime["repo_env"]}},
            {"name": "live_backend", "ok": ready, "details": probe.get("details", {})},
        ],
        "supported_read_commands": ["review.status", "review.get", "report.list", "report.get", "config.get"],
        "supported_write_commands": ["review.request", "config.update"],
        "next_steps": [
            f"Set {runtime['api_key_env']} to enable live CodeRabbit API calls.",
            f"Set {runtime['repo_env']} to scope repository-specific operations.",
            "Store repository review settings in .coderabbit.yaml to use the config bridge.",
        ],
    }


def config_show_result(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    return config_snapshot(ctx_obj, probe=probe_runtime(ctx_obj))


def review_request_result(
    ctx_obj: dict[str, Any],
    *,
    repo: str | None,
    pr_number: str | None,
    full_review: bool,
    comment: str | None,
) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved_repo = _require_arg(repo or runtime["repo"], code="CODERABBIT_REPO_REQUIRED", message="repo is required", detail_key="env", detail_value=runtime["repo_env"])
    request_comment = (comment or "").strip() or ("@coderabbitai full review" if full_review else "@coderabbitai review")
    requested_pr = (pr_number or runtime["pr_number"] or "").strip() or None
    review_id = runtime["review_id"] or f"req-{resolved_repo.replace('/', '-')}-{int(date.today().strftime('%Y%m%d'))}"
    state = _load_state(runtime)
    request = {
        "review_id": review_id,
        "repo": resolved_repo,
        "pr_number": requested_pr,
        "status": "requested",
        "comment": request_comment,
        "full_review": bool(full_review),
        "requested_at": date.today().isoformat(),
    }
    state.setdefault("requests", [])
    state["requests"].append(request)
    state["last_request"] = request
    _save_state(runtime, state)
    return {
        "status": "requested",
        "backend": BACKEND_NAME,
        "summary": f"Requested CodeRabbit review for {resolved_repo}.",
        "request": request,
        "bridge": {"kind": "local_state", "path": str(runtime["state_path"])},
        "scope_preview": _scope_preview("review.request", "review", {"repo": resolved_repo, "pr_number": requested_pr}),
    }


def review_status_result(ctx_obj: dict[str, Any], *, repo: str | None, review_id: str | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved_repo = _require_arg(repo or runtime["repo"], code="CODERABBIT_REPO_REQUIRED", message="repo is required", detail_key="env", detail_value=runtime["repo_env"])
    state = _load_state(runtime)
    requests = state.get("requests", [])
    matches = [
        item
        for item in requests
        if isinstance(item, dict)
        and item.get("repo") == resolved_repo
        and (not review_id or item.get("review_id") == review_id)
    ]
    request = matches[-1] if matches else _latest_request(runtime)
    if not request:
        return {
            "status": "unknown",
            "backend": BACKEND_NAME,
            "summary": f"No stored review request found for {resolved_repo}.",
            "review": None,
            "scope_preview": _scope_preview("review.status", "review", {"repo": resolved_repo, "review_id": review_id}),
        }
    review = {
        "review_id": request.get("review_id"),
        "repo": request.get("repo"),
        "pr_number": request.get("pr_number"),
        "status": request.get("status", "requested"),
        "comment": request.get("comment"),
        "full_review": request.get("full_review", False),
        "requested_at": request.get("requested_at"),
    }
    return {
        "status": review["status"],
        "backend": BACKEND_NAME,
        "summary": f"Review {review['review_id']} is {review['status']}.",
        "review": review,
        "scope_preview": _scope_preview("review.status", "review", {"repo": resolved_repo, "review_id": review["review_id"]}),
    }


def review_get_result(ctx_obj: dict[str, Any], *, repo: str | None, review_id: str | None) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved_repo = _require_arg(repo or runtime["repo"], code="CODERABBIT_REPO_REQUIRED", message="repo is required", detail_key="env", detail_value=runtime["repo_env"])
    state = _load_state(runtime)
    requests = state.get("requests", [])
    matches = [
        item
        for item in requests
        if isinstance(item, dict)
        and item.get("repo") == resolved_repo
        and (not review_id or item.get("review_id") == review_id)
    ]
    request = matches[-1] if matches else _latest_request(runtime)
    review = {
        "review_id": request.get("review_id") if request else review_id,
        "repo": resolved_repo,
        "pr_number": request.get("pr_number") if request else runtime["pr_number"] or None,
        "status": request.get("status", "requested") if request else "not_found",
        "summary": "Local bridge review record.",
        "findings": request.get("findings", []) if request else [],
        "suggestions": request.get("suggestions", []) if request else [],
        "requested_at": request.get("requested_at") if request else None,
        "comment": request.get("comment") if request else None,
    }
    return {
        "status": review["status"],
        "backend": BACKEND_NAME,
        "summary": f"Loaded review record for {resolved_repo}.",
        "review": review,
        "bridge": {"kind": "local_state", "path": str(runtime["state_path"])},
        "scope_preview": _scope_preview("review.get", "review", {"repo": resolved_repo, "review_id": review["review_id"]}),
    }


def report_list_result(
    ctx_obj: dict[str, Any],
    *,
    start_date: str | None,
    end_date: str | None,
    limit: int,
    cursor: str | None,
) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved_repo = _require_arg(runtime["repo"], code="CODERABBIT_REPO_REQUIRED", message="repo is required", detail_key="env", detail_value=runtime["repo_env"])
    client = create_client(ctx_obj)
    start = start_date or runtime["report_start_date"]
    end = end_date or runtime["report_end_date"]
    response = client.metrics_reviews(start_date=start, end_date=end, limit=limit, cursor=cursor)
    repo_key = resolved_repo.split("/", 1)[-1].lower()
    reports = [
        item
        for item in response["reports"]
        if repo_key in str(item.get("repository_name", "")).lower()
        or repo_key in str(item.get("repository_id", "")).lower()
        or repo_key in str(item.get("pr_url", "")).lower()
        or not resolved_repo
    ]
    picker_items = [
        {
            "value": item.get("pr_url") or item.get("repository_id") or str(index),
            "label": item.get("repository_name") or item.get("repository_id") or item.get("pr_url") or "report",
            "subtitle": item.get("author_username") or item.get("organization_name") or item.get("created_at"),
            "selected": False,
        }
        for index, item in enumerate(reports, start=1)
    ]
    state = _load_state(runtime)
    state["last_report_list"] = {
        "repo": resolved_repo,
        "start_date": start,
        "end_date": end,
        "count": len(reports),
    }
    _save_state(runtime, state)
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Loaded {len(reports)} CodeRabbit metric report(s) for {resolved_repo}.",
        "reports": reports,
        "next_cursor": response["next_cursor"],
        "picker": _picker(picker_items, kind="report"),
        "scope_preview": _scope_preview("report.list", "report", {"repo": resolved_repo, "start_date": start, "end_date": end}),
    }


def report_get_result(
    ctx_obj: dict[str, Any],
    *,
    start_date: str | None,
    end_date: str | None,
    prompt: str | None,
    prompt_template: str | None,
) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved_repo = _require_arg(runtime["repo"], code="CODERABBIT_REPO_REQUIRED", message="repo is required", detail_key="env", detail_value=runtime["repo_env"])
    client = create_client(ctx_obj)
    start = start_date or runtime["report_start_date"]
    end = end_date or runtime["report_end_date"]
    body: dict[str, Any] = {"from": start, "to": end}
    body["prompt"] = prompt or runtime["report_prompt"] or f"Summarize review activity for {resolved_repo}."
    template = prompt_template or runtime["report_template"]
    if template:
        body["promptTemplate"] = template
    report = client.report_generate(body)
    markdown = "\n\n".join(item.get("report", "") for item in report if item.get("report"))
    state = _load_state(runtime)
    state["last_report"] = {
        "repo": resolved_repo,
        "start_date": start,
        "end_date": end,
        "prompt": body["prompt"],
        "prompt_template": template,
        "groups": report,
    }
    _save_state(runtime, state)
    return {
        "status": "live_read",
        "backend": BACKEND_NAME,
        "summary": f"Generated CodeRabbit report for {resolved_repo}.",
        "report": report,
        "report_markdown": markdown,
        "window": {"start_date": start, "end_date": end},
        "scope_preview": _scope_preview("report.get", "report", {"repo": resolved_repo, "start_date": start, "end_date": end}),
    }


def config_get_result(ctx_obj: dict[str, Any]) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved_repo = _require_arg(runtime["repo"], code="CODERABBIT_REPO_REQUIRED", message="repo is required", detail_key="env", detail_value=runtime["repo_env"])
    snapshot = _read_json_file(runtime["config_path"])
    content = snapshot["content"] if snapshot else ""
    return {
        "status": "bridge_read",
        "backend": BACKEND_NAME,
        "summary": f"Loaded repository configuration for {resolved_repo}.",
        "repo": resolved_repo,
        "config": {"path": str(runtime["config_path"]), "exists": bool(snapshot), "content": content},
        "scope_preview": _scope_preview("config.get", "config", {"repo": resolved_repo, "path": str(runtime["config_path"])}),
    }


def config_update_result(ctx_obj: dict[str, Any], *, content: str) -> dict[str, Any]:
    runtime = resolve_runtime_values(ctx_obj)
    resolved_repo = _require_arg(runtime["repo"], code="CODERABBIT_REPO_REQUIRED", message="repo is required", detail_key="env", detail_value=runtime["repo_env"])
    if not content.strip():
        raise CliError(code="CODERABBIT_CONFIG_CONTENT_REQUIRED", message="content is required", exit_code=4, details={"env": runtime["config_content_env"]})
    _write_text(runtime["config_path"], content)
    state = _load_state(runtime)
    state["last_config_update"] = {"repo": resolved_repo, "path": str(runtime["config_path"]), "updated_at": date.today().isoformat()}
    _save_state(runtime, state)
    return {
        "status": "bridge_write",
        "backend": BACKEND_NAME,
        "summary": f"Updated repository configuration for {resolved_repo}.",
        "repo": resolved_repo,
        "config": {"path": str(runtime["config_path"]), "exists": True, "content": content},
        "scope_preview": _scope_preview("config.update", "config", {"repo": resolved_repo, "path": str(runtime["config_path"])}),
    }
