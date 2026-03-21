import { describe, expect, it } from "vitest";
import {
  detectRepeatedFailures,
  detectRetryPatterns,
  parseToolLessonsFromResponse,
} from "./sis-lesson-extractor.js";

describe("sis lesson extractor", () => {
  it("extracts retry workaround lesson", () => {
    const lessons = detectRetryPatterns([
      {
        toolName: "web_fetch",
        toolCallId: "call-1",
        isError: true,
        errorMessage: "timeout",
        durationMs: 120,
        timestamp: "2026-03-05T01:00:00.000Z",
      },
      {
        toolName: "web_fetch",
        toolCallId: "call-2",
        isError: false,
        durationMs: 95,
        timestamp: "2026-03-05T01:00:01.000Z",
      },
    ]);

    expect(lessons).toHaveLength(1);
    expect(lessons[0]?.type).toBe("workaround");
    expect(lessons[0]?.relatedTools).toContain("web_fetch");
  });

  it("extracts repeated failure lesson for 3+ failures", () => {
    const lessons = detectRepeatedFailures([
      {
        toolName: "exec",
        toolCallId: "call-1",
        isError: true,
        errorMessage: "deny",
        durationMs: 10,
        timestamp: "2026-03-05T02:00:00.000Z",
      },
      {
        toolName: "exec",
        toolCallId: "call-2",
        isError: true,
        errorMessage: "deny",
        durationMs: 8,
        timestamp: "2026-03-05T02:00:01.000Z",
      },
      {
        toolName: "exec",
        toolCallId: "call-3",
        isError: true,
        errorMessage: "allowlist",
        durationMs: 12,
        timestamp: "2026-03-05T02:00:02.000Z",
      },
    ]);

    expect(lessons).toHaveLength(1);
    expect(lessons[0]?.type).toBe("mistake");
    expect(lessons[0]?.lesson).toContain("recurring failure pattern");
  });

  it("parses only valid model-extracted tool lessons", () => {
    const lessons = parseToolLessonsFromResponse({
      tool_lessons: [
        {
          type: "mistake",
          tool: "dns",
          context: "updating record",
          action: "upsert",
          outcome: "record conflict",
          lesson: "lookup before update",
          confidence: 0.8,
          tags: ["dns"],
        },
        {
          type: "invalid-type",
          tool: "exec",
          lesson: "should drop",
        },
        "not-an-object",
        {
          type: "workaround",
          tool: "browser",
          context: "session stale",
          lesson: "", // empty lesson should be dropped
        },
      ],
    } as Record<string, unknown>);

    expect(lessons).toHaveLength(1);
    expect(lessons[0]?.type).toBe("mistake");
    expect(lessons[0]?.relatedTools).toEqual(["dns"]);
  });
});
