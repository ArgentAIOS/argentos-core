"""Tests for the generate command and image saving logic."""
from __future__ import annotations

import json
import os
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from click.testing import CliRunner

from cli_aos.nanob.cli import cli


@pytest.fixture
def runner():
    return CliRunner()


@pytest.fixture
def fake_image_bytes():
    # Minimal PNG header (8 bytes) + enough to be a file
    return b"\x89PNG\r\n\x1a\n" + b"\x00" * 100


class TestHealthCommand:
    def test_health_no_api_key(self, runner):
        with patch.dict(os.environ, {}, clear=True):
            # Remove GEMINI_API_KEY if present
            env = {k: v for k, v in os.environ.items() if k != "GEMINI_API_KEY"}
            with patch.dict(os.environ, env, clear=True):
                result = runner.invoke(cli, ["--json", "health"])
                assert result.exit_code == 0
                data = json.loads(result.output)
                assert data["ok"] is True
                assert data["data"]["api_key_set"] is False

    def test_health_json_envelope(self, runner):
        with patch.dict(os.environ, {}, clear=True):
            result = runner.invoke(cli, ["--json", "health"])
            data = json.loads(result.output)
            assert "ok" in data
            assert "tool" in data
            assert data["tool"] == "aos-nanob"
            assert "meta" in data


class TestCapabilitiesCommand:
    def test_capabilities_json(self, runner):
        result = runner.invoke(cli, ["--json", "capabilities"])
        assert result.exit_code == 0
        data = json.loads(result.output)
        assert data["ok"] is True
        assert data["data"]["tool"] == "aos-nanob"
        commands = {c["id"] for c in data["data"]["commands"]}
        assert "generate" in commands
        assert "edit" in commands
        assert "health" in commands
        assert "models" in commands

    def test_capabilities_modes(self, runner):
        result = runner.invoke(cli, ["--json", "capabilities"])
        data = json.loads(result.output)
        assert data["data"]["modes"] == ["readonly", "write", "full", "admin"]


class TestGenerateCommand:
    @patch("cli_aos.nanob.gemini_client.generate_flash")
    def test_generate_flash_saves_image(self, mock_gen, runner, fake_image_bytes, tmp_path):
        mock_gen.return_value = [{
            "image_bytes": fake_image_bytes,
            "text": None,
            "model": "gemini-2.0-flash-preview-image-generation",
            "index": 0,
        }]
        out = str(tmp_path / "test_output.png")
        result = runner.invoke(cli, [
            "--json", "--mode", "write",
            "generate", "a cat", "--output", out,
        ])
        assert result.exit_code == 0
        data = json.loads(result.output)
        assert data["ok"] is True
        assert len(data["data"]["images"]) == 1
        assert Path(out).exists()
        assert Path(out).read_bytes() == fake_image_bytes

    @patch("cli_aos.nanob.gemini_client.generate_pro")
    def test_generate_pro(self, mock_gen, runner, fake_image_bytes, tmp_path):
        mock_gen.return_value = [{
            "image_bytes": fake_image_bytes,
            "text": None,
            "model": "imagen-3.0-generate-002",
            "index": 0,
        }]
        out = str(tmp_path / "pro_output.png")
        result = runner.invoke(cli, [
            "--json", "--mode", "write",
            "generate", "a dog", "--model", "pro", "--output", out,
        ])
        assert result.exit_code == 0
        data = json.loads(result.output)
        assert data["data"]["model"] == "imagen-3.0-generate-002"

    def test_generate_requires_write_mode(self, runner):
        result = runner.invoke(cli, [
            "--json", "--mode", "readonly",
            "generate", "a cat",
        ])
        data = json.loads(result.output)
        assert data["ok"] is False
        assert data["error"]["code"] == "PERMISSION_DENIED"

    @patch("cli_aos.nanob.gemini_client.generate_flash")
    def test_generate_save_prompt(self, mock_gen, runner, fake_image_bytes, tmp_path):
        mock_gen.return_value = [{
            "image_bytes": fake_image_bytes,
            "text": None,
            "model": "gemini-2.0-flash-preview-image-generation",
            "index": 0,
        }]
        out = str(tmp_path / "prompted.png")
        result = runner.invoke(cli, [
            "--json", "--mode", "write",
            "generate", "a landscape", "--output", out, "--save-prompt",
        ])
        assert result.exit_code == 0
        data = json.loads(result.output)
        assert len(data["data"]["prompt_files"]) == 1
        prompt_path = Path(data["data"]["prompt_files"][0])
        assert prompt_path.exists()
        prompt_data = json.loads(prompt_path.read_text())
        assert prompt_data["prompt"] == "a landscape"


class TestEditCommand:
    def test_edit_requires_write_mode(self, runner, tmp_path):
        img = tmp_path / "source.png"
        img.write_bytes(b"\x89PNG\r\n\x1a\n" + b"\x00" * 10)
        result = runner.invoke(cli, [
            "--json", "--mode", "readonly",
            "edit", str(img), "make it blue",
        ])
        data = json.loads(result.output)
        assert data["ok"] is False
        assert data["error"]["code"] == "PERMISSION_DENIED"
