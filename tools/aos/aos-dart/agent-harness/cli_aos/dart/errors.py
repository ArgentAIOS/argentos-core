from __future__ import annotations

from collections.abc import Mapping
from typing import Any


class DartError(RuntimeError):
    code = "DART_ERROR"
    exit_code = 10

    def __init__(self, message: str, *, details: Mapping[str, Any] | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.details = dict(details or {})


class DartConfigurationError(DartError):
    code = "DART_CONFIGURATION_ERROR"
    exit_code = 4


class DartUsageError(DartError):
    code = "INVALID_USAGE"
    exit_code = 2


class DartPermissionError(DartError):
    code = "PERMISSION_DENIED"
    exit_code = 3


class DartAPIError(DartError):
    code = "DART_API_ERROR"
    exit_code = 5


class DartNotFoundError(DartError):
    code = "NOT_FOUND"
    exit_code = 6


class DartNotSupportedError(DartError):
    code = "DART_NOT_SUPPORTED"
    exit_code = 5
