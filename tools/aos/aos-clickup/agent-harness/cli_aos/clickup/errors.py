from __future__ import annotations

from collections.abc import Mapping
from typing import Any


class ClickUpError(RuntimeError):
    code = "CLICKUP_ERROR"
    exit_code = 1

    def __init__(self, message: str, *, details: Mapping[str, Any] | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.details = dict(details or {})


class ClickUpConfigurationError(ClickUpError):
    code = "CLICKUP_CONFIGURATION_ERROR"
    exit_code = 2


class ClickUpPermissionError(ClickUpError):
    code = "PERMISSION_DENIED"
    exit_code = 3


class ClickUpAPIError(ClickUpError):
    code = "CLICKUP_API_ERROR"
    exit_code = 4


class ClickUpNotSupportedError(ClickUpError):
    code = "CLICKUP_NOT_SUPPORTED"
    exit_code = 5
