/**
 * Unit tests for /goal command handler.
 *
 * Acceptance criteria coverage:
 *   AC1 /goal <text>     — sets a goal and surfaces a kick-off confirmation
 *   AC3 /goal status     — shows turns used (0/20 right after set)
 *   AC4 /goal pause      — pauses an active goal
 *   AC5 /goal resume     — resumes and resets turn counter
 *   AC6 /goal clear      — marks cleared (preserved for audit)
 *
 * Persistence is verified by spying on `updateSessionStoreEntry` (the same
 * atomic-write path that PR #359 hardened) — no actual disk writes.
 */

import { describe, expect, it, vi } from "vitest";
import type { SessionEntry } from "../../config/sessions.js";
import type { HandleCommandsParams } from "./commands-types.js";
import { type GoalState, formatGoalStatusLine } from "../../agents/goal-state.js";
import { handleGoalCommand, parseGoalBody } from "./commands-goal.js";

vi.mock("../../config/sessions.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../config/sessions.js")>();
  return {
    ...actual,
    updateSessionStoreEntry: vi.fn(async () => null),
  };
});

import { updateSessionStoreEntry } from "../../config/sessions.js";

const baseGoal = (overrides: Partial<GoalState> = {}): GoalState => ({
  goal: "Write four files to /tmp",
  status: "active",
  turnsUsed: 0,
  maxTurns: 20,
  createdAt: 1_000,
  lastTurnAt: 0,
  consecutiveParseFailures: 0,
  subgoals: [],
  ...overrides,
});

function makeParams(overrides: {
  body?: string;
  sessionEntry?: SessionEntry;
  isAuthorized?: boolean;
  storePath?: string;
  sessionKey?: string;
}): HandleCommandsParams {
  const body = overrides.body ?? "/goal";
  return {
    // oxlint-disable-next-line typescript/no-explicit-any
    ctx: { CommandBody: body, Body: body } as any,
    // oxlint-disable-next-line typescript/no-explicit-any
    cfg: {} as any,
    command: {
      surface: "cli",
      channel: "cli",
      ownerList: [],
      senderIsOwner: true,
      isAuthorizedSender: overrides.isAuthorized ?? true,
      rawBodyNormalized: body,
      commandBodyNormalized: body.toLowerCase(),
    },
    directives: {} as HandleCommandsParams["directives"],
    elevated: { enabled: false, allowed: false, failures: [] },
    sessionEntry: overrides.sessionEntry,
    sessionKey: overrides.sessionKey ?? "session-key",
    storePath: overrides.storePath ?? "/tmp/store.json",
    workspaceDir: "/tmp",
    defaultGroupActivation: () => "always",
    resolvedVerboseLevel: "off",
    resolvedReasoningLevel: "off",
    resolveDefaultThinkingLevel: async () => undefined,
    provider: "stub",
    model: "stub",
    contextTokens: 0,
    isGroup: false,
  };
}

describe("parseGoalBody", () => {
  it("bare /goal → status subcommand", () => {
    expect(parseGoalBody("/goal")).toEqual({ subcommand: "status", text: "" });
  });
  it("/goal status", () => {
    expect(parseGoalBody("/goal status")).toEqual({ subcommand: "status", text: "" });
  });
  it("/goal pause", () => {
    expect(parseGoalBody("/goal pause")).toEqual({ subcommand: "pause", text: "" });
  });
  it("/goal resume", () => {
    expect(parseGoalBody("/goal resume")).toEqual({ subcommand: "resume", text: "" });
  });
  it("/goal clear", () => {
    expect(parseGoalBody("/goal clear")).toEqual({ subcommand: "clear", text: "" });
  });
  it("/goal <text>", () => {
    expect(parseGoalBody("/goal Write four files to /tmp")).toEqual({
      subcommand: "set",
      text: "Write four files to /tmp",
    });
  });
  it("non-/goal body → empty subcommand", () => {
    expect(parseGoalBody("/compact")).toEqual({ subcommand: "", text: "" });
  });
});

