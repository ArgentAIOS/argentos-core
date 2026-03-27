from __future__ import annotations

import json
import time
from pathlib import Path

import click

from . import __version__
from .config import config_snapshot
from .constants import MODE_ORDER, PERMISSIONS_PATH
from .errors import CliError
from .output import emit, failure, success
from .runtime import (
    audio_isolate_result,
    capabilities_snapshot,
    doctor_snapshot,
    health_snapshot,
    history_download_result,
    history_list_result,
    model_list_result,
    sfx_generate_result,
    tts_generate_result,
    tts_stream_result,
    user_read_result,
    voice_clone_result,
    voice_get_result,
    voice_list_result,
)


def _mode_allows(actual: str, required: str) -> bool:
    return MODE_ORDER.index(actual) >= MODE_ORDER.index(required)


def _load_permissions() -> dict[str, str]:
    payload = json.loads(PERMISSIONS_PATH.read_text())
    return payload.get("permissions", {})


def require_mode(ctx: click.Context, command_id: str) -> None:
    required = _load_permissions().get(command_id, "admin")
    mode = ctx.obj["mode"]
    if _mode_allows(mode, required):
        return
    raise CliError(
        code="PERMISSION_DENIED",
        message=f"Command requires mode={required}",
        exit_code=3,
        details={"required_mode": required, "actual_mode": mode},
    )


class AosGroup(click.Group):
    def invoke(self, ctx: click.Context):
        try:
            return super().invoke(ctx)
        except CliError as err:
            emit(
                failure(
                    command=ctx.obj.get("_command_id", "unknown") if ctx.obj else "unknown",
                    mode=ctx.obj.get("mode", "unknown") if ctx.obj else "unknown",
                    started=ctx.obj.get("started", time.time()) if ctx.obj else time.time(),
                    error={"code": err.code, "message": err.message, "details": err.details},
                ),
                as_json=ctx.obj.get("json", True) if ctx.obj else True,
            )
            ctx.exit(err.exit_code)
        except click.ClickException as err:
            emit(
                failure(
                    command=ctx.obj.get("_command_id", "unknown") if ctx.obj else "unknown",
                    mode=ctx.obj.get("mode", "unknown") if ctx.obj else "unknown",
                    started=ctx.obj.get("started", time.time()) if ctx.obj else time.time(),
                    error={"code": "INVALID_USAGE", "message": str(err), "details": {}},
                ),
                as_json=ctx.obj.get("json", True) if ctx.obj else True,
            )
            ctx.exit(2)


def _set_command(ctx: click.Context, command_id: str) -> None:
    ctx.obj["_command_id"] = command_id


def _emit_success(ctx: click.Context, command_id: str, data: dict) -> None:
    emit(
        success(command=command_id, mode=ctx.obj["mode"], started=ctx.obj["started"], data=data),
        as_json=ctx.obj["json"],
    )


@click.group(cls=AosGroup)
@click.option("--json", "as_json", is_flag=True, help="Emit JSON output")
@click.option("--mode", type=click.Choice(MODE_ORDER), default="readonly", show_default=True)
@click.option("--verbose", is_flag=True, help="Verbose diagnostics")
@click.version_option(__version__)
@click.pass_context
def cli(ctx: click.Context, as_json: bool, mode: str, verbose: bool) -> None:
    ctx.ensure_object(dict)
    ctx.obj.update(
        {
            "json": as_json,
            "mode": mode,
            "verbose": verbose,
            "started": time.time(),
            "version": __version__,
            "_command_id": "unknown",
        }
    )


# ---------------------------------------------------------------------------
# Meta commands
# ---------------------------------------------------------------------------

@cli.command("capabilities")
@click.pass_context
def capabilities(ctx: click.Context) -> None:
    _set_command(ctx, "capabilities")
    require_mode(ctx, "capabilities")
    _emit_success(ctx, "capabilities", capabilities_snapshot())


@cli.group("config")
def config_group() -> None:
    pass


@config_group.command("show")
@click.pass_context
def config_show(ctx: click.Context) -> None:
    _set_command(ctx, "config.show")
    require_mode(ctx, "config.show")
    _emit_success(ctx, "config.show", config_snapshot(ctx.obj))


@cli.command("health")
@click.pass_context
def health(ctx: click.Context) -> None:
    _set_command(ctx, "health")
    require_mode(ctx, "health")
    _emit_success(ctx, "health", health_snapshot(ctx.obj))


