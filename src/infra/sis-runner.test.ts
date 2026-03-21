import { describe, expect, it } from "vitest";
import { __testing, getSisConsolidationMetricsSnapshot } from "./sis-runner.js";

function buildValidPayload(overrides?: Record<string, unknown>): string {
  return JSON.stringify(
    {
      patterns: [
        {
          name: "verification-rigor",
          description: "Verification checks are increasing",
          frequency: 3,
          avg_valence: 0.4,
          lessons: ["verify assumptions before execution"],
          episode_ids: ["ep1", "ep2", "ep3"],
          growth_direction: "ad-hoc -> methodical",
        },
      ],
      growth_arc: "moving from reactive to deliberate execution",
      self_insights: ["bias toward speed caused misses"],
      recommendations: ["add explicit verification checkpoint"],
      ...(overrides || {}),
    },
    null,
    2,
  );
}

describe("sis runner consolidation parser", () => {
  it("parses strict tagged JSON", () => {
    __testing.resetSisConsolidationMetrics();
    const text = `[SIS_PATTERNS]\n${buildValidPayload()}\n[/SIS_PATTERNS]`;
    const parsed = __testing.parseConsolidationResponse(text);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.fallbackUsed).toBe(false);
    expect(parsed.result.patterns[0]?.name).toBe("verification-rigor");

    const metrics = getSisConsolidationMetricsSnapshot();
    expect(metrics.attempts).toBe(1);
    expect(metrics.parseSuccess).toBe(1);
    expect(metrics.parseFailures).toBe(0);
  });

  it("accepts fenced JSON and marks fallback", () => {
    __testing.resetSisConsolidationMetrics();
    const text = `[SIS_PATTERNS]\n\n\`\`\`json\n${buildValidPayload()}\n\`\`\`\n[/SIS_PATTERNS]`;
    const parsed = __testing.parseConsolidationResponse(text);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.fallbackUsed).toBe(true);

    const metrics = getSisConsolidationMetricsSnapshot();
    expect(metrics.fallbackParses).toBe(1);
  });

  it("accepts near-valid JSON with trailing text", () => {
    __testing.resetSisConsolidationMetrics();
    const text = `${buildValidPayload()}\n\nAdditional commentary after JSON.`;
    const parsed = __testing.parseConsolidationResponse(text);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.fallbackUsed).toBe(true);
  });

  it("prefers SIS-tagged payloads when multiple reply payloads are returned", () => {
    const selected = __testing.selectBestSisReplyPayload([
      { text: "We are done." },
      { text: `[SIS_PATTERNS]\n${buildValidPayload()}\n[/SIS_PATTERNS]` },
    ]);

    expect(selected?.text).toContain("[SIS_PATTERNS]");
  });

  it("falls back to payload containing patterns key when SIS tags are absent", () => {
    const selected = __testing.selectBestSisReplyPayload([
      { text: "We are done." },
      { text: `${buildValidPayload()}` },
    ]);

    expect(selected?.text).toContain('"patterns"');
  });

  it("returns typed reason for missing recommendations", () => {
    __testing.resetSisConsolidationMetrics();
    const payload = buildValidPayload({ recommendations: undefined });
    const text = `[SIS_PATTERNS]\n${payload}\n[/SIS_PATTERNS]`;
    const parsed = __testing.parseConsolidationResponse(text);

    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.reason).toBe("missing-recommendations");

    const metrics = getSisConsolidationMetricsSnapshot();
    expect(metrics.parseFailureByReason["missing-recommendations"]).toBe(1);
  });

  it("returns typed reason for malformed JSON", () => {
    __testing.resetSisConsolidationMetrics();
    const text = `[SIS_PATTERNS]\n{ "patterns": [ }\n[/SIS_PATTERNS]`;
    const parsed = __testing.parseConsolidationResponse(text);

    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.reason).toBe("json-parse-failed");

    const metrics = getSisConsolidationMetricsSnapshot();
    expect(metrics.parseFailureByReason["json-parse-failed"]).toBe(1);
  });

  it("achieves >=95% parse success on noisy fixture corpus", () => {
    __testing.resetSisConsolidationMetrics();

    const base = buildValidPayload();
    const fixtures: string[] = [
      `[SIS_PATTERNS]\n${base}\n[/SIS_PATTERNS]`,
      `[SIS_PATTERNS]\n\`\`\`json\n${base}\n\`\`\`\n[/SIS_PATTERNS]`,
      `${base}\nTrailing note`,
      `Intro text\n${base}`,
      `[SIS_PATTERNS]\n${base}\n[/SIS_PATTERNS]\ntrailing`,
      `\n\n${base}\n\n`,
      `${base}`,
      `[SIS_PATTERNS]\n\n${base}\n\n[/SIS_PATTERNS]`,
      `[SIS_PATTERNS]\n\`\`\`\n${base}\n\`\`\`\n[/SIS_PATTERNS]`,
      `prefix ${base} suffix`,
      `[SIS_PATTERNS]\n${buildValidPayload({ growth_arc: "arc" })}\n[/SIS_PATTERNS]`,
      `[SIS_PATTERNS]\n${buildValidPayload({ self_insights: ["one", "two"] })}\n[/SIS_PATTERNS]`,
      `[SIS_PATTERNS]\n${buildValidPayload({ recommendations: ["one", "two"] })}\n[/SIS_PATTERNS]`,
      `[SIS_PATTERNS]\n${buildValidPayload({ patterns: [] })}\n[/SIS_PATTERNS]`,
      `${buildValidPayload({
        patterns: [
          {
            name: "x",
            description: "y",
            frequency: 1,
            avg_valence: 0,
            lessons: ["a"],
            episode_ids: ["ep"],
          },
        ],
      })}\nextra`,
      `[SIS_PATTERNS]\n${buildValidPayload({ tool_lessons: [{ type: "mistake" }] })}\n[/SIS_PATTERNS]`,
      `[SIS_PATTERNS]\n${buildValidPayload({
        patterns: [
          {
            name: "pattern-b",
            description: "desc",
            frequency: 2,
            avg_valence: 0.2,
            lessons: ["l1", "l2"],
            episode_ids: ["ep9", "ep10"],
          },
        ],
      })}\n[/SIS_PATTERNS]`,
      `${buildValidPayload({ recommendations: ["focus", "verify"] })}`,
      `context\n[SIS_PATTERNS]\n${base}\n[/SIS_PATTERNS]\npost`,
      `[SIS_PATTERNS]\n{\"patterns\": [}\n[/SIS_PATTERNS]`,
    ];

    let successCount = 0;
    for (const fixture of fixtures) {
      const parsed = __testing.parseConsolidationResponse(fixture);
      if (parsed.ok) {
        successCount++;
      }
    }

    const rate = successCount / fixtures.length;
    expect(rate).toBeGreaterThanOrEqual(0.95);

    const metrics = getSisConsolidationMetricsSnapshot();
    expect(metrics.attempts).toBe(fixtures.length);
    expect(metrics.parseSuccess).toBe(successCount);
    expect(metrics.parseFailures).toBe(fixtures.length - successCount);
  });
});

