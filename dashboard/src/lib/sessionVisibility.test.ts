import { describe, expect, it } from "vitest";
import {
  coerceVisibleOperatorSessionKey,
  isBackgroundSessionKey,
  isVisibleOperatorSession,
} from "./sessionVisibility";

describe("session visibility", () => {
  it("classifies cron and contemplation sessions as background", () => {
    expect(isBackgroundSessionKey("agent:argent:cron:job-1")).toBe(true);
    expect(isBackgroundSessionKey("agent:argent:main:contemplation")).toBe(true);
    expect(isBackgroundSessionKey("agent:argent:main")).toBe(false);
  });

  it("coerces background session keys back to the main operator session", () => {
    expect(
      coerceVisibleOperatorSessionKey({
        sessionKey: "agent:argent:cron:job-1",
        mainSessionKey: "agent:argent:main",
      }),
    ).toBe("agent:argent:main");

    expect(
      coerceVisibleOperatorSessionKey({
        sessionKey: "agent:argent:main:contemplation",
        mainSessionKey: "agent:argent:main",
      }),
    ).toBe("agent:argent:main");
  });

  it("never considers cron sessions visible operator sessions", () => {
    expect(
      isVisibleOperatorSession({
        session: { key: "agent:argent:cron:job-1", channel: "webchat" },
        currentSessionKey: "agent:argent:main",
        selectedAgentId: "argent",
        defaultAgentId: "argent",
      }),
    ).toBe(false);
  });
});
