#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from dataclasses import dataclass, asdict
from pathlib import Path

REQUIRED_SERVICES = "drive,gmail,calendar,sheets,docs"
CLIENT_SECRET_PATH = Path.home() / ".config" / "gws" / "client_secret.json"


@dataclass
class Check:
    name: str
    ok: bool
    details: dict


def run(cmd: list[str]) -> tuple[int, str, str]:
    proc = subprocess.run(cmd, capture_output=True, text=True, check=False)
    return proc.returncode, (proc.stdout or "").strip(), (proc.stderr or "").strip()


def check_gws(gws_bin: str) -> Check:
    path = shutil.which(gws_bin)
    return Check(
        name="gws_binary",
        ok=bool(path),
        details={
            "bin": gws_bin,
            "resolved_path": path,
            "install_hint": "npm install -g @googleworkspace/cli",
            "upstream_repo": "https://github.com/googleworkspace/cli",
        },
    )


def install_gws() -> Check:
    npm_path = shutil.which("npm")
    if not npm_path:
        return Check(
            name="gws_install",
            ok=False,
            details={"reason": "npm not found", "install_hint": "Install Node.js and npm first"},
        )

    code, out, err = run([npm_path, "install", "-g", "@googleworkspace/cli"])
    return Check(
        name="gws_install",
        ok=code == 0,
        details={"returncode": code, "stdout": out, "stderr": err},
    )


def check_version(gws_bin: str) -> Check:
    code, out, err = run([gws_bin, "--version"])
    return Check(
        name="gws_version",
        ok=code == 0,
        details={"returncode": code, "stdout": out, "stderr": err},
    )


def check_gcloud() -> Check:
    path = shutil.which("gcloud")
    return Check(
        name="gcloud_cli",
        ok=bool(path),
        details={
            "resolved_path": path,
            "install_hint": "Install Google Cloud SDK from https://cloud.google.com/sdk/docs/install",
            "setup_hint": "gws auth setup --login",
        },
    )


def check_oauth_client_config() -> Check:
    client_id = os.getenv("GOOGLE_WORKSPACE_CLI_CLIENT_ID", "").strip()
    client_secret = os.getenv("GOOGLE_WORKSPACE_CLI_CLIENT_SECRET", "").strip()
    env_configured = bool(client_id and client_secret)
    file_configured = CLIENT_SECRET_PATH.exists()
    return Check(
        name="oauth_client_config",
        ok=env_configured or file_configured,
        details={
            "client_secret_path": str(CLIENT_SECRET_PATH),
            "client_secret_present": file_configured,
            "env_client_id_present": bool(client_id),
            "env_client_secret_present": bool(client_secret),
            "setup_hint": "gws auth setup --login",
            "manual_file_hint": f"Save client_secret.json to {CLIENT_SECRET_PATH}",
            "manual_env_hint": "Set GOOGLE_WORKSPACE_CLI_CLIENT_ID and GOOGLE_WORKSPACE_CLI_CLIENT_SECRET",
        },
    )


def check_auth(gws_bin: str) -> Check:
    code, out, err = run([gws_bin, "auth", "status", "--json"])
    details = {"returncode": code, "stderr": err}
    authenticated = False
    if out:
        try:
            status = json.loads(out)
            details["status"] = status
            auth_method = str(status.get("auth_method") or "").strip().lower()
            credential_source = str(status.get("credential_source") or "").strip().lower()
            authenticated = auth_method not in {"", "none"} and credential_source not in {"", "none"}
            details["authenticated"] = authenticated
        except json.JSONDecodeError:
            details["raw"] = out
    details["login_hint"] = f"gws auth login -s {REQUIRED_SERVICES}"
    return Check(name="gws_auth", ok=code == 0 and authenticated, details=details)


