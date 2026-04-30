from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class CliError(Exception):
    code: str
    message: str
    exit_code: int = 10
    details: dict[str, Any] = field(default_factory=dict)
