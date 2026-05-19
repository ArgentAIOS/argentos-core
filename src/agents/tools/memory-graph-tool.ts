/**
 * Memory Graph Tool — Entity-centric memory exploration
 *
 * Shows all memories linked to a specific entity and reveals connections
 * to other entities. Supports depth traversal for discovering relationships.
 */

import { Type } from "@sinclair/typebox";
import type { ArgentConfig } from "../../config/config.js";
import type { AnyAgentTool } from "./common.js";
import { getStorageAdapter } from "../../data/storage-factory.js";
import { jsonResult, readStringParam, readNumberParam } from "./common.js";

const MemoryGraphSchema = Type.Object({
  entity: Type.String({ description: "Entity name to explore" }),
  depth: Type.Optional(
    Type.Number({
      description:
        "1 = direct memories only, 2 = also show connected entities' memories (default: 1)",
      default: 1,
    }),
  ),
  limit: Type.Optional(
    Type.Number({ description: "Max memories per entity (default: 30)", default: 30 }),
  ),
});

// Significance sort order (higher = more significant)
const SIG_ORDER: Record<string, number> = {
  core: 4,
  important: 3,
  noteworthy: 2,
  routine: 1,
};

// Type emoji map
const TYPE_EMOJI: Record<string, string> = {
  profile: "\uD83D\uDC64",
  event: "\uD83D\uDCC5",
  knowledge: "\uD83D\uDCD6",
  behavior: "\uD83D\uDCA1",
  skill: "\uD83D\uDEE0\uFE0F",
  tool: "\u2699\uFE0F",
  self: "\uD83E\uDE9E",
  episode: "\uD83C\uDFAC",
};

