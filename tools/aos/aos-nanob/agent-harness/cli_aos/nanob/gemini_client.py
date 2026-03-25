from __future__ import annotations

import base64
import os
from pathlib import Path

from .constants import FLASH_MODEL, PRO_MODEL
from .errors import CliError


def _get_client():
    """Create a google-genai client. Requires GEMINI_API_KEY env var."""
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise CliError(
            code="MISSING_API_KEY",
            message="GEMINI_API_KEY environment variable is not set",
            exit_code=1,
            details={"env_var": "GEMINI_API_KEY"},
        )
    try:
        from google import genai
    except ImportError:
        raise CliError(
            code="MISSING_DEPENDENCY",
            message="google-genai package is not installed. Run: pip install google-genai",
            exit_code=1,
            details={"package": "google-genai"},
        )
    return genai.Client(api_key=api_key)


def check_health() -> dict:
    """Verify API key is set and connectivity works."""
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        return {
            "status": "unhealthy",
            "api_key_set": False,
            "connectivity": False,
            "error": "GEMINI_API_KEY not set",
        }

    try:
        client = _get_client()
        # Quick connectivity check: list models
        models = client.models.list()
        model_names = [m.name for m in models if "image" in m.name.lower() or "imagen" in m.name.lower()]
        return {
            "status": "healthy",
            "api_key_set": True,
            "connectivity": True,
            "image_models_found": len(model_names),
        }
    except Exception as exc:
        return {
            "status": "degraded",
            "api_key_set": True,
            "connectivity": False,
            "error": str(exc),
        }


def list_models() -> list[dict]:
    """List available Gemini image-related models."""
    client = _get_client()
    models = client.models.list()
    result = []
    for m in models:
        name = m.name if isinstance(m.name, str) else str(m.name)
        # Filter for image generation models
        if any(kw in name.lower() for kw in ("image", "imagen", "flash")):
            result.append({
                "name": name,
                "display_name": getattr(m, "display_name", name),
                "description": getattr(m, "description", ""),
            })
    # Always include our known models even if not in list
    known = {FLASH_MODEL, PRO_MODEL}
    listed_names = {m["name"] for m in result}
    for model_id in known:
        if not any(model_id in n for n in listed_names):
            result.append({
                "name": model_id,
                "display_name": model_id,
                "description": "Known image generation model (may require allowlist)",
            })
    return result


def generate_flash(
    prompt: str,
    aspect_ratio: str = "1:1",
    negative: str | None = None,
    seed: int | None = None,
    number_of_images: int = 1,
) -> list[dict]:
    """Generate images using Gemini Flash (generate_content with IMAGE modality)."""
    from google.genai import types

    client = _get_client()

    full_prompt = prompt
    if negative:
        full_prompt += f"\n\nAvoid: {negative}"
    if aspect_ratio != "1:1":
        full_prompt += f"\n\nAspect ratio: {aspect_ratio}"

    results = []
    for i in range(number_of_images):
        effective_prompt = full_prompt
        if seed is not None:
            effective_prompt += f"\n\nSeed: {seed + i}"

        try:
            response = client.models.generate_content(
                model=FLASH_MODEL,
                contents=effective_prompt,
                config=types.GenerateContentConfig(
                    response_modalities=["TEXT", "IMAGE"],
                ),
            )
        except Exception as exc:
            raise CliError(
                code="GENERATION_FAILED",
                message=f"Flash generation failed: {exc}",
                exit_code=1,
                details={"model": FLASH_MODEL, "error": str(exc)},
            )

        image_data = None
        text_response = None

        if response.candidates:
            for part in response.candidates[0].content.parts:
                if hasattr(part, "inline_data") and part.inline_data is not None:
                    image_data = part.inline_data.data
                elif hasattr(part, "text") and part.text:
                    text_response = part.text

        if image_data is None:
            raise CliError(
                code="NO_IMAGE_GENERATED",
                message="Model returned no image data",
                exit_code=1,
                details={
                    "model": FLASH_MODEL,
                    "text_response": text_response,
                    "hint": "The model may have refused the prompt or returned text only",
                },
            )

        # image_data is raw bytes from inline_data
        if isinstance(image_data, str):
            image_bytes = base64.b64decode(image_data)
        else:
            image_bytes = image_data

        results.append({
            "image_bytes": image_bytes,
            "text": text_response,
            "model": FLASH_MODEL,
            "index": i,
        })

    return results


