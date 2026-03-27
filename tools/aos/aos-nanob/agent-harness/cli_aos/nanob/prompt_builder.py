from __future__ import annotations

import json
from pathlib import Path

from .constants import CAMERA_ANGLES, LIGHTING, PROMPTS_DIR, STYLES


def interactive_prompt() -> dict:
    """Run an interactive questionnaire to build a structured image prompt."""
    from InquirerPy import inquirer

    subject = inquirer.text(
        message="Subject (what/who is in the image):",
        validate=lambda x: len(x.strip()) > 0,
        invalid_message="Subject is required",
    ).execute()

    style = inquirer.select(
        message="Style:",
        choices=STYLES,
        default="photorealistic",
    ).execute()

    mood = inquirer.text(
        message="Mood/atmosphere (e.g., serene, energetic, mysterious):",
        default="",
    ).execute()

    lighting_choice = inquirer.select(
        message="Lighting:",
        choices=LIGHTING,
        default="natural",
    ).execute()

    camera = inquirer.select(
        message="Camera angle:",
        choices=CAMERA_ANGLES,
        default="medium",
    ).execute()

    background = inquirer.text(
        message="Background description:",
        default="",
    ).execute()

    details = inquirer.text(
        message="Additional details:",
        default="",
    ).execute()

    negative = inquirer.text(
        message="Negative prompt (things to avoid):",
        default="",
    ).execute()

    prompt_data = {
        "subject": subject.strip(),
        "style": style,
        "mood": mood.strip() or None,
        "lighting": lighting_choice,
        "camera": camera,
        "background": background.strip() or None,
        "details": details.strip() or None,
        "negative": negative.strip() or None,
    }

    # Remove None values
    return {k: v for k, v in prompt_data.items() if v is not None}


def interactive_preset(preset_type: str) -> dict:
    """Run a preset-specific questionnaire."""
    from .presets import get_preset

    preset = get_preset(preset_type)
    if preset is None:
        from .errors import CliError
        raise CliError(
            code="UNKNOWN_PRESET",
            message=f"Unknown preset type: {preset_type}",
            exit_code=2,
            details={"available": ["influencer", "product", "thumbnail", "scene", "motion"]},
        )

    answers = preset.questions()
    return preset.build(answers)


def flatten(prompt_data: dict) -> str:
    """Convert a structured prompt JSON into a natural language prompt string."""
    parts: list[str] = []

    style = prompt_data.get("style", "photorealistic")
    subject = prompt_data.get("subject", "")

    # Build the core description
    if style and style != "photorealistic":
        parts.append(f"A {style} style image of {subject}")
    else:
        parts.append(f"A photorealistic image of {subject}")

    # Camera angle
    camera = prompt_data.get("camera")
    if camera and camera != "medium":
        parts.append(f"shot from a {camera} angle")

    # Lighting
    lighting = prompt_data.get("lighting")
    if lighting and lighting != "natural":
        parts.append(f"with {lighting} lighting")

    # Mood
    mood = prompt_data.get("mood")
    if mood:
        parts.append(f"conveying a {mood} atmosphere")

    # Background
    background = prompt_data.get("background")
    if background:
        parts.append(f"set against {background}")

    # Details
    details = prompt_data.get("details")
    if details:
        parts.append(details)

    # Preset-specific fields
    for key in ("setting", "aesthetic", "platform", "surface", "lifestyle",
                 "topic", "emotion", "text_overlay", "location", "time_of_day",
                 "weather", "subjects", "action", "speed", "blur", "perspective"):
        val = prompt_data.get(key)
        if val:
            parts.append(f"{key.replace('_', ' ')}: {val}")

    return ". ".join(parts) + "."


def save_prompt(prompt_data: dict, name: str) -> Path:
    """Save a structured prompt to the prompts directory."""
    PROMPTS_DIR.mkdir(parents=True, exist_ok=True)
    path = PROMPTS_DIR / f"{name}.json"
    path.write_text(json.dumps(prompt_data, indent=2))
    return path


def load_prompt(path: str | Path) -> dict:
    """Load a structured prompt from a JSON file."""
    p = Path(path)
    if not p.exists():
        from .errors import CliError
        raise CliError(
            code="FILE_NOT_FOUND",
            message=f"Prompt file not found: {path}",
            exit_code=1,
            details={"path": str(path)},
        )
    return json.loads(p.read_text())
