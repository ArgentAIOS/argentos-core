from __future__ import annotations

import asyncio
import importlib
import json
from pathlib import Path
from typing import Any

from . import __version__
from .config import (
    dataset_name,
    ensure_openai_api_key,
    read_argent_config,
    redacted_config_snapshot,
    vault_path,
)
from .constants import CONNECTOR_PATH, MANIFEST_SCHEMA_VERSION, MODE_ORDER, SEARCH_MODES, TOOL_NAME
from .errors import CliError


def _load_connector_manifest() -> dict[str, Any]:
    return json.loads(CONNECTOR_PATH.read_text())


def _load_cognee() -> tuple[Any | None, str | None]:
    ensure_openai_api_key()
    try:
        return importlib.import_module("cognee"), None
    except Exception as err:
        return None, str(err)


def _search_type(cognee_module: Any, search_mode: str) -> Any:
    search_type = getattr(cognee_module, "SearchType", None)
    if search_type is None:
        try:
            search_type = importlib.import_module("cognee").SearchType
        except Exception:
            return search_mode
    return getattr(search_type, search_mode, search_mode)


def _string_value(value: Any) -> str:
    if isinstance(value, str):
        return value
    if value is None:
        return ""
    if isinstance(value, (int, float, bool)):
        return str(value)
    try:
        return json.dumps(value, sort_keys=True)
    except Exception:
        return str(value)


def _normalize_search_result(entry: Any) -> dict[str, Any] | None:
    if isinstance(entry, dict):
        summary = next(
            (
                _string_value(entry.get(key)).strip()
                for key in ("summary", "text", "content", "answer", "entity", "name")
                if _string_value(entry.get(key)).strip()
            ),
            "",
        )
        if not summary:
            summary = _string_value(entry).strip()
        score_raw = entry.get("score", entry.get("relevance", entry.get("similarity", 0)))
        score = score_raw if isinstance(score_raw, (int, float)) else 0
        hit: dict[str, Any] = {"summary": summary, "score": float(score)}
        source = entry.get("source") or entry.get("dataset") or entry.get("node_set")
        if source:
            hit["source"] = _string_value(source)
        vault = entry.get("vaultPath") or entry.get("vault_path") or entry.get("sourceVaultPath")
        if vault:
            hit["vaultPath"] = _string_value(vault)
        return hit if summary else None
    summary = _string_value(entry).strip()
    return {"summary": summary, "score": 0.0} if summary else None


def _normalize_search_results(raw: Any, limit: int) -> list[dict[str, Any]]:
    payload = raw
    if isinstance(raw, dict):
        for key in ("results", "hits", "data"):
            if isinstance(raw.get(key), list):
                payload = raw[key]
                break
    if not isinstance(payload, list):
        payload = [payload]
    hits: list[dict[str, Any]] = []
    for entry in payload:
        hit = _normalize_search_result(entry)
        if hit:
            hits.append(hit)
        if len(hits) >= limit:
            break
    return hits


def capabilities_snapshot() -> dict:
    manifest = _load_connector_manifest()
    return {
        "tool": TOOL_NAME,
        "version": __version__,
        "manifest_schema_version": MANIFEST_SCHEMA_VERSION,
        "backend": "cognee",
        "modes": list(MODE_ORDER),
        "connector": manifest.get("connector", {}),
        "auth": manifest.get("auth", {}),
        "commands": manifest.get("commands", []),
        "search_modes": list(SEARCH_MODES),
    }


def health_snapshot(ctx_obj: dict | None = None) -> dict:
    cfg = read_argent_config()
    snapshot = redacted_config_snapshot(ctx_obj)
    cognee_module, error = _load_cognee()
    dependency_ok = cognee_module is not None
    vault_exists = Path(snapshot["vault_path"]).is_dir()
    return {
        "status": "healthy" if dependency_ok else "needs-setup",
        "dependency": {
            "cognee_importable": dependency_ok,
            "error": error,
        },
        "vault": {
            "path": snapshot["vault_path"],
            "exists": vault_exists,
        },
        "dataset": dataset_name(cfg, (ctx_obj or {}).get("dataset")),
    }


def doctor_snapshot(ctx_obj: dict | None = None) -> dict:
    health = health_snapshot(ctx_obj)
    checks = [
        {
            "name": "python_cognee_package",
            "ok": health["dependency"]["cognee_importable"],
            "detail": health["dependency"].get("error") or "import ok",
        },
        {
            "name": "argent_vault_path",
            "ok": health["vault"]["exists"],
            "detail": health["vault"]["path"],
        },
    ]
    return {
        "status": "healthy" if all(check["ok"] for check in checks) else "needs-setup",
        "checks": checks,
        "recommended_path": (
            "ready"
            if all(check["ok"] for check in checks)
            else "install with pip install -e '.[dev]' and bind/create the Argent vault"
        ),
        "config": redacted_config_snapshot(ctx_obj),
    }


