from __future__ import annotations

from collections.abc import Mapping
from typing import Any


class AsanaError(RuntimeError):
    code = "ASANA_ERROR"
    exit_code = 1

    def __init__(self, message: str, *, details: Mapping[str, Any] | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.details = dict(details or {})


class AsanaConfigurationError(AsanaError):
    code = "ASANA_CONFIGURATION_ERROR"
    exit_code = 2


class AsanaPermissionError(AsanaError):
    code = "PERMISSION_DENIED"
    exit_code = 3


class AsanaAPIError(AsanaError):
    code = "ASANA_API_ERROR"
    exit_code = 4


class AsanaNotSupportedError(AsanaError):
    code = "ASANA_NOT_SUPPORTED"
    exit_code = 5
