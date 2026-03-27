from __future__ import annotations


class SquareError(RuntimeError):
    pass


class SquareConfigurationError(SquareError):
    pass


class SquareAPIError(SquareError):
    pass
