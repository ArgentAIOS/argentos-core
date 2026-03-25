from __future__ import annotations

DEFAULTS: dict[str, str] = {
    "photorealistic": (
        "blurry, distorted, low quality, watermark, text, logo, "
        "oversaturated, deformed, disfigured, extra limbs"
    ),
    "illustration": (
        "photorealistic, blurry, low quality, watermark, text, logo, "
        "3d render, photograph"
    ),
    "3d-render": (
        "blurry, low quality, watermark, text, logo, flat, 2d, "
        "photorealistic, sketch"
    ),
    "anime": (
        "photorealistic, blurry, low quality, watermark, text, logo, "
        "western cartoon, 3d render, deformed"
    ),
    "watercolor": (
        "photorealistic, digital, sharp edges, watermark, text, logo, "
        "blurry, low quality, 3d render"
    ),
    "oil-painting": (
        "photorealistic, digital, watermark, text, logo, blurry, "
        "low quality, flat colors, sketch"
    ),
    "pixel-art": (
        "photorealistic, blurry, smooth gradients, watermark, text, logo, "
        "high resolution photograph, 3d render"
    ),
    "sketch": (
        "photorealistic, color, blurry, watermark, text, logo, "
        "3d render, digital painting"
    ),
}


def get_negative(style: str, user_negative: str | None = None) -> str:
    """Get combined negative prompt for a style, appending any user overrides."""
    base = DEFAULTS.get(style, DEFAULTS["photorealistic"])
    if user_negative:
        return f"{base}, {user_negative}"
    return base
