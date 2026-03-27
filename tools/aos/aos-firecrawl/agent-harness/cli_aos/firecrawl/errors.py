from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass
class CliError(Exception):
    code: str
    message: str
    exit_code: int = 5
    details: dict[str, Any] | None = None

    def to_payload(self) -> dict[str, Any]:
        payload = {"code": self.code, "message": self.message}
        if self.details:
            payload["details"] = self.details
        return payload
