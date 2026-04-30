from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
from typing import Any

DEFAULT_SERVICE_KEYS_PATH = Path(os.getenv("HOME", "/tmp")) / ".argentos" / "service-keys.json"
SERVICE_KEYS_PATH = Path(os.getenv("ARGENT_SERVICE_KEYS_PATH", str(DEFAULT_SERVICE_KEYS_PATH)))
SERVICE_KEY_VARIABLES = {
    "SLACK_BOT_TOKEN",
    "SLACK_APP_TOKEN",
    "SLACK_BASE_URL",
    "SLACK_CHANNEL_ID",
    "SLACK_THREAD_TS",
    "SLACK_TEXT",
    "SLACK_EMOJI",
    "SLACK_USER_ID",
    "SLACK_CHANNEL_NAME",
    "SLACK_CANVAS_ID",
    "SLACK_CANVAS_TITLE",
    "SLACK_CANVAS_CONTENT",
    "SLACK_CANVAS_CHANGES",
    "SLACK_FILE_PATH",
    "SLACK_FILE_TITLE",
    "SLACK_REMINDER_TEXT",
    "SLACK_REMINDER_TIME",
    "SLACK_REMINDER_USER",
}
TOOL_SCOPE_KEYS = ("aos-slack-workflow", "slack-workflow", "slack_workflow", "slack")
SERVICE_KEY_CONTEXT_FIELDS = ("service_keys", "service_key_values", "api_keys", "secrets")
DECRYPT_SECRET_SCRIPT = r"""
const { createDecipheriv } = require("node:crypto");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const PREFIX = "enc:v1:";
const value = fs.readFileSync(0, "utf8").trim();
const home = process.env.HOME || "/tmp";

function readKeychainKey() {
  if (process.platform !== "darwin") return null;
  try {
    const hex = execFileSync(
      "security",
      ["find-generic-password", "-s", "ArgentOS-MasterKey", "-a", "ArgentOS", "-w"],
      { encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
    const key = Buffer.from(hex, "hex");
    return key.length === 32 ? key : null;
  } catch {
    return null;
  }
}

function readFileKey() {
  try {
    const key = Buffer.from(fs.readFileSync(path.join(home, ".argentos", ".master-key"), "utf8").trim(), "hex");
    return key.length === 32 ? key : null;
  } catch {
    return null;
  }
}

function decryptWith(key) {
  const parts = value.slice(PREFIX.length).split(":");
  if (parts.length !== 3) throw new Error("Invalid encrypted secret format");
  const [ivHex, authTagHex, cipherHex] = parts;
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(authTagHex, "hex"));
  let decrypted = decipher.update(cipherHex, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

if (!value.startsWith(PREFIX)) {
  process.stdout.write(value);
  process.exit(0);
}

for (const key of [readKeychainKey(), readFileKey()].filter(Boolean)) {
  try {
    process.stdout.write(decryptWith(key));
    process.exit(0);
  } catch {
    // Try the next key source.
  }
}

process.exit(2);
"""