def check_sanitize_env() -> Check:
    tpl = os.getenv("GOOGLE_WORKSPACE_CLI_SANITIZE_TEMPLATE", "")
    mode = os.getenv("GOOGLE_WORKSPACE_CLI_SANITIZE_MODE", "")
    ok = bool(tpl)
    return Check(
        name="model_armor_config",
        ok=ok,
        details={
            "sanitize_template_configured": ok,
            "sanitize_mode": mode or None,
        },
    )


def build_next_steps(checks: list[Check], require_auth: bool) -> list[str]:
    lookup = {check.name: check for check in checks}
    steps: list[str] = []

    def add(step: str) -> None:
        if step not in steps:
            steps.append(step)

    if not lookup.get("gws_binary", Check("", False, {})).ok:
        add("Install upstream gws: npm install -g @googleworkspace/cli")

    oauth_client_ready = lookup.get("oauth_client_config", Check("", False, {})).ok
    gcloud_ready = lookup.get("gcloud_cli", Check("", False, {})).ok

    if require_auth and not oauth_client_ready:
        if gcloud_ready:
            add("Create the Google OAuth client automatically: gws auth setup --login")
        else:
            add("Install Google Cloud SDK if you want guided setup: https://cloud.google.com/sdk/docs/install")
        add(f"Or save Google OAuth credentials to: {CLIENT_SECRET_PATH}")
        add(
            "Or set env vars: GOOGLE_WORKSPACE_CLI_CLIENT_ID and GOOGLE_WORKSPACE_CLI_CLIENT_SECRET"
        )

    if require_auth and oauth_client_ready and not lookup.get("gws_auth", Check("", False, {})).ok:
        add(f"Run login: gws auth login -s {REQUIRED_SERVICES}")

    if not lookup.get("model_armor_config", Check("", False, {})).ok:
        add(
            "Optional: set GOOGLE_WORKSPACE_CLI_SANITIZE_TEMPLATE (and GOOGLE_WORKSPACE_CLI_SANITIZE_MODE) for sanitize-by-default."
        )

    return steps


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Preflight checks for aos-google runtime dependencies")
    p.add_argument("--gws-bin", default="gws", help="gws binary name/path")
    p.add_argument("--install-missing", action="store_true", help="Install gws via npm if missing")
    p.add_argument("--require-auth", action="store_true", help="Fail preflight if gws auth is not ready")
    p.add_argument("--json", action="store_true", help="Emit JSON output")
    return p


def main() -> int:
    args = build_parser().parse_args()

    checks: list[Check] = []
    gws_check = check_gws(args.gws_bin)
    checks.append(gws_check)

    if not gws_check.ok and args.install_missing:
        install_check = install_gws()
        checks.append(install_check)
        gws_check = check_gws(args.gws_bin)
        checks.append(gws_check)

    if gws_check.ok:
        checks.append(check_version(args.gws_bin))
        checks.append(check_gcloud())
        checks.append(check_oauth_client_config())
        auth_check = check_auth(args.gws_bin)
        checks.append(auth_check)
    else:
        auth_check = Check(name="gws_auth", ok=False, details={"skipped": True, "reason": "gws missing"})
        checks.append(check_gcloud())
        checks.append(check_oauth_client_config())

    checks.append(check_sanitize_env())

    required_ok = [c for c in checks if c.name in {"gws_binary", "gws_version"}]
    if args.require_auth:
        required_ok.extend([c for c in checks if c.name in {"oauth_client_config", "gws_auth"}])

    is_ready = all(c.ok for c in required_ok)

    payload = {
        "ok": is_ready,
        "tool": "aos-google",
        "backend": "@googleworkspace/cli",
        "checks": [asdict(c) for c in checks],
        "next_steps": build_next_steps(checks, args.require_auth),
    }

    if args.json:
        print(json.dumps(payload, indent=2, sort_keys=True))
    else:
        print("aos-google preflight")
        print(f"ready: {is_ready}")
        for c in checks:
            print(f"- {c.name}: {'ok' if c.ok else 'fail'}")

    return 0 if is_ready else 1


if __name__ == "__main__":
    raise SystemExit(main())
