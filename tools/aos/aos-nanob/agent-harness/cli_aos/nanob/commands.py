from __future__ import annotations

import hashlib
import json
import os
from datetime import datetime, timezone
from pathlib import Path

import click

from .constants import ASPECT_RATIOS, OUTPUT_DIR, PROMPTS_DIR, SIZE_MAP
from .errors import CliError
from .permissions import require_mode


def _output_path(prefix: str = "nanob") -> Path:
    """Generate a unique output path with timestamp and hash."""
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    now = datetime.now(timezone.utc)
    ts = now.strftime("%Y%m%d_%H%M%S")
    h = hashlib.sha256(f"{ts}{os.getpid()}{id(now)}".encode()).hexdigest()[:8]
    return OUTPUT_DIR / f"{prefix}_{ts}_{h}.png"


def _save_image(image_bytes: bytes, output: str | None = None) -> str:
    """Save image bytes to disk and return the path."""
    if output:
        path = Path(output)
        path.parent.mkdir(parents=True, exist_ok=True)
    else:
        path = _output_path()
    path.write_bytes(image_bytes)
    return str(path)


@click.command("health")
@click.pass_context
def health(ctx: click.Context) -> None:
    """Check GEMINI_API_KEY and API connectivity."""
    from .gemini_client import check_health

    result = check_health()
    ctx.obj["_result"] = result
    ctx.obj["_command_id"] = "health"


@click.command("capabilities")
@click.pass_context
def capabilities(ctx: click.Context) -> None:
    """List all commands and required modes."""
    from .permissions import load_manifest

    manifest = load_manifest()
    permissions = manifest.get("permissions", {})
    ctx.obj["_result"] = {
        "tool": "aos-nanob",
        "version": ctx.obj["version"],
        "manifest_schema_version": "1.0.0",
        "modes": ["readonly", "write", "full", "admin"],
        "commands": [
            {
                "id": cmd,
                "required_mode": required,
                "supports_json": True,
            }
            for cmd, required in sorted(permissions.items())
        ],
    }
    ctx.obj["_command_id"] = "capabilities"


@click.command("models")
@click.pass_context
def models(ctx: click.Context) -> None:
    """List available Gemini image models."""
    require_mode(ctx.obj["mode"], "models")
    from .gemini_client import list_models

    result = list_models()
    ctx.obj["_result"] = {"models": result, "count": len(result)}
    ctx.obj["_command_id"] = "models"


@click.command("generate")
@click.argument("prompt")
@click.option("--aspect", type=click.Choice(ASPECT_RATIOS), default="1:1", show_default=True, help="Aspect ratio")
@click.option("--size", type=click.Choice(["1K", "2K", "4K"]), default="1K", show_default=True, help="Resolution preset")
@click.option("--model", "model_choice", type=click.Choice(["flash", "pro"]), default="flash", show_default=True, help="Model selection")
@click.option("--seed", type=int, default=None, help="Seed for reproducibility")
@click.option("--output", "output_path", default=None, help="Output file path")
@click.option("--save-prompt", "save_prompt_flag", is_flag=True, help="Save prompt JSON alongside image")
@click.option("--negative", default=None, help="Negative prompt text")
@click.option("--number-of-images", type=click.IntRange(1, 4), default=1, show_default=True, help="Number of images")
@click.option("--session", default=None, help="Session name to track this generation")
@click.pass_context
def generate(
    ctx: click.Context,
    prompt: str,
    aspect: str,
    size: str,
    model_choice: str,
    seed: int | None,
    output_path: str | None,
    save_prompt_flag: bool,
    negative: str | None,
    number_of_images: int,
    session: str | None,
) -> None:
    """Generate images from a text prompt."""
    require_mode(ctx.obj["mode"], "generate")

    from .gemini_client import generate_flash, generate_pro

    verbose = ctx.obj.get("verbose", False)
    as_json = ctx.obj.get("json", False)

    # Resolve pixel dimensions
    dimensions = SIZE_MAP.get(aspect, SIZE_MAP["1:1"]).get(size, (1024, 1024))

    if not as_json:
        try:
            from rich.console import Console
            from rich.status import Status
            console = Console(stderr=True)
            status = console.status(f"Generating with {model_choice} model...")
            status.start()
        except ImportError:
            status = None
    else:
        status = None

    try:
        if model_choice == "flash":
            results = generate_flash(
                prompt=prompt,
                aspect_ratio=aspect,
                negative=negative,
                seed=seed,
                number_of_images=number_of_images,
            )
        else:
            results = generate_pro(
                prompt=prompt,
                aspect_ratio=aspect,
                negative=negative,
                seed=seed,
                number_of_images=number_of_images,
            )
    finally:
        if status:
            status.stop()

    # Save images
    saved_paths: list[str] = []
    for i, result in enumerate(results):
        if output_path and len(results) == 1:
            path = _save_image(result["image_bytes"], output_path)
        elif output_path and len(results) > 1:
            base = Path(output_path)
            p = base.parent / f"{base.stem}_{i}{base.suffix}"
            path = _save_image(result["image_bytes"], str(p))
        else:
            path = _save_image(result["image_bytes"])
        saved_paths.append(path)

        if verbose and not as_json:
            try:
                from rich.console import Console
                Console(stderr=True).print(f"  Saved: {path}")
            except ImportError:
                pass

    # Save prompt JSON alongside if requested
    prompt_paths: list[str] = []
    if save_prompt_flag:
        prompt_data = {
            "prompt": prompt,
            "model": model_choice,
            "aspect": aspect,
            "size": size,
            "dimensions": {"width": dimensions[0], "height": dimensions[1]},
            "seed": seed,
            "negative": negative,
            "number_of_images": number_of_images,
        }
        for img_path in saved_paths:
            prompt_file = Path(img_path).with_suffix(".json")
            prompt_file.write_text(json.dumps(prompt_data, indent=2))
            prompt_paths.append(str(prompt_file))

    # Track in session if specified
    if session:
        from . import sessions
        for path in saved_paths:
            sessions.add_image(session, path, prompt)

    ctx.obj["_result"] = {
        "images": saved_paths,
        "count": len(saved_paths),
        "model": results[0]["model"] if results else model_choice,
        "aspect": aspect,
        "size": size,
        "dimensions": {"width": dimensions[0], "height": dimensions[1]},
        "prompt": prompt,
        "seed": seed,
        "text_responses": [r.get("text") for r in results if r.get("text")],
        "prompt_files": prompt_paths if save_prompt_flag else [],
        "session": session,
    }
    ctx.obj["_command_id"] = "generate"


