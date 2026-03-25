"""Tests for prompt builder interactive questionnaire."""
from __future__ import annotations

import json
from unittest.mock import patch, MagicMock

import pytest

from cli_aos.nanob.prompt_builder import flatten, save_prompt, load_prompt


class TestFlatten:
    def test_basic_subject(self):
        result = flatten({"subject": "a golden retriever", "style": "photorealistic"})
        assert "golden retriever" in result
        assert "photorealistic" in result

    def test_non_default_style(self):
        result = flatten({"subject": "a castle", "style": "watercolor"})
        assert "watercolor" in result
        assert "castle" in result

    def test_all_fields(self):
        prompt = {
            "subject": "a woman reading",
            "style": "oil-painting",
            "mood": "serene",
            "lighting": "golden-hour",
            "camera": "close-up",
            "background": "a garden",
            "details": "wearing a red hat",
        }
        result = flatten(prompt)
        assert "oil-painting" in result
        assert "woman reading" in result
        assert "serene" in result
        assert "golden-hour" in result
        assert "close-up" in result
        assert "garden" in result
        assert "red hat" in result

    def test_default_style_produces_photorealistic(self):
        result = flatten({"subject": "a car"})
        assert "photorealistic" in result

    def test_camera_medium_omitted(self):
        result = flatten({"subject": "a dog", "camera": "medium"})
        # medium is the default and should not appear
        assert "medium" not in result.lower() or "medium" in "a dog"

    def test_natural_lighting_omitted(self):
        result = flatten({"subject": "a tree", "lighting": "natural"})
        # natural is default and should be omitted
        parts = result.split(".")
        assert not any("natural lighting" in p for p in parts)

    def test_preset_fields_included(self):
        prompt = {
            "subject": "a runner",
            "action": "sprinting",
            "speed": "fast",
        }
        result = flatten(prompt)
        assert "sprinting" in result
        assert "fast" in result


class TestSaveLoad:
    def test_save_and_load(self, tmp_path):
        prompt_data = {"subject": "test", "style": "anime"}
        with patch("cli_aos.nanob.prompt_builder.PROMPTS_DIR", tmp_path):
            path = save_prompt(prompt_data, "my_prompt")
            assert path.exists()
            loaded = load_prompt(path)
            assert loaded["subject"] == "test"
            assert loaded["style"] == "anime"

    def test_load_missing_file(self):
        with pytest.raises(Exception) as exc_info:
            load_prompt("/nonexistent/path.json")
        assert "not found" in str(exc_info.value).lower()