export function createMemoryGraphTool(options: {
  config?: ArgentConfig;
  agentId?: string;
}): AnyAgentTool | null {
  const cfg = options.config;
  if (!cfg) return null;

  return {
    label: "Memory Graph",
    name: "memory_graph",
    description:
      "Explore the memory graph starting from a specific entity (person, place, project, etc). " +
      "Shows all memories linked to that entity sorted by significance, and reveals connections to other entities. " +
      "Use depth=2 to also see memories from connected entities. " +
      "Great for building a full picture of a person, project, or topic and discovering relationships.",
    parameters: MemoryGraphSchema,
    execute: async (_toolCallId, params) => {
      const entityName = readStringParam(params, "entity", { required: true });
      const depth = readNumberParam(params, "depth", { integer: true }) ?? 1;
      const limit = readNumberParam(params, "limit", { integer: true }) ?? 30;

      try {
        const storage = await getStorageAdapter();
        const memory =
          options.agentId && storage.memory.withAgentId
            ? storage.memory.withAgentId(options.agentId)
            : storage.memory;

        const rootEntity = await memory.findEntityByName(entityName);
        if (!rootEntity) {
          return jsonResult({
            found: false,
            entity: entityName,
            message: `No entity found with name "${entityName}". Try memory_entity with action='list' to see known entities.`,
          });
        }

        // Get direct memories for root entity
        const directItems = await memory.getEntityItems(rootEntity.id, limit);

        // Sort by significance DESC, then created_at DESC
        directItems.sort((a, b) => {
          const sigDiff = (SIG_ORDER[b.significance] ?? 1) - (SIG_ORDER[a.significance] ?? 1);
          if (sigDiff !== 0) return sigDiff;
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        });

        // Collect connected entities from direct memories
        const connectedEntities = new Map<
          string,
          { name: string; sharedCount: number; type: string; relationship: string | null }
        >();
        const seenItemIds = new Set(directItems.map((i) => i.id));

        for (const item of directItems) {
          const linkedEntities = await memory.getItemEntities(item.id);
          for (const e of linkedEntities) {
            if (e.id === rootEntity.id) continue;
            const existing = connectedEntities.get(e.id);
            if (existing) {
              existing.sharedCount++;
            } else {
              connectedEntities.set(e.id, {
                name: e.name,
                sharedCount: 1,
                type: e.entityType,
                relationship: e.relationship,
              });
            }
          }
        }

        // Format direct memories
        const directFormatted = directItems.map((item) => {
          const emoji = TYPE_EMOJI[item.memoryType] ?? "\uD83D\uDCD6";
          return {
            id: item.id,
            type: item.memoryType,
            summary: `${emoji} (${item.memoryType}) ${item.summary}`,
            significance: item.significance,
            emotion: item.emotionalValence !== 0 ? item.emotionalValence : undefined,
          };
        });

        // Build connected entities summary, sorted by shared memory count
        const connectedSorted = Array.from(connectedEntities.values()).sort(
          (a, b) => b.sharedCount - a.sharedCount,
        );

        const connectedFormatted = connectedSorted.map((e) => ({
          name: e.name,
          sharedMemories: e.sharedCount,
          type: e.type,
          relationship: e.relationship,
        }));

        // Depth 2: also gather memories from connected entities
        let depth2Sections: Array<{
          entity: string;
          memories: Array<{ type: string; summary: string; significance: string }>;
        }> = [];

        if (depth >= 2 && connectedSorted.length > 0) {
          // Only explore top connected entities (up to 5)
          const toExplore = connectedSorted.slice(0, 5);
          for (const connected of toExplore) {
            const connEntity = await memory.findEntityByName(connected.name);
            if (!connEntity) continue;

            const connItems = await memory.getEntityItems(connEntity.id, Math.min(limit, 10));
            // Filter out items we already have
            const newItems = connItems.filter((i) => !seenItemIds.has(i.id));
            for (const item of newItems) {
              seenItemIds.add(item.id);
            }

            if (newItems.length > 0) {
              newItems.sort((a, b) => {
                const sigDiff = (SIG_ORDER[b.significance] ?? 1) - (SIG_ORDER[a.significance] ?? 1);
                if (sigDiff !== 0) return sigDiff;
                return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
              });

              depth2Sections.push({
                entity: connected.name,
                memories: newItems.map((item) => {
                  const emoji = TYPE_EMOJI[item.memoryType] ?? "\uD83D\uDCD6";
                  return {
                    type: item.memoryType,
                    summary: `${emoji} (${item.memoryType}) ${item.summary}`,
                    significance: item.significance,
                  };
                }),
              });
            }
          }
        }

        // Build text output
        let text = `# Entity Graph: ${rootEntity.name}\n\n`;

        if (rootEntity.entityType || rootEntity.relationship) {
          const parts: string[] = [];
          if (rootEntity.entityType) parts.push(`Type: ${rootEntity.entityType}`);
          if (rootEntity.relationship) parts.push(`Relationship: ${rootEntity.relationship}`);
          if (rootEntity.bondStrength > 0)
            parts.push(`Bond: ${(rootEntity.bondStrength * 100).toFixed(0)}%`);
          text += `${parts.join(" | ")}\n\n`;
        }

        text += `## Direct Memories (${directFormatted.length})\n\n`;
        for (const m of directFormatted) {
          text += `${m.summary}\n`;
          if (m.emotion !== undefined) {
            text += `  Significance: ${m.significance} | Emotion: ${m.emotion > 0 ? "+" : ""}${m.emotion.toFixed(1)}\n`;
          }
        }

        if (connectedFormatted.length > 0) {
          text += `\n## Connected Entities (${connectedFormatted.length})\n\n`;
          for (const e of connectedFormatted) {
            const desc = e.relationship ? ` - ${e.relationship}` : "";
            text += `${e.name} (${e.sharedMemories} shared memories)${desc}\n`;
          }
        }

        if (depth2Sections.length > 0) {
          text += `\n## Extended Graph (depth 2)\n\n`;
          for (const section of depth2Sections) {
            text += `### ${section.entity} (${section.memories.length} additional memories)\n\n`;
            for (const m of section.memories) {
              text += `${m.summary}\n`;
            }
            text += "\n";
          }
        }

        return jsonResult({
          graph: text.trim(),
          entity: {
            name: rootEntity.name,
            type: rootEntity.entityType,
            relationship: rootEntity.relationship,
            bondStrength: rootEntity.bondStrength,
            memoryCount: rootEntity.memoryCount,
          },
          directMemories: directFormatted.length,
          connectedEntities: connectedFormatted,
          depth2Sections: depth2Sections.length > 0 ? depth2Sections.length : undefined,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return jsonResult({ found: false, error: message });
      }
    },
  };
}
