"""Tests for prompt flattener edge cases and preset builds."""
from __future__ import annotations

import pytest

from cli_aos.nanob.prompt_builder import flatten
from cli_aos.nanob.negatives import get_negative, DEFAULTS


class TestFlattenerEdgeCases:
    def test_empty_subject(self):
        result = flatten({"subject": ""})
        assert isinstance(result, str)
        assert "photorealistic" in result

    def test_only_subject(self):
        result = flatten({"subject": "sunset over mountains"})
        assert "sunset over mountains" in result
        assert result.endswith(".")

    def test_multiple_preset_fields(self):
        prompt = {
            "subject": "a product shot",
            "setting": "modern office",
            "lifestyle": "person using laptop",
            "surface": "oak desk",
        }
        result = flatten(prompt)
        assert "modern office" in result
        assert "person using laptop" in result
        assert "oak desk" in result

    def test_result_is_sentence_formatted(self):
        result = flatten({"subject": "a flower", "mood": "peaceful"})
        # Should end with a period
        assert result.endswith(".")
        # Should not have double periods
        assert ".." not in result


class TestNegatives:
    def test_all_styles_have_defaults(self):
        for style in ["photorealistic", "illustration", "3d-render", "anime",
                       "watercolor", "oil-painting", "pixel-art", "sketch"]:
            neg = get_negative(style)
            assert isinstance(neg, str)
            assert len(neg) > 0

    def test_user_negative_appended(self):
        result = get_negative("photorealistic", "ugly hands")
        assert "ugly hands" in result
        assert "blurry" in result  # base should still be there

    def test_unknown_style_falls_back(self):
        result = get_negative("unknown-style")
        assert result == DEFAULTS["photorealistic"]

    def test_no_user_negative(self):
        result = get_negative("anime")
        assert result == DEFAULTS["anime"]


class TestPresetBuilds:
    def test_influencer_build(self):
        from cli_aos.nanob.presets.influencer import build
        answers = {
            "person": "young woman smiling",
            "setting": "coffee shop",
            "aesthetic": "warm vintage",
            "platform": "Instagram feed (1:1)",
            "outfit": "denim jacket",
            "props": "coffee cup",
        }
        result = build(answers)
        assert "young woman smiling" in result["subject"]
        assert "denim jacket" in result["subject"]
        assert result["suggested_aspect"] == "1:1"

    def test_product_build(self):
        from cli_aos.nanob.presets.product import build
        answers = {
            "item": "wireless earbuds",
            "surface": "marble",
            "lighting": "studio softbox",
            "angle": "45 degree",
            "lifestyle": None,
            "color_scheme": "white and silver",
        }
        result = build(answers)
        assert "wireless earbuds" in result["subject"]
        assert result["background"] == "marble"
        assert "white and silver" in result["details"]

    def test_thumbnail_build(self):
        from cli_aos.nanob.presets.thumbnail import build
        answers = {
            "topic": "AI coding tools",
            "emotion": "excited/amazed",
            "text_overlay": "TOP 5",
            "style": "bold graphic (text-heavy, colorful)",
            "colors": "red and yellow (high energy)",
        }
        result = build(answers)
        assert "AI coding tools" in result["subject"]
        assert result["suggested_aspect"] == "16:9"
        assert "TOP 5" in result["details"]

    def test_scene_build(self):
        from cli_aos.nanob.presets.scene import build
        answers = {
            "location": "mountain valley",
            "time_of_day": "golden hour",
            "weather": "foggy/misty",
            "mood": "epic/grandiose",
            "subjects": "lone hiker",
            "camera": "wide establishing shot",
        }
        result = build(answers)
        assert "mountain valley" in result["subject"]
        assert "lone hiker" in result["subject"]
        assert result["suggested_aspect"] == "21:9"

    def test_motion_build(self):
        from cli_aos.nanob.presets.motion import build
        answers = {
            "subject": "motorcycle",
            "action": "racing through streets",
            "speed": "heavy motion blur (speed lines)",
            "blur": "panning blur (subject sharp, background streaked)",
            "perspective": "tracking alongside",
            "environment": "Tokyo at night",
        }
        result = build(answers)
        assert "motorcycle" in result["subject"]
        assert "racing" in result["subject"]
        assert result["background"] == "Tokyo at night"
