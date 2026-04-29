from __future__ import annotations

import json
import re
import shutil
import subprocess
import time
from datetime import datetime, timezone
from email.utils import parseaddr
from pathlib import Path
from typing import Any

import click

from . import __version__
from .errors import CliError
from .service_keys import service_key_details

TOOL_NAME = "aos-vip-email"
BACKEND = "google-workspace-gmail"
MODE_ORDER = ["readonly", "write", "full", "admin"]
CONNECTOR_PATH = Path(__file__).resolve().parents[3] / "connector.json"
PERMISSIONS_PATH = Path(__file__).resolve().parents[2] / "permissions.json"
DEFAULT_GWS_BIN = "gws"
DEFAULT_LOOKBACK_DAYS = 7
DEFAULT_SCAN_CADENCE_SECONDS = 300
DEFAULT_MAX_RESULTS = 20
DEFAULT_DEDUPE_WINDOW_SECONDS = 604_800
DEFAULT_STATE_PATH = Path.home() / ".argentos" / "aos-vip-email-state.json"


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text())


def _permissions() -> dict[str, str]:
    return _load_json(PERMISSIONS_PATH).get("permissions", {})


def _mode_allows(actual: str, required: str) -> bool:
    return MODE_ORDER.index(actual) >= MODE_ORDER.index(required)


def require_mode(ctx: click.Context, command_id: str) -> None:
    required = _permissions().get(command_id, "admin")
    actual = ctx.obj["mode"]
    if not _mode_allows(actual, required):
        raise CliError(
            "PERMISSION_DENIED",
            f"Command requires mode={required}",
            3,
            {"required_mode": required, "actual_mode": actual},
        )


def result_payload(ctx: click.Context, *, ok: bool, command: str, data: dict | None = None, error: dict | None = None) -> dict:
    payload = {
        "ok": ok,
        "tool": TOOL_NAME,
        "command": command,
        "meta": {
            "mode": ctx.obj["mode"],
            "duration_ms": int((time.time() - ctx.obj["started"]) * 1000),
            "timestamp": now_iso(),
            "version": __version__,
        },
    }
    if ok:
        payload["data"] = data or {}
    else:
        payload["error"] = error or {"code": "INTERNAL_ERROR", "message": "Unknown error", "details": {}}
    return payload


def emit(ctx: click.Context, payload: dict) -> None:
    if ctx.obj["json"]:
        click.echo(json.dumps(payload, indent=2, sort_keys=True))
        return
    if payload.get("ok"):
        summary = payload.get("data", {}).get("summary")
        click.echo(summary or "OK")
    else:
        click.echo(f"ERROR: {payload.get('error', {}).get('message', 'Unknown error')}")


def fail(ctx: click.Context, command: str, err: CliError) -> None:
    emit(ctx, result_payload(ctx, ok=False, command=command, error=err.to_payload()))
    raise SystemExit(err.exit_code)


def _string_list(raw: str | None) -> list[str]:
    value = (raw or "").strip()
    if not value:
        return []
    if value.startswith("["):
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            parsed = []
        if isinstance(parsed, list):
            return [str(item).strip() for item in parsed if str(item).strip()]
    return [part.strip() for part in re.split(r"[\n,;]+", value) if part.strip()]


def _int_value(raw: str | None, default: int, *, minimum: int, maximum: int) -> int:
    try:
        value = int(str(raw).strip()) if raw not in (None, "") else default
    except (TypeError, ValueError):
        return default
    return max(minimum, min(maximum, value))


def _resolve(variable: str, ctx_obj: dict[str, Any] | None, default: str | None = None) -> dict[str, Any]:
    return service_key_details(variable, ctx_obj=ctx_obj, default=default)


