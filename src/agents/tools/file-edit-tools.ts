/**
 * File Edit Tools
 *
 * Two tools for flexible file editing:
 * - edit_line_range: Replace a range of lines
 * - edit_regex: Find/replace with regex
 */

import { Type } from "@sinclair/typebox";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolveStateDir } from "../../config/paths.js";
import { type AnyAgentTool, jsonResult, readNumberParam, readStringParam } from "./common.js";

type FileEditOptions = {
  workspaceDir?: string;
  sandboxRoot?: string;
  extraAllowedPaths?: string[];
};

// ============================================================================
// Path validation
// ============================================================================

function validatePath(filePath: string, options: FileEditOptions): string {
  const resolved = path.resolve(filePath);
  const stateDir = resolveStateDir();
  const homeDir = os.homedir();
  const allowed = [
    options.workspaceDir,
    options.sandboxRoot,
    stateDir,
    path.join(homeDir, ".argentos"),
    ...(options.extraAllowedPaths ?? []),
  ].filter(Boolean) as string[];

  const isAllowed = allowed.some((dir) => resolved.startsWith(dir));
  if (!isAllowed) {
    throw new Error(`Path "${resolved}" is outside allowed directories: ${allowed.join(", ")}`);
  }
  return resolved;
}

// ============================================================================
// edit_line_range
// ============================================================================

const EditLineRangeSchema = Type.Object({
  path: Type.String(),
  start_line: Type.Number({ minimum: 1 }),
  end_line: Type.Number({ minimum: 1 }),
  content: Type.String(),
});

function createEditLineRangeExecute(options: FileEditOptions) {
  return async (_toolCallId: string, args: unknown) => {
    const params = args as Record<string, unknown>;
    const filePath = readStringParam(params, "path", { required: true });
    const startLine = readNumberParam(params, "start_line", { required: true, integer: true })!;
    const endLine = readNumberParam(params, "end_line", { required: true, integer: true })!;
    const content = readStringParam(params, "content", {
      required: true,
      trim: false,
      allowEmpty: true,
    });

    const resolved = validatePath(filePath, options);

    const original = await fs.readFile(resolved, "utf-8");
    const lines = original.split("\n");

    if (startLine > endLine) {
      throw new Error(`start_line (${startLine}) must be <= end_line (${endLine})`);
    }
    if (endLine > lines.length) {
      throw new Error(`end_line (${endLine}) exceeds file length (${lines.length} lines)`);
    }

    const oldLines = lines.slice(startLine - 1, endLine);
    const newLines = content.split("\n");

    lines.splice(startLine - 1, endLine - startLine + 1, ...newLines);
    await fs.writeFile(resolved, lines.join("\n"), "utf-8");

    return jsonResult({
      path: resolved,
      range: { start: startLine, end: endLine },
      old_lines: oldLines,
      new_lines: newLines,
      total_lines_before: original.split("\n").length,
      total_lines_after: lines.length,
    });
  };
}

export function createEditLineRangeTool(options: FileEditOptions = {}): AnyAgentTool {
  return {
    label: "EditLineRange",
    name: "edit_line_range",
    description: `Replace a range of lines in a file (1-indexed, inclusive).

Use this for surgical edits when you know the exact line numbers.
The start_line and end_line are both inclusive.

Example: Replace lines 10-15 with new content:
{ "path": "/path/to/file", "start_line": 10, "end_line": 15, "content": "new line 1\\nnew line 2" }`,
    parameters: EditLineRangeSchema,
    execute: createEditLineRangeExecute(options),
  };
}

// ============================================================================
// edit_regex
// ============================================================================

const EditRegexSchema = Type.Object({
  path: Type.String(),
  pattern: Type.String(),
  replacement: Type.String(),
  flags: Type.Optional(Type.String()),
  dry_run: Type.Optional(Type.Boolean()),
});

function createEditRegexExecute(options: FileEditOptions) {
  return async (_toolCallId: string, args: unknown) => {
    const params = args as Record<string, unknown>;
    const filePath = readStringParam(params, "path", { required: true });
    const pattern = readStringParam(params, "pattern", { required: true });
    const replacement = readStringParam(params, "replacement", {
      required: true,
      trim: false,
      allowEmpty: true,
    });
    const flags = readStringParam(params, "flags") || "g";
    const dryRun = params.dry_run === true;

    const resolved = validatePath(filePath, options);

    const original = await fs.readFile(resolved, "utf-8");

    let regex: RegExp;
    try {
      regex = new RegExp(pattern, flags);
    } catch (err) {
      throw new Error(`Invalid regex pattern: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Count matches
    const matches: string[] = [];
    const countRegex = new RegExp(pattern, flags.includes("g") ? flags : `${flags}g`);
    let match: RegExpExecArray | null;
    while ((match = countRegex.exec(original)) !== null) {
      matches.push(match[0]);
      if (!flags.includes("g")) break;
    }

    const result = original.replace(regex, replacement);

    if (!dryRun && matches.length > 0) {
      await fs.writeFile(resolved, result, "utf-8");
    }

    // Build preview: show first few matches
    const previewMatches = matches.slice(0, 5).map((m) => ({
      matched: m,
      replaced: m.replace(regex, replacement),
    }));

    return jsonResult({
      path: resolved,
      pattern,
      replacement,
      flags,
      dry_run: dryRun,
      match_count: matches.length,
      applied: !dryRun && matches.length > 0,
      preview: previewMatches,
    });
  };
}

export function createEditRegexTool(options: FileEditOptions = {}): AnyAgentTool {
  return {
    label: "EditRegex",
    name: "edit_regex",
    description: `Find and replace text in a file using regex.

Supports capture groups ($1, $2) in replacements.
Use dry_run: true to preview changes without writing.

Example: Rename a function:
{ "path": "/path/to/file", "pattern": "oldName", "replacement": "newName", "flags": "g" }

Example: Preview changes:
{ "path": "/path/to/file", "pattern": "(\\w+)Helper", "replacement": "$1Service", "dry_run": true }`,
    parameters: EditRegexSchema,
    execute: createEditRegexExecute(options),
  };
}