def generate_pro(
    prompt: str,
    aspect_ratio: str = "1:1",
    negative: str | None = None,
    seed: int | None = None,
    number_of_images: int = 1,
) -> list[dict]:
    """Generate images using Imagen 3 (generate_images endpoint)."""
    from google.genai import types

    client = _get_client()

    config_kwargs: dict = {
        "number_of_images": min(number_of_images, 4),
        "aspect_ratio": aspect_ratio,
    }
    if negative:
        config_kwargs["negative_prompt"] = negative
    if seed is not None:
        config_kwargs["seed"] = seed

    try:
        response = client.models.generate_images(
            model=PRO_MODEL,
            prompt=prompt,
            config=types.GenerateImagesConfig(**config_kwargs),
        )
    except Exception as exc:
        raise CliError(
            code="GENERATION_FAILED",
            message=f"Pro generation failed: {exc}",
            exit_code=1,
            details={"model": PRO_MODEL, "error": str(exc)},
        )

    if not response.generated_images:
        raise CliError(
            code="NO_IMAGE_GENERATED",
            message="Imagen 3 returned no images",
            exit_code=1,
            details={"model": PRO_MODEL},
        )

    results = []
    for i, gen_image in enumerate(response.generated_images):
        image_bytes = gen_image.image.image_bytes
        results.append({
            "image_bytes": image_bytes,
            "text": None,
            "model": PRO_MODEL,
            "index": i,
        })

    return results


def edit_image(
    image_path: str,
    instruction: str,
    aspect_ratio: str = "1:1",
    seed: int | None = None,
) -> list[dict]:
    """Edit an image using Gemini Flash with image input + instruction."""
    from google.genai import types

    client = _get_client()

    img_path = Path(image_path)
    if not img_path.exists():
        raise CliError(
            code="FILE_NOT_FOUND",
            message=f"Image file not found: {image_path}",
            exit_code=1,
            details={"path": image_path},
        )

    image_bytes = img_path.read_bytes()

    # Determine mime type
    suffix = img_path.suffix.lower()
    mime_map = {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
        ".gif": "image/gif",
    }
    mime_type = mime_map.get(suffix, "image/png")

    prompt_text = f"Edit this image: {instruction}"
    if aspect_ratio != "1:1":
        prompt_text += f"\n\nAspect ratio: {aspect_ratio}"
    if seed is not None:
        prompt_text += f"\n\nSeed: {seed}"

    try:
        response = client.models.generate_content(
            model=FLASH_MODEL,
            contents=[
                types.Part.from_bytes(data=image_bytes, mime_type=mime_type),
                prompt_text,
            ],
            config=types.GenerateContentConfig(
                response_modalities=["TEXT", "IMAGE"],
            ),
        )
    except Exception as exc:
        raise CliError(
            code="EDIT_FAILED",
            message=f"Image edit failed: {exc}",
            exit_code=1,
            details={"model": FLASH_MODEL, "error": str(exc)},
        )

    image_data = None
    text_response = None

    if response.candidates:
        for part in response.candidates[0].content.parts:
            if hasattr(part, "inline_data") and part.inline_data is not None:
                image_data = part.inline_data.data
            elif hasattr(part, "text") and part.text:
                text_response = part.text

    if image_data is None:
        raise CliError(
            code="NO_IMAGE_GENERATED",
            message="Edit returned no image data",
            exit_code=1,
            details={"model": FLASH_MODEL, "text_response": text_response},
        )

    if isinstance(image_data, str):
        result_bytes = base64.b64decode(image_data)
    else:
        result_bytes = image_data

    return [{
        "image_bytes": result_bytes,
        "text": text_response,
        "model": FLASH_MODEL,
        "index": 0,
    }]