@cli.command("doctor")
@click.pass_context
def doctor(ctx: click.Context) -> None:
    _set_command(ctx, "doctor")
    require_mode(ctx, "doctor")
    _emit_success(ctx, "doctor", doctor_snapshot(ctx.obj))


# ---------------------------------------------------------------------------
# voices.*
# ---------------------------------------------------------------------------

@cli.group("voices")
def voices_group() -> None:
    pass


@voices_group.command("list")
@click.option("--page-size", default=10, show_default=True, type=int)
@click.option("--cursor", default=None, help="Page cursor returned from the previous request")
@click.option("--search", default=None, help="Optional voice search term")
@click.pass_context
def voices_list(ctx: click.Context, page_size: int, cursor: str | None, search: str | None) -> None:
    _set_command(ctx, "voices.list")
    require_mode(ctx, "voices.list")
    _emit_success(ctx, "voices.list", voice_list_result(ctx.obj, page_size=page_size, cursor=cursor, search=search))


@voices_group.command("get")
@click.argument("voice_id", required=False)
@click.pass_context
def voices_get(ctx: click.Context, voice_id: str | None) -> None:
    _set_command(ctx, "voices.get")
    require_mode(ctx, "voices.get")
    _emit_success(ctx, "voices.get", voice_get_result(ctx.obj, voice_id))


@voices_group.command("clone")
@click.option("--name", required=True, help="Name for the cloned voice")
@click.option("--description", default=None, help="Optional description for the cloned voice")
@click.option("--file", "files", multiple=True, required=True, help="Audio sample file(s) for cloning (repeat for multiple)")
@click.pass_context
def voices_clone(ctx: click.Context, name: str, description: str | None, files: tuple[str, ...]) -> None:
    _set_command(ctx, "voices.clone")
    require_mode(ctx, "voices.clone")
    _emit_success(ctx, "voices.clone", voice_clone_result(ctx.obj, name=name, description=description, files=list(files)))


# ---------------------------------------------------------------------------
# model.*
# ---------------------------------------------------------------------------

@cli.group("model")
def model_group() -> None:
    pass


@model_group.command("list")
@click.pass_context
def model_list(ctx: click.Context) -> None:
    _set_command(ctx, "model.list")
    require_mode(ctx, "model.list")
    _emit_success(ctx, "model.list", model_list_result(ctx.obj))


# ---------------------------------------------------------------------------
# history.*
# ---------------------------------------------------------------------------

@cli.group("history")
def history_group() -> None:
    pass


@history_group.command("list")
@click.option("--page-size", default=100, show_default=True, type=int)
@click.option("--cursor", default=None, help="History cursor to continue from")
@click.option("--voice-id", default=None, help="Optional voice filter")
@click.option("--model-id", default=None, help="Optional model filter")
@click.pass_context
def history_list(
    ctx: click.Context,
    page_size: int,
    cursor: str | None,
    voice_id: str | None,
    model_id: str | None,
) -> None:
    _set_command(ctx, "history.list")
    require_mode(ctx, "history.list")
    _emit_success(
        ctx,
        "history.list",
        history_list_result(ctx.obj, page_size=page_size, cursor=cursor, voice_id=voice_id, model_id=model_id),
    )


@history_group.command("download")
@click.argument("history_item_id", required=False)
@click.option(
    "--output",
    "output_path",
    default=None,
    type=click.Path(dir_okay=False, path_type=Path),
    help="Write the downloaded audio to a file",
)
@click.pass_context
def history_download(ctx: click.Context, history_item_id: str | None, output_path) -> None:
    _set_command(ctx, "history.download")
    require_mode(ctx, "history.download")
    _emit_success(ctx, "history.download", history_download_result(ctx.obj, history_item_id, output_path=output_path))


# ---------------------------------------------------------------------------
# user.*
# ---------------------------------------------------------------------------

@cli.group("user")
def user_group() -> None:
    pass


@user_group.command("read")
@click.pass_context
def user_read(ctx: click.Context) -> None:
    _set_command(ctx, "user.read")
    require_mode(ctx, "user.read")
    _emit_success(ctx, "user.read", user_read_result(ctx.obj))


# ---------------------------------------------------------------------------
# tts.*
# ---------------------------------------------------------------------------

@cli.group("tts")
def tts_group() -> None:
    pass


