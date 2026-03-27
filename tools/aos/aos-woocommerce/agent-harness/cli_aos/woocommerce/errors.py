from __future__ import annotations


class WooCommerceError(RuntimeError):
    pass


class WooCommerceConfigurationError(WooCommerceError):
    pass


class WooCommerceAPIError(WooCommerceError):
    pass
