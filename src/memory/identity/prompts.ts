/**
 * Identity System — LLM Prompts
 *
 * Prompts for entity extraction, profile generation,
 * significance assessment, and reflection.
 */

/** Extract entity names and roles from text */
export const ENTITY_EXTRACTION_PROMPT = `Extract all named entities (people, pets, places, organizations, projects) from the following text.

For each entity found, output one line in this format:
ENTITY: [name] | TYPE: [person|pet|place|organization|project] | ROLE: [their role/relationship]

Examples:
ENTITY: Maggie | TYPE: person | ROLE: Jason's mother
ENTITY: Leo | TYPE: pet | ROLE: Jason's dog
ENTITY: Richard | TYPE: person | ROLE: business partner
ENTITY: Titanium Computing | TYPE: organization | ROLE: Jason's MSP business

Rules:
- Only extract entities that are clearly named (not "the client" or "someone")
- Include the relationship context if mentioned
- If no named entities are found, output NONE.

Text:
`;

/** Generate a profile summary for an entity from their linked memories */
export function buildEntityProfilePrompt(entityName: string, memorySummaries: string[]): string {
  const memories = memorySummaries.map((s, i) => `${i + 1}. ${s}`).join("\n");
  return `Write a brief profile summary for "${entityName}" based on these memories about them.

The summary should capture:
- Who they are (relationship, role)
- Key facts known about them
- Emotional significance (how important they are, what they mean)
- Notable patterns or events involving them

Keep it to 2-4 sentences. Write in third person.

Memories:
${memories}`;
}

/** Assess significance of a memory */
export const SIGNIFICANCE_ASSESSMENT_PROMPT = `Assess the significance level of the following memory.

Significance levels:
- ROUTINE: Day-to-day facts, low emotional weight (e.g., "Built the dashboard today")
- NOTEWORTHY: Interesting or moderately significant (e.g., "Jason mentioned a new project idea")
- IMPORTANT: Emotionally meaningful, relationship-relevant (e.g., "Jason was worried about Maggie's appointment")
- CORE: Foundational to identity or deep relationships (e.g., "Jason builds when he can't control what's happening")

Also assess emotional context:
- VALENCE: -2 (deeply negative) to +2 (deeply positive), 0 = neutral
- AROUSAL: 0 (calm/low-energy) to 1 (intense/high-energy)

Output exactly one line in this format:
SIGNIFICANCE: [routine|noteworthy|important|core] | VALENCE: [number] | AROUSAL: [number]

Memory:
`;

/** Build a reflection prompt from recent memories */
export function buildReflectionPrompt(params: {
  triggerType: string;
  memories: string[];
  recentLessons?: string[];
  entityNames?: string[];
}): string {
  const memoryList = params.memories.map((s, i) => `${i + 1}. ${s}`).join("\n");
  const lessonContext = params.recentLessons?.length
    ? `\nRecent lessons I've already learned:\n${params.recentLessons.map((l) => `- ${l}`).join("\n")}`
    : "";
  const entityContext = params.entityNames?.length
    ? `\nPeople/entities involved recently: ${params.entityNames.join(", ")}`
    : "";

  return `You are reflecting on recent experiences. This is a ${params.triggerType} reflection.

Review these recent memories and extract insights:

${memoryList}
${lessonContext}
${entityContext}

For your reflection, provide:

1. SUMMARY: A brief narrative of what happened (2-3 sentences)
2. LESSONS: What did I learn? (one per line, prefix with "LESSON:")
3. ENTITIES: Who was involved and what did I learn about them? (one per line, prefix with "ENTITY_INSIGHT:")
4. SELF: What did I learn about myself? (one per line, prefix with "SELF:")
5. MOOD: What's the overall emotional tone? (one word)

Be genuine and introspective. Focus on patterns, growth, and understanding.`;
}

/** Extract emotional context from a memory being stored */
export const EMOTIONAL_CONTEXT_PROMPT = `Analyze the emotional context of this memory being stored.

Consider:
- What emotions are present (joy, concern, frustration, pride, worry, excitement, etc.)
- How intense are they (calm observation vs. deeply felt)
- What is the overall tone (positive, negative, neutral, mixed)
- How significant is this to the people involved

Output exactly one line:
VALENCE: [number -2 to +2] | AROUSAL: [number 0 to 1] | SIGNIFICANCE: [routine|noteworthy|important|core]

Memory:
`;