def _string_value(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def _mapping_value(mapping: Any, *keys: str) -> str:
    if not isinstance(mapping, dict):
        return ""
    for key in keys:
        value = _string_value(mapping.get(key))
        if value:
            return value
    return ""


def _candidate_keys(variable: str) -> tuple[str, ...]:
    suffix = variable.removeprefix("SLACK_").lower()
    keys = [variable, variable.lower(), suffix]
    aliases = {
        "SLACK_BOT_TOKEN": ("bot_token", "token", "access_token"),
        "SLACK_APP_TOKEN": ("app_token", "socket_token"),
        "SLACK_BASE_URL": ("base_url", "api_url", "url"),
        "SLACK_CHANNEL_ID": ("channel_id", "channel"),
        "SLACK_THREAD_TS": ("thread_ts", "timestamp", "message_ts"),
        "SLACK_TEXT": ("text", "message_text"),
        "SLACK_EMOJI": ("emoji", "reaction"),
        "SLACK_USER_ID": ("user_id", "user"),
        "SLACK_CHANNEL_NAME": ("channel_name", "name"),
        "SLACK_CANVAS_ID": ("canvas_id", "canvas"),
        "SLACK_CANVAS_TITLE": ("canvas_title", "title"),
        "SLACK_CANVAS_CONTENT": ("canvas_content", "content"),
        "SLACK_CANVAS_CHANGES": ("canvas_changes", "changes"),
        "SLACK_FILE_PATH": ("file_path", "path"),
        "SLACK_FILE_TITLE": ("file_title", "filename", "title"),
        "SLACK_REMINDER_TEXT": ("reminder_text",),
        "SLACK_REMINDER_TIME": ("reminder_time", "time"),
        "SLACK_REMINDER_USER": ("reminder_user", "reminder_user_id"),
    }
    keys.extend(aliases.get(variable, ()))
    return tuple(dict.fromkeys(keys))


def _operator_service_key_value(ctx_obj: dict[str, Any] | None, variable: str) -> tuple[str, str]:
    if not isinstance(ctx_obj, dict):
        return "", "missing"

    candidate_keys = _candidate_keys(variable)
    for field_name in SERVICE_KEY_CONTEXT_FIELDS:
        container = ctx_obj.get(field_name)
        value = _mapping_value(container, *candidate_keys)
        if value:
            return value, f"operator:{field_name}"
        if isinstance(container, dict):
            for tool_scope_key in TOOL_SCOPE_KEYS:
                value = _mapping_value(container.get(tool_scope_key), *candidate_keys)
                if value:
                    return value, f"operator:{field_name}:tool"

    value = _mapping_value(ctx_obj, *candidate_keys)
    if value:
        return value, "operator:context"
    return "", "missing"


def _has_scoped_policy(entry: dict[str, Any]) -> bool:
    return (
        entry.get("denyAll") is True
        or bool(entry.get("allowedRoles"))
        or bool(entry.get("allowedAgents"))
        or bool(entry.get("allowedTeams"))
    )


def _decrypt_repo_secret(value: str) -> str | None:
    if not value.startswith("enc:v1:"):
        return value
    try:
        result = subprocess.run(
            ["node", "-e", DECRYPT_SECRET_SCRIPT],
            input=value,
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if result.returncode != 0:
        return None
    return _string_value(result.stdout) or None


def repo_service_key_details(variable: str) -> dict[str, Any] | None:
    try:
        payload = json.loads(SERVICE_KEYS_PATH.read_text())
    except (OSError, json.JSONDecodeError):
        return None
    keys = payload.get("keys")
    if not isinstance(keys, list):
        return None
    for entry in keys:
        if not isinstance(entry, dict):
            continue
        if entry.get("variable") != variable or entry.get("enabled") is False:
            continue
        value = _string_value(entry.get("value"))
        if not value:
            return None
        if _has_scoped_policy(entry):
            return {
                "value": "",
                "present": True,
                "usable": False,
                "source": "repo-service-key-scoped",
                "variable": variable,
                "blocked": True,
                "reason": "scoped service keys must be injected by the operator runtime",
            }
        decrypted_value = _decrypt_repo_secret(value)
        if decrypted_value is None:
            return None
        return {
            "value": decrypted_value,
            "present": True,
            "usable": True,
            "source": "repo-service-key",
            "variable": variable,
        }
    return None


def service_key_details(variable: str, ctx_obj: dict[str, Any] | None = None, default: str | None = None) -> dict[str, Any]:
    if variable in SERVICE_KEY_VARIABLES:
        value, source = _operator_service_key_value(ctx_obj, variable)
        if value:
            return {"value": value, "present": True, "usable": True, "source": source, "variable": variable}

        repo_detail = repo_service_key_details(variable)
        if repo_detail:
            return repo_detail

    value = _string_value(os.getenv(variable))
    if value:
        return {"value": value, "present": True, "usable": True, "source": "env_fallback", "variable": variable}

    fallback = _string_value(default)
    if fallback:
        return {"value": fallback, "present": False, "usable": True, "source": "default", "variable": variable}

    return {"value": "", "present": False, "usable": False, "source": "missing", "variable": variable}


def service_key_env(variable: str, default: str | None = None, ctx_obj: dict[str, Any] | None = None) -> str | None:
    value = service_key_details(variable, ctx_obj, default=default)["value"]
    return value or None


def service_key_source(variable: str, ctx_obj: dict[str, Any] | None = None) -> str | None:
    detail = service_key_details(variable, ctx_obj)
    return detail["source"] if detail["present"] else None


def resolve_service_key(variable: str) -> str | None:
    return service_key_env(variable)
