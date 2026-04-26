from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(slots=True)
class ConnectorError(Exception):
    code: str
    message: str
    exit_code: int = 1
    details: dict[str, Any] | None = None
