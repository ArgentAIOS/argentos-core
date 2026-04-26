from __future__ import annotations

import os
from typing import Any


def _present(value: str | None) -> bool:
    return bool(value and value.strip())


def _normalize_service_keys(raw: Any) -> dict[str, str]:
    if isinstance(raw, dict):
        return {
            str(key): str(value).strip()
            for key, value in raw.items()
            if isinstance(key, str) and isinstance(value, str) and value.strip()
        }
    if isinstance(raw, list):
        normalized: dict[str, str] = {}
        for item in raw:
            if not isinstance(item, dict):
                continue
            name = item.get("name") or item.get("id") or item.get("key")
            value = item.get("value") or item.get("secret")
            if isinstance(name, str) and isinstance(value, str) and name.strip() and value.strip():
                normalized[name.strip()] = value.strip()
        return normalized
    return {}


def resolve_service_key(ctx_obj: dict[str, Any], key_name: str) -> dict[str, Any]:
    service_keys = _normalize_service_keys(ctx_obj.get("service_keys") or ctx_obj.get("serviceKeys"))
    service_key_value = service_keys.get(key_name)
    if _present(service_key_value):
        return {"name": key_name, "present": True, "source": "service_key", "value": service_key_value.strip()}

    env_value = os.getenv(key_name)
    if _present(env_value):
        return {"name": key_name, "present": True, "source": "env", "value": env_value.strip()}

    return {"name": key_name, "present": False, "source": "missing", "value": None}
