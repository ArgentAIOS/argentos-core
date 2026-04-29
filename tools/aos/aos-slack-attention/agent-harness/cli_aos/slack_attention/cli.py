from __future__ import annotations

import json
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib import error, parse, request

import click

from . import __version__
from .errors import CliError
from .service_keys import service_key_details

TOOL_NAME = "aos-slack-attention"
BACKEND = "slack-web-api"
MODE_ORDER = ["readonly", "write", "full", "admin"]
CONNECTOR_PATH = Path(__file__).resolve().parents[3] / "connector.json"
PERMISSIONS_PATH = Path(__file__).resolve().parents[2] / "permissions.json"
DEFAULT_LOOKBACK_MINUTES = 10
DEFAULT_SCAN_CADENCE_SECONDS = 300
DEFAULT_MAX_MESSAGES = 100
DEFAULT_DEDUPE_WINDOW_SECONDS = 604_800
DEFAULT_STATE_PATH = Path.home() / ".argentos" / "aos-slack-attention-state.json"
SLACK_API_BASE_URL = "https://slack.com/api"
HIGH_SIGNAL_KEYWORDS = {"urgent", "asap", "blocked", "down", "outage", "failed"}


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
        click.echo(payload.get("data", {}).get("summary") or "OK")
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
    token = _resolve("SLACK_BOT_TOKEN", ctx_obj)
    channels = _resolve("SLACK_ATTENTION_CHANNELS", ctx_obj)
    keywords = _resolve("SLACK_ATTENTION_KEYWORDS", ctx_obj)
    mention_user_ids = _resolve("SLACK_ATTENTION_MENTION_USER_IDS", ctx_obj)
    mention_names = _resolve("SLACK_ATTENTION_MENTION_NAMES", ctx_obj)
    cadence = _resolve("SLACK_ATTENTION_SCAN_CADENCE_SECONDS", ctx_obj, str(DEFAULT_SCAN_CADENCE_SECONDS))
    lookback = _resolve("SLACK_ATTENTION_LOOKBACK_MINUTES", ctx_obj, str(DEFAULT_LOOKBACK_MINUTES))
    max_messages = _resolve("SLACK_ATTENTION_MAX_MESSAGES", ctx_obj, str(DEFAULT_MAX_MESSAGES))
    dedupe = _resolve("SLACK_ATTENTION_DEDUPE_WINDOW_SECONDS", ctx_obj, str(DEFAULT_DEDUPE_WINDOW_SECONDS))
    quiet_hours = _resolve("SLACK_ATTENTION_QUIET_HOURS", ctx_obj)
    destinations = _resolve("SLACK_ATTENTION_ALERT_DESTINATIONS", ctx_obj)
    return {
        "backend": BACKEND,
        "tool": TOOL_NAME,
        "bot_token": token["value"],
        "bot_token_present": bool(token["value"]),
        "bot_token_source": token["source"],
        "channels": _string_list(channels["value"]),
        "channels_present": bool(channels["value"]),
        "channels_source": channels["source"],
        "keywords": _string_list(keywords["value"]),
        "mention_user_ids": _string_list(mention_user_ids["value"]),
        "mention_names": _string_list(mention_names["value"]),
        "scan_cadence_seconds": _int_value(cadence["value"], DEFAULT_SCAN_CADENCE_SECONDS, minimum=10, maximum=86_400),
        "lookback_minutes": _int_value(lookback["value"], DEFAULT_LOOKBACK_MINUTES, minimum=1, maximum=180),
        "max_messages": _int_value(max_messages["value"], DEFAULT_MAX_MESSAGES, minimum=1, maximum=1000),
        "dedupe_window_seconds": _int_value(
            dedupe["value"], DEFAULT_DEDUPE_WINDOW_SECONDS, minimum=0, maximum=2_592_000
        ),
        "quiet_hours": quiet_hours["value"],
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
        "bot_token_present": config["bot_token_present"],
        "bot_token_source": config["bot_token_source"],
        "channel_count": len(config["channels"]),
        "channels_source": config["channels_source"],
        "keyword_count": len(config["keywords"]),
        "mention_user_id_count": len(config["mention_user_ids"]),
        "mention_name_count": len(config["mention_names"]),
        "scan_cadence_seconds": config["scan_cadence_seconds"],
        "lookback_minutes": config["lookback_minutes"],
        "max_messages": config["max_messages"],
        "dedupe_window_seconds": config["dedupe_window_seconds"],
        "quiet_hours": config["quiet_hours"],
        "alert_destinations_count": len(config["alert_destinations"]),
        "connector_contract": "read-only alert candidates; Workflows owns scheduling and delivery",
    }


