from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class CliError(Exception):
    code: str
    message: str
    exit_code: int = 10
    details: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        super().__init__(self.message)

    def to_payload(self) -> dict[str, Any]:
        return {
            "code": self.code,
            "message": self.message,
            "details": self.details,
        }

    def to_probe(self) -> dict[str, Any]:
        return {
            "ok": False,
            "code": self.code,
            "message": self.message,
            "details": self.details,
        }
