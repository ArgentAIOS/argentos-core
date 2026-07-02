import { describe, expect, it } from "vitest";
import type { GradeEvent } from "../data/types.js";
import {
  buildScorecard,
  evaluatePromotionGate,
  gradableComponentsForRun,
  PROMOTION_GATE,
} from "./worker-grading.js";

const DAY = 24 * 60 * 60 * 1000;
const T0 = 1_750_000_000_000;

function grade(
  i: number,
  verdict: GradeEvent["verdict"],
  opts: { component?: string; at?: number } = {},
): GradeEvent {
  return {
    id: `g-${i}`,
    runId: `run-${i}`,
    assignmentId: "asg-1",
    templateId: "tpl-1",
    component: opts.component ?? "classification",
    verdict,
    grader: "operator",
    createdAt: opts.at ?? T0 + i * 1000,
  };
}

function series(correct: number, wrong: number, startAt = T0): GradeEvent[] {
  const events: GradeEvent[] = [];
  for (let i = 0; i < correct; i++) {
    events.push(grade(i, "correct", { at: startAt + i * 1000 }));
  }
  for (let i = 0; i < wrong; i++) {
    events.push(grade(correct + i, "wrong", { at: startAt + (correct + i) * 1000 }));
  }
  return events;
}

describe("buildScorecard", () => {
  it("rolls up totals and per-component rows", () => {
    const events = [
      grade(1, "correct", { component: "classification" }),
      grade(2, "correct", { component: "classification" }),
      grade(3, "needs_change", { component: "assignee" }),
      grade(4, "wrong", { component: "draft" }),
    ];
    const card = buildScorecard(events);
    expect(card.totals).toMatchObject({ total: 4, correct: 2, needsChange: 1, wrong: 1 });
    expect(card.totals.correctPct).toBe(50);
    expect(card.components.map((c) => c.component)).toEqual([
      "assignee",
      "classification",
      "draft",
    ]);
    expect(card.components[1]).toMatchObject({ correct: 2, total: 2, correctPct: 100 });
  });

  it("empty events → zeroed scorecard", () => {
    const card = buildScorecard([]);
    expect(card.totals.total).toBe(0);
    expect(card.components).toEqual([]);
  });
});

describe("evaluatePromotionGate — exact integer math (≥95% over ≥50, sustained 2 weeks)", () => {
  it("locked gate numbers", () => {
    expect(PROMOTION_GATE).toEqual({ minGraded: 50, minCorrectPct: 95, sustainDays: 14 });
  });

  it("under 50 graded decisions → not passing, says how many more", () => {
    const status = evaluatePromotionGate(series(49, 0), T0 + 30 * DAY);
    expect(status.passingNow).toBe(false);
    expect(status.eligible).toBe(false);
    expect(status.reasons.join(" ")).toContain("needs 1 more graded decisions");
  });

  it("exactly the 95% boundary passes: 19/20 ratio at 50+ graded", () => {
    // 76 correct of 80 = exactly 95%
    const status = evaluatePromotionGate(series(76, 4), T0 + 30 * DAY);
    expect(status.passingNow).toBe(true);
    expect(status.correctPct).toBe(95);
  });

  it("one grade below the boundary fails: 75/80 = 93%", () => {
    const status = evaluatePromotionGate(series(75, 5), T0 + 30 * DAY);
    expect(status.passingNow).toBe(false);
    expect(status.eligible).toBe(false);
    expect(status.reasons.join(" ")).toContain("below the 95% bar");
  });

  it("50/50 correct passes the count and rate simultaneously", () => {
    const status = evaluatePromotionGate(series(50, 0), T0 + 30 * DAY);
    expect(status.passingNow).toBe(true);
    // Streak starts at the 50th grade (when the count threshold was reached).
    expect(status.sustainedSinceMs).toBe(T0 + 49 * 1000);
  });

  it("passing but not yet sustained 14 days → not eligible, shows sustain-until", () => {
    const events = series(50, 0);
    const status = evaluatePromotionGate(events, T0 + 49 * 1000 + 13 * DAY);
    expect(status.passingNow).toBe(true);
    expect(status.eligible).toBe(false);
    expect(status.reasons.join(" ")).toContain("sustain until");
  });

  it("sustained 14 days → eligible; gate informs, never auto-promotes", () => {
    const events = series(50, 0);
    const status = evaluatePromotionGate(events, T0 + 49 * 1000 + 14 * DAY);
    expect(status.eligible).toBe(true);
    expect(status.reasons.join(" ")).toContain("operator promotes");
  });

  it("a dip below the bar RESETS the sustain clock", () => {
    // 60 correct (passing from grade 50), then a wrong at day 10 that drops
    // 60/61 = 98%... need a real dip: 50 correct then 3 wrong → 50/53 = 94%.
    const events = [
      ...series(50, 0),
      grade(100, "wrong", { at: T0 + 10 * DAY }),
      grade(101, "wrong", { at: T0 + 10 * DAY + 1000 }),
      grade(102, "wrong", { at: T0 + 10 * DAY + 2000 }),
      // recover: 100 more corrects → 150/153 = 98%
      ...Array.from({ length: 100 }, (_, i) =>
        grade(200 + i, "correct", { at: T0 + 11 * DAY + i * 1000 }),
      ),
    ];
    const status = evaluatePromotionGate(events, T0 + 20 * DAY);
    expect(status.passingNow).toBe(true);
    // Clock restarted when the rate re-crossed 95% during the recovery run,
    // NOT at the original grade-50 entry.
    expect(status.sustainedSinceMs).toBeGreaterThan(T0 + 11 * DAY);
    expect(status.eligible).toBe(false);
  });

  it("no grades → not passing, needs 50", () => {
    const status = evaluatePromotionGate([], T0);
    expect(status).toMatchObject({ passingNow: false, eligible: false, gradedCount: 0 });
    expect(status.reasons.join(" ")).toContain("needs 50 more");
  });

  it("needs_change counts as not-correct", () => {
    const events = [
      ...series(48, 0),
      grade(100, "needs_change", { at: T0 + 100_000 }),
      grade(101, "needs_change", { at: T0 + 101_000 }),
    ];
    // 48/50 = 96% → passes count+rate
    const status = evaluatePromotionGate(events, T0 + 30 * DAY);
    expect(status.gradedCount).toBe(50);
    expect(status.correctCount).toBe(48);
    expect(status.passingNow).toBe(true);
  });
});

describe("gradableComponentsForRun", () => {
  it("derives proposed_action components + report", () => {
    const components = gradableComponentsForRun({
      events: [
        { type: "claimed" },
        { type: "proposed_action", detail: { tool: "atera_write" } },
        { type: "proposed_action", detail: { tool: "atera_write" } },
        { type: "proposed_action", detail: { tool: "email_delivery" } },
      ],
      summary: "triaged 6 tickets",
    });
    expect(components).toEqual([
      "proposed_action:atera_write",
      "proposed_action:email_delivery",
      "report",
    ]);
  });

  it("run with no proposals and no report → single 'run' component", () => {
    expect(gradableComponentsForRun({ events: [{ type: "claimed" }] })).toEqual(["run"]);
  });
});
