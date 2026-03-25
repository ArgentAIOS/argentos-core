import { describe, expect, it } from "vitest";
import {
  buildKnowledgeObservationCanonicalKey,
  normalizeObservationKeySegment,
} from "./canonical-key.js";

describe("knowledge observation canonical key", () => {
  it("normalizes key segments deterministically", () => {
    expect(normalizeObservationKeySegment("  Jason Brashear  ")).toBe("jason-brashear");
    expect(normalizeObservationKeySegment("Discord / Voice")).toBe("discord-voice");
  });

  it("builds entity preference keys with lowercase stable format", () => {
    expect(
      buildKnowledgeObservationCanonicalKey({
        kind: "operator_preference",
        subjectType: "entity",
        subjectId: "Entity Jason",
        slot: "delivery_preference",
      }),
    ).toBe("entity:entity-jason:operator_preference:delivery_preference");
  });

  it("builds relationship and project keys with stable ontology slots", () => {
    expect(
      buildKnowledgeObservationCanonicalKey({
        kind: "relationship_fact",
        subjectType: "entity",
        subjectId: "Richard Avery",
        slot: "relationship",
      }),
    ).toBe("entity:richard-avery:relationship_fact:relationship");

    expect(
      buildKnowledgeObservationCanonicalKey({
        kind: "project_state",
        subjectType: "project",
        subjectId: "Forward Observer Area Intelligence Platform",
        slot: "status",
      }),
    ).toBe("project:forward-observer-area-intelligence-platform:project_state:status");
  });

  it("builds tool and world keys without free-form shape drift", () => {
    expect(
      buildKnowledgeObservationCanonicalKey({
        kind: "tooling_state",
        subjectType: "tool",
        subjectId: "Playwright CLI",
        slot: "failure_mode",
      }),
    ).toBe("tool:playwright-cli:tooling_state:failure_mode");

    expect(
      buildKnowledgeObservationCanonicalKey({
        kind: "world_fact",
        subjectType: "global",
        slot: "status",
      }),
    ).toBe("global:world_fact:status");
  });
});
