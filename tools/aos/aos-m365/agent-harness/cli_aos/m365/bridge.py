from __future__ import annotations

from .config import redacted_config_snapshot, runtime_config
from .runtime import doctor_snapshot, health_snapshot, probe_runtime


def config_snapshot() -> dict:
    config = runtime_config()
    probe = probe_runtime(config)
    return {
        **redacted_config_snapshot(),
        "api_probe": probe,
        "runtime_ready": bool(probe.get("ok")),
    }


def health_snapshot_data() -> dict:
    return health_snapshot()


def doctor_snapshot_data() -> dict:
    return doctor_snapshot()
