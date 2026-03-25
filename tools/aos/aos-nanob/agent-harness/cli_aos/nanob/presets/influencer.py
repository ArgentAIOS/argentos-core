from __future__ import annotations


def questions() -> dict:
    """Run the influencer preset questionnaire and return answers."""
    from InquirerPy import inquirer

    person = inquirer.text(
        message="Describe the person (age, appearance, expression):",
        validate=lambda x: len(x.strip()) > 0,
        invalid_message="Person description is required",
    ).execute()

    setting = inquirer.text(
        message="Setting/location (e.g., coffee shop, beach, urban rooftop):",
        default="modern urban setting",
    ).execute()

    aesthetic = inquirer.select(
        message="Aesthetic style:",
        choices=[
            "clean minimal",
            "warm vintage",
            "moody editorial",
            "bright colorful",
            "dark luxury",
            "soft pastel",
            "retro film",
            "natural candid",
        ],
        default="clean minimal",
    ).execute()

    platform = inquirer.select(
        message="Target platform:",
        choices=[
            "Instagram feed (1:1)",
            "Instagram story (9:16)",
            "TikTok (9:16)",
            "YouTube thumbnail (16:9)",
            "Twitter/X post (16:9)",
            "LinkedIn (1:1)",
        ],
        default="Instagram feed (1:1)",
    ).execute()

    outfit = inquirer.text(
        message="Outfit/styling details:",
        default="",
    ).execute()

    props = inquirer.text(
        message="Props or accessories:",
        default="",
    ).execute()

    return {
        "person": person.strip(),
        "setting": setting.strip(),
        "aesthetic": aesthetic,
        "platform": platform,
        "outfit": outfit.strip() or None,
        "props": props.strip() or None,
    }


def build(answers: dict) -> dict:
    """Build a structured prompt from influencer answers."""
    # Map platform to suggested aspect ratio
    platform_aspect = {
        "Instagram feed (1:1)": "1:1",
        "Instagram story (9:16)": "9:16",
        "TikTok (9:16)": "9:16",
        "YouTube thumbnail (16:9)": "16:9",
        "Twitter/X post (16:9)": "16:9",
        "LinkedIn (1:1)": "1:1",
    }

    subject_parts = [answers["person"]]
    if answers.get("outfit"):
        subject_parts.append(f"wearing {answers['outfit']}")
    if answers.get("props"):
        subject_parts.append(f"with {answers['props']}")

    prompt = {
        "subject": ", ".join(subject_parts),
        "style": "photorealistic",
        "mood": answers["aesthetic"],
        "lighting": "natural",
        "camera": "medium",
        "background": answers["setting"],
        "setting": answers["setting"],
        "aesthetic": answers["aesthetic"],
        "platform": answers["platform"],
        "suggested_aspect": platform_aspect.get(answers["platform"], "1:1"),
    }

    return {k: v for k, v in prompt.items() if v is not None}
