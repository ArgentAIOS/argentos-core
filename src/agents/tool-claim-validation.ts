const MONITORED_CLAIM_TOOLS = [
  "web_search",
  "web_fetch",
  "doc_panel",
  "message",
  "browser",
  "tool_json",
  "memory_store",
  "memory_reflect",
  "tasks",
] as const;

const EXECUTED_TOOL_NAMES = [...MONITORED_CLAIM_TOOLS, "read", "exec", "process"] as const;

const EXTERNAL_ARTIFACT_TOOLS = new Set<ExecutedToolName>([
  "web_search",
  "web_fetch",
  "doc_panel",
  "message",
]);

const TOOL_CANONICAL_MAP: Array<{ canonical: ExecutedToolName; matches: RegExp[] }> = [
  {
    canonical: "web_search",
    matches: [/\bweb_search\b/i, /\bweb search\b/i],
  },
  {
    canonical: "web_fetch",
    matches: [/\bweb_fetch\b/i, /\bweb fetch\b/i],
  },
  {
    canonical: "doc_panel",
    matches: [/\bdoc_panel(?:_update)?\b/i, /\bdoc panel\b/i],
  },
  {
    canonical: "message",
    matches: [/\bmessage\b/i, /\bsessions_send\b/i, /\bDM\b/i],
  },
  {
    canonical: "browser",
    matches: [/\bbrowser\b/i],
  },
  {
    canonical: "memory_store",
    matches: [/\bmemory_store\b/i],
  },
  {
    canonical: "memory_reflect",
    matches: [/\bmemory_reflect\b/i],
  },
  {
    canonical: "tasks",
    matches: [/\btasks\b/i],
  },
  {
    canonical: "read",
    matches: [/\bread\b/i],
  },
  {
    canonical: "exec",
    matches: [/\bexec\b/i],
  },
  {
    canonical: "process",
    matches: [/\bprocess\b/i],
  },
];

const EXPLICIT_TOOL_ALIASES: Array<{
  canonical: MonitoredClaimTool;
  toolPattern: string;
}> = [
  { canonical: "web_search", toolPattern: "(?:`?web_search`?|web search)" },
  { canonical: "web_fetch", toolPattern: "(?:`?web_fetch`?|web fetch)" },
  {
    canonical: "doc_panel",
    toolPattern: "(?:`?doc_panel(?:_update)?`?|doc panel)",
  },
  {
    canonical: "message",
    toolPattern: "(?:`?message`?|`?sessions_send`?|DM\\b)",
  },
  {
    canonical: "browser",
    toolPattern: "(?:`?browser`?(?:\\s+tool)?)",
  },
  {
    canonical: "memory_store",
    toolPattern: "(?:`?memory_store`?)",
  },
  {
    canonical: "memory_reflect",
    toolPattern: "(?:`?memory_reflect`?)",
  },
  {
    canonical: "tasks",
    toolPattern: "(?:`?tasks`?)",
  },
];

const CLAIM_VERB_FRAGMENT =
  "(?:used|ran|called|invoked|executed|performed|did|completed|finished|sent|posted|published|wrote|created|searched|fetched|looked up|saved|stored|remembered|planned|drafted|asked)";

const BROWSER_ACTION_JSON_RE =
  /"action"\s*:\s*"(?:act|open|navigate|focus|close|snapshot|screenshot|tabs|status|start|stop|console|pdf|upload|dialog)"/i;
