from __future__ import annotations

import json
import shutil
import subprocess
from dataclasses import dataclass
from typing import Any

from .constants import CLI_BINARY


@dataclass(slots=True)
class ClaudeCodeClientError(Exception):
    code: str
    message: str
    details: dict[str, Any] | None = None


class ClaudeCodeClient:
    def __init__(
        self,
        *,
        binary: str = CLI_BINARY,
        project_dir: str | None = None,
        model: str | None = None,
    ) -> None:
        self._binary = binary
        self._project_dir = project_dir
        self._model = model

    def is_available(self) -> bool:
        return shutil.which(self._binary) is not None

    def _base_args(self, *, project_dir: str | None = None, model: str | None = None) -> list[str]:
        args = [self._binary]
        resolved_project_dir = project_dir or self._project_dir
        resolved_model = model or self._model
        if resolved_project_dir:
            args.extend(["--project-dir", resolved_project_dir])
        if resolved_model:
            args.extend(["--model", resolved_model])
        return args

    def _run_json(
        self,
        args: list[str],
        *,
        cwd: str | None = None,
        stdin_text: str | None = None,
    ) -> dict[str, Any]:
        if not self.is_available():
            raise ClaudeCodeClientError(
                code="CLAUDE_CODE_NOT_INSTALLED",
                message="claude CLI is not installed or not on PATH",
                details={"binary": self._binary},
            )
        proc = subprocess.run(
            args,
            input=stdin_text,
            text=True,
            capture_output=True,
            check=False,
            cwd=cwd,
        )
        if proc.returncode != 0:
            raise ClaudeCodeClientError(
                code="CLAUDE_CODE_CLI_ERROR",
                message=proc.stderr.strip() or proc.stdout.strip() or "claude CLI command failed",
                details={"args": args, "returncode": proc.returncode},
            )
        try:
            parsed = json.loads(proc.stdout or "{}")
        except json.JSONDecodeError as err:
            raise ClaudeCodeClientError(
                code="CLAUDE_CODE_INVALID_JSON",
                message="claude CLI returned invalid JSON",
                details={"stdout": proc.stdout, "error": str(err)},
            ) from err
        if not isinstance(parsed, dict):
            return {"result": parsed}
        return parsed

    def version(self) -> dict[str, Any]:
        return self._run_json([self._binary, "--version", "--json"])

    def prompt_send(
        self,
        *,
        prompt: str,
        project_dir: str | None = None,
        session_id: str | None = None,
        model: str | None = None,
        stream: bool = False,
    ) -> dict[str, Any]:
        args = self._base_args(project_dir=project_dir, model=model)
        args.extend(["prompt", "send", "--json"])
        if stream:
            args.append("--stream")
        if session_id:
            args.extend(["--session", session_id])
        args.append(prompt)
        return self._run_json(args, cwd=project_dir or self._project_dir)

    def session_list(self, *, limit: int = 10, project_dir: str | None = None) -> dict[str, Any]:
        args = self._base_args(project_dir=project_dir)
        args.extend(["session", "list", "--json", "--limit", str(limit)])
        return self._run_json(args, cwd=project_dir or self._project_dir)

    def session_resume(
        self,
        *,
        session_id: str,
        prompt: str | None = None,
        project_dir: str | None = None,
        model: str | None = None,
    ) -> dict[str, Any]:
        args = self._base_args(project_dir=project_dir, model=model)
        args.extend(["session", "resume", "--json", session_id])
        if prompt:
            args.extend(["--prompt", prompt])
        return self._run_json(args, cwd=project_dir or self._project_dir)

    def hook_list(self, *, project_dir: str | None = None) -> dict[str, Any]:
        args = self._base_args(project_dir=project_dir)
        args.extend(["hook", "list", "--json"])
        return self._run_json(args, cwd=project_dir or self._project_dir)

    def hook_create(
        self,
        *,
        event: str,
        matcher: str,
        command: str,
        project_dir: str | None = None,
    ) -> dict[str, Any]:
        args = self._base_args(project_dir=project_dir)
        args.extend(["hook", "create", "--json", "--event", event, "--matcher", matcher, "--command", command])
        return self._run_json(args, cwd=project_dir or self._project_dir)

    def config_get(self, *, key: str | None = None, project_dir: str | None = None) -> dict[str, Any]:
        args = self._base_args(project_dir=project_dir)
        args.extend(["config", "get", "--json"])
        if key:
            args.extend(["--key", key])
        return self._run_json(args, cwd=project_dir or self._project_dir)

    def config_set(
        self,
        *,
        key: str,
        value: str,
        project_dir: str | None = None,
    ) -> dict[str, Any]:
        args = self._base_args(project_dir=project_dir)
        args.extend(["config", "set", "--json", "--key", key, "--value", value])
        return self._run_json(args, cwd=project_dir or self._project_dir)

    def mcp_list(self, *, project_dir: str | None = None) -> dict[str, Any]:
        args = self._base_args(project_dir=project_dir)
        args.extend(["mcp", "list", "--json"])
        return self._run_json(args, cwd=project_dir or self._project_dir)

    def mcp_call(
        self,
        *,
        server: str,
        tool: str,
        input_payload: dict[str, Any],
        project_dir: str | None = None,
    ) -> dict[str, Any]:
        args = self._base_args(project_dir=project_dir)
        args.extend(["mcp", "call", "--json", "--server", server, "--tool", tool])
        return self._run_json(args, cwd=project_dir or self._project_dir, stdin_text=json.dumps(input_payload))
