/**
 * Operator Light Tools
 *
 * Curated, minimal, high-power tool surface exclusively for the primary operator
 * agent (the main "argent" the user interacts with directly).
 *
 * Phase 0 of Grok Enhancements / main-operator-evolution.
 * See: operator-prompt-profiles.ts for the matching prompt stripping decisions.
 *
 * Design:
 * - ~8-12 tools max (vs 40+ in full createArgentCodingTools).
 * - Heavy emphasis on delegation (family), self-extension (skills create/promote),
 *   memory (MemU recall + store), and lightweight workflow coordination.
 * - Everything else (file ops, browser, code editing, etc.) available by spawning
 *   family agents with the full surface when needed.
 * - All changes gated behind isPrimaryOperator flag. No default behavior change.
 *
 * wf-1 / wf-6 update: workflow_builder is now a full operator-owned authoring surface
 * (create/edit/version/promote as self-extension artifacts + delegate_build for
 * goal-driven parallel delegation). Creation here is the sole wiring point that
 * activates the expanded surface (via forPrimaryOperator flag). The NOTE below
 * was updated from earlier "stability" stance now that the surface is proven.
 */
import type { AnyAgentTool } from "./pi-tools.types.js";
// Stable high-value additions for the operator (add here as bidirectional surfaces land)
import { createExecTool } from "./bash-tools.js";
import {
  CAPABILITY_DELEGATION_TOOL_ALLOWLIST,
  CAPABILITY_DELEGATION_TOOL_DENY,
} from "./tools/capability-delegation.js";
import { createCuratorTool } from "./tools/curator-tool.js";
import { createFamilyTool } from "./tools/family-tool.js";
import {
  createMemoryRecallTool,
  createMemoryStoreTool,
  createMemoryCategoriesTool,
  createMemoryReflectTool,
} from "./tools/memu-tools.js";
import { createPersonalSkillTool } from "./tools/personal-skill-tool.js";
import { createSkillsTool } from "./tools/skills-tool.js";
import { createWorkflowBuilderTool } from "./tools/workflow-builder-tool.js";

export interface LightOperatorToolsOptions {
  config?: unknown;
  sessionKey?: string;
  agentId?: string;
  /** For tools that need a scoped agent (Personal Skills authoring, etc.) */
  operatorAgentId?: string;
  /**
   * Phase 3 (grok/main-operator-evolution): thread runId so that curator and
   * personal_skill invocations can emit correlated [operator-self-ext] logs
   * and AgentEvents for measurement of self-extension activity on the fast path.
   */
  runId?: string;
  /**
   * Phase 0.5 (Hermes Absorption): captured turn messages (messagesSnapshot) from the
   * completed operator fast-path turn. Threaded to curator + personal_skill so self-extension
   * recordings carry richer turn context (count today; deep MemU/SIS consumption is the next slice).
   */
  turnMessages?: readonly unknown[];
}

/**
 * Creates a curated, lightweight tool set for the primary operator agent.
 *
 * This set is intentionally small and high-signal compared to the full
 * createArgentCodingTools surface.
 */
