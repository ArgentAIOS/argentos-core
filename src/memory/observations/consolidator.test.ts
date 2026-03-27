import { describe, expect, it, vi } from "vitest";
import type { MemoryAdapter } from "../../data/adapter.js";
import type { CreateKnowledgeObservationInput, Entity, Lesson, MemoryItem } from "../memu-types.js";
import {
  consolidateKnowledgeObservations,
  sweepKnowledgeObservationScopeRevalidation,
} from "./consolidator.js";

function makeMockMemory(params?: {
  items?: MemoryItem[];
  lessons?: Lesson[];
  entities?: Entity[];
  entityMap?: Record<string, Entity[]>;
  existing?: Array<{
    id: string;
    canonicalKey: string;
    kind: CreateKnowledgeObservationInput["kind"];
    summary: string;
    revalidationDueAt?: string | null;
    lastSupportedAt?: string | null;
  }>;
}) {
  const upsert = vi.fn(async (input: CreateKnowledgeObservationInput) => ({
    id: "obs-new",
    kind: input.kind,
    subjectType: input.subjectType,
    subjectId: input.subjectId ?? null,
    canonicalKey: input.canonicalKey,
    summary: input.summary,
    detail: input.detail ?? null,
    confidence: input.confidence ?? 0.5,
    confidenceComponents: input.confidenceComponents ?? {},
    freshness: input.freshness ?? 1,
    revalidationDueAt: input.revalidationDueAt ?? null,
    supportCount: input.supportCount ?? 0,
    sourceDiversity: input.sourceDiversity ?? 0,
    contradictionWeight: input.contradictionWeight ?? 0,
    operatorConfirmed: input.operatorConfirmed ?? false,
    status: input.status ?? "active",
    firstSupportedAt: input.firstSupportedAt ?? null,
    lastSupportedAt: input.lastSupportedAt ?? null,
    lastContradictedAt: input.lastContradictedAt ?? null,
    supersedesObservationId: input.supersedesObservationId ?? null,
    embedding: null,
    tags: input.tags ?? [],
    metadata: input.metadata ?? {},
    visibility: input.visibility ?? "private",
    createdAt: "2026-03-10T00:00:00Z",
    updatedAt: "2026-03-10T00:00:00Z",
  }));
  const supersede = vi.fn(
    async ({ successor }: { id: string; successor: CreateKnowledgeObservationInput }) =>
      upsert({ ...successor, supersedesObservationId: "obs-old" }),
  );
  const markStale = vi.fn(async () => {});

  return {
    memory: {
      listItems: vi.fn(async () => params?.items ?? []),
      listLessons: vi.fn(async () => params?.lessons ?? []),
      listEntities: vi.fn(async () => params?.entities ?? []),
      getItemEntities: vi.fn(async (itemId: string) => params?.entityMap?.[itemId] ?? []),
      listKnowledgeObservations: vi.fn(async () =>
        (params?.existing ?? []).map((entry) => ({
          id: entry.id,
          kind: entry.kind,
          subjectType:
            entry.kind === "tooling_state"
              ? "tool"
              : entry.kind === "project_state"
                ? "project"
                : "entity",
          subjectId: "subject",
          canonicalKey: entry.canonicalKey,
          summary: entry.summary,
          detail: null,
          confidence: 0.5,
          confidenceComponents: {},
          freshness: 1,
          revalidationDueAt: entry.revalidationDueAt ?? null,
          supportCount: 1,
          sourceDiversity: 1,
          contradictionWeight: 0,
          operatorConfirmed: false,
          status: "active",
          firstSupportedAt: null,
          lastSupportedAt: entry.lastSupportedAt ?? null,
          lastContradictedAt: null,
          supersedesObservationId: null,
          embedding: null,
          tags: [],
          metadata: {},
          visibility: "private",
          createdAt: "2026-03-01T00:00:00Z",
          updatedAt: "2026-03-01T00:00:00Z",
        })),
      ),
      upsertKnowledgeObservation: upsert,
      supersedeKnowledgeObservation: supersede,
      markKnowledgeObservationStale: markStale,
    } as unknown as MemoryAdapter,
    upsert,
    supersede,
    markStale,
  };
}

