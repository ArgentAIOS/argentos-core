from __future__ import annotations


def questions() -> dict:
    """Run the cinematic scene preset questionnaire."""
    from InquirerPy import inquirer

    location = inquirer.text(
        message="Location (e.g., mountain valley, neon-lit alley, space station):",
        validate=lambda x: len(x.strip()) > 0,
        invalid_message="Location is required",
    ).execute()

    time_of_day = inquirer.select(
        message="Time of day:",
        choices=[
            "dawn",
            "morning",
            "midday",
            "golden hour",
            "sunset",
            "blue hour",
            "night",
            "midnight",
        ],
        default="golden hour",
    ).execute()

    weather = inquirer.select(
        message="Weather/atmosphere:",
        choices=[
            "clear skies",
            "overcast",
            "foggy/misty",
            "rainy",
            "snowy",
            "stormy",
            "dusty/hazy",
            "aurora/northern lights",
        ],
        default="clear skies",
    ).execute()

    mood = inquirer.select(
        message="Mood:",
        choices=[
            "epic/grandiose",
            "peaceful/serene",
            "mysterious/eerie",
            "romantic",
            "desolate/lonely",
            "chaotic/intense",
            "magical/fantastical",
            "melancholic",
        ],
        default="epic/grandiose",
    ).execute()

    subjects = inquirer.text(
        message="Subjects in the scene (people, animals, vehicles — or 'none'):",
        default="none",
    ).execute()

    camera = inquirer.select(
        message="Camera perspective:",
        choices=[
            "wide establishing shot",
            "aerial/drone",
            "eye-level medium",
            "low angle dramatic",
            "dutch angle tension",
            "over-the-shoulder",
        ],
        default="wide establishing shot",
    ).execute()

    return {
        "location": location.strip(),
        "time_of_day": time_of_day,
        "weather": weather,
        "mood": mood,
        "subjects": subjects.strip(),
        "camera": camera,
    }


def build(answers: dict) -> dict:
    """Build a structured prompt from scene answers."""
    camera_map = {
        "wide establishing shot": "wide",
        "aerial/drone": "overhead",
        "eye-level medium": "medium",
        "low angle dramatic": "low-angle",
        "dutch angle tension": "dutch-angle",
        "over-the-shoulder": "medium",
    }

    time_lighting = {
        "dawn": "golden-hour",
        "morning": "natural",
        "midday": "natural",
        "golden hour": "golden-hour",
        "sunset": "golden-hour",
        "blue hour": "blue-hour",
        "night": "dramatic",
        "midnight": "dramatic",
    }

    subject = f"Cinematic scene of {answers['location']}"
    if answers["subjects"] and answers["subjects"].lower() != "none":
        subject += f" with {answers['subjects']}"

    prompt = {
        "subject": subject,
        "style": "photorealistic",
        "mood": answers["mood"],
        "lighting": time_lighting.get(answers["time_of_day"], "natural"),
        "camera": camera_map.get(answers["camera"], "wide"),
        "background": f"{answers['location']}, {answers['weather']}, {answers['time_of_day']}",
        "location": answers["location"],
        "time_of_day": answers["time_of_day"],
        "weather": answers["weather"],
        "subjects": answers["subjects"] if answers["subjects"].lower() != "none" else None,
        "details": f"{answers['weather']} weather, {answers['time_of_day']} lighting",
        "suggested_aspect": "21:9",
    }

    return {k: v for k, v in prompt.items() if v is not None}