@click.command("edit")
@click.argument("image_path", type=click.Path(exists=True))
@click.argument("instruction")
@click.option("--aspect", type=click.Choice(ASPECT_RATIOS), default="1:1", show_default=True)
@click.option("--seed", type=int, default=None)
@click.option("--output", "output_path", default=None, help="Output file path")
@click.option("--session", default=None, help="Session name to track this edit")
@click.pass_context
def edit(
    ctx: click.Context,
    image_path: str,
    instruction: str,
    aspect: str,
    seed: int | None,
    output_path: str | None,
    session: str | None,
) -> None:
    """Edit an existing image with an instruction."""
    require_mode(ctx.obj["mode"], "edit")

    from .gemini_client import edit_image

    as_json = ctx.obj.get("json", False)

    if not as_json:
        try:
            from rich.console import Console
            status = Console(stderr=True).status("Editing image...")
            status.start()
        except ImportError:
            status = None
    else:
        status = None

    try:
        results = edit_image(
            image_path=image_path,
            instruction=instruction,
            aspect_ratio=aspect,
            seed=seed,
        )
    finally:
        if status:
            status.stop()

    saved_path = _save_image(results[0]["image_bytes"], output_path)

    if session:
        from . import sessions
        sessions.add_image(session, saved_path, f"edit: {instruction}")
        sessions.add_reference(session, str(Path(image_path).resolve()))

    ctx.obj["_result"] = {
        "image": saved_path,
        "source": str(Path(image_path).resolve()),
        "instruction": instruction,
        "model": results[0]["model"],
        "text_response": results[0].get("text"),
        "session": session,
    }
    ctx.obj["_command_id"] = "edit"


@click.command("prompt")
@click.option("--type", "preset_type", default=None, help="Preset type: influencer, product, thumbnail, scene, motion")
@click.option("--save", "save_name", default=None, help="Save prompt to file with this name")
@click.option("--flatten", "do_flatten", is_flag=True, help="Output the flattened natural language prompt")
@click.pass_context
def prompt_cmd(ctx: click.Context, preset_type: str | None, save_name: str | None, do_flatten: bool) -> None:
    """Interactive prompt builder. Use --type for preset questionnaires."""
    require_mode(ctx.obj["mode"], "prompt")

    from .prompt_builder import flatten, interactive_preset, interactive_prompt, save_prompt

    if preset_type:
        prompt_data = interactive_preset(preset_type)
    else:
        prompt_data = interactive_prompt()

    flat = flatten(prompt_data)

    saved_path = None
    if save_name:
        saved_path = str(save_prompt(prompt_data, save_name))

    ctx.obj["_result"] = {
        "prompt": prompt_data,
        "flattened": flat,
        "saved_to": saved_path,
        "preset": preset_type,
    }
    ctx.obj["_command_id"] = "prompt"