def runtime_config(ctx_obj: dict[str, Any] | None = None) -> dict[str, Any]:
    account = _resolve("GOOGLE_WORKSPACE_ACCOUNT", ctx_obj)
    senders = _resolve("VIP_EMAIL_SENDERS", ctx_obj)
    accounts = _resolve("VIP_EMAIL_ACCOUNTS", ctx_obj)
    cadence = _resolve("VIP_EMAIL_SCAN_CADENCE_SECONDS", ctx_obj, str(DEFAULT_SCAN_CADENCE_SECONDS))
    lookback = _resolve("VIP_EMAIL_LOOKBACK_DAYS", ctx_obj, str(DEFAULT_LOOKBACK_DAYS))
    max_results = _resolve("VIP_EMAIL_MAX_RESULTS", ctx_obj, str(DEFAULT_MAX_RESULTS))
    dedupe = _resolve("VIP_EMAIL_DEDUPE_WINDOW_SECONDS", ctx_obj, str(DEFAULT_DEDUPE_WINDOW_SECONDS))
    quiet_hours = _resolve("VIP_EMAIL_QUIET_HOURS", ctx_obj)
    destinations = _resolve("VIP_EMAIL_ALERT_DESTINATIONS", ctx_obj)
    return {
        "backend": BACKEND,
        "tool": TOOL_NAME,
        "account": account["value"],
        "account_present": bool(account["value"]),
        "account_source": account["source"],
        "vip_senders": _string_list(senders["value"]),
        "vip_senders_present": bool(senders["value"]),
        "vip_senders_source": senders["source"],
        "accounts": _string_list(accounts["value"]),
        "accounts_source": accounts["source"] if accounts["present"] else None,
        "scan_cadence_seconds": _int_value(cadence["value"], DEFAULT_SCAN_CADENCE_SECONDS, minimum=10, maximum=86_400),
        "lookback_days": _int_value(lookback["value"], DEFAULT_LOOKBACK_DAYS, minimum=1, maximum=30),
        "max_results": _int_value(max_results["value"], DEFAULT_MAX_RESULTS, minimum=1, maximum=200),
        "dedupe_window_seconds": _int_value(
            dedupe["value"], DEFAULT_DEDUPE_WINDOW_SECONDS, minimum=0, maximum=2_592_000
        ),
        "quiet_hours": quiet_hours["value"],
        "quiet_hours_source": quiet_hours["source"] if quiet_hours["present"] else None,
        "alert_destinations": _string_list(destinations["value"]),
        "resolution_order": [
            "operator runtime service_keys/service_key_values/api_keys/secrets",
            "unmanaged repo service-keys.json",
            "local environment fallback",
        ],
    }


def config_snapshot(ctx_obj: dict[str, Any] | None = None) -> dict[str, Any]:
    config = runtime_config(ctx_obj)
    return {
        "backend": config["backend"],
        "account": config["account"],
        "account_present": config["account_present"],
        "account_source": config["account_source"],
        "vip_sender_count": len(config["vip_senders"]),
        "vip_senders_source": config["vip_senders_source"],
        "scan_cadence_seconds": config["scan_cadence_seconds"],
        "lookback_days": config["lookback_days"],
        "max_results": config["max_results"],
        "dedupe_window_seconds": config["dedupe_window_seconds"],
        "quiet_hours": config["quiet_hours"],
        "alert_destinations_count": len(config["alert_destinations"]),
        "connector_contract": "read-only alert candidates; Workflows owns scheduling and delivery",
    }


def ensure_gws(gws_bin: str) -> None:
    if shutil.which(gws_bin):
        return
    raise CliError("BACKEND_UNAVAILABLE", f"gws binary not found on PATH: {gws_bin}", 5)


def run_gws(gws_bin: str, args: list[str]) -> dict[str, Any]:
    ensure_gws(gws_bin)
    try:
        proc = subprocess.run([gws_bin, *args], capture_output=True, text=True, check=False)
    except OSError as exc:
        raise CliError("BACKEND_UNAVAILABLE", str(exc), 5) from exc
    stdout = (proc.stdout or "").strip()
    stderr = (proc.stderr or "").strip()
    if proc.returncode != 0:
        raise CliError("BACKEND_ERROR", "gws command failed", 5, {"returncode": proc.returncode, "stderr": stderr})
    if not stdout:
        return {}
    try:
        payload = json.loads(stdout)
    except json.JSONDecodeError:
        return {"raw": stdout}
    return payload if isinstance(payload, dict) else {"items": payload}


def _gmail_query(senders: list[str], lookback_days: int) -> str:
    sender_query = " OR ".join(f"from:{sender}" for sender in senders)
    if len(senders) > 1:
        sender_query = f"({sender_query})"
    return f"{sender_query} newer_than:{lookback_days}d"


def _message_items(payload: dict[str, Any]) -> list[dict[str, Any]]:
    for key in ("messages", "items", "threads", "results"):
        value = payload.get(key)
        if isinstance(value, list):
            return [item for item in value if isinstance(item, dict)]
    return []


def _header(headers: Any, name: str) -> str:
    if not isinstance(headers, list):
        return ""
    for header in headers:
        if isinstance(header, dict) and str(header.get("name", "")).lower() == name.lower():
            return str(header.get("value") or "")
    return ""