def _headers(token: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
        "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
        "User-Agent": "aos-slack-attention/0.1.0",
    }


def slack_api(api_method: str, token: str, *, params: dict[str, Any] | None = None) -> dict[str, Any]:
    req = request.Request(
        f"{SLACK_API_BASE_URL}/{api_method}",
        data=parse.urlencode({k: v for k, v in (params or {}).items() if v not in (None, "")}).encode("utf-8"),
        method="POST",
        headers=_headers(token),
    )
    try:
        with request.urlopen(req, timeout=20) as response:
            body = response.read().decode(response.headers.get_content_charset("utf-8") or "utf-8")
    except error.HTTPError as exc:
        raise CliError("BACKEND_ERROR", "Slack API request failed", 5, {"method": api_method, "status": exc.code}) from exc
    except error.URLError as exc:
        raise CliError("BACKEND_UNAVAILABLE", "Failed to reach Slack API", 5, {"method": api_method, "reason": str(exc.reason)}) from exc
    try:
        payload = json.loads(body) if body else {}
    except json.JSONDecodeError as exc:
        raise CliError("BACKEND_ERROR", "Slack API returned invalid JSON", 5, {"method": api_method}) from exc
    if not isinstance(payload, dict):
        raise CliError("BACKEND_ERROR", "Slack API returned an unexpected payload", 5, {"method": api_method})
    if payload.get("ok") is False:
        err = str(payload.get("error") or "slack_api_error")
        code = "AUTH_ERROR" if err in {"not_authed", "invalid_auth", "missing_scope"} else "SLACK_API_ERROR"
        raise CliError(code, "Slack API request failed", 4 if code == "AUTH_ERROR" else 5, {"method": api_method, "slack_error": err})
    return payload


def _load_state(path: Path) -> dict[str, Any]:
    try:
        payload = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        return {"version": 1, "seen": {}}
    return payload if isinstance(payload, dict) else {"version": 1, "seen": {}}


def _save_state(path: Path, state: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(state, indent=2, sort_keys=True))


def _message_hits(text: str, *, mention_user_ids: list[str], mention_names: list[str], keywords: list[str]) -> tuple[list[str], str]:
    lower = text.lower()
    reasons: list[str] = []
    for user_id in mention_user_ids:
        if f"<@{user_id.upper()}>" in text.upper():
            reasons.append("direct_mention")
            break
    for name in mention_names:
        if name and name.lower() in lower:
            reasons.append("operator_name")
            break
    for keyword in keywords:
        if keyword and keyword.lower() in lower:
            reasons.append("keyword_high_signal" if keyword.lower() in HIGH_SIGNAL_KEYWORDS else "keyword")
            break
    severity = "high" if any(reason in {"direct_mention", "keyword_high_signal"} for reason in reasons) else "normal"
    return list(dict.fromkeys(reasons)), severity