async def _search_async(query: str, search_mode: str, limit: int, dataset: str | None) -> dict:
    cognee_module, error = _load_cognee()
    if cognee_module is None:
        raise CliError(
            code="DEPENDENCY_MISSING",
            message="Python package 'cognee' is not installed in this harness environment.",
            exit_code=5,
            details={"import_error": error},
        )
    query_type = _search_type(cognee_module, search_mode)
    attempts = [
        lambda: cognee_module.search(query_text=query, query_type=query_type, top_k=limit),
        lambda: cognee_module.search(query_text=query, query_type=query_type),
        lambda: cognee_module.search(query, query_type=query_type),
        lambda: cognee_module.search(query),
    ]
    last_error: Exception | None = None
    for attempt in attempts:
        try:
            raw = await attempt()
            return {
                "results": _normalize_search_results(raw, limit),
                "search_mode": search_mode,
                "dataset": dataset,
            }
        except TypeError as err:
            last_error = err
            continue
    raise CliError(
        code="COGNEE_SEARCH_FAILED",
        message=str(last_error) if last_error else "Cognee search failed.",
        exit_code=6,
        details={"search_mode": search_mode},
    )


def search_result(query: str, search_mode: str, limit: int, dataset: str | None) -> dict:
    return asyncio.run(_search_async(query, search_mode, limit, dataset))


def _markdown_files(root: Path, limit: int | None) -> list[Path]:
    files = [
        path
        for path in root.rglob("*")
        if path.is_file()
        and path.suffix.lower() in {".md", ".markdown", ".txt"}
        and ".obsidian" not in path.parts
    ]
    files.sort()
    return files[:limit] if limit and limit > 0 else files


async def _add_to_cognee(cognee_module: Any, content: str, dataset: str) -> None:
    attempts = [
        lambda: cognee_module.add(content, node_set=[dataset]),
        lambda: cognee_module.add(data=content, dataset_name=dataset),
        lambda: cognee_module.add(content),
    ]
    last_error: Exception | None = None
    for attempt in attempts:
        try:
            await attempt()
            return
        except TypeError as err:
            last_error = err
            continue
    raise CliError(
        code="COGNEE_ADD_FAILED",
        message=str(last_error) if last_error else "Cognee add failed.",
        exit_code=6,
        details={"dataset": dataset},
    )


async def _ingest_vault_async(path_value: str, dataset: str, limit: int | None) -> dict:
    cognee_module, error = _load_cognee()
    if cognee_module is None:
        raise CliError(
            code="DEPENDENCY_MISSING",
            message="Python package 'cognee' is not installed in this harness environment.",
            exit_code=5,
            details={"import_error": error},
        )
    root = Path(path_value).expanduser()
    if not root.is_dir():
        raise CliError(
            code="VAULT_NOT_FOUND",
            message="Vault path is not a directory.",
            exit_code=4,
            details={"path": str(root)},
        )
    files = _markdown_files(root, limit)
    for file_path in files:
        rel = file_path.relative_to(root)
        content = file_path.read_text(errors="replace")
        await _add_to_cognee(cognee_module, f"Source: {rel}\n\n{content}", dataset)
    return {"path": str(root), "dataset": dataset, "files_added": len(files)}


def ingest_vault_result(path_value: str, dataset: str, limit: int | None) -> dict:
    return asyncio.run(_ingest_vault_async(path_value, dataset, limit))


async def _call_cognee_operation(name: str, dataset: str | None = None) -> dict:
    cognee_module, error = _load_cognee()
    if cognee_module is None:
        raise CliError(
            code="DEPENDENCY_MISSING",
            message="Python package 'cognee' is not installed in this harness environment.",
            exit_code=5,
            details={"import_error": error},
        )
    operation = getattr(cognee_module, name, None)
    if operation is None:
        raise CliError(
            code="OPERATION_UNAVAILABLE",
            message=f"Cognee operation '{name}' is not available.",
            exit_code=6,
            details={},
        )
    attempts = [
        lambda: operation(datasets=[dataset]) if dataset else operation(),
        lambda: operation(dataset_name=dataset) if dataset else operation(),
        lambda: operation(),
    ]
    last_error: Exception | None = None
    for attempt in attempts:
        try:
            raw = await attempt()
            return {"operation": name, "dataset": dataset, "result": _string_value(raw)}
        except TypeError as err:
            last_error = err
            continue
    raise CliError(
        code="COGNEE_OPERATION_FAILED",
        message=str(last_error) if last_error else f"Cognee operation '{name}' failed.",
        exit_code=6,
        details={"operation": name, "dataset": dataset},
    )


def cognify_result(dataset: str | None = None) -> dict:
    return asyncio.run(_call_cognee_operation("cognify", dataset))


def memify_result(dataset: str | None = None) -> dict:
    return asyncio.run(_call_cognee_operation("memify", dataset))


async def _prune_async() -> dict:
    cognee_module, error = _load_cognee()
    if cognee_module is None:
        raise CliError(
            code="DEPENDENCY_MISSING",
            message="Python package 'cognee' is not installed in this harness environment.",
            exit_code=5,
            details={"import_error": error},
        )
    prune = getattr(cognee_module, "prune", None)
    if prune is None:
        raise CliError(
            code="OPERATION_UNAVAILABLE",
            message="Cognee prune module is not available.",
            exit_code=6,
            details={},
        )
    if hasattr(prune, "prune_data"):
        await prune.prune_data()
    if hasattr(prune, "prune_system"):
        await prune.prune_system(metadata=True)
    return {"operation": "prune", "status": "completed"}


def prune_result() -> dict:
    return asyncio.run(_prune_async())
