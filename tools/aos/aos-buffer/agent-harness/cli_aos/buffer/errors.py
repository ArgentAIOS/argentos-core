from __future__ import annotations


class BufferError(RuntimeError):
    pass


class BufferConfigurationError(BufferError):
    pass


class BufferAPIError(BufferError):
    pass
