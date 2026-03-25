from __future__ import annotations


def questions() -> dict:
    """Run the product photography preset questionnaire."""
    from InquirerPy import inquirer

    item = inquirer.text(
        message="Product name and description:",
        validate=lambda x: len(x.strip()) > 0,
        invalid_message="Product description is required",
    ).execute()

    surface = inquirer.select(
        message="Surface/background:",
        choices=[
            "white seamless",
            "marble",
            "wood table",
            "concrete",
            "fabric/textile",
            "gradient backdrop",
            "lifestyle scene",
            "outdoor natural",
        ],
        default="white seamless",
    ).execute()

    lighting = inquirer.select(
        message="Lighting setup:",
        choices=[
            "studio softbox",
            "natural window",
            "dramatic spotlight",
            "ring light",
            "backlit glow",
            "flat lay even",
        ],
        default="studio softbox",
    ).execute()

    angle = inquirer.select(
        message="Camera angle:",
        choices=[
            "straight on",
            "45 degree",
            "overhead flat lay",
            "low angle hero",
            "three-quarter",
        ],
        default="45 degree",
    ).execute()

    lifestyle = inquirer.confirm(
        message="Include lifestyle context (hands, person using it)?",
        default=False,
    ).execute()

    lifestyle_desc = ""
    if lifestyle:
        lifestyle_desc = inquirer.text(
            message="Describe the lifestyle context:",
            default="person holding the product",
        ).execute()

    color_scheme = inquirer.text(
        message="Brand colors or color scheme (optional):",
        default="",
    ).execute()

    return {
        "item": item.strip(),
        "surface": surface,
        "lighting": lighting,
        "angle": angle,
        "lifestyle": lifestyle_desc.strip() or None,
        "color_scheme": color_scheme.strip() or None,
    }


def build(answers: dict) -> dict:
    """Build a structured prompt from product answers."""
    camera_map = {
        "straight on": "medium",
        "45 degree": "medium",
        "overhead flat lay": "overhead",
        "low angle hero": "low-angle",
        "three-quarter": "medium",
    }

    lighting_map = {
        "studio softbox": "studio",
        "natural window": "natural",
        "dramatic spotlight": "dramatic",
        "ring light": "studio",
        "backlit glow": "backlit",
        "flat lay even": "studio",
    }

    subject = answers["item"]
    if answers.get("lifestyle"):
        subject += f", {answers['lifestyle']}"

    details_parts = [f"{answers['angle']} angle product shot"]
    if answers.get("color_scheme"):
        details_parts.append(f"brand colors: {answers['color_scheme']}")

    prompt = {
        "subject": subject,
        "style": "photorealistic",
        "mood": "clean and professional",
        "lighting": lighting_map.get(answers["lighting"], "studio"),
        "camera": camera_map.get(answers["angle"], "medium"),
        "background": answers["surface"],
        "surface": answers["surface"],
        "lifestyle": answers.get("lifestyle"),
        "details": ". ".join(details_parts),
    }

    return {k: v for k, v in prompt.items() if v is not None}