export function createLightOperatorTools(options: LightOperatorToolsOptions = {}): AnyAgentTool[] {
  const tools: AnyAgentTool[] = [];

  // === Core Self-Extension & Coordination Tools ===
  // These are the highest priority for making the main operator more powerful.

  // Family / Delegation (critical for multi-agent work and "build for me" patterns)
  try {
    const familyTool = createFamilyTool({
      agentId: options.agentId,
    });
    tools.push(familyTool);
  } catch (err) {
    // Tool creation can fail in some environments (missing config, etc.)
    console.warn("[operator-light-tools] Failed to create family tool:", err);
  }

  // Skills management (create, promote, status) — direct support for self-extension
  try {
    const skillsTool = createSkillsTool({
      config: options.config,
      runId: options.runId,
    });
    tools.push(skillsTool);
  } catch (err) {
    console.warn("[operator-light-tools] Failed to create skills tool:", err);
  }

  // Personal Skills bidirectional authoring (the real self-extension surface).
  // This is the operator-owned equivalent of Hermes curator skill creation.
  // Gives the primary operator create/patch/promote over its own procedures.
  const effectiveAgentId = options.agentId ?? options.operatorAgentId;
  if (effectiveAgentId) {
    try {
      const personalSkillTool = createPersonalSkillTool({
        agentId: effectiveAgentId,
        runId: options.runId, // Phase 3 visibility threading
        turnMessages: options.turnMessages, // Phase 0.5: richer turn context
      });
      tools.push(personalSkillTool);
    } catch (err) {
      console.warn("[operator-light-tools] Failed to create personal_skill tool:", err);
    }

    // Capability Curator — the operator's active self-curation + self-building delegation loop.
    // Uses rich packets from capability-delegation.ts (tuned allow/deny + explicit handoff contracts).
    // Core of the combined "Self-Extending Operator Core" milestone.
    try {
      const curatorTool = createCuratorTool({
        agentId: effectiveAgentId,
        runId: options.runId, // Phase 3 visibility threading
        turnMessages: options.turnMessages, // Phase 0.5: richer turn context
      });
      tools.push(curatorTool);
    } catch (err) {
      console.warn("[operator-light-tools] Failed to create curator tool:", err);
    }

    // Workflow Builder — full operator-facing authoring surface for self-extension.
    // Supports draft/save + (when forPrimaryOperator) list/update/promote_pattern/delegate_build.
    // This is the wf-1 deliverable: clean operator-owned create/edit/version workflows
    // as durable self-improvement artifacts, plus goal-driven parallel delegation.
    // Only the light surface creation path (this file) ever passes forPrimaryOperator=true.
    try {
      const wfBuilder = createWorkflowBuilderTool({
        agentSessionKey: options.sessionKey,
        forPrimaryOperator: true,
        runId: options.runId,
        operatorAgentId: effectiveAgentId,
      });
      tools.push(wfBuilder);
    } catch (err) {
      console.warn("[operator-light-tools] Failed to create workflow_builder tool:", err);
    }
  }

  // Curated memory tools (MemU) — essential for the operator to have strong long-term recall
  // without pulling in the entire heavy memory tool surface
  try {
    const recallTool = createMemoryRecallTool({
      config: options.config as any,
      agentId: options.agentId,
    });
    if (recallTool) tools.push(recallTool);
  } catch (err) {
    console.warn("[operator-light-tools] Failed to create memory_recall tool:", err);
  }

  try {
    const storeTool = createMemoryStoreTool({
      config: options.config as any,
      agentId: options.agentId,
    });
    if (storeTool) tools.push(storeTool);
  } catch (err) {
    console.warn("[operator-light-tools] Failed to create memory_store tool:", err);
  }

  try {
    const categoriesTool = createMemoryCategoriesTool({
      config: options.config as any,
      agentId: options.agentId,
    });
    if (categoriesTool) tools.push(categoriesTool);
  } catch (err) {
    console.warn("[operator-light-tools] Failed to create memory_categories tool:", err);
  }

  try {
    const reflectTool = createMemoryReflectTool({
      config: options.config as any,
      agentId: options.agentId,
    });
    if (reflectTool) tools.push(reflectTool);
  } catch (err) {
    console.warn("[operator-light-tools] Failed to create memory_reflect tool:", err);
  }

  // === Additional high-value stable tools for the primary operator ===

  // Lightweight local exec (strict security). Operator can do quick local checks / orchestration
  // without pulling the full heavy bash surface or needing to spawn a family agent for tiny tasks.
  try {
    const execTool = createExecTool({
      host: "sandbox",
      security: "allowlist",
      ask: "on-miss",
    });
    if (execTool) tools.push(execTool);
  } catch (err) {
    console.warn("[operator-light-tools] Failed to create lightweight operator exec tool:", err);
  }

  // Future slices (keep this set stable while we prove the fast path + curator + workflow/goal loop):
  // - Deeper MemU warming and high-confidence candidate prefetch for the operator
  // - Lightweight dedicated memory_search variant tuned for operator recall
  // - Full goal-driven parallel self-improvement workflows + operator_goal orchestration owned by the operator (wf-2/3 now live)
  // - Stronger supervisor/handoff + result aggregation patterns for goal-driven family delegation
  // - Native core parity for the full operator fast path

  return tools;
}
