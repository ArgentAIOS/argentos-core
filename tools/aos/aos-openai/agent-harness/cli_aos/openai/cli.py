from __future__ import annotations

import json
import time

import click

from . import __version__
from .constants import MODE_ORDER, PERMISSIONS_PATH
from .errors import CliError
from .output import emit, failure, success
from .runtime import (
    audio_transcribe_result,
    audio_tts_result,
    capabilities_snapshot,
    config_show_result,
    doctor_snapshot,
    embedding_create_result,
    health_snapshot,
    image_edit_result,
    image_generate_result,
    chat_complete_result,
    model_list_result,
    moderation_check_result,
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
    _emit_success(ctx, "config.show", config_show_result(ctx.obj))


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


@cli.group("chat")
def chat_group() -> None:
    pass


@chat_group.command("complete")
@click.option("--model", default=None)
@click.option("--prompt", default=None)
@click.option("--messages-json", default=None)
@click.option("--max-tokens", default=None, type=int)
@click.option("--temperature", default=None, type=float)
@click.pass_context
def chat_complete(
    ctx: click.Context,
    model: str | None,
    prompt: str | None,
    messages_json: str | None,
    max_tokens: int | None,
    temperature: float | None,
) -> None:
    _set_command(ctx, "chat.complete")
    require_mode(ctx, "chat.complete")
    _emit_success(
        ctx,
        "chat.complete",
        chat_complete_result(
            ctx.obj,
            model=model,
            prompt=prompt,
            messages_json=messages_json,
            max_tokens=max_tokens,
            temperature=temperature,
        ),
    )


@cli.group("embedding")
def embedding_group() -> None:
    pass


@embedding_group.command("create")
@click.option("--model", default=None)
@click.option("--prompt", default=None)
@click.pass_context
def embedding_create(ctx: click.Context, model: str | None, prompt: str | None) -> None:
    _set_command(ctx, "embedding.create")
    require_mode(ctx, "embedding.create")
    _emit_success(ctx, "embedding.create", embedding_create_result(ctx.obj, model=model, prompt=prompt))


@cli.group("image")
def image_group() -> None:
    pass


@image_group.command("generate")
@click.option("--model", default=None)
@click.option("--prompt", default=None)
@click.option("--image-prompt", default=None)
@click.option("--image-size", default=None)
@click.pass_context
def image_generate(
    ctx: click.Context,
    model: str | None,
    prompt: str | None,
    image_prompt: str | None,
    image_size: str | None,
) -> None:
    _set_command(ctx, "image.generate")
    require_mode(ctx, "image.generate")
    _emit_success(
        ctx,
        "image.generate",
        image_generate_result(
            ctx.obj,
            model=model,
            prompt=prompt,
            image_prompt=image_prompt,
            image_size=image_size,
        ),
    )


@image_group.command("edit")
@click.option("--model", default=None)
@click.option("--prompt", default=None)
@click.option("--image-prompt", default=None)
@click.option("--image-size", default=None)
@click.option("--image-file", default=None, help="Local image path or URL")
@click.pass_context
def image_edit(
    ctx: click.Context,
    model: str | None,
    prompt: str | None,
    image_prompt: str | None,
    image_size: str | None,
    image_file: str | None,
) -> None:
    _set_command(ctx, "image.edit")
    require_mode(ctx, "image.edit")
    _emit_success(
        ctx,
        "image.edit",
        image_edit_result(
            ctx.obj,
            model=model,
            prompt=prompt,
            image_prompt=image_prompt,
            image_size=image_size,
            image_file=image_file,
        ),
    )


@cli.group("audio")
def audio_group() -> None:
    pass


@audio_group.command("transcribe")
@click.option("--model", default=None)
@click.option("--audio-file", default=None, help="Local audio path or URL")
@click.pass_context
def audio_transcribe(ctx: click.Context, model: str | None, audio_file: str | None) -> None:
    _set_command(ctx, "audio.transcribe")
    require_mode(ctx, "audio.transcribe")
    _emit_success(ctx, "audio.transcribe", audio_transcribe_result(ctx.obj, model=model, audio_file=audio_file))


@audio_group.command("tts")
@click.option("--model", default=None)
@click.option("--prompt", default=None)
@click.option("--voice", default=None)
@click.pass_context
def audio_tts(ctx: click.Context, model: str | None, prompt: str | None, voice: str | None) -> None:
    _set_command(ctx, "audio.tts")
    require_mode(ctx, "audio.tts")
    _emit_success(ctx, "audio.tts", audio_tts_result(ctx.obj, model=model, prompt=prompt, voice=voice))


@cli.group("moderation")
def moderation_group() -> None:
    pass


@moderation_group.command("check")
@click.option("--model", default=None)
@click.option("--prompt", default=None)
@click.pass_context
def moderation_check(ctx: click.Context, model: str | None, prompt: str | None) -> None:
    _set_command(ctx, "moderation.check")
    require_mode(ctx, "moderation.check")
    _emit_success(ctx, "moderation.check", moderation_check_result(ctx.obj, model=model, prompt=prompt))


@cli.group("model")
def model_group() -> None:
    pass


@model_group.command("list")
@click.option("--limit", default=50, show_default=True, type=int)
@click.pass_context
def model_list(ctx: click.Context, limit: int) -> None:
    _set_command(ctx, "model.list")
    require_mode(ctx, "model.list")
    _emit_success(ctx, "model.list", model_list_result(ctx.obj, limit=limit))
