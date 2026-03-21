import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { IntentConfig } from "../config/types.intent.js";
import { resolveStateDir } from "../config/paths.js";

export type CopilotDomain =
  | "intent"
  | "workforce"
  | "run-story"
  | "tool-policy"
  | "observability"
  | "onboarding"
  | "nudge-offtime"
  | "memory-governance"
  | "voice-presence"
  | "department-org"
  | "deployment";

export type CopilotAccessMode = "off" | "assist-draft" | "assist-propose" | "assist-live-limited";

export type IntentChangeEntry = {
  id: string;
  at: string;
  actor: "operator" | "ai-assisted" | "system";
  reason?: string;
  before: IntentConfig | null;
  after: IntentConfig | null;
};

type CopilotState = {
  version: 1;
  accessModes: Partial<Record<CopilotDomain, CopilotAccessMode>>;
  intentHistory: IntentChangeEntry[];
};

const DEFAULT_STATE: CopilotState = {
  version: 1,
  accessModes: {
    intent: "assist-draft",
    workforce: "assist-draft",
    "run-story": "assist-draft",
    "tool-policy": "assist-draft",
    observability: "assist-draft",
    onboarding: "assist-draft",
    "nudge-offtime": "assist-draft",
    "memory-governance": "assist-draft",
    "voice-presence": "assist-draft",
    "department-org": "assist-draft",
    deployment: "assist-draft",
  },
  intentHistory: [],
};

function stateFilePath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveStateDir(env), "copilot", "state.json");
}

function normalizeState(raw: unknown): CopilotState {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_STATE };
  const obj = raw as Partial<CopilotState>;
  const accessModes =
    obj.accessModes && typeof obj.accessModes === "object"
      ? (obj.accessModes as CopilotState["accessModes"])
      : {};
  const intentHistory = Array.isArray(obj.intentHistory)
    ? obj.intentHistory.filter(
        (item): item is IntentChangeEntry =>
          Boolean(item) &&
          typeof item === "object" &&
          typeof (item as IntentChangeEntry).id === "string" &&
          typeof (item as IntentChangeEntry).at === "string",
      )
    : [];
  return {
    version: 1,
    accessModes: { ...DEFAULT_STATE.accessModes, ...accessModes },
    intentHistory,
  };
}

export async function readCopilotState(
  env: NodeJS.ProcessEnv = process.env,
): Promise<CopilotState> {
  const file = stateFilePath(env);
  try {
    const raw = await fs.readFile(file, "utf-8");
    return normalizeState(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_STATE };
  }
}

export async function writeCopilotState(
  state: CopilotState,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const file = stateFilePath(env);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(state, null, 2)}\n`, "utf-8");
}

export async function getCopilotAccessMode(
  domain: CopilotDomain,
  env: NodeJS.ProcessEnv = process.env,
): Promise<CopilotAccessMode> {
  const state = await readCopilotState(env);
  return state.accessModes[domain] ?? "assist-draft";
}

export async function setCopilotAccessMode(
  domain: CopilotDomain,
  mode: CopilotAccessMode,
  env: NodeJS.ProcessEnv = process.env,
): Promise<CopilotState> {
  const state = await readCopilotState(env);
  state.accessModes[domain] = mode;
  await writeCopilotState(state, env);
  return state;
}

export async function appendIntentHistory(
  params: Omit<IntentChangeEntry, "id" | "at">,
  env: NodeJS.ProcessEnv = process.env,
): Promise<IntentChangeEntry> {
  const state = await readCopilotState(env);
  const entry: IntentChangeEntry = {
    id: randomUUID(),
    at: new Date().toISOString(),
    ...params,
  };
  state.intentHistory.unshift(entry);
  state.intentHistory = state.intentHistory.slice(0, 200);
  await writeCopilotState(state, env);
  return entry;
}
