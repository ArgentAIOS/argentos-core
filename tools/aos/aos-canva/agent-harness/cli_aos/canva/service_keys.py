from __future__ import annotations

import os
import subprocess
from functools import lru_cache
from pathlib import Path

from .constants import (
    CANVA_ACCESS_TOKEN_ENV,
    CANVA_ASSET_FILE_ENV,
    CANVA_ASSET_ID_ENV,
    CANVA_ASSET_NAME_ENV,
    CANVA_ASSET_URL_ENV,
    CANVA_AUTOFILL_DATA_ENV,
    CANVA_BRAND_TEMPLATE_ID_ENV,
    CANVA_DESIGN_ID_ENV,
    CANVA_EXPORT_FORMAT_ENV,
    CANVA_EXPORT_JOB_ID_ENV,
    CANVA_FOLDER_ID_ENV,
    CANVA_FOLDER_NAME_ENV,
    CANVA_TITLE_ENV,
    LEGACY_AOS_CANVA_ACCESS_TOKEN_ENV,
    LEGACY_AOS_CANVA_API_KEY_ENV,
    LEGACY_CANVA_API_KEY_ENV,
)

ARGENTOS_ROOT = Path(__file__).resolve().parents[6]
SERVICE_KEY_VARIABLES = {
    CANVA_ACCESS_TOKEN_ENV,
    LEGACY_CANVA_API_KEY_ENV,
    LEGACY_AOS_CANVA_ACCESS_TOKEN_ENV,
    LEGACY_AOS_CANVA_API_KEY_ENV,
    CANVA_FOLDER_ID_ENV,
    CANVA_DESIGN_ID_ENV,
    CANVA_BRAND_TEMPLATE_ID_ENV,
    CANVA_EXPORT_FORMAT_ENV,
    CANVA_EXPORT_JOB_ID_ENV,
    CANVA_ASSET_FILE_ENV,
    CANVA_ASSET_URL_ENV,
    CANVA_ASSET_NAME_ENV,
    CANVA_ASSET_ID_ENV,
    CANVA_AUTOFILL_DATA_ENV,
    CANVA_FOLDER_NAME_ENV,
    CANVA_TITLE_ENV,
}


@lru_cache(maxsize=64)
def resolve_service_key(variable: str) -> str | None:
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


def service_key_env(variable: str, default: str | None = None) -> str | None:
    if variable in SERVICE_KEY_VARIABLES:
        value = resolve_service_key(variable)
        if value:
            return value
    value = os.getenv(variable)
    if value is not None:
        return value
    return default
