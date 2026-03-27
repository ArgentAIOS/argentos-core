from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class CliError(Exception):
    code: str
    message: str
    exit_code: int = 10
    details: dict[str, object] = field(default_factory=dict)