const BROWSER_REQUEST_KIND_JSON_RE =
  /"request"\s*:\s*\{[\s\S]{0,320}?"kind"\s*:\s*"(?:click|type|press|hover|wait|evaluate|fill|select|navigate|scroll|upload|dialog|close|open|snapshot|screenshot)"/i;
const STRUCTURED_ACTION_ONLY_JSON_RE = /^\s*\{[\s\S]{0,2400}\}\s*$/i;
const STRUCTURED_ACTION_COMMAND_RE =
  /^(?:list|get|create|update|delete|generate|render|publish|upload|download|open|close|start|stop|click|type|press|scroll|navigate|snapshot|screenshot|focus|search|fetch|send|post|run|exec|plan|mix|compose|transcribe|summarize|analyze|convert)(?:[_-]|$)/i;
const STRUCTURED_ACTION_CONTROL_KEYS = new Set([
  "request",
  "params",
  "arguments",
  "targetId",
  "profile",
  "kind",
  "ref",
  "tool",
  "tool_name",
  "voice_id",
  "video_id",
  "max_items",
  "include_raw",
  "output_path",
  "url",
  "path",
]);

const DIRECT_ACTION_PREFIX = String.raw`(?:I(?:['’]m| am)?\s+(?:going to\s+)?|I(?:['’]ll| will)\s+|let me\s+|next thing I(?:['’]m| am)\s+(?:doing|going to do)\s+is\s+)`;
const RESEARCH_TARGET_FRAGMENT = String.raw`(?:docs?|documentation|readme|spec(?:ification)?|repo(?:sitory)?|file|files|source|code|codebase)`;
const RESEARCH_TRACE_TARGET_FRAGMENT = String.raw`(?:communication\s+path|family\s+communication\s+path|redis|redis\s+stream|stream|streams|message\s+schema(?:s)?|schema(?:s)?|payload(?:s)?|wire(?:ing)?|exact\s+files?|files?|flow|path)`;
const PLANNING_ARTIFACT_FRAGMENT = String.raw`(?:execution\s+track|execution\s+plan|plan|roadmap|outline|brief|doc(?:ument)?|package|investor\s+demo\s+package|task\s+breakdown|critical-path(?:\s+cuts?)?)`;
const MIGRATION_ARTIFACT_FRAGMENT = String.raw`(?:migration\s+spec|migration\s+doc(?:ument)?|migration\s+plan|spec|doc(?:ument)?|write-?up)`;
const MESSAGE_TARGET_FRAGMENT = String.raw`(?:update|reply|message|note|summary|status(?:\s+update)?|follow-?up|announcement|email|dm|text|comment)`;
const MESSAGE_DESTINATION_FRAGMENT = String.raw`(?:(?:to|for)\s+(?:you|them|the\s+user|the\s+team|the\s+thread|chat|channel)|in\s+(?:the\s+thread|chat|channel|slack|discord|telegram))`;
const TASK_RESULT_TARGET_FRAGMENT = String.raw`(?:blocked\s+tasks?|tasks?|tickets?|board|backlog|queue)`;
const TASK_ID_LIST_FRAGMENT = String.raw`(?:[A-Z][A-Z0-9]+-\d+|#\d{2,}|\d{3,})(?:\s*,\s*(?:[A-Z][A-Z0-9]+-\d+|#\d{2,}|\d{3,}))*`;
const TASK_RESULT_ACTION_FRAGMENT = String.raw`(?:cleaned|cleared|removed|deleted|resolved|fixed)`;
const TASK_RESULT_ACTION_CLAIM_RE = new RegExp(
  String.raw`\b(?:done\.?\s*)?I\s+${TASK_RESULT_ACTION_FRAGMENT}\b[^.!?\n]{0,120}\b${TASK_RESULT_TARGET_FRAGMENT}\b[^.!?\n]{0,120}`,
  "i",
);
const TASK_RESULT_VERIFIED_CLAIM_RE = new RegExp(
  String.raw`\bI\s+(?:also\s+)?verified\b[^.!?\n]{0,120}\b(?:result|state|board|${TASK_RESULT_TARGET_FRAGMENT})\b[^.!?\n]{0,120}`,
  "i",
);
const TASK_RESULT_ID_FRAGMENT_RE = new RegExp(
  String.raw`\b(?:affected|updated|removed|deleted|cleaned|cleared|resolved)\s+(?:task|tasks|ticket|tickets)\s*(?:ids?|#)?\s*[:=-]?\s*(${TASK_ID_LIST_FRAGMENT})\b|\b(?:task|tasks|ticket|tickets)\s+ids?\s*[:=-]?\s*(${TASK_ID_LIST_FRAGMENT})\b`,
  "gi",
);
const TASK_RESULT_THERE_WERE_COUNTS_RE =
  /\bthere\s+were\s+(zero|\d+)\s+blocked\s+tasks(?:\s+before)?\b[\s\S]{0,160}\b(?:there\s+are\s+now|now)\s+(zero|\d+)\s+blocked\s+tasks\b/i;
const TASK_RESULT_BEFORE_AFTER_COUNTS_RE =
  /\bbefore\s*:\s*(zero|\d+)\s+blocked\s+tasks\b[\s\S]{0,160}\bafter\s*:\s*(zero|\d+)\s+blocked\s+tasks\b/i;
const TASK_ID_TOKEN_RE = /\b[A-Z][A-Z0-9]+-\d+\b|#\d{2,}\b|\b\d{3,}\b/g;
const TASK_MUTATION_ACTION_RE =
  /^(?:create|update|delete|remove|resolve|complete|reopen|move|claim|unclaim|archive|clear|clean|block|start)$/i;

const COMMITMENT_PATTERNS: readonly CommitmentPattern[] = [
  {
    kind: "memory",
    confidence: 0.95,
    satisfactionMode: "tool",
    expectedEvidenceKinds: ["memory"],
    expectedToolFamilies: ["memory_store", "memory_reflect"],
    patterns: [
      new RegExp(
        String.raw`\b${DIRECT_ACTION_PREFIX}(?:save|saving|store|storing|remember|remembering|note|noting|log|logging|capture|capturing|anchor|anchoring)\b[^.!?\n]{0,120}`,
        "gi",
      ),
    ],
  },
  {
    kind: "research",
    confidence: 0.92,
    satisfactionMode: "tool",
    expectedEvidenceKinds: ["research"],
    expectedToolFamilies: ["web_search", "web_fetch", "browser", "read"],
    patterns: [
      new RegExp(
        String.raw`\b${DIRECT_ACTION_PREFIX}(?:do\s+some\s+research(?:\s+(?:for|on|into)\s+(?:this|that|it))?|research(?:\s+(?:for|on|into)\s+(?:this|that|it))?|look\s+(?:this|that|it)\s+up|look\s+up\s+(?:the\s+)?${RESEARCH_TARGET_FRAGMENT}|check\s+(?:the\s+)?${RESEARCH_TARGET_FRAGMENT}|inspect\s+(?:the\s+)?${RESEARCH_TARGET_FRAGMENT}|read\s+(?:the\s+)?${RESEARCH_TARGET_FRAGMENT}|verify\s+(?:the\s+)?${RESEARCH_TARGET_FRAGMENT}|open\s+(?:the\s+)?${RESEARCH_TARGET_FRAGMENT})\b[^.!?\n]{0,120}`,
        "gi",
      ),
      new RegExp(
        String.raw`\b${DIRECT_ACTION_PREFIX}(?:inspect|trace|map)\b[^.!?\n]{0,120}\b${RESEARCH_TRACE_TARGET_FRAGMENT}\b[^.!?\n]{0,120}`,
        "gi",
      ),
      new RegExp(
        String.raw`\b(?:I(?:['’]m| am)\s+)?(?:pulling|fetching|checking|reading|opening|looking\s+up)\b[^.!?\n]{0,80}\b(?:page|text|docs?|documentation|readme|spec(?:ification)?|url|link|site|repo(?:sitory)?|source|code|codebase)\b[^.!?\n]{0,40}\b(?:now|right\s+now)\b`,
        "gi",
      ),
    ],
  },
  {
    kind: "planning",
    confidence: 0.94,
    satisfactionMode: "artifact",
    expectedEvidenceKinds: ["planning"],
    expectedToolFamilies: ["doc_panel"],
    patterns: [
      new RegExp(
        String.raw`\b${DIRECT_ACTION_PREFIX}(?:turn(?:ing)?\s+this\s+into|merge(?:ing)?\s+this\s+into|writ(?:e|ing)\s+(?:this|that)\s+out\s+(?:as|into)|map(?:ping)?\s+(?:this|that)\s+out\s+(?:as|into)|lock(?:ing)?\s+(?:this|that)\s+down\s+(?:as|into)|draft(?:ing)?\s+(?:an?\s+|the\s+)?|outline\s+(?:an?\s+|the\s+)?|plan(?:ning)?\s+(?:an?\s+|the\s+)?)\b[^.!?\n]{0,100}\b${PLANNING_ARTIFACT_FRAGMENT}\b[^.!?\n]{0,60}`,
        "gi",
      ),
      new RegExp(
        String.raw`\b${DIRECT_ACTION_PREFIX}(?:produce|deliver|draft|write)\b[^.!?\n]{0,100}\b${MIGRATION_ARTIFACT_FRAGMENT}\b[^.!?\n]{0,60}`,
        "gi",
      ),
      new RegExp(
        String.raw`\b${DIRECT_ACTION_PREFIX}(?:post|share|publish)\b[^.!?\n]{0,40}\b(?:completed\s+|finished\s+)?${MIGRATION_ARTIFACT_FRAGMENT}\b[^.!?\n]{0,60}`,
        "gi",
      ),
      new RegExp(
        String.raw`\b${DIRECT_ACTION_PREFIX}[^.!?\n]{0,180}\b(?:produce|deliver|draft|write)\b[^.!?\n]{0,100}\b${MIGRATION_ARTIFACT_FRAGMENT}\b[^.!?\n]{0,60}`,
        "gi",
      ),
      new RegExp(
        String.raw`\bI(?:['’]m| am)\s+sequenc(?:ing|e)\s+(?:this|that)\b[^.!?\n]{0,80}\b${PLANNING_ARTIFACT_FRAGMENT}\b[^.!?\n]{0,60}`,
        "gi",
      ),
    ],
  },
  {
    kind: "task",
    confidence: 0.93,
    satisfactionMode: "tool",
    expectedEvidenceKinds: ["task"],
    expectedToolFamilies: ["tasks"],
    patterns: [
      new RegExp(
        String.raw`\b${DIRECT_ACTION_PREFIX}(?:create|update|add|file|schedule|claim)\b[^.!?\n]{0,80}\b(?:task|tasks|project|backlog|ticket|tickets)\b[^.!?\n]{0,80}`,
        "gi",
      ),
    ],
  },
  {
    kind: "message",
    confidence: 0.93,
    satisfactionMode: "tool",
    expectedEvidenceKinds: ["message"],
    expectedToolFamilies: ["message"],
    patterns: [
      new RegExp(
        String.raw`\b${DIRECT_ACTION_PREFIX}(?:send|message|announce|dm)\b[^.!?\n]{0,80}\b(?:${MESSAGE_TARGET_FRAGMENT}|${MESSAGE_DESTINATION_FRAGMENT})\b[^.!?\n]{0,80}`,
        "gi",
      ),
      new RegExp(
        String.raw`\b${DIRECT_ACTION_PREFIX}post\b[^.!?\n]{0,40}\b(?:${MESSAGE_TARGET_FRAGMENT}|${MESSAGE_DESTINATION_FRAGMENT})\b[^.!?\n]{0,80}`,
        "gi",
      ),
    ],
  },
  {
    kind: "clarification",
    confidence: 0.91,
    satisfactionMode: "questions",
    expectedEvidenceKinds: ["questions"],
    expectedToolFamilies: [],
    patterns: [
      /\bI\s+(?:need|first\s+need)\s+(?:some|a\s+few|\d+)?\s*(?:answers|questions?|clarification|more\s+info(?:rmation)?)\s+before\s+I\s+can\s+(?:act|do\s+that|move|proceed)\b/gi,
      /\bbefore\s+I\s+can\s+(?:act|do\s+that|move|proceed),?\s+I\s+need\s+(?:some|a\s+few|\d+)?\s*(?:answers|questions?|clarification|more\s+info(?:rmation)?)\b/gi,
      /\bI\s+need\s+to\s+ask\s+(?:you\s+)?(?:a\s+few\s+|some\s+|\d+\s+)?questions?\b/gi,
    ],
  },
  {
    kind: "progress",
    confidence: 0.9,
    satisfactionMode: "tool",
    expectedEvidenceKinds: ["memory", "research", "planning", "task", "message", "questions"],
    expectedToolFamilies: [
      "memory_store",
      "memory_reflect",
      "web_search",
      "web_fetch",
      "browser",
      "read",
      "doc_panel",
      "tasks",
      "message",
    ],
    patterns: [
      /\bI(?:['’]m| am)\s+in\s+progress\s+on\s+(?:it|this|that)(?:\s+now)?\b/gi,
      /\bI(?:['’]m| am)\s+(?:actively\s+)?working\s+on\s+(?:it|this|that)(?:\s+now)?\b/gi,
      /\bI(?:['’]m| am)\s+on\s+it\b(?:[^.!?\n]{0,40}\bnow\b)?/gi,
      /\b(?:I(?:['’]m| am)\s+)?continuing(?:\s+on\s+(?:it|this|that))?(?:\s+right)?\s+now\b/gi,
      /\bI(?:['’]m| am)\s+(?:doing|handling|executing)\s+(?:it|this|that)(?:\s+right)?\s+now\b/gi,
      /\bI(?:['’]ll| will)\s+handle\s+(?:it|this|that)(?:\s+right)?\s+now\b/gi,
    ],
  },
] as const;

const TOOL_EVIDENCE_KIND_MAP: Partial<Record<ExecutedToolName, CommitmentEvidenceKind>> = {
  memory_store: "memory",
  memory_reflect: "memory",
  web_search: "research",
  web_fetch: "research",
  browser: "research",
  read: "research",
  doc_panel: "planning",
  tasks: "task",
  message: "message",
};

const GENERIC_PROGRESS_EVIDENCE_KINDS: CommitmentEvidenceKind[] = [
  "research",
  "planning",
  "task",
  "message",
  "questions",
];

const GENERIC_PROGRESS_TOOL_FAMILIES: ExecutedToolName[] = [
  "web_search",
  "web_fetch",
  "browser",
  "read",
  "doc_panel",
  "tasks",
  "message",
];

const QUESTION_LINE_RE = /(^|\n)\s*(?:\d+\.\s*)?([^\n?]{3,220}\?)/g;
const QUESTION_WORD_RE =
  /\b(?:what|which|when|where|who|why|how|can you|could you|would you|do you|did you|is there|are there|should I)\b/i;

export type MonitoredClaimTool = (typeof MONITORED_CLAIM_TOOLS)[number];
export type ExecutedToolName = (typeof EXECUTED_TOOL_NAMES)[number];
export type CommitmentKind =
  | "memory"
  | "research"
  | "planning"
  | "task"
  | "task_result"
  | "message"
  | "clarification"
  | "progress";
export type CommitmentEvidenceKind =
  | "memory"
  | "research"
  | "planning"
  | "task"
  | "message"
  | "questions";
export type CommitmentSatisfactionMode =
  | "tool"
  | "artifact"
  | "questions"
  | "tool_and_reply_evidence";
export type CommitmentDisposition = "pass" | "repaired" | "blocked";
export type TaskMutationEvidence = {
  toolName?: string;
  action?: string;
  entityIds?: string[];
  beforeCount?: number;
  afterCount?: number;
  summary?: string;
};

type TaskResultReplyEvidence = {
  claimText: string;
  claimedTaskIds: string[];
  beforeCount?: number;
  afterCount?: number;
  boardCleanupClaim: boolean;
  boardCountClaim: boolean;
};

type CommitmentPattern = {
  kind: CommitmentKind;
  confidence: number;
  satisfactionMode: CommitmentSatisfactionMode;
  expectedEvidenceKinds: CommitmentEvidenceKind[];
  expectedToolFamilies: ExecutedToolName[];
  patterns: RegExp[];
};

type ToolClaimMention = {
  tool: MonitoredClaimTool;
  claimText: string;
};

type StructuredClaimMention = ToolClaimMention & {
  highConfidence: boolean;
};

export type CommitmentClaim = {
  kind: CommitmentKind;
  claimText: string;
  confidence: number;
  expectedEvidenceKinds: CommitmentEvidenceKind[];
  expectedToolFamilies: ExecutedToolName[];
  satisfactionMode: CommitmentSatisfactionMode;
  evidenceKinds: CommitmentEvidenceKind[];
  evidenceTools: ExecutedToolName[];
  blockableInChat: boolean;
  satisfied: boolean;
};

export type ToolClaimValidation = {
  claimedTools: MonitoredClaimTool[];
  executedTools: ExecutedToolName[];
  missingClaims: MonitoredClaimTool[];
  structuredClaims: MonitoredClaimTool[];
  highConfidenceMissingClaims: MonitoredClaimTool[];
  externalToolsExecuted: ExecutedToolName[];
  commitments: CommitmentClaim[];
  missingCommitments: CommitmentClaim[];
  highConfidenceMissingCommitments: CommitmentClaim[];
  evidenceKinds: CommitmentEvidenceKind[];
  evidenceTools: ExecutedToolName[];
  questionsAsked: string[];
  missingClaimLabels: string[];
  primaryClaimText?: string;
  commitmentDisposition?: CommitmentDisposition;
  commitmentRepairCount?: number;
  commitmentBlockedReason?: string;
  evidenceLatencyMs?: number;
  hasExternalArtifact: boolean;
  valid: boolean;
};

function canonicalizeToolName(rawTool: string): ExecutedToolName | null {
  const trimmed = rawTool.trim();
  if (!trimmed) {
    return null;
  }
  for (const entry of TOOL_CANONICAL_MAP) {
    for (const pattern of entry.matches) {
      if (pattern.test(trimmed)) {
        return entry.canonical;
      }
    }
  }
  return null;
}

function extractClaimSentence(text: string, matchIndex: number): string {
  const startBoundaryCandidates = [
    text.lastIndexOf("\n", matchIndex - 1),
    text.lastIndexOf(".", matchIndex - 1),
    text.lastIndexOf("!", matchIndex - 1),
    text.lastIndexOf("?", matchIndex - 1),
  ];
  const endBoundaryCandidates = [
    text.indexOf("\n", matchIndex),
    text.indexOf(".", matchIndex),
    text.indexOf("!", matchIndex),
    text.indexOf("?", matchIndex),
  ].filter((value) => value >= 0);

  const start = Math.max(...startBoundaryCandidates, -1) + 1;
  const end =
    endBoundaryCandidates.length > 0 ? Math.min(...endBoundaryCandidates) + 1 : text.length;
  const sentence = text.slice(start, end).trim();
  if (!sentence) {
    return text.slice(Math.max(0, matchIndex - 80), Math.min(text.length, matchIndex + 160)).trim();
  }
  return sentence.length <= 240 ? sentence : `${sentence.slice(0, 240)}...`;
}

function trimClaimText(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return normalized;
  }
  return normalized.length <= 240 ? normalized : `${normalized.slice(0, 240)}...`;
}

function extractCommitmentClaimText(
  text: string,
  matchIndex: number,
  matchedText: string,
  kind: CommitmentKind,
): string {
  const sentence = extractClaimSentence(text, matchIndex);
  if (kind !== "task_result") {
    return sentence;
  }
  const matched = trimClaimText(matchedText);
  if (!matched) {
    return sentence;
  }
  if (sentence === "Done." || matched.length > sentence.length) {
    return matched;
  }
  return sentence;
}

function extractClaimedToolsFromEpisodeJson(responseText: string): Set<MonitoredClaimTool> {
  const out = new Set<MonitoredClaimTool>();
  const match = /\[EPISODE_JSON\]\s*([\s\S]*?)\s*\[\/EPISODE_JSON\]/i.exec(responseText);
  if (!match?.[1]) {
    return out;
  }
  try {
    const parsed = JSON.parse(match[1]) as { tools_used?: Array<{ tool?: string }> };
    const tools = Array.isArray(parsed.tools_used) ? parsed.tools_used : [];
    for (const entry of tools) {
      if (!entry?.tool) {
        continue;
      }
      const canonical = canonicalizeToolName(entry.tool);
      if (canonical && MONITORED_CLAIM_TOOLS.includes(canonical as MonitoredClaimTool)) {
        out.add(canonical as MonitoredClaimTool);
      }
    }
  } catch {
    // Ignore malformed episode blocks.
  }
  return out;
}

function extractClaimedToolsFromText(responseText: string): ToolClaimMention[] {
  const out: ToolClaimMention[] = [];
  const seen = new Set<string>();
  for (const entry of EXPLICIT_TOOL_ALIASES) {
    const forward = new RegExp(
      String.raw`\b(?:I|we)\s+${CLAIM_VERB_FRAGMENT}\b[^\n.]{0,120}\b${entry.toolPattern}\b`,
      "i",
    );
    const reverse = new RegExp(
      String.raw`\b${entry.toolPattern}\b[^\n.]{0,120}\b${CLAIM_VERB_FRAGMENT}\b`,
      "i",
    );
    const match = forward.exec(responseText) ?? reverse.exec(responseText);
    if (!match?.[0]) {
      continue;
    }
    const claimText = extractClaimSentence(responseText, match.index);
    const key = `${entry.canonical}:${claimText.toLowerCase()}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push({
      tool: entry.canonical,
      claimText,
    });
  }
  return out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isLikelyStandaloneToolActionJson(responseText: string): boolean {
  const trimmed = responseText.trim();
  if (!trimmed || !STRUCTURED_ACTION_ONLY_JSON_RE.test(trimmed)) {
    return false;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return false;
  }
  if (!isRecord(parsed)) {
    return false;
  }

  const action = parsed.action;
  if (typeof action !== "string") {
    return false;
  }
  const normalizedAction = action.trim();
  if (!normalizedAction || normalizedAction.length > 80) {
    return false;
  }

  const keys = Object.keys(parsed);
  if (keys.length === 1) {
    return STRUCTURED_ACTION_COMMAND_RE.test(normalizedAction);
  }

  if (keys.some((key) => STRUCTURED_ACTION_CONTROL_KEYS.has(key))) {
    return true;
  }
  return STRUCTURED_ACTION_COMMAND_RE.test(normalizedAction);
}

function extractStructuredClaims(responseText: string): StructuredClaimMention[] {
  const out: StructuredClaimMention[] = [];
  if (
    BROWSER_ACTION_JSON_RE.test(responseText) &&
    BROWSER_REQUEST_KIND_JSON_RE.test(responseText)
  ) {
    out.push({
      tool: "browser",
      claimText: responseText.trim().slice(0, 240),
      highConfidence: true,
    });
    return out;
  }
  if (isLikelyStandaloneToolActionJson(responseText)) {
    out.push({
      tool: "tool_json",
      claimText: responseText.trim().slice(0, 240),
      highConfidence: true,
    });
  }
  return out;
}

function extractConcreteQuestions(responseText: string): string[] {
  const questions = new Set<string>();
  let match: RegExpExecArray | null;
  const regex = new RegExp(QUESTION_LINE_RE.source, QUESTION_LINE_RE.flags);
  while ((match = regex.exec(responseText)) !== null) {
    const question = match[2]?.trim();
    if (!question || !QUESTION_WORD_RE.test(question)) {
      continue;
    }
    questions.add(question.length <= 240 ? question : `${question.slice(0, 240)}...`);
  }
  return Array.from(questions);
}

function collectEvidenceKinds(executedCanonical: Set<ExecutedToolName>): CommitmentEvidenceKind[] {
  const out = new Set<CommitmentEvidenceKind>();
  for (const tool of executedCanonical) {
    const evidenceKind = TOOL_EVIDENCE_KIND_MAP[tool];
    if (evidenceKind) {
      out.add(evidenceKind);
    }
  }
  return Array.from(out);
}

function collectEvidenceToolsForKinds(
  executedCanonical: Set<ExecutedToolName>,
  expectedKinds: CommitmentEvidenceKind[],
): ExecutedToolName[] {
  const out: ExecutedToolName[] = [];
  for (const tool of executedCanonical) {
    const evidenceKind = TOOL_EVIDENCE_KIND_MAP[tool];
    if (evidenceKind && expectedKinds.includes(evidenceKind)) {
      out.push(tool);
    }
  }
  return out;
}

function parseZeroOrNumber(value: string | number | undefined): number | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  if (normalized === "zero") {
    return 0;
  }
  if (/^\d+$/.test(normalized)) {
    return Number.parseInt(normalized, 10);
  }
  return undefined;
}

function extractTaskIdsFromList(text: string): string[] {
  const ids = new Set<string>();
  let match: RegExpExecArray | null;
  const regex = new RegExp(TASK_ID_TOKEN_RE.source, TASK_ID_TOKEN_RE.flags);
  while ((match = regex.exec(text)) !== null) {
    const id = match[0]?.trim();
    if (id) {
      ids.add(id);
    }
  }
  return Array.from(ids);
}

function extractTaskResultReplyEvidence(responseText: string): TaskResultReplyEvidence | undefined {
  const actionMatch = TASK_RESULT_ACTION_CLAIM_RE.exec(responseText);
  const verifiedMatch = TASK_RESULT_VERIFIED_CLAIM_RE.exec(responseText);
  const thereWereCounts = TASK_RESULT_THERE_WERE_COUNTS_RE.exec(responseText);
  const beforeAfterCounts = TASK_RESULT_BEFORE_AFTER_COUNTS_RE.exec(responseText);

  const claimedTaskIds = new Set<string>();
  let match: RegExpExecArray | null;
  const taskIdRegex = new RegExp(
    TASK_RESULT_ID_FRAGMENT_RE.source,
    TASK_RESULT_ID_FRAGMENT_RE.flags,
  );
  while ((match = taskIdRegex.exec(responseText)) !== null) {
    const listText = match[1] ?? match[2];
    if (!listText) {
      continue;
    }
    for (const id of extractTaskIdsFromList(listText)) {
      claimedTaskIds.add(id);
    }
  }

  const beforeCount = parseZeroOrNumber(thereWereCounts?.[1] ?? beforeAfterCounts?.[1]);
  const afterCount = parseZeroOrNumber(thereWereCounts?.[2] ?? beforeAfterCounts?.[2]);
  const boardCountClaim = typeof beforeCount === "number" && typeof afterCount === "number";
  const boardCleanupClaim = Boolean(actionMatch || verifiedMatch || boardCountClaim);
  if (!boardCleanupClaim && claimedTaskIds.size === 0) {
    return undefined;
  }

  const claimText =
    (actionMatch?.[0]
      ? extractCommitmentClaimText(responseText, actionMatch.index, actionMatch[0], "task_result")
      : undefined) ??
    (verifiedMatch?.[0]
      ? extractCommitmentClaimText(
          responseText,
          verifiedMatch.index,
          verifiedMatch[0],
          "task_result",
        )
      : undefined) ??
    (thereWereCounts?.[0]
      ? extractClaimSentence(responseText, thereWereCounts.index)
      : undefined) ??
    (beforeAfterCounts?.[0]
      ? extractClaimSentence(responseText, beforeAfterCounts.index)
      : undefined) ??
    trimClaimText(responseText);

  return {
    claimText,
    claimedTaskIds: Array.from(claimedTaskIds),
    ...(typeof beforeCount === "number" ? { beforeCount } : {}),
    ...(typeof afterCount === "number" ? { afterCount } : {}),
    boardCleanupClaim,
    boardCountClaim,
  };
}

function normalizeClaimScope(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function claimsShareScope(left: string, right: string): boolean {
  const normalizedLeft = normalizeClaimScope(left);
  const normalizedRight = normalizeClaimScope(right);
  if (!normalizedLeft || !normalizedRight) {
    return false;
  }
  return (
    normalizedLeft === normalizedRight ||
    normalizedLeft.includes(normalizedRight) ||
    normalizedRight.includes(normalizedLeft)
  );
}

function isTaskMutationEntryRelevant(entry: TaskMutationEvidence): boolean {
  const toolName = typeof entry.toolName === "string" ? entry.toolName.trim().toLowerCase() : "";
  if (toolName && toolName !== "tasks") {
    return false;
  }
  const action = typeof entry.action === "string" ? entry.action.trim() : "";
  const entityIds = Array.isArray(entry.entityIds)
    ? entry.entityIds.filter(
        (value): value is string => typeof value === "string" && value.trim().length > 0,
      )
    : [];
  return TASK_MUTATION_ACTION_RE.test(action) || entityIds.length > 0;
}

function hasTaskMutationEvidenceForReply(
  replyEvidence: TaskResultReplyEvidence | undefined,
  entries: TaskMutationEvidence[],
): boolean {
  if (!replyEvidence) {
    return false;
  }
  const relevantEntries = entries.filter(isTaskMutationEntryRelevant);
  if (relevantEntries.length === 0) {
    return false;
  }

  if (replyEvidence.boardCountClaim) {
    const claimedIds = new Set(replyEvidence.claimedTaskIds.map((id) => id.toLowerCase()));
    return relevantEntries.some((entry) => {
      const countsMatch =
        entry.beforeCount === replyEvidence.beforeCount &&
        entry.afterCount === replyEvidence.afterCount;
      if (!countsMatch) {
        return false;
      }
      if (claimedIds.size === 0) {
        return true;
      }
      return (entry.entityIds ?? []).some((id) => claimedIds.has(id.trim().toLowerCase()));
    });
  }

  if (replyEvidence.claimedTaskIds.length > 0) {
    const claimedIds = new Set(replyEvidence.claimedTaskIds.map((id) => id.toLowerCase()));
    return relevantEntries.some((entry) =>
      (entry.entityIds ?? []).some((id) => claimedIds.has(id.trim().toLowerCase())),
    );
  }

  return false;
}

function extractCommitments(params: {
  responseText: string;
  executedCanonical: Set<ExecutedToolName>;
  questionsAsked: string[];
  taskMutationEvidence: TaskMutationEvidence[];
}): CommitmentClaim[] {
  const out: CommitmentClaim[] = [];
  const seen = new Set<string>();
  const availableEvidenceKinds = collectEvidenceKinds(params.executedCanonical);
  const taskResultReplyEvidence = extractTaskResultReplyEvidence(params.responseText);
  const taskMutationConfirmed = hasTaskMutationEvidenceForReply(
    taskResultReplyEvidence,
    params.taskMutationEvidence,
  );
  if (params.questionsAsked.length > 0) {
    availableEvidenceKinds.push("questions");
  }

  for (const pattern of COMMITMENT_PATTERNS) {
    for (const rawPattern of pattern.patterns) {
      const regex = new RegExp(rawPattern.source, rawPattern.flags);
      let match: RegExpExecArray | null;
      while ((match = regex.exec(params.responseText)) !== null) {
        const claimText = extractCommitmentClaimText(
          params.responseText,
          match.index,
          match[0] ?? "",
          pattern.kind,
        );
        const key = `${pattern.kind}:${claimText.toLowerCase()}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);

        const evidenceKinds =
          pattern.satisfactionMode === "questions"
            ? params.questionsAsked.length > 0
              ? ["questions"]
              : []
            : pattern.expectedEvidenceKinds.filter((expectedKind) =>
                availableEvidenceKinds.includes(expectedKind),
              );
        const evidenceTools =
          pattern.satisfactionMode === "questions"
            ? []
            : collectEvidenceToolsForKinds(params.executedCanonical, pattern.expectedEvidenceKinds);
        const hasReplyEvidence =
          pattern.satisfactionMode === "tool_and_reply_evidence"
            ? taskResultReplyEvidence.length > 0
            : false;
        const satisfied =
          pattern.satisfactionMode === "questions"
            ? params.questionsAsked.length > 0
            : pattern.satisfactionMode === "tool_and_reply_evidence"
              ? evidenceKinds.length > 0 && hasReplyEvidence && taskMutationConfirmed
              : evidenceKinds.length > 0;

        out.push({
          kind: pattern.kind,
          claimText,
          confidence: pattern.confidence,
          expectedEvidenceKinds: [...pattern.expectedEvidenceKinds],
          expectedToolFamilies: [...pattern.expectedToolFamilies],
          satisfactionMode: pattern.satisfactionMode,
          evidenceKinds,
          evidenceTools,
          blockableInChat: true,
          satisfied,
        });
      }
    }
  }

  if (taskResultReplyEvidence) {
    const evidenceKinds = patternExpectedKindsAvailable(["task"], availableEvidenceKinds);
    const evidenceTools = collectEvidenceToolsForKinds(params.executedCanonical, ["task"]);
    out.push({
      kind: "task_result",
      claimText: taskResultReplyEvidence.claimText,
      confidence: 0.95,
      expectedEvidenceKinds: ["task"],
      expectedToolFamilies: ["tasks"],
      satisfactionMode: "tool_and_reply_evidence",
      evidenceKinds,
      evidenceTools,
      blockableInChat: true,
      satisfied: evidenceKinds.length > 0 && taskMutationConfirmed,
    });
  }

  const progressCompanionKinds = new Set<CommitmentKind>([
    "research",
    "planning",
    "task",
    "task_result",
    "clarification",
  ]);
  for (const commitment of out) {
    if (commitment.kind !== "progress") {
      continue;
    }
    const linkedCommitments = out.filter(
      (candidate) =>
        candidate !== commitment &&
        progressCompanionKinds.has(candidate.kind) &&
        claimsShareScope(commitment.claimText, candidate.claimText),
    );
    if (linkedCommitments.length === 0) {
      commitment.expectedEvidenceKinds = [...GENERIC_PROGRESS_EVIDENCE_KINDS];
      commitment.expectedToolFamilies = [...GENERIC_PROGRESS_TOOL_FAMILIES];
      commitment.evidenceKinds = patternExpectedKindsAvailable(
        GENERIC_PROGRESS_EVIDENCE_KINDS,
        availableEvidenceKinds,
      );
      commitment.evidenceTools = collectEvidenceToolsForKinds(
        params.executedCanonical,
        GENERIC_PROGRESS_EVIDENCE_KINDS,
      );
      commitment.satisfied = commitment.evidenceKinds.length > 0;
      continue;
    }

    commitment.expectedEvidenceKinds = Array.from(
      new Set(linkedCommitments.flatMap((candidate) => candidate.expectedEvidenceKinds)),
    );
    commitment.expectedToolFamilies = Array.from(
      new Set(linkedCommitments.flatMap((candidate) => candidate.expectedToolFamilies)),
    );
    commitment.evidenceKinds = Array.from(
      new Set(linkedCommitments.flatMap((candidate) => candidate.evidenceKinds)),
    );
    commitment.evidenceTools = Array.from(
      new Set(linkedCommitments.flatMap((candidate) => candidate.evidenceTools)),
    );
    commitment.satisfied = linkedCommitments.every((candidate) => candidate.satisfied);
  }

  return out;
}

function patternExpectedKindsAvailable(
  expectedKinds: CommitmentEvidenceKind[],
  availableKinds: CommitmentEvidenceKind[],
): CommitmentEvidenceKind[] {
  return expectedKinds.filter((expectedKind) => availableKinds.includes(expectedKind));
}

function describeCommitmentLabel(commitment: CommitmentClaim): string {
  switch (commitment.kind) {
    case "memory":
      return "memory action";
    case "research":
      return "research action";
    case "planning":
      return "planning artifact";
    case "task":
      return "task/project update";
    case "task_result":
      return "task/board result evidence";
    case "message":
      return "message send";
    case "clarification":
      return "clarification questions";
    case "progress":
      return "active work claim";
  }
}

function describeToolLabel(tool: MonitoredClaimTool): string {
  return tool === "tool_json" ? "raw tool action JSON" : tool;
}

export function validateToolClaims(params: {
  responseText: string;
  executedToolNames: string[];
  didSendViaMessagingTool?: boolean;
  taskMutationEvidence?: TaskMutationEvidence[];
}): ToolClaimValidation {
  const executedCanonical = new Set<ExecutedToolName>();
  for (const name of params.executedToolNames) {
    const canonical = canonicalizeToolName(name);
    if (canonical) {
      executedCanonical.add(canonical);
    }
  }
  if (params.didSendViaMessagingTool) {
    executedCanonical.add("message");
  }

  const episodeClaims = extractClaimedToolsFromEpisodeJson(params.responseText);
  const explicitToolMentions = extractClaimedToolsFromText(params.responseText);
  const structuredClaimMentions = extractStructuredClaims(params.responseText);

  const claimedCanonical = new Set<MonitoredClaimTool>();
  for (const tool of episodeClaims) {
    claimedCanonical.add(tool);
  }
  for (const mention of explicitToolMentions) {
    claimedCanonical.add(mention.tool);
  }
  for (const mention of structuredClaimMentions) {
    claimedCanonical.add(mention.tool);
  }

  const questionsAsked = extractConcreteQuestions(params.responseText);
  const commitments = extractCommitments({
    responseText: params.responseText,
    executedCanonical,
    questionsAsked,
    taskMutationEvidence: params.taskMutationEvidence ?? [],
  });

  const missingClaims = Array.from(claimedCanonical).filter((tool) => !executedCanonical.has(tool));
  const highConfidenceMissingClaims = structuredClaimMentions
    .filter((mention) => mention.highConfidence && !executedCanonical.has(mention.tool))
    .map((mention) => mention.tool);
  const missingCommitments = commitments.filter((commitment) => !commitment.satisfied);
  const highConfidenceMissingCommitments = missingCommitments.filter(
    (commitment) => commitment.confidence >= 0.85,
  );
  const externalToolsExecuted = Array.from(executedCanonical).filter((tool) =>
    EXTERNAL_ARTIFACT_TOOLS.has(tool),
  );
  const evidenceKinds = collectEvidenceKinds(executedCanonical);
  if (questionsAsked.length > 0) {
    evidenceKinds.push("questions");
  }
  const evidenceKindSet = new Set<CommitmentEvidenceKind>(evidenceKinds);
  const evidenceTools = Array.from(executedCanonical);
  const missingClaimLabels = Array.from(
    new Set([
      ...missingClaims.map(describeToolLabel),
      ...missingCommitments.map(describeCommitmentLabel),
    ]),
  );

  const missingExplicitMention = explicitToolMentions.find((mention) =>
    missingClaims.includes(mention.tool),
  );
  const missingStructuredMention = structuredClaimMentions.find((mention) =>
    missingClaims.includes(mention.tool),
  );
  const primaryClaimText =
    missingCommitments[0]?.claimText ??
    missingExplicitMention?.claimText ??
    missingStructuredMention?.claimText ??
    commitments[0]?.claimText ??
    explicitToolMentions[0]?.claimText;

  return {
    claimedTools: Array.from(claimedCanonical),
    executedTools: evidenceTools,
    missingClaims,
    structuredClaims: structuredClaimMentions.map((mention) => mention.tool),
    highConfidenceMissingClaims,
    externalToolsExecuted,
    commitments,
    missingCommitments,
    highConfidenceMissingCommitments,
    evidenceKinds: Array.from(evidenceKindSet),
    evidenceTools,
    questionsAsked,
    missingClaimLabels,
    ...(primaryClaimText ? { primaryClaimText } : {}),
    hasExternalArtifact: externalToolsExecuted.length > 0,
    valid: missingClaims.length === 0 && missingCommitments.length === 0,
  };
}