describe("sis consolidation checkpoint dedupe", () => {
  it("normalizes empty consolidation signatures across dates and episode counts", () => {
    const first = `## SIS Consolidation (2026-03-12)
**Episodes analyzed:** 20
**Patterns found:** 0
**Status:** No cross-episode patterns identified.

### Growth Arc
Stable.

### Patterns
- None identified in this cycle.

### Recommendations
- Continue collecting higher-signal episodes before next consolidation.`;
    const second = `## SIS Consolidation (2026-03-13)
**Episodes analyzed:** 6
**Patterns found:** 0
**Status:** No cross-episode patterns identified.

### Growth Arc
Stable.

### Patterns
- None identified in this cycle.

### Recommendations
- Continue collecting higher-signal episodes before next consolidation.`;

    expect(__testing.buildSisConsolidationSignature(first)).toBe(
      __testing.buildSisConsolidationSignature(second),
    );
  });

  it("skips persisting duplicate empty consolidations", async () => {
    const reflectionContent = `## SIS Consolidation (2026-03-12)
**Episodes analyzed:** 20
**Patterns found:** 0
**Status:** No cross-episode patterns identified.

### Growth Arc
Stable.

### Patterns
- None identified in this cycle.

### Recommendations
- Continue collecting higher-signal episodes before next consolidation.`;
    const memuStore = {
      listReflections: async () => [
        {
          id: "r1",
          triggerType: "sis_consolidation",
          periodStart: "2026-03-12T00:00:00.000Z",
          periodEnd: "2026-03-12T01:00:00.000Z",
          content: reflectionContent,
          lessonsExtracted: [],
          entitiesInvolved: [],
          selfInsights: [],
          mood: "analytical",
          createdAt: "2026-03-12T01:05:00.000Z",
        },
      ],
    };

    await expect(
      __testing.shouldSkipSisConsolidationCheckpoint({
        memuStore: memuStore as any,
        reflectionContent: `## SIS Consolidation (2026-03-13)
**Episodes analyzed:** 4
**Patterns found:** 0
**Status:** No cross-episode patterns identified.

### Growth Arc
Stable.

### Patterns
- None identified in this cycle.

### Recommendations
- Continue collecting higher-signal episodes before next consolidation.`,
      }),
    ).resolves.toBe(true);
  });

  it("does not skip non-empty consolidations", async () => {
    const memuStore = {
      listReflections: async () => [
        {
          id: "r1",
          triggerType: "sis_consolidation",
          periodStart: "2026-03-12T00:00:00.000Z",
          periodEnd: "2026-03-12T01:00:00.000Z",
          content: `## SIS Consolidation (2026-03-12)
**Episodes analyzed:** 20
**Patterns found:** 0`,
          lessonsExtracted: [],
          entitiesInvolved: [],
          selfInsights: [],
          mood: "analytical",
          createdAt: "2026-03-12T01:05:00.000Z",
        },
      ],
    };

    await expect(
      __testing.shouldSkipSisConsolidationCheckpoint({
        memuStore: memuStore as any,
        reflectionContent: `## SIS Consolidation (2026-03-13)
**Episodes analyzed:** 4
**Patterns found:** 1

### Growth Arc
Changed.`,
      }),
    ).resolves.toBe(false);
  });
});
