/**
 * GitHub Issue Tool
 *
 * Uses the `gh` CLI for GitHub issue management.
 */

import { Type } from "@sinclair/typebox";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  type AnyAgentTool,
  jsonResult,
  readNumberParam,
  readStringArrayParam,
  readStringParam,
} from "./common.js";

const execFileAsync = promisify(execFile);

const DEFAULT_REPO = "ArgentAIOS/argentos";

// ============================================================================
// Schema
// ============================================================================

const GithubIssueToolSchema = Type.Object({
  action: Type.Union([Type.Literal("create"), Type.Literal("list"), Type.Literal("view")]),
  repo: Type.Optional(Type.String()),
  title: Type.Optional(Type.String()),
  body: Type.Optional(Type.String()),
  labels: Type.Optional(Type.Array(Type.String())),
  assignee: Type.Optional(Type.String()),
  issue_number: Type.Optional(Type.Number()),
});

// ============================================================================
// Helpers
// ============================================================================

function textResult(text: string) {
  return {
    content: [{ type: "text" as const, text }],
  } as import("../../agent-core/core.js").AgentToolResult<unknown>;
}

async function runGh(args: string[]): Promise<{ stdout: string; stderr: string }> {
  try {
    return await execFileAsync("gh", args, { timeout: 30_000 });
  } catch (err) {
    const error = err as { code?: string; stderr?: string; message?: string };
    if (error.code === "ENOENT") {
      throw new Error("gh CLI not found. Install it from https://cli.github.com/");
    }
    const stderr = error.stderr?.trim() || error.message || "Unknown error";
    throw new Error(`gh command failed: ${stderr}`);
  }
}

// ============================================================================
// Actions
// ============================================================================

async function createIssue(params: Record<string, unknown>) {
  const repo = readStringParam(params, "repo") || DEFAULT_REPO;
  const title = readStringParam(params, "title", { required: true });
  const body = readStringParam(params, "body", { trim: false });
  const labels = readStringArrayParam(params, "labels");
  const assignee = readStringParam(params, "assignee");

  const args = ["issue", "create", "--repo", repo, "--title", title];
  if (body) {
    args.push("--body", body);
  }
  if (labels) {
    for (const label of labels) {
      args.push("--label", label);
    }
  }
  if (assignee) {
    args.push("--assignee", assignee);
  }

  const { stdout } = await runGh(args);
  const url = stdout.trim();
  return jsonResult({ action: "created", url });
}

async function listIssues(params: Record<string, unknown>) {
  const repo = readStringParam(params, "repo") || DEFAULT_REPO;
  const args = [
    "issue",
    "list",
    "--repo",
    repo,
    "--limit",
    "20",
    "--json",
    "number,title,state,labels,createdAt",
  ];

  const { stdout } = await runGh(args);
  const issues = JSON.parse(stdout);
  return jsonResult({ action: "list", repo, issues });
}

async function viewIssue(params: Record<string, unknown>) {
  const repo = readStringParam(params, "repo") || DEFAULT_REPO;
  const issueNumber = readNumberParam(params, "issue_number", {
    required: true,
    integer: true,
  });

  const args = [
    "issue",
    "view",
    String(issueNumber),
    "--repo",
    repo,
    "--json",
    "title,body,state,labels,comments",
  ];

  const { stdout } = await runGh(args);
  const issue = JSON.parse(stdout);
  return jsonResult({ action: "view", repo, issue });
}

// ============================================================================
// Tool Implementation
// ============================================================================

export function createGithubIssueTool(): AnyAgentTool {
  return {
    label: "GitHubIssue",
    name: "github_issue",
    description: `Manage GitHub issues using the gh CLI.

ACTIONS:
- create: Create a new issue (requires title)
- list: List recent issues (up to 20)
- view: View a specific issue by number

Default repo: ${DEFAULT_REPO}`,
    parameters: GithubIssueToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });

      try {
        switch (action) {
          case "create":
            return await createIssue(params);
          case "list":
            return await listIssues(params);
          case "view":
            return await viewIssue(params);
          default:
            return textResult(`Unknown action "${action}". Use create, list, or view.`);
        }
      } catch (err) {
        return textResult(
          `GitHub issue error: ${err instanceof Error ? err.message : "Unknown error"}`,
        );
      }
    },
  };
}
