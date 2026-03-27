from __future__ import annotations


def questions() -> dict:
    """Run the thumbnail preset questionnaire."""
    from InquirerPy import inquirer

    topic = inquirer.text(
        message="Video/content topic:",
        validate=lambda x: len(x.strip()) > 0,
        invalid_message="Topic is required",
    ).execute()

    emotion = inquirer.select(
        message="Primary emotion/reaction:",
        choices=[
            "excited/amazed",
            "shocked/surprised",
            "curious/intrigued",
            "happy/celebratory",
            "serious/dramatic",
            "angry/frustrated",
            "sad/emotional",
            "confident/powerful",
        ],
        default="excited/amazed",
    ).execute()

    text_overlay = inquirer.text(
        message="Text overlay (leave empty for none):",
        default="",
    ).execute()

    style = inquirer.select(
        message="Thumbnail style:",
        choices=[
            "face reaction (close-up person reacting)",
            "split comparison (before/after or vs)",
            "bold graphic (text-heavy, colorful)",
            "cinematic scene",
            "tutorial/how-to (step visual)",
            "listicle (numbered items)",
        ],
        default="face reaction (close-up person reacting)",
    ).execute()

    colors = inquirer.select(
        message="Color scheme:",
        choices=[
            "red and yellow (high energy)",
            "blue and white (trustworthy)",
            "black and gold (premium)",
            "green and white (growth/money)",
            "purple and pink (creative)",
            "orange and dark (attention-grabbing)",
        ],
        default="red and yellow (high energy)",
    ).execute()

    return {
        "topic": topic.strip(),
        "emotion": emotion,
        "text_overlay": text_overlay.strip() or None,
        "style": style,
        "colors": colors,
    }


def build(answers: dict) -> dict:
    """Build a structured prompt from thumbnail answers."""
    style_camera = {
        "face reaction (close-up person reacting)": "close-up",
        "split comparison (before/after or vs)": "wide",
        "bold graphic (text-heavy, colorful)": "medium",
        "cinematic scene": "wide",
        "tutorial/how-to (step visual)": "medium",
        "listicle (numbered items)": "medium",
    }

    subject_parts = [f"YouTube thumbnail about {answers['topic']}"]
    subject_parts.append(f"in {answers['style']} style")

    details_parts = [f"Color scheme: {answers['colors']}"]
    details_parts.append(f"Emotion: {answers['emotion']}")
    if answers.get("text_overlay"):
        details_parts.append(f"Text overlay reads: \"{answers['text_overlay']}\"")

    prompt = {
        "subject": ", ".join(subject_parts),
        "style": "illustration",
        "mood": answers["emotion"],
        "lighting": "dramatic",
        "camera": style_camera.get(answers["style"], "medium"),
        "background": "bold, attention-grabbing background",
        "topic": answers["topic"],
        "emotion": answers["emotion"],
        "text_overlay": answers.get("text_overlay"),
        "details": ". ".join(details_parts),
        "suggested_aspect": "16:9",
    }

    return {k: v for k, v in prompt.items() if v is not None}