@click.command("batch")
@click.argument("prompts_dir", type=click.Path(exists=True))
@click.option("--model", "model_choice", type=click.Choice(["flash", "pro"]), default="flash", show_default=True)
@click.option("--aspect", type=click.Choice(ASPECT_RATIOS), default="1:1", show_default=True)
@click.option("--size", type=click.Choice(["1K", "2K", "4K"]), default="1K", show_default=True)
@click.option("--session", default=None, help="Session name to track batch")
@click.pass_context
def batch(
    ctx: click.Context,
    prompts_dir: str,
    model_choice: str,
    aspect: str,
    size: str,
    session: str | None,
) -> None:
    """Batch generate from a directory of JSON prompt files."""
    require_mode(ctx.obj["mode"], "batch")

    from .gemini_client import generate_flash, generate_pro
    from .prompt_builder import flatten, load_prompt

    as_json = ctx.obj.get("json", False)

    prompt_dir = Path(prompts_dir)
    json_files = sorted(prompt_dir.glob("*.json"))

    if not json_files:
        raise CliError(
            code="NO_PROMPTS",
            message=f"No JSON files found in {prompts_dir}",
            exit_code=1,
            details={"directory": prompts_dir},
        )

    if not as_json:
        try:
            from rich.console import Console
            console = Console(stderr=True)
            console.print(f"Found {len(json_files)} prompt files")
        except ImportError:
            pass

    generated: list[dict] = []
    errors: list[dict] = []
    dimensions = SIZE_MAP.get(aspect, SIZE_MAP["1:1"]).get(size, (1024, 1024))

    for i, json_file in enumerate(json_files):
        if not as_json:
            try:
                from rich.console import Console
                Console(stderr=True).print(f"  [{i+1}/{len(json_files)}] {json_file.name}")
            except ImportError:
                pass

        try:
            prompt_data = load_prompt(json_file)
            flat_prompt = flatten(prompt_data)
            negative = prompt_data.get("negative")
            seed = prompt_data.get("seed")
            num_images = prompt_data.get("number_of_images", 1)
            file_aspect = prompt_data.get("suggested_aspect", aspect)
            if file_aspect not in ASPECT_RATIOS:
                file_aspect = aspect

            if model_choice == "flash":
                results = generate_flash(
                    prompt=flat_prompt,
                    aspect_ratio=file_aspect,
                    negative=negative,
                    seed=seed,
                    number_of_images=num_images,
                )
            else:
                results = generate_pro(
                    prompt=flat_prompt,
                    aspect_ratio=file_aspect,
                    negative=negative,
                    seed=seed,
                    number_of_images=num_images,
                )

            saved_paths = []
            for result in results:
                path = _save_image(result["image_bytes"])
                saved_paths.append(path)

                if session:
                    from . import sessions
                    sessions.add_image(session, path, flat_prompt)

            generated.append({
                "source": str(json_file),
                "images": saved_paths,
                "prompt": flat_prompt,
                "model": results[0]["model"],
            })

        except (CliError, Exception) as exc:
            errors.append({
                "source": str(json_file),
                "error": str(exc),
            })

    ctx.obj["_result"] = {
        "total_prompts": len(json_files),
        "generated": len(generated),
        "errors": len(errors),
        "results": generated,
        "error_details": errors,
        "model": model_choice,
        "aspect": aspect,
        "size": size,
        "dimensions": {"width": dimensions[0], "height": dimensions[1]},
        "session": session,
    }
    ctx.obj["_command_id"] = "batch"


@click.group("sessions")
def sessions_group() -> None:
    """Manage generation sessions."""
    pass


@sessions_group.command("list")
@click.pass_context
def sessions_list(ctx: click.Context) -> None:
    """List all active sessions."""
    require_mode(ctx.obj["mode"], "sessions.list")
    from . import sessions

    result = sessions.list_sessions()
    ctx.obj["_result"] = {"sessions": result, "count": len(result)}
    ctx.obj["_command_id"] = "sessions.list"


@sessions_group.command("create")
@click.argument("name")
@click.pass_context
def sessions_create(ctx: click.Context, name: str) -> None:
    """Create a new session."""
    require_mode(ctx.obj["mode"], "sessions.create")
    from . import sessions

    session = sessions.create(name)
    ctx.obj["_result"] = session
    ctx.obj["_command_id"] = "sessions.create"


@sessions_group.command("show")
@click.argument("name")
@click.pass_context
def sessions_show(ctx: click.Context, name: str) -> None:
    """Show details of a session."""
    require_mode(ctx.obj["mode"], "sessions.show")
    from . import sessions

    session = sessions.get(name)
    ctx.obj["_result"] = session
    ctx.obj["_command_id"] = "sessions.show"


def register(cli: click.Group) -> None:
    """Register all commands with the CLI group."""
    cli.add_command(health)
    cli.add_command(capabilities)
    cli.add_command(models)
    cli.add_command(generate)
    cli.add_command(edit)
    cli.add_command(prompt_cmd, "prompt")
    cli.add_command(batch)
    cli.add_command(sessions_group)
