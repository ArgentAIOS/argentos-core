/**
 * Argent Agent — File Tools (Read, Write, Edit, Bash)
 *
 * Ground-up implementations of the core agent file manipulation tools.
 * These are NOT wrappers around Pi's tools — they're Argent-native with
 * cleaner error handling, better truncation, and pluggable operations
 * for sandboxed/remote execution.
 *
 * Each factory returns a Pi-compatible AgentTool so consuming code
 * doesn't need to change.
 *
 * @module argent-agent/file-tools
 */

import { Type, type Static } from "@sinclair/typebox";
import { exec } from "child_process";
import { constants } from "fs";
import { readFile, writeFile, access, mkdir, stat } from "fs/promises";
import { resolve, dirname, extname, relative } from "path";
import type { TextContent, ImageContent } from "../argent-ai/types.js";
import type { AgentTool, AgentToolResult, AgentToolUpdateCallback } from "./pi-types.js";

// ============================================================================
// Shared Utilities
// ============================================================================

/** Max bytes before truncation */
const DEFAULT_MAX_BYTES = 128 * 1024; // 128 KB
/** Max lines to return */
const DEFAULT_MAX_LINES = 2000;
/** Line length truncation threshold */
const MAX_LINE_LENGTH = 2000;

function textResult(text: string, details?: unknown): AgentToolResult<unknown> {
  return {
    content: [{ type: "text", text } as TextContent],
    details: details ?? {},
  };
}

function errorResult(message: string): AgentToolResult<unknown> {
  return textResult(`Error: ${message}`, { error: true });
}

/** Resolve and validate a path relative to cwd. */
function resolvePath(cwd: string, filePath: string): string {
  if (!filePath || !filePath.trim()) {
    throw new Error("File path is required");
  }
  // Resolve relative to cwd, but accept absolute paths too
  const resolved = resolve(cwd, filePath);
  return resolved;
}

/** Format file content with line numbers. */
function formatWithLineNumbers(content: string, offset: number): string {
  const lines = content.split("\n");
  const padWidth = String(offset + lines.length).length;
  return lines
    .map((line, i) => {
      const lineNum = String(offset + i + 1).padStart(padWidth, " ");
      const truncated =
        line.length > MAX_LINE_LENGTH ? line.slice(0, MAX_LINE_LENGTH) + "... (truncated)" : line;
      return `${lineNum}\t${truncated}`;
    })
    .join("\n");
}

/** Known image extensions */
const IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bmp",
  ".ico",
  ".svg",
]);

// ============================================================================
// READ TOOL
// ============================================================================

const readSchema = Type.Object({
  path: Type.String({ description: "Absolute or relative file path to read" }),
  offset: Type.Optional(
    Type.Number({ description: "Line offset to start reading from (0-based)" }),
  ),
  limit: Type.Optional(Type.Number({ description: "Maximum number of lines to read" })),
});

type ReadInput = Static<typeof readSchema>;

/** Pluggable filesystem operations for the read tool. */
export interface ReadOperations {
  readFile: (absolutePath: string) => Promise<Buffer>;
  access: (absolutePath: string) => Promise<void>;
  detectImageMimeType?: (absolutePath: string) => Promise<string | null | undefined>;
}

export interface ReadToolOptions {
  autoResizeImages?: boolean;
  operations?: ReadOperations;
}

const defaultReadOps: ReadOperations = {
  readFile: (p) => readFile(p),
  access: (p) => access(p, constants.R_OK),
};

/**
 * Create a file read tool for a working directory.
 *
 * Reads text files with line numbers, handles binary detection,
 * supports offset/limit for large files, and returns images as
 * base64 content blocks.
 */
