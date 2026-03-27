from __future__ import annotations


def questions() -> dict:
    """Run the motion/action preset questionnaire."""
    from InquirerPy import inquirer

    subject = inquirer.text(
        message="Subject (who/what is in motion):",
        validate=lambda x: len(x.strip()) > 0,
        invalid_message="Subject is required",
    ).execute()

    action = inquirer.text(
        message="Action being performed (e.g., sprinting, jumping, dancing):",
        validate=lambda x: len(x.strip()) > 0,
        invalid_message="Action is required",
    ).execute()

    speed = inquirer.select(
        message="Speed/intensity:",
        choices=[
            "frozen moment (ultra fast shutter)",
            "slight motion blur",
            "moderate motion blur",
            "heavy motion blur (speed lines)",
            "long exposure streaks",
        ],
        default="frozen moment (ultra fast shutter)",
    ).execute()

    blur = inquirer.select(
        message="Background treatment:",
        choices=[
            "sharp (everything in focus)",
            "shallow depth of field (subject sharp, background blurred)",
            "panning blur (subject sharp, background streaked)",
            "radial zoom blur",
        ],
        default="shallow depth of field (subject sharp, background blurred)",
    ).execute()

    perspective = inquirer.select(
        message="Camera perspective:",
        choices=[
            "tracking alongside",
            "head-on",
            "from below (heroic)",
            "from above (overhead)",
            "dutch angle (dynamic tilt)",
            "first person POV",
        ],
        default="tracking alongside",
    ).execute()

    environment = inquirer.text(
        message="Environment/setting:",
        default="",
    ).execute()

    return {
        "subject": subject.strip(),
        "action": action.strip(),
        "speed": speed,
        "blur": blur,
        "perspective": perspective,
        "environment": environment.strip() or None,
    }


def build(answers: dict) -> dict:
    """Build a structured prompt from motion answers."""
    perspective_camera = {
        "tracking alongside": "medium",
        "head-on": "medium",
        "from below (heroic)": "low-angle",
        "from above (overhead)": "overhead",
        "dutch angle (dynamic tilt)": "dutch-angle",
        "first person POV": "close-up",
    }

    subject_desc = f"{answers['subject']} {answers['action']}"
    details_parts = [
        f"Motion: {answers['speed']}",
        f"Background: {answers['blur']}",
        f"Perspective: {answers['perspective']}",
    ]

    prompt = {
        "subject": subject_desc,
        "style": "photorealistic",
        "mood": "dynamic and energetic",
        "lighting": "dramatic",
        "camera": perspective_camera.get(answers["perspective"], "medium"),
        "background": answers.get("environment") or "contextual environment",
        "action": answers["action"],
        "speed": answers["speed"],
        "blur": answers["blur"],
        "perspective": answers["perspective"],
        "details": ". ".join(details_parts),
    }

    return {k: v for k, v in prompt.items() if v is not None}
