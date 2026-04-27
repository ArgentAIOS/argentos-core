"""Resolve COMMUNITY_HOME for standalone skill scripts.

Skill scripts may run outside the community skills process (e.g. system Python,
nix env, CI) where ``community_constants`` is not importable.  This module
provides the same ``get_community_home()`` and ``display_community_home()``
contracts as ``community_constants`` without requiring it on ``sys.path``.

When ``community_constants`` IS available it is used directly so that any
future enhancements (profile resolution, Docker detection, etc.) are
picked up automatically.  The fallback path replicates the core logic
from ``community_constants.py`` using only the stdlib.

All scripts under ``google-workspace/scripts/`` should import from here
instead of duplicating the ``COMMUNITY_HOME = Path(os.getenv(...))`` pattern.
"""

from __future__ import annotations

import os
from pathlib import Path

try:
    from community_constants import display_community_home as display_community_home
    from community_constants import get_community_home as get_community_home
except (ModuleNotFoundError, ImportError):

    def get_community_home() -> Path:
        """Return the community skills home directory (default: ~/.argent).

        Mirrors ``community_constants.get_community_home()``."""
        val = os.environ.get("COMMUNITY_HOME", "").strip()
        return Path(val) if val else Path.home() / ".community"

    def display_community_home() -> str:
        """Return a user-friendly ``~/``-shortened display string.

        Mirrors ``community_constants.display_community_home()``."""
        home = get_community_home()
        try:
            return "~/" + str(home.relative_to(Path.home()))
        except ValueError:
            return str(home)