export function createReadTool(
  cwd: string,
  options?: ReadToolOptions,
): AgentTool<typeof readSchema> {
  const ops = options?.operations ?? defaultReadOps;

  return {
    name: "read",
    label: "Read File",
    description:
      "Read the contents of a file. For text files, returns content with line numbers. " +
      "For images, returns the image data. Use offset and limit for large files.",
    parameters: readSchema,
    execute: async (
      _toolCallId: string,
      params: ReadInput,
      _signal?: AbortSignal,
      _onUpdate?: AgentToolUpdateCallback<unknown>,
    ): Promise<AgentToolResult<unknown>> => {
      try {
        const filePath = resolvePath(cwd, params.path);
        await ops.access(filePath);

        // Check for image files
        const ext = extname(filePath).toLowerCase();
        if (IMAGE_EXTENSIONS.has(ext)) {
          const buffer = await ops.readFile(filePath);
          const mimeType =
            ext === ".svg"
              ? "image/svg+xml"
              : ext === ".png"
                ? "image/png"
                : ext === ".gif"
                  ? "image/gif"
                  : ext === ".webp"
                    ? "image/webp"
                    : ext === ".bmp"
                      ? "image/bmp"
                      : ext === ".ico"
                        ? "image/x-icon"
                        : "image/jpeg";

          const content: (TextContent | ImageContent)[] = [
            { type: "text", text: `Read image file [${mimeType}]` } as TextContent,
            { type: "image", data: buffer.toString("base64"), mimeType } as ImageContent,
          ];
          return { content, details: { isImage: true, mimeType } };
        }

        // Read text file
        const buffer = await ops.readFile(filePath);

        // Check for binary content (presence of null bytes in first 8KB)
        const probe = buffer.subarray(0, 8192);
        if (probe.includes(0)) {
          return textResult(
            `Binary file detected (${buffer.length} bytes). Use a specialized tool for binary files.`,
            { binary: true, size: buffer.length },
          );
        }

        const fullText = buffer.toString("utf-8");
        const allLines = fullText.split("\n");

        // Apply offset and limit
        const offset = params.offset ?? 0;
        const limit = params.limit ?? DEFAULT_MAX_LINES;
        const end = Math.min(offset + limit, allLines.length);
        const selectedLines = allLines.slice(offset, end);

        // Truncate if total bytes exceed threshold
        let text = selectedLines.join("\n");
        let truncated = false;
        if (Buffer.byteLength(text, "utf-8") > DEFAULT_MAX_BYTES) {
          // Binary search for a safe cut point
          let lo = 0,
            hi = selectedLines.length;
          while (lo < hi) {
            const mid = (lo + hi + 1) >> 1;
            if (
              Buffer.byteLength(selectedLines.slice(0, mid).join("\n"), "utf-8") <=
              DEFAULT_MAX_BYTES
            ) {
              lo = mid;
            } else {
              hi = mid - 1;
            }
          }
          text = selectedLines.slice(0, lo).join("\n");
          truncated = true;
        }

        const formatted = formatWithLineNumbers(text, offset);
        const relPath = relative(cwd, filePath) || filePath;

        let header = `File: ${relPath} (${allLines.length} lines)`;
        if (offset > 0 || end < allLines.length) {
          header += ` [showing lines ${offset + 1}-${truncated ? "truncated" : end}]`;
        }
        if (truncated) {
          header += " (output truncated due to size)";
        }

        return textResult(`${header}\n${formatted}`, {
          lines: allLines.length,
          offset,
          shown: end - offset,
          truncated,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("ENOENT")) {
          return errorResult(`File not found: ${params.path}`);
        }
        if (msg.includes("EACCES")) {
          return errorResult(`Permission denied: ${params.path}`);
        }
        return errorResult(msg);
      }
    },
  };
}

// ============================================================================
// WRITE TOOL
// ============================================================================

const writeSchema = Type.Object({
  path: Type.String({ description: "Absolute or relative file path to write" }),
  content: Type.String({ description: "Content to write to the file" }),
});

type WriteInput = Static<typeof writeSchema>;

/** Pluggable filesystem operations for the write tool. */
export interface WriteOperations {
  writeFile: (absolutePath: string, content: string) => Promise<void>;
  mkdir: (dir: string) => Promise<void>;
}

export interface WriteToolOptions {
  operations?: WriteOperations;
}

const defaultWriteOps: WriteOperations = {
  writeFile: (p, c) => writeFile(p, c, "utf-8"),
  mkdir: (d) => mkdir(d, { recursive: true }).then(() => {}),
};

/**
 * Create a file write tool for a working directory.
 *
 * Writes content to a file, creating parent directories as needed.
 * Reports the number of lines and bytes written.
 */
export function createWriteTool(
  cwd: string,
  options?: WriteToolOptions,
): AgentTool<typeof writeSchema> {
  const ops = options?.operations ?? defaultWriteOps;

  return {
    name: "write",
    label: "Write File",
    description:
      "Write content to a file. Creates the file if it doesn't exist. " +
      "Creates parent directories automatically. Overwrites existing content.",
    parameters: writeSchema,
    execute: async (
      _toolCallId: string,
      params: WriteInput,
      _signal?: AbortSignal,
      _onUpdate?: AgentToolUpdateCallback<unknown>,
    ): Promise<AgentToolResult<unknown>> => {
      try {
        const filePath = resolvePath(cwd, params.path);
        const dir = dirname(filePath);
        await ops.mkdir(dir);
        await ops.writeFile(filePath, params.content);

        const lines = params.content.split("\n").length;
        const bytes = Buffer.byteLength(params.content, "utf-8");
        const relPath = relative(cwd, filePath) || filePath;

        return textResult(`Wrote ${lines} lines (${bytes} bytes) to ${relPath}`, {
          path: relPath,
          lines,
          bytes,
        });
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }
    },
  };
}

// ============================================================================
// EDIT TOOL
// ============================================================================

const editSchema = Type.Object({
  path: Type.String({ description: "Absolute or relative file path to edit" }),
  oldText: Type.String({ description: "Exact text to find and replace" }),
  newText: Type.String({ description: "Replacement text" }),
});

type EditInput = Static<typeof editSchema>;

/** Pluggable filesystem operations for the edit tool. */
export interface EditOperations {
  readFile: (absolutePath: string) => Promise<Buffer>;
  writeFile: (absolutePath: string, content: string) => Promise<void>;
  access: (absolutePath: string) => Promise<void>;
}

export interface EditToolOptions {
  operations?: EditOperations;
}

const defaultEditOps: EditOperations = {
  readFile: (p) => readFile(p),
  writeFile: (p, c) => writeFile(p, c, "utf-8"),
  access: (p) => access(p, constants.R_OK | constants.W_OK),
};

/**
 * Create a file edit tool for a working directory.
 *
 * Performs exact string replacement. The oldText must appear exactly once
 * in the file (prevents ambiguous edits). Returns a unified diff of changes.
 */
export function createEditTool(
  cwd: string,
  options?: EditToolOptions,
): AgentTool<typeof editSchema> {
  const ops = options?.operations ?? defaultEditOps;

  return {
    name: "edit",
    label: "Edit File",
    description:
      "Edit a file by replacing exact text. The oldText must match exactly one location " +
      "in the file. Returns a diff showing the changes made.",
    parameters: editSchema,
    execute: async (
      _toolCallId: string,
      params: EditInput,
      _signal?: AbortSignal,
      _onUpdate?: AgentToolUpdateCallback<unknown>,
    ): Promise<AgentToolResult<unknown>> => {
      try {
        const filePath = resolvePath(cwd, params.path);
        await ops.access(filePath);

        const buffer = await ops.readFile(filePath);
        const original = buffer.toString("utf-8");

        if (params.oldText === params.newText) {
          return textResult("No changes needed (oldText === newText)");
        }

        // Count occurrences
        const occurrences = countOccurrences(original, params.oldText);
        if (occurrences === 0) {
          // Provide helpful context about what's in the file
          const lines = original.split("\n").length;
          return errorResult(
            `oldText not found in ${params.path} (${lines} lines). ` +
              "Make sure the text matches exactly, including whitespace and indentation.",
          );
        }
        if (occurrences > 1) {
          return errorResult(
            `oldText found ${occurrences} times in ${params.path}. ` +
              "Include more surrounding context to make the match unique.",
          );
        }

        // Perform the replacement
        const updated = original.replace(params.oldText, params.newText);
        await ops.writeFile(filePath, updated);

        // Generate a simple diff
        const diff = generateSimpleDiff(original, updated, params.oldText, params.newText);
        const relPath = relative(cwd, filePath) || filePath;

        // Find the line number of the change
        const beforeChange = original.slice(0, original.indexOf(params.oldText));
        const firstChangedLine = beforeChange.split("\n").length;

        return textResult(`Edited ${relPath} (line ${firstChangedLine})\n${diff}`, {
          path: relPath,
          firstChangedLine,
          diff,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("ENOENT")) {
          return errorResult(`File not found: ${params.path}`);
        }
        return errorResult(msg);
      }
    },
  };
}

function countOccurrences(text: string, search: string): number {
  let count = 0;
  let pos = 0;
  while ((pos = text.indexOf(search, pos)) !== -1) {
    count++;
    pos += search.length;
  }
  return count;
}

function generateSimpleDiff(
  original: string,
  updated: string,
  oldText: string,
  newText: string,
): string {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  const parts: string[] = [];

  for (const line of oldLines) {
    parts.push(`- ${line}`);
  }
  for (const line of newLines) {
    parts.push(`+ ${line}`);
  }

  return parts.join("\n");
}

// ============================================================================
// BASH TOOL
// ============================================================================

const bashSchema = Type.Object({
  command: Type.String({ description: "Shell command to execute" }),
  timeout: Type.Optional(Type.Number({ description: "Timeout in milliseconds (default: 120000)" })),
});

type BashInput = Static<typeof bashSchema>;

/** Pluggable operations for the bash tool. */
export interface BashOperations {
  exec: (
    command: string,
    cwd: string,
    options: {
      onData: (data: Buffer) => void;
      signal?: AbortSignal;
      timeout?: number;
      env?: NodeJS.ProcessEnv;
    },
  ) => Promise<{ exitCode: number | null }>;
}

export interface BashToolOptions {
  operations?: BashOperations;
  commandPrefix?: string;
}

const DEFAULT_BASH_TIMEOUT = 120_000; // 2 minutes

const defaultBashOps: BashOperations = {
  exec: (command, cwd, options) => {
    return new Promise((resolve, reject) => {
      const child = exec(command, {
        cwd,
        timeout: options.timeout ?? DEFAULT_BASH_TIMEOUT,
        maxBuffer: 10 * 1024 * 1024, // 10 MB
        signal: options.signal,
        env: options.env ?? process.env,
      });

      child.stdout?.on("data", (chunk) => {
        const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
        options.onData(buf);
      });
      child.stderr?.on("data", (chunk) => {
        const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
        options.onData(buf);
      });

      child.on("close", (code) => resolve({ exitCode: code }));
      child.on("error", reject);
    });
  },
};

/**
 * Create a bash command execution tool for a working directory.
 *
 * Executes shell commands, captures stdout+stderr, and returns the
 * output with exit code. Supports timeouts and abort signals.
 */
export function createBashTool(
  cwd: string,
  options?: BashToolOptions,
): AgentTool<typeof bashSchema> {
  const ops = options?.operations ?? defaultBashOps;
  const prefix = options?.commandPrefix;

  return {
    name: "bash",
    label: "Bash",
    description:
      "Execute a shell command. Returns stdout and stderr combined, plus the exit code. " +
      "Commands run in the project working directory.",
    parameters: bashSchema,
    execute: async (
      _toolCallId: string,
      params: BashInput,
      signal?: AbortSignal,
      onUpdate?: AgentToolUpdateCallback<unknown>,
    ): Promise<AgentToolResult<unknown>> => {
      try {
        const command = prefix ? `${prefix}\n${params.command}` : params.command;
        const chunks: Buffer[] = [];
        let totalBytes = 0;

        const { exitCode } = await ops.exec(command, cwd, {
          onData: (data) => {
            chunks.push(data);
            totalBytes += data.length;

            // Stream partial updates for long-running commands
            if (onUpdate && totalBytes % (16 * 1024) < data.length) {
              const partial = Buffer.concat(chunks).toString("utf-8");
              onUpdate({
                content: [{ type: "text", text: partial } as TextContent],
                details: { streaming: true, bytes: totalBytes },
              });
            }
          },
          signal,
          timeout: params.timeout ?? DEFAULT_BASH_TIMEOUT,
        });

        let output = Buffer.concat(chunks).toString("utf-8");

        // Truncate if too large
        let truncated = false;
        if (Buffer.byteLength(output, "utf-8") > DEFAULT_MAX_BYTES) {
          // Keep the last part (tail) since that's usually most relevant
          const lines = output.split("\n");
          const kept: string[] = [];
          let size = 0;
          for (let i = lines.length - 1; i >= 0; i--) {
            const lineSize = Buffer.byteLength(lines[i]!, "utf-8") + 1;
            if (size + lineSize > DEFAULT_MAX_BYTES) break;
            kept.unshift(lines[i]!);
            size += lineSize;
          }
          output =
            `... (output truncated, showing last ${kept.length} of ${lines.length} lines)\n` +
            kept.join("\n");
          truncated = true;
        }

        const exitStr = exitCode === 0 ? "" : `\nExit code: ${exitCode}`;
        return textResult(`${output}${exitStr}`, { exitCode, bytes: totalBytes, truncated });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("ABORT") || msg.includes("abort")) {
          return errorResult("Command aborted");
        }
        return errorResult(msg);
      }
    },
  };
}

// ============================================================================
// Tool Collections
// ============================================================================

/** Core coding tools: read, bash, edit, write */
export function createCodingTools(
  cwd: string,
  options?: {
    read?: ReadToolOptions;
    write?: WriteToolOptions;
    edit?: EditToolOptions;
    bash?: BashToolOptions;
  },
): [
  AgentTool<typeof readSchema, unknown>,
  AgentTool<typeof bashSchema, unknown>,
  AgentTool<typeof editSchema, unknown>,
  AgentTool<typeof writeSchema, unknown>,
] {
  return [
    createReadTool(cwd, options?.read),
    createBashTool(cwd, options?.bash),
    createEditTool(cwd, options?.edit),
    createWriteTool(cwd, options?.write),
  ];
}

// ============================================================================
// Default Tool Instances (Pi-compatible template objects)
// ============================================================================

/**
 * Pre-built default coding tools using process.cwd() as the working directory.
 *
 * These are used as a template set that consuming code (pi-tools.ts) iterates
 * over, checking each tool's `.name` property and replacing with fresh
 * instances bound to the actual workspace root. The CWD doesn't matter
 * since the tools are never executed directly — only their names are inspected.
 *
 * Legacy upstream exports these as `codingTools` from its coding-agent package.
 */
export const codingTools = createCodingTools(process.cwd());

/**
 * Pre-built default read tool instance.
 *
 * Used by pi-tools.ts to identify the read tool by name in the codingTools
 * array during filtering: `if (tool.name === readTool.name)`.
 *
 * Legacy upstream exports this as `readTool` from its coding-agent package.
 */
export const readTool = createReadTool(process.cwd());
