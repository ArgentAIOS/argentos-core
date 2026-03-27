from __future__ import annotations

import json
from typing import Any


def dumps(payload: Any) -> str:
    return json.dumps(payload, indent=2, sort_keys=True, ensure_ascii=False)
