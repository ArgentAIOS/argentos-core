import type { Skill } from "../../agent-core/coding.js";
import type {
  RoomReaderOpportunity,
  RoomReaderPatternId,
  SkillEntry,
  SkillMatchCandidate,
} from "./types.js";

type PatternDefinition = {
  id: RoomReaderPatternId;
  label: string;
  keywords: string[];
  phrases: RegExp[];
  activate: RegExp[];
};

const PATTERNS: PatternDefinition[] = [
  {
    id: "podcast",
    label: "podcast",
    keywords: ["podcast", "episode", "show notes", "rss", "audio show", "interview"],
    phrases: [
      /\bpodcast\b/i,
      /\b(show notes|episode outline|episode script)\b/i,
      /\bturn (this|that|it) into (a )?(podcast|episode)\b/i,
    ],
    activate: [/\b(create|make|draft|produce|turn .* into) (a )?(podcast|episode)\b/i],
  },
  {
    id: "article",
    label: "article",
    keywords: ["article", "blog", "newsletter", "essay", "post", "write-up"],
    phrases: [
      /\b(article|blog post|newsletter|essay|write-up)\b/i,
      /\bturn (this|that|it) into (an? )?(article|blog|post|newsletter)\b/i,
    ],
    activate: [
      /\b(write|draft|create|turn .* into) (an? )?(article|blog post|newsletter|essay)\b/i,
      /\b(write|draft|create).*\b(article|blog post|newsletter|essay)\b/i,
    ],
  },
  {
    id: "data_collection",
    label: "data collection",
    keywords: ["spreadsheet", "csv", "table", "rows", "leads", "prospects", "business info"],
    phrases: [
      /\b(spreadsheet|csv|table|dataset|data collection)\b/i,
      /\b(collect|gather|enrich|scrape|fill in).*\b(data|business info|leads|prospects|rows)\b/i,
      /\b(business info|company info|lead list|prospect list)\b/i,
    ],
    activate: [
      /\b(collect|gather|enrich|scrape|fill in).*\b(spreadsheet|csv|table|leads|prospects|business info)\b/i,
    ],
  },
  {
    id: "research",
    label: "research",
    keywords: ["research", "investigate", "compare", "sources", "market map", "literature"],
    phrases: [
      /\b(research|investigate|deep dive|market map|literature review)\b/i,
      /\b(compare|evaluate).*\b(options|vendors|tools|papers|sources)\b/i,
    ],
    activate: [
      /\b(research|investigate|compare|evaluate).*\b(for me|with sources|and summarize)\b/i,
    ],
  },
  {
    id: "workflow_automation",
    label: "workflow automation",
    keywords: ["workflow", "automation", "automate", "pipeline", "trigger", "scheduled"],
    phrases: [
      /\b(workflow|automation|automate|pipeline)\b/i,
      /\b(when|if).*\bthen\b/i,
      /\b(every day|daily|weekly|scheduled|recurring).*\b(report|brief|send|run)\b/i,
    ],
    activate: [
      /\b(automate|set up|create|build).*\b(workflow|automation|pipeline|scheduled|recurring)\b/i,
    ],
  },
  {
    id: "project_build",
    label: "project build",
    keywords: [
      "build",
      "app",
      "application",
      "coding app",
      "coding application",
      "software",
      "api",
      "saas",
      "platform",
      "agent",
      "project",
    ],
    phrases: [
      /\b(build|create|make|scaffold|architect|spec|plan).*\b(app|application|coding app|coding application|software|api|saas|platform|agent|project|feature|tool)\b/i,
      /\b(i want|we need|help me).*\b(build|ship|launch).*\b(app|application|coding app|coding application|software|product|platform|tool)\b/i,
    ],
    activate: [
      /\b(build|create|make|scaffold).*\b(app|application|coding app|coding application|software|api|saas|platform|agent|project|feature|tool)\b/i,
      /\b(i want|we need|help me).*\b(build|ship|launch).*\b(app|application|coding app|coding application|software|product|platform|tool)\b/i,
    ],
  },
];

const STOP_COMMAND_RE = /^\s*\//;

function clampConfidence(value: number): number {
  return Math.max(0, Math.min(1, Math.round(value * 100) / 100));
}

function includesAny(haystack: string, needles: string[]): boolean {
  return needles.some((needle) => haystack.includes(needle));
}

function skillText(skill: Skill): string {
  return [skill.name, skill.description ?? ""].join(" ").toLowerCase();
}

function candidateText(candidate: SkillMatchCandidate): string {
  return [candidate.name, candidate.source, candidate.reasons.join(" ")].join(" ").toLowerCase();
}