def scan_now(
    *,
    ctx_obj: dict[str, Any],
    channels: str | None,
    keywords: str | None,
    mention_user_ids: str | None,
    mention_names: str | None,
    lookback_minutes: int | None,
    max_messages: int | None,
    state_path: Path,
    no_state: bool,
) -> dict[str, Any]:
    config = runtime_config(ctx_obj)
    token = config["bot_token"]
    resolved_channels = _string_list(channels) or config["channels"]
    resolved_keywords = _string_list(keywords) or config["keywords"]
    resolved_user_ids = _string_list(mention_user_ids) or config["mention_user_ids"]
    resolved_names = _string_list(mention_names) or config["mention_names"]
    if not token:
        raise CliError("AUTH_REQUIRED", "SLACK_BOT_TOKEN is not configured", 4)
    if not resolved_channels:
        raise CliError("CONFIG_REQUIRED", "SLACK_ATTENTION_CHANNELS is not configured", 4)
    if not (resolved_keywords or resolved_user_ids or resolved_names):
        raise CliError(
            "CONFIG_REQUIRED",
            "Configure at least one Slack attention keyword, mention user ID, or mention name",
            4,
        )

    lookback = lookback_minutes or config["lookback_minutes"]
    limit = max_messages or config["max_messages"]
    oldest = f"{time.time() - (lookback * 60):.6f}"
    state = {"version": 1, "seen": {}} if no_state else _load_state(state_path)
    seen = state.setdefault("seen", {})
    detected_at = now_iso()
    candidates: list[dict[str, Any]] = []
    suppressed = 0
    scan_errors: list[dict[str, str]] = []
    for channel in resolved_channels:
        try:
            payload = slack_api(
                "conversations.history",
                token,
                params={"channel": channel, "oldest": oldest, "limit": str(limit), "inclusive": "true"},
            )
        except CliError as err:
            scan_errors.append({"channel": channel, "code": err.code, "message": err.message})
            continue
        for message in payload.get("messages", []):
            if not isinstance(message, dict):
                continue
            text = str(message.get("text") or "")
            reasons, severity = _message_hits(
                text,
                mention_user_ids=resolved_user_ids,
                mention_names=resolved_names,
                keywords=resolved_keywords,
            )
            if not reasons:
                continue
            ts = str(message.get("ts") or "")
            dedupe_key = f"slack:{channel}:{ts}"
            if not no_state and dedupe_key in seen:
                suppressed += 1
                continue
            url = f"slack://channel?team=&id={channel}&message={ts}" if ts else ""
            candidates.append(
                {
                    "event_type": "operator.alert.candidate",
                    "connector_id": TOOL_NAME,
                    "source_provider": "slack",
                    "source_account": "slack-workspace",
                    "source_ref": f"{channel}:{ts}",
                    "detected_at": detected_at,
                    "severity": severity,
                    "reasons": reasons,
                    "candidate_text": text[:500],
                    "url": url,
                    "dedupe_key": dedupe_key,
                    "quiet_hours_suppressed": False,
                    "raw_summary": text[:300],
                    "metadata": {
                        "channel": channel,
                        "message_ts": ts,
                        "user": message.get("user"),
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
        "summary": f"Slack attention scan: {len(candidates)} alert candidate(s)",
        "live_status": "live_read",
        "event_type": "operator.alert.candidate",
        "source_provider": "slack",
        "channel_count": len(resolved_channels),
        "candidates": candidates,
        "candidate_count": len(candidates),
        "duplicate_suppressed_count": suppressed,
        "scan_errors": scan_errors,
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
        if not config["bot_token_present"]:
            missing.append("SLACK_BOT_TOKEN")
        if not config["channels_present"]:
            missing.append("SLACK_ATTENTION_CHANNELS")
        if not (config["keywords"] or config["mention_user_ids"] or config["mention_names"]):
            missing.append("SLACK_ATTENTION_KEYWORDS_OR_MENTIONS")
        return {
            "status": "ok" if not missing else "needs_setup",
            "missing": missing,
            "summary": "Slack Attention connector ready" if not missing else f"Missing: {', '.join(missing)}",
        }

    run_command(ctx, "health", _health)


@cli.command("doctor")
@click.pass_context
def doctor(ctx: click.Context) -> None:
    def _doctor() -> dict[str, Any]:
        config = runtime_config(ctx.obj)
        checks = [
            {"name": "bot_token", "ok": config["bot_token_present"], "source": config["bot_token_source"]},
            {"name": "channels", "ok": config["channels_present"], "source": config["channels_source"]},
            {
                "name": "attention_rules",
                "ok": bool(config["keywords"] or config["mention_user_ids"] or config["mention_names"]),
            },
        ]
        return {
            "status": "ok" if all(check["ok"] for check in checks) else "needs_setup",
            "checks": checks,
            "summary": "Slack Attention diagnostics complete",
        }

    run_command(ctx, "doctor", _doctor)


@cli.group("scan")
def scan_group() -> None:
    pass


@scan_group.command("now")
@click.option("--channels", default=None, help="Comma or JSON list of Slack channel IDs")
@click.option("--keywords", default=None, help="Comma or JSON list of attention keywords")
@click.option("--mention-user-ids", default=None, help="Comma or JSON list of Slack user IDs")
@click.option("--mention-names", default=None, help="Comma or JSON list of operator names")
@click.option("--lookback-minutes", type=int, default=None)
@click.option("--max-messages", type=int, default=None)
@click.option("--state-path", type=click.Path(path_type=Path), default=DEFAULT_STATE_PATH)
@click.option("--no-state", is_flag=True, help="Do not read/write local dedupe state")
@click.pass_context
def scan_now_command(
    ctx: click.Context,
    channels: str | None,
    keywords: str | None,
    mention_user_ids: str | None,
    mention_names: str | None,
    lookback_minutes: int | None,
    max_messages: int | None,
    state_path: Path,
    no_state: bool,
) -> None:
    run_command(
        ctx,
        "scan.now",
        scan_now,
        ctx_obj=ctx.obj,
        channels=channels,
        keywords=keywords,
        mention_user_ids=mention_user_ids,
        mention_names=mention_names,
        lookback_minutes=lookback_minutes,
        max_messages=max_messages,
        state_path=state_path,
        no_state=no_state,
    )


if __name__ == "__main__":
    cli()