def _message_field(message: dict[str, Any], *keys: str) -> str:
    for key in keys:
        value = message.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    payload = message.get("payload")
    if isinstance(payload, dict):
        headers = payload.get("headers")
        for key in keys:
            value = _header(headers, key)
            if value:
                return value
    return ""


def _sender_email(message: dict[str, Any]) -> str:
    raw = _message_field(message, "from", "sender")
    return parseaddr(raw)[1].lower() or raw.strip().lower()


def _load_state(path: Path) -> dict[str, Any]:
    try:
        payload = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        return {"version": 1, "seen": {}}
    return payload if isinstance(payload, dict) else {"version": 1, "seen": {}}


def _save_state(path: Path, state: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(state, indent=2, sort_keys=True))


def scan_now(
    *,
    ctx_obj: dict[str, Any],
    gws_bin: str,
    account: str | None,
    vip_senders: str | None,
    lookback_days: int | None,
    max_results: int | None,
    state_path: Path,
    no_state: bool,
) -> dict[str, Any]:
    config = runtime_config(ctx_obj)
    resolved_account = account or config["account"] or (config["accounts"][0] if config["accounts"] else "")
    senders = _string_list(vip_senders) or config["vip_senders"]
    if not resolved_account:
        raise CliError("CONFIG_REQUIRED", "GOOGLE_WORKSPACE_ACCOUNT is not configured", 4)
    if not senders:
        raise CliError("CONFIG_REQUIRED", "VIP_EMAIL_SENDERS is not configured", 4)

    lookback = lookback_days or config["lookback_days"]
    limit = max_results or config["max_results"]
    args = [
        "gmail",
        "users",
        "messages",
        "list",
        "--account",
        resolved_account,
        "--query",
        _gmail_query(senders, lookback),
        "--max-results",
        str(limit),
        "--json",
    ]
    payload = run_gws(gws_bin, args)
    messages = _message_items(payload)
    sender_set = {sender.lower() for sender in senders}
    state = {"version": 1, "seen": {}} if no_state else _load_state(state_path)
    seen = state.setdefault("seen", {})
    detected_at = now_iso()
    candidates = []
    suppressed = 0
    for message in messages:
        msg_id = str(message.get("id") or message.get("messageId") or message.get("threadId") or "").strip()
        sender = _sender_email(message)
        if sender_set and sender not in sender_set:
            continue
        dedupe_key = f"gmail:{resolved_account}:{msg_id or sender}:{_message_field(message, 'date')}"
        if not no_state and dedupe_key in seen:
            suppressed += 1
            continue
        subject = _message_field(message, "subject") or "(no subject)"
        snippet = str(message.get("snippet") or message.get("summary") or "").strip()
        url = f"https://mail.google.com/mail/u/{resolved_account}/#all/{msg_id}" if msg_id else ""
        title = f"VIP email: {subject}"
        candidates.append(
            {
                "event_type": "operator.alert.candidate",
                "connector_id": TOOL_NAME,
                "source_provider": "google-workspace-gmail",
                "source_account": resolved_account,
                "source_ref": msg_id,
                "detected_at": detected_at,
                "severity": "high",
                "reasons": ["vip_sender"],
                "candidate_text": f"VIP email from {sender}: {subject}",
                "title": title,
                "url": url,
                "dedupe_key": dedupe_key,
                "quiet_hours_suppressed": False,
                "raw_summary": snippet,
                "metadata": {
                    "from": _message_field(message, "from", "sender"),
                    "sender_email": sender,
                    "subject": subject,
                    "date": _message_field(message, "date"),
                    "dedupe_window_seconds": config["dedupe_window_seconds"],
                    "scan_cadence_seconds": config["scan_cadence_seconds"],
                    "quiet_hours": config["quiet_hours"],
                    "alert_destinations": config["alert_destinations"],
                },
            }
        )
        if not no_state:
            seen[dedupe_key] = detected_at
    if not no_state:
        _save_state(state_path, state)
    return {
        "summary": f"VIP email scan: {len(candidates)} alert candidate(s)",
        "live_status": "live_read",
        "event_type": "operator.alert.candidate",
        "source_provider": "google-workspace-gmail",
        "source_account": resolved_account,
        "vip_sender_count": len(senders),
        "candidates": candidates,
        "candidate_count": len(candidates),
        "duplicate_suppressed_count": suppressed,
        "workflow_contract": "Workflows owns cadence, Run Now, retries, dedupe handoff, workload status, and delivery.",
    }