function scorePattern(
  prompt: string,
  pattern: PatternDefinition,
): { score: number; reasons: string[] } {
  const lowered = prompt.toLowerCase();
  const reasons: string[] = [];
  let score = 0;

  const keywordHits = pattern.keywords.filter((keyword) => lowered.includes(keyword));
  if (keywordHits.length > 0) {
    score += Math.min(0.35, keywordHits.length * 0.12);
    reasons.push(`${pattern.id}:keywords:${keywordHits.slice(0, 3).join(",")}`);
  }

  const phraseHits = pattern.phrases.filter((phrase) => phrase.test(prompt)).length;
  if (phraseHits > 0) {
    score += Math.min(0.35, phraseHits * 0.22);
    reasons.push(`${pattern.id}:phrase`);
  }

  const activateHits = pattern.activate.filter((phrase) => phrase.test(prompt)).length;
  if (activateHits > 0) {
    score += Math.min(0.3, activateHits * 0.24);
    reasons.push(`${pattern.id}:action`);
  }

  return { score: clampConfidence(score), reasons };
}

function selectRecommendedSkill(params: {
  pattern: PatternDefinition;
  matchedSkills: SkillMatchCandidate[];
  skills: Skill[];
}): RoomReaderOpportunity["recommended"] | undefined {
  if (params.pattern.id === "project_build") {
    return {
      kind: "workflow",
      name: "specforge",
      source: "core",
    };
  }

  const matched = params.matchedSkills.find((candidate) =>
    includesAny(candidateText(candidate), [
      params.pattern.id,
      params.pattern.label,
      ...params.pattern.keywords,
    ]),
  );
  if (matched) {
    return {
      kind: "skill",
      name: matched.name,
      source: matched.source,
    };
  }

  const skill = params.skills.find((entry) =>
    includesAny(skillText(entry), [
      params.pattern.id,
      params.pattern.label,
      ...params.pattern.keywords,
    ]),
  );
  if (skill) {
    return {
      kind: "skill",
      name: skill.name,
      source: skill.source,
    };
  }

  return undefined;
}

export function resolveRoomReaderOpportunity(params: {
  prompt: string;
  entries?: SkillEntry[];
  resolvedSkills?: Skill[];
  matchedSkills?: SkillMatchCandidate[];
}): RoomReaderOpportunity {
  const prompt = params.prompt.trim();
  if (!prompt || STOP_COMMAND_RE.test(prompt)) {
    return {
      mode: "observe",
      patterns: [],
      confidence: 0,
      reasons: ["no natural-language opportunity signal"],
    };
  }

  const scored = PATTERNS.map((pattern) => {
    const result = scorePattern(prompt, pattern);
    return {
      pattern,
      confidence: result.score,
      reasons: result.reasons,
    };
  })
    .filter((entry) => entry.confidence > 0)
    .toSorted((a, b) => b.confidence - a.confidence || a.pattern.id.localeCompare(b.pattern.id));

  const top = scored[0];
  if (!top || top.confidence < 0.45) {
    return {
      mode: "observe",
      patterns: scored.slice(0, 2).map((entry) => ({
        id: entry.pattern.id,
        confidence: entry.confidence,
      })),
      confidence: top?.confidence ?? 0,
      reasons: top?.reasons ?? ["no confident opportunity pattern"],
    };
  }

  const actionMatched = top.pattern.activate.some((phrase) => phrase.test(prompt));
  const mode = top.confidence >= 0.55 && actionMatched ? "activate" : "offer";
  const skills = params.resolvedSkills ?? params.entries?.map((entry) => entry.skill) ?? [];
  const recommended = selectRecommendedSkill({
    pattern: top.pattern,
    matchedSkills: params.matchedSkills ?? [],
    skills,
  });

  return {
    mode,
    patterns: scored.slice(0, 2).map((entry) => ({
      id: entry.pattern.id,
      confidence: entry.confidence,
    })),
    confidence: top.confidence,
    reasons: top.reasons.slice(0, 3),
    recommended,
  };
}

export function buildRoomReaderOpportunityPromptBlock(
  opportunity: RoomReaderOpportunity,
): string | undefined {
  if (opportunity.mode === "observe" || opportunity.patterns.length === 0) {
    return undefined;
  }
  const primary = opportunity.patterns[0];
  if (!primary) {
    return undefined;
  }
  const lines = [
    "## Opportunity Router",
    `Detected pattern: ${primary.id} (${opportunity.confidence.toFixed(2)} confidence).`,
    `Action mode: ${opportunity.mode}.`,
  ];
  if (opportunity.recommended) {
    lines.push(`Recommended ${opportunity.recommended.kind}: ${opportunity.recommended.name}.`);
  }
  if (opportunity.reasons.length > 0) {
    lines.push(`Reason: ${opportunity.reasons[0]}.`);
  }
  lines.push(
    opportunity.mode === "activate"
      ? "If this fits the user request, use the recommended skill or workflow as the primary path."
      : "Offer the recommended skill or workflow briefly if it would help; otherwise continue normally.",
  );
  return lines.join("\n");
}
