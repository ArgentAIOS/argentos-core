/**
 * Argent Agent Tool Registry & Execution
 *
 * Manages tool registration and executes tool calls from the LLM.
 *
 * Built for Argent Core - February 16, 2026
 */

import type { ToolCall } from "../argent-ai/types.js";

// ============================================================================
// Types
// ============================================================================

/**
 * A tool handler with metadata and execution function.
 */
export interface ToolHandler {
  /** Tool name (must match what the LLM calls) */
  name: string;
  /** Human-readable description for the model */
  description: string;
  /** JSON Schema for parameters */
  parameters: Record<string, unknown>;
  /** Execution function */
  handler: (args: Record<string, unknown>) => Promise<string>;
}

// ============================================================================
// Tool Registry
// ============================================================================

/**
 * Registry of available tools that the agent can invoke.
 */
export class ToolRegistry {
  private tools = new Map<string, ToolHandler>();

  /**
   * Register a tool handler.
   * Overwrites any existing tool with the same name.
   */
  register(tool: ToolHandler): void {
    this.tools.set(tool.name, tool);
  }

  /**
   * Get a tool handler by name.
   */
  get(name: string): ToolHandler | undefined {
    return this.tools.get(name);
  }

  /**
   * Check if a tool is registered.
   */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * List all registered tools.
   */
  list(): ToolHandler[] {
    return Array.from(this.tools.values());
  }

  /**
   * Convert registered tools to tool definitions for the provider.
   */
  toToolDefs(): Array<{
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  }> {
    return this.list().map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }));
  }
}

// ============================================================================
// Tool Execution
// ============================================================================

/**
 * Execute a tool call against a registry.
 *
 * Looks up the tool by name, invokes its handler with the call arguments,
 * and wraps the result (or error) in a standard format.
 */
export async function executeToolCall(
  toolCall: ToolCall,
  registry: ToolRegistry,
): Promise<{ result: string; isError: boolean }> {
  const tool = registry.get(toolCall.name);

  if (!tool) {
    return {
      result: `Error: Tool "${toolCall.name}" not found`,
      isError: true,
    };
  }

  try {
    const result = await tool.handler(toolCall.arguments);
    return { result, isError: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      result: `Error: ${message}`,
      isError: true,
    };
  }
}