@click.group()
@click.option("--json", "as_json", is_flag=True, help="Emit JSON output")
@click.option("--mode", type=click.Choice(MODE_ORDER), default="readonly", show_default=True)
@click.option("--verbose", is_flag=True, help="Verbose diagnostic output")
@click.pass_context
def cli(ctx: click.Context, as_json: bool, mode: str, verbose: bool) -> None:
    ctx.ensure_object(dict)
    ctx.obj.update({"json": as_json, "mode": mode, "verbose": verbose, "started": time.time()})


def run_command(ctx: click.Context, command: str, fn, *args, **kwargs) -> None:
    require_mode(ctx, command)
    try:
        data = fn(*args, **kwargs)
    except CliError as err:
        fail(ctx, command, err)
    emit(ctx, result_payload(ctx, ok=True, command=command, data=data))


@cli.command("capabilities")
@click.pass_context
def capabilities(ctx: click.Context) -> None:
    run_command(ctx, "capabilities", lambda: _load_json(CONNECTOR_PATH))


@cli.group("config")
def config_group() -> None:
    pass


@config_group.command("show")
@click.pass_context
def config_show(ctx: click.Context) -> None:
    run_command(ctx, "config.show", config_snapshot, ctx.obj)


@cli.command("health")
@click.pass_context
def health(ctx: click.Context) -> None:
    def _health() -> dict[str, Any]:
        config = runtime_config(ctx.obj)
        missing = []
        if not config["account_present"]:
            missing.append("GOOGLE_WORKSPACE_ACCOUNT")
        if not config["vip_senders_present"]:
            missing.append("VIP_EMAIL_SENDERS")
        return {
            "status": "ok" if not missing else "needs_setup",
            "missing": missing,
            "summary": "VIP Email connector ready" if not missing else f"Missing: {', '.join(missing)}",
        }

    run_command(ctx, "health", _health)


@cli.command("doctor")
@click.option("--gws-bin", default=DEFAULT_GWS_BIN, show_default=True)
@click.pass_context
def doctor(ctx: click.Context, gws_bin: str) -> None:
    def _doctor() -> dict[str, Any]:
        checks = []
        config = runtime_config(ctx.obj)
        checks.append({"name": "google_account", "ok": config["account_present"], "source": config["account_source"]})
        checks.append({"name": "vip_senders", "ok": config["vip_senders_present"], "source": config["vip_senders_source"]})
        checks.append({"name": "gws_binary", "ok": bool(shutil.which(gws_bin)), "binary": gws_bin})
        return {
            "status": "ok" if all(check["ok"] for check in checks) else "needs_setup",
            "checks": checks,
            "summary": "VIP Email diagnostics complete",
        }

    run_command(ctx, "doctor", _doctor)


@cli.group("vip")
def vip_group() -> None:
    pass


@vip_group.command("list")
@click.option("--vip-senders", default=None, help="Comma or JSON list override")
@click.pass_context
def vip_list(ctx: click.Context, vip_senders: str | None) -> None:
    def _list() -> dict[str, Any]:
        senders = _string_list(vip_senders) or runtime_config(ctx.obj)["vip_senders"]
        return {"vip_senders": senders, "count": len(senders), "summary": f"{len(senders)} VIP sender(s) configured"}

    run_command(ctx, "vip.list", _list)


@cli.group("scan")
def scan_group() -> None:
    pass


@scan_group.command("now")
@click.option("--gws-bin", default=DEFAULT_GWS_BIN, show_default=True)
@click.option("--account", default=None, help="Google Workspace account alias/email")
@click.option("--vip-senders", default=None, help="Comma or JSON list override")
@click.option("--lookback-days", type=int, default=None)
@click.option("--max-results", type=int, default=None)
@click.option("--state-path", type=click.Path(path_type=Path), default=DEFAULT_STATE_PATH)
@click.option("--no-state", is_flag=True, help="Do not read/write local dedupe state")
@click.pass_context
def scan_now_command(
    ctx: click.Context,
    gws_bin: str,
    account: str | None,
    vip_senders: str | None,
    lookback_days: int | None,
    max_results: int | None,
    state_path: Path,
    no_state: bool,
) -> None:
    run_command(
        ctx,
        "scan.now",
        scan_now,
        ctx_obj=ctx.obj,
        gws_bin=gws_bin,
        account=account,
        vip_senders=vip_senders,
        lookback_days=lookback_days,
        max_results=max_results,
        state_path=state_path,
        no_state=no_state,
    )


if __name__ == "__main__":
    cli()
