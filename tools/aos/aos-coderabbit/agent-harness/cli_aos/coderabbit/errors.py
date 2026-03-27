from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(slots=True)
class CliError(Exception):
    code: str
    message: str
    exit_code: int = 1
    details: dict[str, Any] | None = None

    def to_error(self) -> dict[str, Any]:
        return {
            "code": self.code,
            "message": self.message,
            "details": self.details or {},
        }
