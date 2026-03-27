from __future__ import annotations

import json
import time

import click

from . import __version__
from .config import config_snapshot
from .constants import MODE_ORDER, PERMISSIONS_PATH
from .errors import CliError
from .output import emit, failure, success
from .runtime import (
    actions_list_runs_result,
    actions_trigger_result,
    branch_create_result,
    branch_list_result,
    capabilities_snapshot,
    doctor_snapshot,
    health_snapshot,
    issue_comment_result,
    issue_create_result,
    issue_get_result,
    issue_list_result,
    issue_update_result,
    pr_create_result,
    pr_get_result,
    pr_list_result,
    pr_merge_result,
    pr_review_result,
    release_create_result,
    release_list_result,
    repo_get_result,
    repo_list_result,
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


# --- Repo commands ---

@cli.group("repo")
def repo_group() -> None:
    pass


@repo_group.command("list")
@click.option("--owner", default=None, help="Owner/org to list repos for")
@click.option("--limit", default=30, show_default=True, type=int)
@click.pass_context
def repo_list(ctx: click.Context, owner: str | None, limit: int) -> None:
    _set_command(ctx, "repo.list")
    require_mode(ctx, "repo.list")
    _emit_success(ctx, "repo.list", repo_list_result(ctx.obj, owner, limit=limit))


@repo_group.command("get")
@click.option("--owner", default=None)
@click.option("--repo", "repo_name", default=None)
@click.pass_context
def repo_get(ctx: click.Context, owner: str | None, repo_name: str | None) -> None:
    _set_command(ctx, "repo.get")
    require_mode(ctx, "repo.get")
    _emit_success(ctx, "repo.get", repo_get_result(ctx.obj, owner, repo_name))


# --- Issue commands ---

@cli.group("issue")
def issue_group() -> None:
    pass


@issue_group.command("list")
@click.option("--owner", default=None)
@click.option("--repo", "repo_name", default=None)
@click.option("--limit", default=30, show_default=True, type=int)
@click.option("--state", default="open", show_default=True, type=click.Choice(["open", "closed", "all"]))
@click.pass_context
def issue_list(ctx: click.Context, owner: str | None, repo_name: str | None, limit: int, state: str) -> None:
    _set_command(ctx, "issue.list")
    require_mode(ctx, "issue.list")
    _emit_success(ctx, "issue.list", issue_list_result(ctx.obj, owner, repo_name, limit=limit, state=state))


@issue_group.command("get")
@click.option("--owner", default=None)
@click.option("--repo", "repo_name", default=None)
@click.argument("number", required=False, type=int)
@click.pass_context
def issue_get(ctx: click.Context, owner: str | None, repo_name: str | None, number: int | None) -> None:
    _set_command(ctx, "issue.get")
    require_mode(ctx, "issue.get")
    _emit_success(ctx, "issue.get", issue_get_result(ctx.obj, owner, repo_name, number))


@issue_group.command("create")
@click.option("--owner", default=None)
@click.option("--repo", "repo_name", default=None)
@click.option("--title", required=True, help="Issue title")
@click.option("--body", default=None, help="Issue body")
@click.pass_context
def issue_create(ctx: click.Context, owner: str | None, repo_name: str | None, title: str, body: str | None) -> None:
    _set_command(ctx, "issue.create")
    require_mode(ctx, "issue.create")
    _emit_success(ctx, "issue.create", issue_create_result(ctx.obj, owner, repo_name, title=title, body=body))


@issue_group.command("update")
@click.option("--owner", default=None)
@click.option("--repo", "repo_name", default=None)
@click.argument("number", type=int)
@click.option("--title", default=None)
@click.option("--body", default=None)
@click.option("--state", default=None, type=click.Choice(["open", "closed"]))
@click.pass_context
def issue_update(ctx: click.Context, owner: str | None, repo_name: str | None, number: int, title: str | None, body: str | None, state: str | None) -> None:
    _set_command(ctx, "issue.update")
    require_mode(ctx, "issue.update")
    _emit_success(ctx, "issue.update", issue_update_result(ctx.obj, owner, repo_name, number, title=title, body=body, state=state))


@issue_group.command("comment")
@click.option("--owner", default=None)
@click.option("--repo", "repo_name", default=None)
@click.argument("number", type=int)
@click.option("--body", required=True, help="Comment body")
@click.pass_context
def issue_comment(ctx: click.Context, owner: str | None, repo_name: str | None, number: int, body: str) -> None:
    _set_command(ctx, "issue.comment")
    require_mode(ctx, "issue.comment")
    _emit_success(ctx, "issue.comment", issue_comment_result(ctx.obj, owner, repo_name, number, body=body))


# --- PR commands ---

@cli.group("pr")
def pr_group() -> None:
    pass


@pr_group.command("list")
@click.option("--owner", default=None)
@click.option("--repo", "repo_name", default=None)
@click.option("--limit", default=30, show_default=True, type=int)
@click.option("--state", default="open", show_default=True, type=click.Choice(["open", "closed", "all"]))
@click.pass_context
def pr_list(ctx: click.Context, owner: str | None, repo_name: str | None, limit: int, state: str) -> None:
    _set_command(ctx, "pr.list")
    require_mode(ctx, "pr.list")
    _emit_success(ctx, "pr.list", pr_list_result(ctx.obj, owner, repo_name, limit=limit, state=state))


@pr_group.command("get")
@click.option("--owner", default=None)
@click.option("--repo", "repo_name", default=None)
@click.argument("number", required=False, type=int)
@click.pass_context
def pr_get(ctx: click.Context, owner: str | None, repo_name: str | None, number: int | None) -> None:
    _set_command(ctx, "pr.get")
    require_mode(ctx, "pr.get")
    _emit_success(ctx, "pr.get", pr_get_result(ctx.obj, owner, repo_name, number))


@pr_group.command("create")
@click.option("--owner", default=None)
@click.option("--repo", "repo_name", default=None)
@click.option("--title", required=True, help="PR title")
@click.option("--head", required=True, help="Head branch")
@click.option("--base", required=True, help="Base branch")
@click.option("--body", default=None, help="PR body")
@click.pass_context
def pr_create(ctx: click.Context, owner: str | None, repo_name: str | None, title: str, head: str, base: str, body: str | None) -> None:
    _set_command(ctx, "pr.create")
    require_mode(ctx, "pr.create")
    _emit_success(ctx, "pr.create", pr_create_result(ctx.obj, owner, repo_name, title=title, head=head, base=base, body=body))


@pr_group.command("merge")
@click.option("--owner", default=None)
@click.option("--repo", "repo_name", default=None)
@click.argument("number", type=int)
@click.pass_context
def pr_merge(ctx: click.Context, owner: str | None, repo_name: str | None, number: int) -> None:
    _set_command(ctx, "pr.merge")
    require_mode(ctx, "pr.merge")
    _emit_success(ctx, "pr.merge", pr_merge_result(ctx.obj, owner, repo_name, number))


@pr_group.command("review")
@click.option("--owner", default=None)
@click.option("--repo", "repo_name", default=None)
@click.argument("number", type=int)
@click.option("--event", default="APPROVE", show_default=True, type=click.Choice(["APPROVE", "REQUEST_CHANGES", "COMMENT"]))
@click.option("--body", default=None, help="Review body")
@click.pass_context
def pr_review(ctx: click.Context, owner: str | None, repo_name: str | None, number: int, event: str, body: str | None) -> None:
    _set_command(ctx, "pr.review")
    require_mode(ctx, "pr.review")
    _emit_success(ctx, "pr.review", pr_review_result(ctx.obj, owner, repo_name, number, event=event, body=body))


# --- Branch commands ---

@cli.group("branch")
def branch_group() -> None:
    pass


@branch_group.command("list")
@click.option("--owner", default=None)
@click.option("--repo", "repo_name", default=None)
@click.option("--limit", default=30, show_default=True, type=int)
@click.pass_context
def branch_list(ctx: click.Context, owner: str | None, repo_name: str | None, limit: int) -> None:
    _set_command(ctx, "branch.list")
    require_mode(ctx, "branch.list")
    _emit_success(ctx, "branch.list", branch_list_result(ctx.obj, owner, repo_name, limit=limit))


@branch_group.command("create")
@click.option("--owner", default=None)
@click.option("--repo", "repo_name", default=None)
@click.option("--branch", required=True, help="New branch name")
@click.option("--sha", required=True, help="Commit SHA to branch from")
@click.pass_context
def branch_create(ctx: click.Context, owner: str | None, repo_name: str | None, branch: str, sha: str) -> None:
    _set_command(ctx, "branch.create")
    require_mode(ctx, "branch.create")
    _emit_success(ctx, "branch.create", branch_create_result(ctx.obj, owner, repo_name, branch=branch, sha=sha))


# --- Actions commands ---

@cli.group("actions")
def actions_group() -> None:
    pass


@actions_group.command("list-runs")
@click.option("--owner", default=None)
@click.option("--repo", "repo_name", default=None)
@click.option("--limit", default=10, show_default=True, type=int)
@click.pass_context
def actions_list_runs(ctx: click.Context, owner: str | None, repo_name: str | None, limit: int) -> None:
    _set_command(ctx, "actions.list_runs")
    require_mode(ctx, "actions.list_runs")
    _emit_success(ctx, "actions.list_runs", actions_list_runs_result(ctx.obj, owner, repo_name, limit=limit))


@actions_group.command("trigger")
@click.option("--owner", default=None)
@click.option("--repo", "repo_name", default=None)
@click.option("--workflow-id", required=True, help="Workflow file name or ID")
@click.option("--ref", default="main", show_default=True, help="Git ref to trigger on")
@click.pass_context
def actions_trigger(ctx: click.Context, owner: str | None, repo_name: str | None, workflow_id: str, ref: str) -> None:
    _set_command(ctx, "actions.trigger")
    require_mode(ctx, "actions.trigger")
    _emit_success(ctx, "actions.trigger", actions_trigger_result(ctx.obj, owner, repo_name, workflow_id=workflow_id, ref=ref))


# --- Release commands ---

@cli.group("release")
def release_group() -> None:
    pass


@release_group.command("list")
@click.option("--owner", default=None)
@click.option("--repo", "repo_name", default=None)
@click.option("--limit", default=10, show_default=True, type=int)
@click.pass_context
def release_list(ctx: click.Context, owner: str | None, repo_name: str | None, limit: int) -> None:
    _set_command(ctx, "release.list")
    require_mode(ctx, "release.list")
    _emit_success(ctx, "release.list", release_list_result(ctx.obj, owner, repo_name, limit=limit))


@release_group.command("create")
@click.option("--owner", default=None)
@click.option("--repo", "repo_name", default=None)
@click.option("--tag", "tag_name", required=True, help="Tag name for the release")
@click.option("--name", default=None, help="Release name")
@click.option("--body", default=None, help="Release description")
@click.pass_context
def release_create(ctx: click.Context, owner: str | None, repo_name: str | None, tag_name: str, name: str | None, body: str | None) -> None:
    _set_command(ctx, "release.create")
    require_mode(ctx, "release.create")
    _emit_success(ctx, "release.create", release_create_result(ctx.obj, owner, repo_name, tag_name=tag_name, name=name, body=body))
