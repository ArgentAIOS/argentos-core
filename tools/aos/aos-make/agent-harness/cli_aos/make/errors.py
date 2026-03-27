from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(slots=True)
class ConnectorError(Exception):
    code: str
    message: str
    exit_code: int
    details: dict[str, Any] | None = None

    def to_error(self) -> dict[str, Any]:
        payload = {"code": self.code, "message": self.message}
        if self.details is not None:
            payload["details"] = self.details
        return payload
