import { describe, expect, it } from "vitest";
import { __testing } from "./onboarding-pack-tool.js";

describe("onboarding_pack helpers", () => {
  it("normalizes envelope payload shape", () => {
    const intake = __testing.normalizeIntake({
      kind: "argentos.customer-intake",
      schemaVersion: "1.0.0",
      payload: {
        company: { name: "CTSA", industry: "Operations", headcount: 42 },
        contacts: [{ name: "Jason", role: "Owner", email: "jason@example.com" }],
        painPoints: [{ statement: "Incident alerts are noisy and ignored." }],
        outcomes: { dayOneAnchor: "Auto-triage critical alerts." },
        integrations: ["Slack", "Coolify"],
      },
    });

    expect(intake.companyName).toBe("CTSA");
    expect(intake.industry).toBe("Operations");
    expect(intake.contacts[0]?.name).toBe("Jason");
    expect(intake.painPoints.length).toBe(1);
    expect(intake.outcomes.dayOneAnchor).toBe("Auto-triage critical alerts.");
    expect(intake.integrations).toEqual(["Slack", "Coolify"]);
  });

  it("infers archetypes from pain patterns and includes orchestrator", () => {
    const roster = __testing.inferArchetypes([
      "Ticket queue triage is manual.",
      "Customer updates are inconsistent during incidents.",
      "Compliance evidence is hard to reconstruct.",
    ]);

    const names = roster.map((role) => role.name);
    expect(names).toContain("Dispatch Coordinator");
    expect(names).toContain("Customer Communications");
    expect(names).toContain("Compliance Guardian");
    expect(names).toContain("Orchestrator");
  });

  it("builds all four onboarding artifacts", () => {
    const intake = __testing.normalizeIntake({
      company: { name: "ACME", industry: "MSP" },
      contacts: [{ name: "Dustin", role: "Ops Lead" }],
      painPoints: ["Alert noise delays response."],
      outcomes: { dayOneAnchor: "Reliable critical alert handling." },
      integrations: ["Discord"],
    });
    const roster = __testing.inferArchetypes(intake.painPoints);
    const artifacts = __testing.buildArtifacts(intake, roster);

    expect(artifacts.map((item) => item.key)).toEqual([
      "strategy",
      "technical",
      "bootstrap",
      "skillsGap",
    ]);
    expect(artifacts[0]?.content).toContain("ArgentOS Strategy");
    expect(artifacts[1]?.content).toContain("Technical Implementation Spec");
    expect(artifacts[2]?.content).toContain("Bootstrap Prompt");
    expect(artifacts[3]?.content).toContain("Skills Gap Report");
  });
});