describe("knowledge observation consolidator", () => {
  it("creates operator preference observations from memory items", async () => {
    const item: MemoryItem = {
      id: "item-1",
      resourceId: null,
      memoryType: "knowledge",
      summary: "Jason prefers Discord for quick project updates",
      embedding: null,
      happenedAt: null,
      contentHash: null,
      reinforcementCount: 1,
      lastReinforcedAt: null,
      extra: {},
      emotionalValence: 0,
      emotionalArousal: 0,
      moodAtCapture: null,
      significance: "important",
      reflection: null,
      lesson: null,
      createdAt: "2026-03-09T00:00:00Z",
      updatedAt: "2026-03-09T00:00:00Z",
    };
    const { memory, upsert } = makeMockMemory({
      items: [item],
      entityMap: {
        "item-1": [
          {
            id: "Jason Brashear",
            name: "Jason Brashear",
            entityType: "person",
            relationship: null,
            bondStrength: 1,
            emotionalTexture: null,
            profileSummary: null,
            firstMentionedAt: null,
            lastMentionedAt: null,
            memoryCount: 1,
            embedding: null,
            createdAt: "",
            updatedAt: "",
          },
        ],
      },
    });

    const results = await consolidateKnowledgeObservations({
      memory,
      now: new Date("2026-03-10T00:00:00Z"),
    });

    expect(results[0]?.action).toBe("create");
    expect(upsert).toHaveBeenCalledTimes(1);
    const payload = upsert.mock.calls[0]?.[0];
    expect(payload.canonicalKey).toContain("operator_preference:delivery_preference");
  });

  it("reinforces unchanged truths and supersedes materially changed ones", async () => {
    const lesson: Lesson = {
      id: "lesson-1",
      type: "success",
      context: "When using playwright",
      action: "Run the smoke flow first",
      outcome: "It verifies auth quickly",
      lesson: "Playwright works best when you run a smoke flow before the full suite",
      correction: null,
      confidence: 0.9,
      occurrences: 3,
      lastSeen: "2026-03-10T00:00:00Z",
      tags: ["playwright"],
      relatedTools: ["playwright"],
      sourceEpisodeIds: [],
      createdAt: "2026-03-01T00:00:00Z",
      updatedAt: "2026-03-10T00:00:00Z",
    };
    const { memory, supersede } = makeMockMemory({
      lessons: [lesson],
      existing: [
        {
          id: "obs-old",
          kind: "tooling_state",
          canonicalKey: "tool:playwright:tooling_state:best_path",
          summary: "Some older Playwright guidance",
        },
      ],
    });

    const results = await consolidateKnowledgeObservations({
      memory,
      now: new Date("2026-03-10T00:00:00Z"),
    });

    expect(results[0]?.action).toBe("supersede");
    expect(supersede).toHaveBeenCalledTimes(1);
  });

  it("coalesces entity context and memory evidence into one relationship_fact", async () => {
    const richard: Entity = {
      id: "ent-richard",
      name: "Richard Avery",
      entityType: "person",
      relationship: "business partner and co-founder",
      bondStrength: 0.9,
      emotionalTexture: "professional trust",
      profileSummary: "Richard Avery is your business partner and co-founder on ArgentOS",
      firstMentionedAt: null,
      lastMentionedAt: null,
      memoryCount: 4,
      embedding: null,
      createdAt: "2026-03-01T00:00:00Z",
      updatedAt: "2026-03-12T00:00:00Z",
    };
    const item: MemoryItem = {
      id: "item-relationship",
      resourceId: null,
      memoryType: "knowledge",
      summary: "Richard Avery is your business partner and co-founder on ArgentOS",
      embedding: null,
      happenedAt: null,
      contentHash: null,
      reinforcementCount: 1,
      lastReinforcedAt: null,
      extra: {},
      emotionalValence: 0,
      emotionalArousal: 0,
      moodAtCapture: null,
      significance: "important",
      reflection: null,
      lesson: null,
      createdAt: "2026-03-10T00:00:00Z",
      updatedAt: "2026-03-10T00:00:00Z",
    };
    const { memory, upsert } = makeMockMemory({
      items: [item],
      entities: [richard],
      entityMap: {
        "item-relationship": [richard],
      },
    });

    const results = await consolidateKnowledgeObservations({
      memory,
      now: new Date("2026-03-14T00:00:00Z"),
    });

    const relationshipResult = results.find(
      (result) => result.observation?.kind === "relationship_fact",
    );
    expect(relationshipResult?.action).toBe("create");
    expect(upsert).toHaveBeenCalledTimes(1);
    const payload = upsert.mock.calls[0]?.[0];
    expect(payload.kind).toBe("relationship_fact");
    expect(payload.canonicalKey).toBe("entity:ent-richard:relationship_fact:relationship");
    expect(payload.supportCount).toBe(2);
    expect(payload.evidence).toHaveLength(2);
  });

  it("creates project_state observations from project planning records", async () => {
    const item: MemoryItem = {
      id: "item-project-plan",
      resourceId: null,
      memoryType: "knowledge",
      summary: "Forward Observer Area Intelligence Platform — V1 PRD Draft",
      embedding: null,
      happenedAt: null,
      contentHash: null,
      reinforcementCount: 1,
      lastReinforcedAt: null,
      extra: {
        source: "knowledge_ingest",
        collection: "docpane",
      },
      emotionalValence: 0,
      emotionalArousal: 0,
      moodAtCapture: null,
      significance: "important",
      reflection: null,
      lesson: null,
      createdAt: "2026-03-14T00:00:00Z",
      updatedAt: "2026-03-14T00:00:00Z",
    };
    const { memory, upsert } = makeMockMemory({
      items: [item],
    });

    await consolidateKnowledgeObservations({
      memory,
      now: new Date("2026-03-15T00:00:00Z"),
    });

    expect(upsert).toHaveBeenCalledTimes(1);
    const payload = upsert.mock.calls[0]?.[0];
    expect(payload.kind).toBe("project_state");
    expect(payload.canonicalKey).toBe(
      "project:forward-observer-area-intelligence-platform:project_state:status",
    );
    expect(payload.metadata.projectState).toBe("planning");
  });

  it("uses a linked project entity name for the canonical project_state key", async () => {
    const project: Entity = {
      id: "project-random-id",
      name: "Argent Launch",
      entityType: "project",
      relationship: null,
      bondStrength: 0.7,
      emotionalTexture: null,
      profileSummary: null,
      firstMentionedAt: null,
      lastMentionedAt: null,
      memoryCount: 2,
      embedding: null,
      createdAt: "2026-03-01T00:00:00Z",
      updatedAt: "2026-03-10T00:00:00Z",
    };
    const item: MemoryItem = {
      id: "item-project-linked",
      resourceId: null,
      memoryType: "event",
      summary: "Argent Launch project went live on the staging domain",
      embedding: null,
      happenedAt: "2026-03-10T00:00:00Z",
      contentHash: null,
      reinforcementCount: 1,
      lastReinforcedAt: null,
      extra: {},
      emotionalValence: 0,
      emotionalArousal: 0,
      moodAtCapture: null,
      significance: "important",
      reflection: null,
      lesson: null,
      createdAt: "2026-03-10T00:00:00Z",
      updatedAt: "2026-03-10T00:00:00Z",
    };
    const { memory, upsert } = makeMockMemory({
      items: [item],
      entityMap: {
        "item-project-linked": [project],
      },
    });

    await consolidateKnowledgeObservations({
      memory,
      now: new Date("2026-03-11T00:00:00Z"),
    });

    const payload = upsert.mock.calls[0]?.[0];
    expect(payload.canonicalKey).toBe("project:argent-launch:project_state:status");
  });

  it("collapses same-key project backfill into one active write with contradiction evidence", async () => {
    const planningItem: MemoryItem = {
      id: "item-project-planning",
      resourceId: null,
      memoryType: "knowledge",
      summary: "Project: Desiree Honeypot — Planning Draft for OSINT Portfolio Site",
      embedding: null,
      happenedAt: null,
      contentHash: null,
      reinforcementCount: 1,
      lastReinforcedAt: null,
      extra: {
        collection: "desiree-honeypot",
      },
      emotionalValence: 0,
      emotionalArousal: 0,
      moodAtCapture: null,
      significance: "important",
      reflection: null,
      lesson: null,
      createdAt: "2026-03-01T00:00:00Z",
      updatedAt: "2026-03-01T00:00:00Z",
    };
    const liveItem: MemoryItem = {
      id: "item-project-live",
      resourceId: null,
      memoryType: "event",
      summary: "Desiree Honeypot project website went live with Cloudflare DNS and Coolify deploys",
      embedding: null,
      happenedAt: "2026-03-08T00:00:00Z",
      contentHash: null,
      reinforcementCount: 1,
      lastReinforcedAt: null,
      extra: {
        collection: "desiree-honeypot",
      },
      emotionalValence: 0,
      emotionalArousal: 0,
      moodAtCapture: null,
      significance: "important",
      reflection: null,
      lesson: null,
      createdAt: "2026-03-08T00:00:00Z",
      updatedAt: "2026-03-08T00:00:00Z",
    };
    const { memory, upsert } = makeMockMemory({
      items: [planningItem, liveItem],
    });

    const results = await consolidateKnowledgeObservations({
      memory,
      now: new Date("2026-03-10T00:00:00Z"),
    });

    expect(results).toHaveLength(1);
    expect(upsert).toHaveBeenCalledTimes(1);
    const payload = upsert.mock.calls[0]?.[0];
    expect(payload.kind).toBe("project_state");
    expect(payload.canonicalKey).toBe("project:desiree-honeypot:project_state:status");
    expect(payload.summary).toContain("went live");
    expect(payload.evidence).toHaveLength(2);
    expect(payload.contradictionWeight).toBeGreaterThan(0);
  });

  it("marks due project or relationship observations stale only when no current scope reproduces them", async () => {
    const dueObservationKey = "project:desired-launch:project_state:status";
    const retainedObservationKey = "project:argent-launch:project_state:status";
    const project: Entity = {
      id: "project-argent",
      name: "Argent Launch",
      entityType: "project",
      relationship: null,
      bondStrength: 0.8,
      emotionalTexture: null,
      profileSummary: null,
      firstMentionedAt: null,
      lastMentionedAt: null,
      memoryCount: 2,
      embedding: null,
      createdAt: "2026-03-01T00:00:00Z",
      updatedAt: "2026-03-10T00:00:00Z",
    };
    const item: MemoryItem = {
      id: "item-project-active",
      resourceId: null,
      memoryType: "event",
      summary: "Argent Launch project is approved for the next deploy window",
      embedding: null,
      happenedAt: "2026-03-10T00:00:00Z",
      contentHash: null,
      reinforcementCount: 1,
      lastReinforcedAt: null,
      extra: {},
      emotionalValence: 0,
      emotionalArousal: 0,
      moodAtCapture: null,
      significance: "important",
      reflection: null,
      lesson: null,
      createdAt: "2026-03-10T00:00:00Z",
      updatedAt: "2026-03-10T00:00:00Z",
    };
    const { memory, markStale } = makeMockMemory({
      items: [item],
      entityMap: {
        "item-project-active": [project],
      },
      existing: [
        {
          id: "obs-due-missing",
          kind: "project_state",
          canonicalKey: dueObservationKey,
          summary: "Desired Launch is still in planning",
          revalidationDueAt: "2026-03-04T00:00:00Z",
          lastSupportedAt: "2026-03-01T00:00:00Z",
        },
        {
          id: "obs-due-retained",
          kind: "project_state",
          canonicalKey: retainedObservationKey,
          summary: "Argent Launch is approved for the next deploy window",
          revalidationDueAt: "2026-03-04T00:00:00Z",
          lastSupportedAt: "2026-03-01T00:00:00Z",
        },
      ],
    });

    const result = await sweepKnowledgeObservationScopeRevalidation({
      memory,
      now: new Date("2026-03-20T00:00:00Z"),
    });

    expect(result.markedStale).toBe(1);
    expect(result.staleIds).toEqual(["obs-due-missing"]);
    expect(result.retainedCanonicalKeys).toContain(retainedObservationKey);
    expect(markStale).toHaveBeenCalledTimes(1);
    expect(markStale).toHaveBeenCalledWith("obs-due-missing");
  });
});
