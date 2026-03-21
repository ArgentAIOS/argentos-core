from __future__ import annotations

from typing import Any


class CliError(Exception):
    def __init__(
        self,
        *,
        code: str,
        message: str,
        exit_code: int = 10,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.exit_code = exit_code
        self.details = details or {}

    def to_payload(self) -> dict[str, Any]:
        return {
            "code": self.code,
            "message": self.message,
            "details": self.details,
        }
