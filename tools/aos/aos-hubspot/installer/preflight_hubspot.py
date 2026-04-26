#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import subprocess
from dataclasses import asdict, dataclass
from functools import lru_cache
from pathlib import Path


ARGENTOS_ROOT = Path(__file__).resolve().parents[4]
SERVICE_KEY_VARIABLES = {"HUBSPOT_ACCESS_TOKEN", "HUBSPOT_PORTAL_ID"}


@dataclass
class Check:
    name: str
    ok: bool
    details: dict


@lru_cache(maxsize=32)
def _resolve_service_key(variable: str) -> str | None:
    command = [
        "node",
        "--import",
        "tsx",
        "-e",
        (
            "import { resolveServiceKey } from './src/infra/service-keys.ts';"
            f" process.stdout.write(resolveServiceKey('{variable}') || '');"
            " process.exit(0);"
        ),
    ]
    result = subprocess.run(
        command,
        cwd=ARGENTOS_ROOT,
        capture_output=True,
        text=True,
        timeout=20,
        check=False,
    )
    if result.returncode != 0:
        return None
    return result.stdout.strip() or None


def _service_key_env(variable: str) -> str | None:
    if variable in SERVICE_KEY_VARIABLES:
        value = _resolve_service_key(variable)
        if value:
            return value
    return os.getenv(variable)


def _first_present(*names: str) -> tuple[str | None, str | None]:
    for name in names:
        value = (_service_key_env(name) or "").strip()
        if value:
            return name, value
    return None, None


def check_portal_id() -> Check:
    env_name, value = _first_present("HUBSPOT_PORTAL_ID", "AOS_HUBSPOT_PORTAL_ID")
    return Check(
        name="portal_id",
        ok=bool(value),
        details={"env": env_name or "HUBSPOT_PORTAL_ID", "present": bool(value)},
    )


def check_access_token() -> Check:
    env_name, value = _first_present("HUBSPOT_ACCESS_TOKEN", "AOS_HUBSPOT_ACCESS_TOKEN")
    return Check(
        name="access_token",
        ok=bool(value),
        details={"env": env_name or "HUBSPOT_ACCESS_TOKEN", "present": bool(value)},
    )


def check_app_id() -> Check:
    env_name, value = _first_present("HUBSPOT_APP_ID", "AOS_HUBSPOT_APP_ID")
    return Check(
        name="app_id",
        ok=bool(value),
        details={"env": env_name or "HUBSPOT_APP_ID", "present": bool(value)},
    )


def check_webhook_secret() -> Check:
    env_name, value = _first_present("HUBSPOT_WEBHOOK_SECRET", "AOS_HUBSPOT_WEBHOOK_SECRET")
    return Check(
        name="webhook_secret",
        ok=bool(value),
        details={"env": env_name or "HUBSPOT_WEBHOOK_SECRET", "present": bool(value)},
    )


def build_next_steps(checks: list[Check], require_auth: bool) -> list[str]:
    steps: list[str] = []
    lookup = {check.name: check for check in checks}

    def add(step: str) -> None:
        if step not in steps:
            steps.append(step)

    if not lookup["portal_id"].ok:
        add("Set HUBSPOT_PORTAL_ID to the target HubSpot portal/account id.")
    if require_auth and not lookup["access_token"].ok:
        add("Set HUBSPOT_ACCESS_TOKEN for live HubSpot API access.")
    if not lookup["app_id"].ok:
        add("Optional: set HUBSPOT_APP_ID when the OAuth/webhook app is provisioned.")
    if not lookup["webhook_secret"].ok:
        add("Optional: set HUBSPOT_WEBHOOK_SECRET before enabling webhook-backed workers.")

    return steps


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Preflight checks for aos-hubspot runtime configuration")
    parser.add_argument("--require-auth", action="store_true", help="Fail when portal/token bootstrap is incomplete")
    parser.add_argument("--json", action="store_true", help="Emit JSON output")
    return parser


def main() -> int:
    args = build_parser().parse_args()

    checks = [
        check_portal_id(),
        check_access_token(),
        check_app_id(),
        check_webhook_secret(),
    ]

    required = [check for check in checks if check.name == "portal_id"]
    if args.require_auth:
        required.extend(check for check in checks if check.name == "access_token")

    is_ready = all(check.ok for check in required)
    payload = {
        "ok": is_ready,
        "tool": "aos-hubspot",
        "backend": "hubspot",
        "checks": [asdict(check) for check in checks],
        "next_steps": build_next_steps(checks, args.require_auth),
    }

    if args.json:
        print(json.dumps(payload, indent=2, sort_keys=True))
    else:
        print("aos-hubspot preflight")
        print(f"ready: {is_ready}")
        for check in checks:
            print(f"- {check.name}: {'ok' if check.ok else 'fail'}")

    return 0 if is_ready else 1


if __name__ == "__main__":
    raise SystemExit(main())
