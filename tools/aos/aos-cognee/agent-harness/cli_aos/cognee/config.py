from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

DEFAULT_COLLECTION = "vault-knowledge"
OPENAI_API_KEY_ENV = "OPENAI_API_KEY"


def _home() -> Path:
    return Path(os.path.expanduser("~"))


def expand_path(value: str | None) -> str:
    if not value:
        return ""
    return str(Path(os.path.expandvars(value)).expanduser())


def argent_config_path() -> Path:
    return Path(
        expand_path(os.getenv("ARGENT_CONFIG_PATH"))
        or str(_home() / ".argentos" / "argent.json")
    )


def read_argent_config() -> dict[str, Any]:
    path = argent_config_path()
    try:
        return json.loads(path.read_text())
    except Exception:
        return {}


def _config_env_vars(config: dict[str, Any] | None = None) -> dict[str, str]:
    cfg = config if config is not None else read_argent_config()
    env_config = cfg.get("env")
    if not isinstance(env_config, dict):
        return {}

    entries: dict[str, str] = {}

    raw_vars = env_config.get("vars")
    if isinstance(raw_vars, dict):
        for key, value in raw_vars.items():
            if isinstance(value, str) and value.strip():
                entries[str(key)] = value

    for key, value in env_config.items():
        if key in {"shellEnv", "vars"}:
            continue
        if isinstance(value, str) and value.strip():
            entries[str(key)] = value

    return entries


def ensure_openai_api_key(config: dict[str, Any] | None = None) -> bool:
    existing = (os.getenv(OPENAI_API_KEY_ENV) or "").strip()
    if existing:
        return True

    config_env = _config_env_vars(config)
    api_key = (config_env.get(OPENAI_API_KEY_ENV) or "").strip()
    if not api_key:
        return False

    os.environ[OPENAI_API_KEY_ENV] = api_key
    return True


def vault_path(config: dict[str, Any] | None = None, override: str | None = None) -> str:
    if override:
        return expand_path(override)
    env_value = os.getenv("AOS_COGNEE_VAULT_PATH")
    if env_value:
        return expand_path(env_value)
    cfg = config if config is not None else read_argent_config()
    raw = ((cfg.get("memory") or {}).get("vault") or {}).get("path")
    if isinstance(raw, str) and raw.strip():
        return expand_path(raw)
    return str(_home() / ".argentos" / "vault")


def dataset_name(config: dict[str, Any] | None = None, override: str | None = None) -> str:
    if override and override.strip():
        return override.strip()
    env_value = os.getenv("AOS_COGNEE_DATASET")
    if env_value and env_value.strip():
        return env_value.strip()
    cfg = config if config is not None else read_argent_config()
    raw = ((cfg.get("memory") or {}).get("vault") or {}).get("knowledgeCollection")
    if isinstance(raw, str) and raw.strip():
        return raw.strip()
    return DEFAULT_COLLECTION


def redacted_config_snapshot(ctx_obj: dict | None = None) -> dict:
    cfg = read_argent_config()
    path = vault_path(cfg, (ctx_obj or {}).get("vault_path"))
    collection = dataset_name(cfg, (ctx_obj or {}).get("dataset"))
    return {
        "argent_config_path": str(argent_config_path()),
        "vault_path": path,
        "vault_exists": Path(path).is_dir() if path else False,
        "dataset": collection,
        "cognee_enabled": ((cfg.get("memory") or {}).get("cognee") or {}).get("enabled") is True,
        "retrieval_enabled": (
            (((cfg.get("memory") or {}).get("cognee") or {}).get("retrieval") or {}).get("enabled")
            is True
        ),
    }
