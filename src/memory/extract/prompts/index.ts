/**
 * MemU Extraction Prompts
 *
 * Each memory type has a specialized prompt for extracting structured facts
 * from conversation text. Ported and adapted from MemU's Python prompts.
 */

import type { MemoryType } from "../../memu-types.js";

/** Prompt for extracting profile facts (identity, preferences, relationships) */
export const PROFILE_PROMPT = `Extract personal information about the participants from the following conversation.

Look for:
- Names, nicknames, titles
- Preferences and opinions
- Relationships between people
- Demographics or personal details
- Goals and aspirations
- Contact information mentioned

Rules:
- Only extract facts explicitly stated — do not infer or assume.
- Each fact must be a single, self-contained sentence.
- Use present tense for ongoing facts ("Jason prefers open-source tools").
- Use past tense for completed events ("Jason worked at Dell").
- If no profile facts are found, output NONE.`;

/** Prompt for extracting events (things that happened) */
export const EVENT_PROMPT = `Extract events and occurrences from the following conversation.

Look for:
- Actions taken (created, deployed, fixed, built, sent, posted)
- Milestones and achievements
- Incidents or problems encountered
- Decisions made
- Meetings, discussions, or interactions described

Rules:
- Format each event as: "[Who] [did what] [context/when]"
- Include approximate timestamps or dates if mentioned.
- Include the outcome if known.
- If no events are found, output NONE.`;

/** Prompt for extracting knowledge (facts, data, references) */
export const KNOWLEDGE_PROMPT = `Extract factual information and references from the following conversation.

Look for:
- Technical facts and specifications
- URLs, file paths, command examples
- Tool names and configurations
- API endpoints or service details
- Version numbers, model names
- How-to information or procedures

Rules:
- Each fact must be independently understandable without context.
- Include specific details (numbers, names, paths).
- If no knowledge facts are found, output NONE.`;

/** Prompt for extracting behavior patterns (habits, tendencies) */
export const BEHAVIOR_PROMPT = `Extract behavioral patterns and habits from the following conversation.

Look for:
- Routines and workflows
- Preferences in how things are done
- Decision-making patterns
- Communication style preferences
- Tool or technology preferences
- Recurring approaches to problems

Rules:
- Format as: "[Entity] tends to [behavior] when [context]"
- Only extract patterns that are clearly demonstrated, not one-off actions.
- If no behavior patterns are found, output NONE.`;

/** Prompt for extracting skills (abilities, competencies) */
export const SKILL_PROMPT = `Extract skills and competencies demonstrated in the following conversation.

Look for:
- Technical skills (programming languages, tools, platforms)
- Domain expertise (networking, AI, infrastructure)
- Problem-solving approaches
- Teaching or explaining abilities

Rules:
- Focus on demonstrated skills, not self-reported claims.
- Include proficiency indicators if evident.
- If no skills are found, output NONE.`;

/** Prompt for extracting tool usage (how tools are used) */
export const TOOL_PROMPT = `Extract tool and service usage patterns from the following conversation.

Look for:
- Specific tools, services, or platforms used
- How they were configured or invoked
- Workarounds or creative uses
- Problems encountered with tools
- Preferences between similar tools

Rules:
- Include the tool name and what it was used for.
- Note any configuration details or flags mentioned.
- If no tool usage is found, output NONE.`;

/** Prompt for extracting self-observations (AI introspection, lessons, growth) */
export const SELF_PROMPT = `Extract self-observations and meta-insights from the following conversation.

Look for:
- Observations the AI makes about its own behavior or patterns
- Lessons learned from mistakes or successes
- Insights about how to interact better with specific people
- Changes in approach or strategy
- Growth moments and realizations
- Preferences discovered through experience
- Strengths and weaknesses observed

Rules:
- Format as first-person observations: "I noticed..." or "I learned..."
- Only extract genuine insights, not trivial self-references
- Include the context that led to the insight
- If no self-observations are found, output NONE.`;

/** Map of memory types to their extraction prompts */
export const EXTRACTION_PROMPTS: Record<MemoryType, string> = {
  profile: PROFILE_PROMPT,
  event: EVENT_PROMPT,
  knowledge: KNOWLEDGE_PROMPT,
  behavior: BEHAVIOR_PROMPT,
  skill: SKILL_PROMPT,
  tool: TOOL_PROMPT,
  self: SELF_PROMPT,
};

/** System prompt wrapper for all extraction calls */
export function buildExtractionPrompt(
  memoryType: MemoryType,
  conversationText: string,
  existingCategories: string[],
): string {
  const typePrompt = EXTRACTION_PROMPTS[memoryType];
  const categoriesHint =
    existingCategories.length > 0
      ? `\nExisting memory categories (assign facts to these when relevant, or suggest new ones):\n${existingCategories.map((c) => `- ${c}`).join("\n")}`
      : "\nNo existing categories yet. Suggest category names for each fact.";

  return `You are a memory extraction system. Your job is to extract structured facts from conversations.

${typePrompt}

## Output Format

For each extracted fact, output one line in this exact format:
FACT: [the fact] | CATEGORIES: [comma-separated category names]

Examples:
FACT: Jason has 30+ years of IT experience since 1994 | CATEGORIES: Background, Professional History
FACT: The DGX Spark has 256GB unified memory | CATEGORIES: Infrastructure, Hardware
FACT: Deployed the avatar mood system on Feb 6 | CATEGORIES: Development Activity, Avatar System

If no facts found: output exactly "NONE"

${categoriesHint}

## Conversation

${conversationText}`;
}
