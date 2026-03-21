/**
 * Terminal Tool for Agents
 *
 * Opens interactive PTY terminals, runs commands, and reads output.
 * The terminal streams to the dashboard doc panel via gateway events.
 *
 * The agent spawns PTY directly in-process (not via gateway RPC) since
 * the agent runs inside the gateway process. The shared terminal session
 * registry is used so dashboard RPC methods can also interact with these
 * terminals.
 */

import { Type } from "@sinclair/typebox";
import type { GatewayRequestContext } from "../../gateway/server-methods/types.js";
import type { AnyAgentTool } from "./common.js";
import { terminalSessions, createTerminalSession } from "../../gateway/server-methods/terminal.js";

// ============================================================================
// Helpers
// ============================================================================

function textResult(text: string) {
  return {
    content: [{ type: "text" as const, text }],
  };
}

// Module-level ref to broadcast — set once when tool is first used in a gateway context
let gatewayBroadcast: GatewayRequestContext["broadcast"] | null = null;

/** Called by the gateway startup to inject the broadcast function. */
export function setTerminalBroadcast(broadcast: GatewayRequestContext["broadcast"]): void {
  gatewayBroadcast = broadcast;
}

// ============================================================================
// Schema
// ============================================================================

const TerminalToolSchema = Type.Object(
  {
    action: Type.String(),
    command: Type.Optional(Type.String()),
    terminal_id: Type.Optional(Type.String()),
    cwd: Type.Optional(Type.String()),
    wait_ms: Type.Optional(Type.Number()),
    keys: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

// Named key → raw byte mapping
const KEY_MAP: Record<string, string> = {
  "ctrl+c": "\x03",
  "ctrl+d": "\x04",
  "ctrl+z": "\x1a",
  "ctrl+l": "\x0c",
  "ctrl+\\": "\x1c",
  "ctrl+a": "\x01",
  "ctrl+e": "\x05",
  "ctrl+u": "\x15",
  "ctrl+k": "\x0b",
  "ctrl+w": "\x17",
  esc: "\x1b",
  enter: "\r",
  tab: "\t",
  up: "\x1b[A",
  down: "\x1b[B",
  right: "\x1b[C",
  left: "\x1b[D",
};

// ============================================================================
// Tool Implementation
// ============================================================================

export function createTerminalTool(): AnyAgentTool {
  return {
    label: "Terminal",
    name: "terminal",
    description: `Open and interact with live terminal sessions in the dashboard.

ACTIONS:
- open: Open a new terminal. Returns terminal_id. Optional cwd param.
- run: Run a command in an existing terminal. Requires terminal_id and command. Optional wait_ms (default 2000, max 30000).
- send_keys: Send special keys/signals to a terminal. Requires terminal_id and keys. Use this to interrupt stuck commands (ctrl+c), exit (ctrl+d), escape modes (esc), or send arrow keys.
- read: Read recent output from a terminal. Requires terminal_id.
- close: Close a terminal session. Requires terminal_id.

The terminal appears as a tab in the dashboard doc panel. Both you and the user can type in it.

IMPORTANT: When a command gets stuck (no prompt returns), use send_keys with "ctrl+c" to interrupt it before trying again.

Available keys: ctrl+c, ctrl+d, ctrl+z, ctrl+l, ctrl+\\, ctrl+a, ctrl+e, ctrl+u, ctrl+k, ctrl+w, esc, enter, tab, up, down, left, right. You can chain multiple keys with spaces: "ctrl+c ctrl+c" sends Ctrl+C twice. You can also send raw text by using the "run" action with an empty command.

EXAMPLES:
- Open: { "action": "open", "cwd": "/Users/sem/argent" }
- Run: { "action": "run", "terminal_id": "term-abc12345", "command": "git status" }
- Interrupt: { "action": "send_keys", "terminal_id": "term-abc12345", "keys": "ctrl+c" }
- Escape: { "action": "send_keys", "terminal_id": "term-abc12345", "keys": "esc esc" }
- Read: { "action": "read", "terminal_id": "term-abc12345" }
- Close: { "action": "close", "terminal_id": "term-abc12345" }`,
    parameters: TerminalToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = (params.action as string) || "";

      switch (action) {
        case "open":
          return handleOpen(params);
        case "run":
          return handleRun(params);
        case "send_keys":
          return handleSendKeys(params);
        case "read":
          return handleRead(params);
        case "close":
          return handleClose(params);
        default:
          return textResult(
            `Unknown action "${action}". Valid actions: open, run, send_keys, read, close`,
          );
      }
    },
  };
}

// ============================================================================
// Action Handlers
// ============================================================================

async function handleOpen(params: Record<string, unknown>) {
  const cwd = (params.cwd as string) || undefined;

  try {
    const result = await createTerminalSession({
      cwd,
      connId: null, // agent-created
      broadcast: gatewayBroadcast ?? undefined,
    });

    return textResult(
      [
        `Terminal opened: ${result.id}`,
        `Shell: ${result.shell}`,
        `CWD: ${result.cwd}`,
        `[APP:terminal:${result.id}]`,
      ].join("\n"),
    );
  } catch (err) {
    return textResult(
      `Failed to open terminal: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

async function handleRun(params: Record<string, unknown>) {
  const terminalId = params.terminal_id as string;
  const command = params.command as string;
  const waitMs = Math.min(Math.max(Number(params.wait_ms) || 2000, 100), 30000);

  if (!terminalId) return textResult("terminal_id is required for run action");
  if (!command) return textResult("command is required for run action");

  const session = terminalSessions.get(terminalId);
  if (!session) return textResult(`Terminal ${terminalId} not found`);
  if (session.exited)
    return textResult(`Terminal ${terminalId} has exited (code: ${session.exitCode})`);

  // Snapshot buffer position before writing
  const offsetBefore = session.outputOffset;

  // Write command + newline
  session.pty.write(command + "\n");
  session.lastWriteAt = Date.now();

  // Wait for output, checking periodically if the shell has returned to a prompt
  const startTime = Date.now();
  const checkInterval = 200;
  let settled = false;
  while (Date.now() - startTime < waitMs) {
    await new Promise((resolve) => setTimeout(resolve, checkInterval));
    // Check if output has stopped arriving (settled for 200ms)
    const elapsed = Date.now() - startTime;
    if (elapsed > 500) {
      const recentOutput = session.outputBuffer.slice(-200);
      // Common shell prompt endings: $, %, >, #, ❯, ›
      if (/[\$%>#❯›]\s*$/.test(recentOutput)) {
        settled = true;
        break;
      }
    }
  }

  // Capture output since snapshot
  const newChars = session.outputOffset - offsetBefore;
  let output: string;
  if (newChars <= 0) {
    output = "(no output)";
  } else if (newChars <= session.outputBuffer.length) {
    output = session.outputBuffer.slice(-newChars);
  } else {
    // Buffer was trimmed; return what we have
    output = session.outputBuffer;
  }

  // Trim to reasonable size for tool result
  const maxOutput = 8000;
  if (output.length > maxOutput) {
    output = "...(truncated)...\n" + output.slice(-maxOutput);
  }

  const status = settled
    ? ""
    : "\n⚠️ Shell may still be waiting for input. Use send_keys with ctrl+c to interrupt if stuck.";

  return textResult(
    [`Terminal ${terminalId} — ran: ${command}`, "---", output + status].join("\n"),
  );
}

async function handleSendKeys(params: Record<string, unknown>) {
  const terminalId = params.terminal_id as string;
  const keysStr = params.keys as string;
  const waitMs = Math.min(Math.max(Number(params.wait_ms) || 500, 100), 10000);

  if (!terminalId) return textResult("terminal_id is required for send_keys action");
  if (!keysStr)
    return textResult(
      "keys is required for send_keys action (e.g. 'ctrl+c', 'esc', 'ctrl+c ctrl+c')",
    );

  const session = terminalSessions.get(terminalId);
  if (!session) return textResult(`Terminal ${terminalId} not found`);
  if (session.exited)
    return textResult(`Terminal ${terminalId} has exited (code: ${session.exitCode})`);

  const offsetBefore = session.outputOffset;

  // Parse and send each key in the sequence
  const keyNames = keysStr.trim().split(/\s+/);
  const sent: string[] = [];
  for (const keyName of keyNames) {
    const mapped = KEY_MAP[keyName.toLowerCase()];
    if (!mapped) {
      return textResult(`Unknown key "${keyName}". Available: ${Object.keys(KEY_MAP).join(", ")}`);
    }
    session.pty.write(mapped);
    sent.push(keyName);
  }
  session.lastWriteAt = Date.now();

  // Brief wait for any response
  await new Promise((resolve) => setTimeout(resolve, waitMs));

  // Capture any output that resulted
  const newChars = session.outputOffset - offsetBefore;
  let output = "(no output)";
  if (newChars > 0) {
    output =
      newChars <= session.outputBuffer.length
        ? session.outputBuffer.slice(-newChars)
        : session.outputBuffer;
    const maxOutput = 4000;
    if (output.length > maxOutput) {
      output = "...(truncated)...\n" + output.slice(-maxOutput);
    }
  }

  return textResult([`Terminal ${terminalId} — sent: ${sent.join(" ")}`, "---", output].join("\n"));
}

async function handleRead(params: Record<string, unknown>) {
  const terminalId = params.terminal_id as string;
  if (!terminalId) return textResult("terminal_id is required for read action");

  const session = terminalSessions.get(terminalId);
  if (!session) return textResult(`Terminal ${terminalId} not found`);

  const output = session.outputBuffer || "(no output yet)";
  // Return last 8KB
  const maxOutput = 8000;
  const trimmed =
    output.length > maxOutput ? "...(truncated)...\n" + output.slice(-maxOutput) : output;

  return textResult(
    [
      `Terminal ${terminalId} — recent output:`,
      `Exited: ${session.exited ? `yes (code ${session.exitCode})` : "no"}`,
      "---",
      trimmed,
    ].join("\n"),
  );
}

async function handleClose(params: Record<string, unknown>) {
  const terminalId = params.terminal_id as string;
  if (!terminalId) return textResult("terminal_id is required for close action");

  const session = terminalSessions.get(terminalId);
  if (!session) return textResult(`Terminal ${terminalId} already closed`);

  if (session.idleTimer) clearTimeout(session.idleTimer);
  if (!session.exited) {
    try {
      session.pty.kill();
    } catch {
      // already dead
    }
  }
  terminalSessions.delete(terminalId);

  gatewayBroadcast?.("terminal", { id: terminalId, stream: "exit", code: -1 });

  return textResult(`Terminal ${terminalId} closed.`);
}