describe("handleGoalCommand", () => {
  it("returns null for non-/goal commands", async () => {
    const params = makeParams({ body: "/compact" });
    const result = await handleGoalCommand(params, true);
    expect(result).toBeNull();
  });

  it("blocks unauthorized senders", async () => {
    const params = makeParams({ body: "/goal status", isAuthorized: false });
    const result = await handleGoalCommand(params, true);
    expect(result?.shouldContinue).toBe(false);
    expect(result?.reply).toBeUndefined();
  });

  it("AC1: /goal <text> persists a new active goal and surfaces kick-off", async () => {
    vi.mocked(updateSessionStoreEntry).mockClear();
    const params = makeParams({ body: "/goal Write four files to /tmp" });
    const result = await handleGoalCommand(params, true);
    expect(result?.shouldContinue).toBe(false);
    expect(result?.reply?.text).toContain("⊙ Goal set");
    expect(result?.reply?.text).toContain("Write four files to /tmp");
    expect(updateSessionStoreEntry).toHaveBeenCalledOnce();
  });

  it("AC3: bare /goal returns the formatted status line for the active goal", async () => {
    const sessionEntry: SessionEntry = {
      sessionId: "s1",
      updatedAt: 0,
      goal: baseGoal({ turnsUsed: 3 }),
    };
    const params = makeParams({ body: "/goal", sessionEntry });
    const result = await handleGoalCommand(params, true);
    expect(result?.reply?.text).toBe(formatGoalStatusLine(sessionEntry.goal));
    expect(result?.reply?.text).toContain("3/20 turns");
  });

  it("AC3: /goal status when no goal is set", async () => {
    const params = makeParams({ body: "/goal status" });
    const result = await handleGoalCommand(params, true);
    expect(result?.reply?.text).toContain("No active goal");
  });

  it("AC4: /goal pause flips active → paused and persists", async () => {
    vi.mocked(updateSessionStoreEntry).mockClear();
    const sessionEntry: SessionEntry = {
      sessionId: "s1",
      updatedAt: 0,
      goal: baseGoal(),
    };
    const params = makeParams({ body: "/goal pause", sessionEntry });
    const result = await handleGoalCommand(params, true);
    expect(result?.reply?.text).toContain("⏸ Goal paused");
    expect(updateSessionStoreEntry).toHaveBeenCalledOnce();
  });

  it("AC4: /goal pause is a no-op when no goal exists", async () => {
    vi.mocked(updateSessionStoreEntry).mockClear();
    const params = makeParams({ body: "/goal pause" });
    const result = await handleGoalCommand(params, true);
    expect(result?.reply?.text).toContain("No active goal to pause");
    expect(updateSessionStoreEntry).not.toHaveBeenCalled();
  });

  it("AC5: /goal resume reactivates a paused goal and resets the turn counter", async () => {
    vi.mocked(updateSessionStoreEntry).mockClear();
    const sessionEntry: SessionEntry = {
      sessionId: "s1",
      updatedAt: 0,
      goal: baseGoal({ status: "paused", turnsUsed: 8, pausedReason: "user-paused" }),
    };
    const params = makeParams({ body: "/goal resume", sessionEntry });
    const result = await handleGoalCommand(params, true);
    expect(result?.reply?.text).toContain("▶ Goal resumed");
    expect(result?.reply?.text).toContain("0/20");
    expect(updateSessionStoreEntry).toHaveBeenCalledOnce();
  });

  it("AC6: /goal clear marks the goal cleared (preserved for audit)", async () => {
    vi.mocked(updateSessionStoreEntry).mockClear();
    const sessionEntry: SessionEntry = {
      sessionId: "s1",
      updatedAt: 0,
      goal: baseGoal(),
    };
    const params = makeParams({ body: "/goal clear", sessionEntry });
    const result = await handleGoalCommand(params, true);
    expect(result?.reply?.text).toContain("🧹 Goal cleared");
    expect(updateSessionStoreEntry).toHaveBeenCalledOnce();
  });

  it("rejects empty text after subcommand parsing falls through", async () => {
    const params = makeParams({ body: "/goal " });
    const result = await handleGoalCommand(params, true);
    // Bare /goal triggers status, not the usage line; that's tested above.
    // This confirms whitespace-only after `/goal` still routes to status.
    expect(result?.reply?.text).toContain("No active goal");
  });
});
