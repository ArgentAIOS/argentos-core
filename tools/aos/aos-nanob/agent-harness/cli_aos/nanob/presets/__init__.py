from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from types import ModuleType

_PRESET_MAP: dict[str, str] = {
    "influencer": ".influencer",
    "product": ".product",
    "thumbnail": ".thumbnail",
    "scene": ".scene",
    "motion": ".motion",
}

AVAILABLE_PRESETS = list(_PRESET_MAP.keys())


def get_preset(name: str) -> "ModuleType | None":
    """Load a preset module by name."""
    if name not in _PRESET_MAP:
        return None
    import importlib
    return importlib.import_module(_PRESET_MAP[name], package=__name__)