def _tts_common_options(fn):
    """Shared options for TTS generate and stream commands."""
    fn = click.option("--voice-id", default=None, help="Optional voice ID override")(fn)
    fn = click.option("--model-id", default=None, help="Optional model ID override")(fn)
    fn = click.option(
        "--output-format",
        default="mp3_44100_128",
        show_default=True,
        help="ElevenLabs output format",
    )(fn)
    fn = click.option(
        "--output",
        "output_path",
        default=None,
        type=click.Path(dir_okay=False, path_type=Path),
        help="Write the generated audio to a file",
    )(fn)
    fn = click.option("--stability", default=None, type=float, help="Stability (0.0-1.0)")(fn)
    fn = click.option("--similarity-boost", default=None, type=float, help="Similarity boost (0.0-1.0)")(fn)
    fn = click.option("--style", default=None, type=float, help="Style exaggeration (0.0-1.0)")(fn)
    return fn


@tts_group.command("generate")
@click.argument("text")
@_tts_common_options
@click.pass_context
def tts_generate(
    ctx: click.Context,
    text: str,
    voice_id: str | None,
    model_id: str | None,
    output_format: str,
    output_path,
    stability: float | None,
    similarity_boost: float | None,
    style: float | None,
) -> None:
    _set_command(ctx, "tts.generate")
    require_mode(ctx, "tts.generate")
    _emit_success(
        ctx,
        "tts.generate",
        tts_generate_result(
            ctx.obj,
            text=text,
            voice_id=voice_id,
            model_id=model_id,
            output_format=output_format,
            output_path=output_path,
            stability=stability,
            similarity_boost=similarity_boost,
            style=style,
        ),
    )


@tts_group.command("stream")
@click.argument("text")
@_tts_common_options
@click.pass_context
def tts_stream(
    ctx: click.Context,
    text: str,
    voice_id: str | None,
    model_id: str | None,
    output_format: str,
    output_path,
    stability: float | None,
    similarity_boost: float | None,
    style: float | None,
) -> None:
    _set_command(ctx, "tts.stream")
    require_mode(ctx, "tts.stream")
    _emit_success(
        ctx,
        "tts.stream",
        tts_stream_result(
            ctx.obj,
            text=text,
            voice_id=voice_id,
            model_id=model_id,
            output_format=output_format,
            output_path=output_path,
            stability=stability,
            similarity_boost=similarity_boost,
            style=style,
        ),
    )


# ---------------------------------------------------------------------------
# sfx.*
# ---------------------------------------------------------------------------

@cli.group("sfx")
def sfx_group() -> None:
    pass


@sfx_group.command("generate")
@click.argument("prompt")
@click.option("--duration", "duration_seconds", default=None, type=float, help="Duration in seconds (optional)")
@click.option("--prompt-influence", default=None, type=float, help="Prompt influence (0.0-1.0)")
@click.option(
    "--output",
    "output_path",
    default=None,
    type=click.Path(dir_okay=False, path_type=Path),
    help="Write the generated audio to a file",
)
@click.pass_context
def sfx_generate(
    ctx: click.Context,
    prompt: str,
    duration_seconds: float | None,
    prompt_influence: float | None,
    output_path,
) -> None:
    _set_command(ctx, "sfx.generate")
    require_mode(ctx, "sfx.generate")
    _emit_success(
        ctx,
        "sfx.generate",
        sfx_generate_result(
            ctx.obj,
            prompt=prompt,
            duration_seconds=duration_seconds,
            prompt_influence=prompt_influence,
            output_path=output_path,
        ),
    )


# ---------------------------------------------------------------------------
# audio.*
# ---------------------------------------------------------------------------

@cli.group("audio")
def audio_group() -> None:
    pass


@audio_group.command("isolate")
@click.argument("input_path")
@click.option(
    "--output",
    "output_path",
    default=None,
    type=click.Path(dir_okay=False, path_type=Path),
    help="Write the isolated audio to a file (otherwise returns inline base64)",
)
@click.pass_context
def audio_isolate(ctx: click.Context, input_path: str, output_path) -> None:
    _set_command(ctx, "audio.isolate")
    require_mode(ctx, "audio.isolate")
    _emit_success(
        ctx,
        "audio.isolate",
        audio_isolate_result(ctx.obj, input_path=input_path, output_path=output_path),
    )
