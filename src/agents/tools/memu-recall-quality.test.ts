/**
 * Gold-set regression suite for Memory Retrieval Quality Layer (MRQL)
 *
 * Tests the recall quality enhancements: mode presets, two-pass retrieval,
 * type diversity quotas, entity graph expansion, and coverage metadata.
 *
 * Uses a mock MemuStore with known data to verify deterministic behavior.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import type { MemoryType } from "../../memory/memu-types.js";

const gatewayCallMock = vi.hoisted(() =>
  vi.fn(async () => ({
    success: true,
    query: "",
    count: 0,
    totalMatched: 0,
    limit: 0,
    includeShared: false,
    ingestedOnly: true,
    aclEnforced: true,
    results: [],
  })),
);

// ── Gold Set: Known memories in the mock store ──

interface MockItem {
  id: string;
  memoryType: MemoryType;
  summary: string;
  significance: string;
  reinforcementCount: number;
  createdAt: string;
  happenedAt: string | null;
  extra?: Record<string, unknown>;
  emotionalValence?: number;
  emotionalArousal?: number;
  reflection?: string | null;
  lesson?: string | null;
}

const GOLD_SET: MockItem[] = [
  {
    id: "k1",
    memoryType: "knowledge",
    summary: "Jason is a CCIE and Red Hat certified engineer",
    significance: "core",
    reinforcementCount: 5,
    createdAt: "2026-01-01T00:00:00Z",
    happenedAt: null,
  },
  {
    id: "k2",
    memoryType: "knowledge",
    summary: "Jason has 30+ years IT experience since 1994",
    significance: "core",
    reinforcementCount: 3,
    createdAt: "2026-01-01T00:00:00Z",
    happenedAt: null,
  },
  {
    id: "k3",
    memoryType: "knowledge",
    summary: "TypeScript is the primary language for ArgentOS",
    significance: "noteworthy",
    reinforcementCount: 2,
    createdAt: "2026-01-15T00:00:00Z",
    happenedAt: null,
  },
  {
    id: "k4",
    memoryType: "knowledge",
    summary: "Jason works with his business partner Richard",
    significance: "important",
    reinforcementCount: 4,
    createdAt: "2026-01-01T00:00:00Z",
    happenedAt: null,
  },
  {
    id: "k5",
    memoryType: "knowledge",
    summary: "Jason has a Dell R750 with 2TB RAM",
    significance: "noteworthy",
    reinforcementCount: 1,
    createdAt: "2026-01-10T00:00:00Z",
    happenedAt: null,
  },
  {
    id: "k6",
    memoryType: "knowledge",
    summary: "Jason has 2x NVIDIA DGX Spark",
    significance: "noteworthy",
    reinforcementCount: 1,
    createdAt: "2026-01-10T00:00:00Z",
    happenedAt: null,
  },
  {
    id: "k7",
    memoryType: "knowledge",
    summary: "Jason is an MSP owner",
    significance: "important",
    reinforcementCount: 2,
    createdAt: "2026-01-01T00:00:00Z",
    happenedAt: null,
  },
  {
    id: "k8",
    memoryType: "knowledge",
    summary: "Jason uses pnpm for package management",
    significance: "routine",
    reinforcementCount: 1,
    createdAt: "2026-02-01T00:00:00Z",
    happenedAt: null,
  },
  {
    id: "k9",
    memoryType: "knowledge",
    summary: "The goal is to hit $1M and retire",
    significance: "important",
    reinforcementCount: 3,
    createdAt: "2026-01-05T00:00:00Z",
    happenedAt: null,
  },
  {
    id: "k10",
    memoryType: "knowledge",
    summary: "Jason prefers free and open-source software",
    significance: "noteworthy",
    reinforcementCount: 2,
    createdAt: "2026-01-08T00:00:00Z",
    happenedAt: null,
  },
  {
    id: "k11",
    memoryType: "knowledge",
    summary: "ArgentOS uses pnpm monorepo structure",
    significance: "routine",
    reinforcementCount: 1,
    createdAt: "2026-01-20T00:00:00Z",
    happenedAt: null,
  },
  {
    id: "k12",
    memoryType: "knowledge",
    summary: "The dashboard runs on React with Live2D avatar",
    significance: "noteworthy",
    reinforcementCount: 1,
    createdAt: "2026-01-22T00:00:00Z",
    happenedAt: null,
  },
  {
    id: "k13",
    memoryType: "knowledge",
    summary: "MemU uses SQLite FTS5 for keyword search",
    significance: "noteworthy",
    reinforcementCount: 1,
    createdAt: "2026-01-25T00:00:00Z",
    happenedAt: null,
  },
  {
    id: "k14",
    memoryType: "knowledge",
    summary: "The gateway runs on WebSocket port 18789",
    significance: "routine",
    reinforcementCount: 1,
    createdAt: "2026-01-28T00:00:00Z",
    happenedAt: null,
  },
  {
    id: "k15",
    memoryType: "knowledge",
    summary: "Contemplation loop runs every 5 minutes when idle",
    significance: "noteworthy",
    reinforcementCount: 1,
    createdAt: "2026-02-01T00:00:00Z",
    happenedAt: null,
  },
  {
    id: "k16",
    memoryType: "knowledge",
    summary: "SIS extracts lessons from contemplation episodes",
    significance: "noteworthy",
    reinforcementCount: 1,
    createdAt: "2026-02-02T00:00:00Z",
    happenedAt: null,
  },
  {
    id: "k17",
    memoryType: "knowledge",
    summary: "Model router uses tiers LOCAL FAST BALANCED POWERFUL",
    significance: "noteworthy",
    reinforcementCount: 1,
    createdAt: "2026-02-03T00:00:00Z",
    happenedAt: null,
  },
  {
    id: "k18",
    memoryType: "knowledge",
    summary: "Backup system Phoenix supports S3 R2 and local",
    significance: "routine",
    reinforcementCount: 1,
    createdAt: "2026-02-04T00:00:00Z",
    happenedAt: null,
  },
  {
    id: "k19",
    memoryType: "knowledge",
    summary: "AEVP renders procedural WebGL particles for emotions",
    significance: "noteworthy",
    reinforcementCount: 1,
    createdAt: "2026-02-05T00:00:00Z",
    happenedAt: null,
  },
  {
    id: "k20",
    memoryType: "knowledge",
    summary: "Channels support Telegram Discord Slack WhatsApp",
    significance: "noteworthy",
    reinforcementCount: 1,
    createdAt: "2026-02-06T00:00:00Z",
    happenedAt: null,
  },
  {
    id: "k21",
    memoryType: "knowledge",
    summary: "Heartbeat system runs periodic accountability checks",
    significance: "routine",
    reinforcementCount: 1,
    createdAt: "2026-02-07T00:00:00Z",
    happenedAt: null,
  },
  {
    id: "k22",
    memoryType: "knowledge",
    summary: "Tasks system uses SQLite with FTS and priorities",
    significance: "routine",
    reinforcementCount: 1,
    createdAt: "2026-02-08T00:00:00Z",
    happenedAt: null,
  },
  {
    id: "k23",
    memoryType: "knowledge",
    summary: "Node v22 required for native module compatibility",
    significance: "important",
    reinforcementCount: 2,
    createdAt: "2026-02-09T00:00:00Z",
    happenedAt: null,
  },
  {
    id: "k24",
    memoryType: "knowledge",
    summary: "Drizzle ORM used for PostgreSQL schema migration",
    significance: "noteworthy",
    reinforcementCount: 1,
    createdAt: "2026-02-10T00:00:00Z",
    happenedAt: null,
  },
  {
    id: "k25",
    memoryType: "knowledge",
    summary: "MiniMax M2.1 model available as budget provider",
    significance: "routine",
    reinforcementCount: 1,
    createdAt: "2026-02-11T00:00:00Z",
    happenedAt: null,
  },
  {
    id: "k26",
    memoryType: "knowledge",
    summary: "Forward Observer Area Intelligence Platform — V1 PRD Draft",
    significance: "important",
    reinforcementCount: 2,
    createdAt: "2026-03-14T15:40:00Z",
    happenedAt: null,
    extra: {
      source: "knowledge_ingest",
      collection: "docpane",
    },
  },
  {
    id: "k27",
    memoryType: "knowledge",
    summary: "Forward Observer Area Intelligence Platform — PRP Planning Draft",
    significance: "important",
    reinforcementCount: 2,
    createdAt: "2026-03-14T15:45:00Z",
    happenedAt: null,
    extra: {
      source: "knowledge_ingest",
      collection: "docpane",
    },
  },
  {
    id: "k28",
    memoryType: "knowledge",
    summary: "# PRP: Forward Observer Area Intelligence Platform - Area Intelligence V1 Foundation",
    significance: "noteworthy",
    reinforcementCount: 1,
    createdAt: "2026-03-14T15:50:00Z",
    happenedAt: null,
    extra: {
      source: "knowledge_ingest",
      collection: "docpane",
    },
  },
  {
    id: "k29",
    memoryType: "knowledge",
    summary: "As I Am Allowed To Say — Revision Packet v1",
    significance: "noteworthy",
    reinforcementCount: 1,
    createdAt: "2026-03-14T17:40:00Z",
    happenedAt: null,
    extra: {
      source: "knowledge_ingest",
      collection: "docpane",
    },
  },
  {
    id: "k30",
    memoryType: "knowledge",
    summary: "Jason prefers direct operator approvals for maintenance windows",
    significance: "routine",
    reinforcementCount: 1,
    createdAt: "2026-01-20T00:00:00Z",
    happenedAt: null,
  },
  {
    id: "kw_site1",
    memoryType: "knowledge",
    summary: "Client Resume Portfolio Website",
    significance: "important",
    reinforcementCount: 1,
    createdAt: "2026-02-24T15:00:00Z",
    happenedAt: null,
    extra: {
      source: "knowledge_ingest",
      collection: "docpane",
    },
  },
  {
    id: "kw_site2",
    memoryType: "knowledge",
    summary: "Project: Desiree Honeypot — OSINT Portfolio Site",
    significance: "important",
    reinforcementCount: 1,
    createdAt: "2026-03-04T16:25:59Z",
    happenedAt: null,
    extra: {
      source: "knowledge_ingest",
      collection: "docpane",
    },
  },
  {
    id: "kw_site3",
    memoryType: "knowledge",
    summary:
      "Desiree Honeypot project website uses Namecheap for domain registration, Cloudflare for DNS, and Coolify for deployment.",
    significance: "important",
    reinforcementCount: 1,
    createdAt: "2026-03-04T16:30:16Z",
    happenedAt: null,
    extra: {
      source: "knowledge_ingest",
      collection: "projects",
    },
  },
  {
    id: "kw_site4",
    memoryType: "knowledge",
    summary:
      "Desiree Denning portfolio site was planned as a fake but convincing resume website OSINT honeypot for evidence collection.",
    significance: "important",
    reinforcementCount: 1,
    createdAt: "2026-03-04T16:39:36Z",
    happenedAt: null,
    extra: {
      source: "knowledge_ingest",
      collection: "desiree-honeypot",
    },
  },
  {
    id: "p1",
    memoryType: "profile",
    summary: "Leo is Jason's dog",
    significance: "important",
    reinforcementCount: 2,
    createdAt: "2026-01-01T00:00:00Z",
    happenedAt: null,
  },
  {
    id: "p2",
    memoryType: "profile",
    summary: "Jason lives in Texas",
    significance: "noteworthy",
    reinforcementCount: 1,
    createdAt: "2026-01-02T00:00:00Z",
    happenedAt: null,
  },
  {
    id: "p3",
    memoryType: "profile",
    summary: "Jason's partner Richard handles business ops",
    significance: "important",
    reinforcementCount: 2,
    createdAt: "2026-01-03T00:00:00Z",
    happenedAt: null,
  },
  {
    id: "p4",
    memoryType: "profile",
    summary: "Maggie is Jason's mom and is receiving hospice dementia care with safety monitoring",
    significance: "core",
    reinforcementCount: 4,
    createdAt: "2026-01-04T00:00:00Z",
    happenedAt: null,
  },
  {
    id: "p5",
    memoryType: "profile",
    summary: "Jason's favorite color is mossy oak green",
    significance: "core",
    reinforcementCount: 3,
    createdAt: "2026-01-06T00:00:00Z",
    happenedAt: null,
  },
  {
    id: "p6",
    memoryType: "profile",
    summary: "Jason's favorite number is 17",
    significance: "noteworthy",
    reinforcementCount: 2,
    createdAt: "2026-01-07T00:00:00Z",
    happenedAt: null,
  },
  {
    id: "p7",
    memoryType: "profile",
    summary: "Jason's favorite AI is GPT-5",
    significance: "noteworthy",
    reinforcementCount: 2,
    createdAt: "2026-01-07T00:00:00Z",
    happenedAt: null,
  },
  {
    id: "p8",
    memoryType: "profile",
    summary: "Jason's favorite voice is warm and reassuring",
    significance: "noteworthy",
    reinforcementCount: 2,
    createdAt: "2026-01-07T00:00:00Z",
    happenedAt: null,
  },
  {
    id: "p9",
    memoryType: "profile",
    summary: "Jason likes cheese pizza with Canadian bacon and extra cheese",
    significance: "important",
    reinforcementCount: 3,
    createdAt: "2026-01-08T00:00:00Z",
    happenedAt: null,
  },
  {
    id: "p10",
    memoryType: "profile",
    summary:
      "That's Memo earning his keep! The persistent memory system is doing exactly what it's supposed to, remembering pizza preferences.",
    significance: "routine",
    reinforcementCount: 1,
    createdAt: "2026-01-08T01:00:00Z",
    happenedAt: null,
  },
  {
    id: "p11",
    memoryType: "profile",
    summary:
      "No personal information about Jason's pizza topping preferences was found in this conversation",
    significance: "routine",
    reinforcementCount: 1,
    createdAt: "2026-01-08T02:00:00Z",
    happenedAt: null,
  },
  {
    id: "p12",
    memoryType: "profile",
    summary:
      "Extra cheese and Canadian bacon, right? Want me to order you one, or just confirming I remember your preference?",
    significance: "routine",
    reinforcementCount: 1,
    createdAt: "2026-01-08T03:00:00Z",
    happenedAt: null,
  },
  {
    id: "p13",
    memoryType: "profile",
    summary:
      "Jason is currently working on several projects, including MAO (Multi-Agent Orchestrator)",
    significance: "routine",
    reinforcementCount: 1,
    createdAt: "2026-03-10T12:00:00Z",
    happenedAt: null,
  },
  {
    id: "p14",
    memoryType: "profile",
    summary: "Jason is currently working on building AI-powered SaaS applications and MAO.",
    significance: "routine",
    reinforcementCount: 1,
    createdAt: "2026-03-12T12:00:00Z",
    happenedAt: null,
  },
  {
    id: "e1",
    memoryType: "event",
    summary: "Deployed ArgentOS v0.9 on Feb 10",
    significance: "important",
    reinforcementCount: 1,
    createdAt: "2026-02-10T00:00:00Z",
    happenedAt: "2026-02-10T00:00:00Z",
  },
  {
    id: "e2",
    memoryType: "event",
    summary: "Fixed zombie reaper bug on Feb 10",
    significance: "noteworthy",
    reinforcementCount: 1,
    createdAt: "2026-02-10T00:00:00Z",
    happenedAt: "2026-02-10T00:00:00Z",
  },
  {
    id: "e3",
    memoryType: "event",
    summary:
      "Shaped Forward Observer into a living area-intelligence platform and drafted the first brief flow",
    significance: "important",
    reinforcementCount: 1,
    createdAt: "2026-03-03T16:00:00Z",
    happenedAt: "2026-03-03T16:00:00Z",
  },
  {
    id: "e4",
    memoryType: "event",
    summary:
      "Built the Forward Observer PRP outline and initial task breakdown for the Area Intelligence V1 foundation",
    significance: "important",
    reinforcementCount: 1,
    createdAt: "2026-03-03T18:30:00Z",
    happenedAt: "2026-03-03T18:30:00Z",
  },
  {
    id: "e5",
    memoryType: "event",
    summary:
      "Defined the Forward Observer source matrix and separated Railway app runtime from Coolify worker orchestration",
    significance: "important",
    reinforcementCount: 1,
    createdAt: "2026-03-05T15:00:00Z",
    happenedAt: "2026-03-05T15:00:00Z",
  },
  {
    id: "e6",
    memoryType: "event",
    summary:
      "Locked the Forward Observer initial task breakdown and scheduled refresh flow for the first Area Intelligence iteration",
    significance: "important",
    reinforcementCount: 1,
    createdAt: "2026-03-06T17:00:00Z",
    happenedAt: "2026-03-06T17:00:00Z",
  },
  {
    id: "e7",
    memoryType: "event",
    summary: "Jason's Atera Integration is active in 2026",
    significance: "routine",
    reinforcementCount: 1,
    createdAt: "2026-03-13T16:00:00Z",
    happenedAt: "2026-03-13T16:00:00Z",
  },
  {
    id: "e8",
    memoryType: "event",
    summary: "Jason has been working with Atera RMM/PSA platform since 2026",
    significance: "routine",
    reinforcementCount: 1,
    createdAt: "2026-03-13T17:00:00Z",
    happenedAt: "2026-03-13T17:00:00Z",
  },
  {
    id: "e9",
    memoryType: "event",
    summary: "Jason has an active Cron job with next run scheduled at 2026-03-13T01:59:36.533Z",
    significance: "routine",
    reinforcementCount: 1,
    createdAt: "2026-03-13T18:00:00Z",
    happenedAt: "2026-03-13T18:00:00Z",
  },
  {
    id: "e10",
    memoryType: "event",
    summary: "Richard asked for more visibility into company reporting and ticket response metrics",
    significance: "important",
    reinforcementCount: 1,
    createdAt: "2026-01-18T16:00:00Z",
    happenedAt: "2026-01-18T16:00:00Z",
  },
  {
    id: "e11",
    memoryType: "event",
    summary: "Richard dashboard went live with Atera metrics and auto-deploys",
    significance: "important",
    reinforcementCount: 1,
    createdAt: "2026-01-20T16:00:00Z",
    happenedAt: "2026-01-20T16:00:00Z",
  },
  {
    id: "k31",
    memoryType: "knowledge",
    summary: "Richard Avery is your business partner and co-founder on ArgentOS",
    significance: "important",
    reinforcementCount: 1,
    createdAt: "2026-01-31T16:00:00Z",
    happenedAt: null,
  },
  {
    id: "ev_site1",
    memoryType: "event",
    summary:
      "Built the Client Resume Portfolio Website for a woman client with domain setup on Namecheap, DNS on Cloudflare, and deployment on Coolify to collect lead data",
    significance: "important",
    reinforcementCount: 1,
    createdAt: "2026-02-24T16:00:00Z",
    happenedAt: "2026-02-24T16:00:00Z",
  },
  {
    id: "ev_site2",
    memoryType: "event",
    summary:
      "Granted the family dev team permission to build the Client Resume Portfolio Website and wire the form-based data collection flow",
    significance: "important",
    reinforcementCount: 1,
    createdAt: "2026-02-24T17:00:00Z",
    happenedAt: "2026-02-24T17:00:00Z",
  },
  {
    id: "b1",
    memoryType: "behavior",
    summary: "Jason values speed — ship fast iterate",
    significance: "core",
    reinforcementCount: 4,
    createdAt: "2026-01-01T00:00:00Z",
    happenedAt: null,
  },
  {
    id: "b2",
    memoryType: "behavior",
    summary: "Jason prefers concise communication",
    significance: "noteworthy",
    reinforcementCount: 2,
    createdAt: "2026-01-05T00:00:00Z",
    happenedAt: null,
  },
  {
    id: "s1",
    memoryType: "self",
    summary: "I tend to over-explain when simpler answers suffice",
    significance: "noteworthy",
    reinforcementCount: 1,
    createdAt: "2026-02-01T00:00:00Z",
    happenedAt: null,
  },
  {
    id: "sk1",
    memoryType: "skill",
    summary: "Proficient at TypeScript refactoring patterns",
    significance: "noteworthy",
    reinforcementCount: 1,
    createdAt: "2026-02-05T00:00:00Z",
    happenedAt: null,
  },
  {
    id: "t1",
    memoryType: "tool",
    summary: "argent CLI rebuilds automatically when src changes",
    significance: "noteworthy",
    reinforcementCount: 1,
    createdAt: "2026-02-01T00:00:00Z",
    happenedAt: null,
  },
];

interface MockEntity {
  id: string;
  name: string;
  entityType: string;
  relationship: string | null;
  bondStrength: number;
  emotionalTexture: string | null;
  profileSummary: string | null;
  firstMentionedAt: string | null;
  lastMentionedAt: string | null;
  memoryCount: number;
  embedding: null;
  createdAt: string;
  updatedAt: string;
}

const ENTITIES: MockEntity[] = [
  {
    id: "ent1",
    name: "Jason Brashear",
    entityType: "person",
    relationship: "owner",
    bondStrength: 1.0,
    emotionalTexture: "deep respect",
    profileSummary: null,
    firstMentionedAt: "2026-01-01T00:00:00Z",
    lastMentionedAt: "2026-02-15T00:00:00Z",
    memoryCount: 10,
    embedding: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-02-15T00:00:00Z",
  },
  {
    id: "ent2",
    name: "Leo",
    entityType: "pet",
    relationship: "Jason's dog",
    bondStrength: 0.9,
    emotionalTexture: "affection",
    profileSummary: null,
    firstMentionedAt: "2026-01-01T00:00:00Z",
    lastMentionedAt: "2026-02-10T00:00:00Z",
    memoryCount: 2,
    embedding: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-02-10T00:00:00Z",
  },
  {
    id: "ent3",
    name: "Richard",
    entityType: "person",
    relationship: "business partner",
    bondStrength: 0.8,
    emotionalTexture: "professional trust",
    profileSummary: null,
    firstMentionedAt: "2026-01-01T00:00:00Z",
    lastMentionedAt: "2026-02-14T00:00:00Z",
    memoryCount: 3,
    embedding: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-02-14T00:00:00Z",
  },
  {
    id: "ent4",
    name: "Maggie",
    entityType: "person",
    relationship: "mother",
    bondStrength: 0.98,
    emotionalTexture: "deep love and caregiving responsibility",
    profileSummary: "Jason's mother with dementia receiving hospice support",
    firstMentionedAt: "2026-01-01T00:00:00Z",
    lastMentionedAt: "2026-02-14T00:00:00Z",
    memoryCount: 1,
    embedding: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-02-14T00:00:00Z",
  },
];

// Entity → item links
const ENTITY_ITEMS: Record<string, string[]> = {
  ent1: ["k1", "k2", "k4", "k7", "k9", "k30", "p2", "b1", "b2"],
  ent2: ["p1"],
  ent3: ["k4", "k30", "p3", "e10", "e11", "k31"],
  ent4: ["p4"],
};

// Item → entity links (reverse index)
const ITEM_ENTITIES: Record<string, string[]> = {};
for (const [entityId, itemIds] of Object.entries(ENTITY_ITEMS)) {
  for (const itemId of itemIds) {
    if (!ITEM_ENTITIES[itemId]) ITEM_ENTITIES[itemId] = [];
    ITEM_ENTITIES[itemId].push(entityId);
  }
}

// ── Mocks ──

const mockStore = {
  getStats: () => ({
    resources: 0,
    items: GOLD_SET.length,
    categories: 5,
    entities: ENTITIES.length,
    reflections: 0,
    lessons: 0,
    modelFeedback: 0,
    itemsByType: {
      knowledge: GOLD_SET.filter((i) => i.memoryType === "knowledge").length,
      profile: GOLD_SET.filter((i) => i.memoryType === "profile").length,
      event: GOLD_SET.filter((i) => i.memoryType === "event").length,
      behavior: GOLD_SET.filter((i) => i.memoryType === "behavior").length,
      self: GOLD_SET.filter((i) => i.memoryType === "self").length,
      skill: GOLD_SET.filter((i) => i.memoryType === "skill").length,
      tool: GOLD_SET.filter((i) => i.memoryType === "tool").length,
    },
    vecAvailable: false,
  }),
  getEntityByName: (name: string) =>
    ENTITIES.find((e) => e.name.toLowerCase() === name.toLowerCase()) ?? null,
  getEntityItems: (entityId: string, _limit: number) => {
    const itemIds = ENTITY_ITEMS[entityId] ?? [];
    return itemIds.map((id) => GOLD_SET.find((i) => i.id === id)!).filter(Boolean);
  },
  getItemEntities: (itemId: string) => {
    const entityIds = ITEM_ENTITIES[itemId] ?? [];
    return entityIds.map((id) => ENTITIES.find((e) => e.id === id)!).filter(Boolean);
  },
  getItemCategories: (_itemId: string) => [],
};

const mockMemoryAdapter: any = {
  withAgentId: () => mockMemoryAdapter,
  searchByKeyword: async (query: string, limit: number) => mockRecall({ query, limit }),
  searchKnowledgeObservations: vi.fn(async () => []),
  listItems: async (filter?: { memoryType?: MemoryType; limit?: number; offset?: number }) => {
    const offset = filter?.offset ?? 0;
    const limit = filter?.limit ?? 100;
    const items = GOLD_SET.filter((item) =>
      filter?.memoryType ? item.memoryType === filter.memoryType : true,
    );
    return items.slice(offset, offset + limit);
  },
  listEntities: async () => ENTITIES,
  findEntityByName: async (name: string) =>
    ENTITIES.find((e) => e.name.toLowerCase() === name.toLowerCase()) ?? null,
  getEntityItems: async (entityId: string, _limit = 100) => {
    const itemIds = ENTITY_ITEMS[entityId] ?? [];
    return itemIds.map((id) => GOLD_SET.find((i) => i.id === id)!).filter(Boolean);
  },
  getItemEntities: async (itemId: string) => {
    const entityIds = ITEM_ENTITIES[itemId] ?? [];
    return entityIds.map((id) => ENTITIES.find((e) => e.id === id)!).filter(Boolean);
  },
  getItemCategories: async (_itemId: string) => [],
  getStats: async () => mockStore.getStats(),
};

vi.mock("../../memory/memu-store.js", () => ({
  getMemuStore: () => mockStore,
  contentHash: (text: string) => `hash_${text.slice(0, 10)}`,
}));

// Mock quickRecall and deepRecall to return items matching the query
function mockRecall(params: { query: string; memoryTypes?: MemoryType[]; limit?: number }) {
  const limit = params.limit ?? 10;
  let items = [...GOLD_SET];

  // Filter by types if specified
  if (params.memoryTypes) {
    items = items.filter((i) => params.memoryTypes!.includes(i.memoryType));
  }

  // Simple keyword matching for query relevance
  const queryLower = params.query.toLowerCase();
  const scored = items.map((item) => {
    const text = item.summary.toLowerCase();
    const words = queryLower.split(/\s+/);
    const matchCount = words.filter((w) => text.includes(w)).length;
    return {
      item,
      score: matchCount > 0 ? 0.5 + matchCount * 0.1 : 0.1,
      categories: [] as string[],
    };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

vi.mock("../../memory/retrieve/index.js", () => ({
  quickRecall: async (params: any) => mockRecall(params),
  deepRecall: async (params: any) => ({
    results: mockRecall(params),
    sufficient: true,
    reranked: true,
    reinforcedCount: 0,
    queryEmbedding: null,
  }),
}));

vi.mock("../../data/storage-factory.js", () => ({
  getStorageAdapter: async () => ({
    memory: mockMemoryAdapter,
    tasks: {},
    teams: {},
    jobs: {},
  }),
}));

vi.mock("../date-time.js", () => ({
  resolveUserTimezone: () => "America/Chicago",
}));

vi.mock("../../gateway/call.js", () => ({
  callGateway: gatewayCallMock,
}));

import { createMemoryRecallTool } from "./memu-tools.js";

// ── Tests ──

describe("MRQL Gold-Set Regression", () => {
  let tool: NonNullable<ReturnType<typeof createMemoryRecallTool>>;

  beforeEach(() => {
    mockMemoryAdapter.searchKnowledgeObservations.mockReset();
    mockMemoryAdapter.searchKnowledgeObservations.mockResolvedValue([]);
    gatewayCallMock.mockReset();
    gatewayCallMock.mockResolvedValue({
      success: true,
      query: "",
      count: 0,
      totalMatched: 0,
      limit: 0,
      includeShared: false,
      ingestedOnly: true,
      aclEnforced: true,
      results: [],
    });
    const cfg = { agents: { list: [{ id: "main", default: true }] } } as any;
    const result = createMemoryRecallTool({ config: cfg, agentId: "main" });
    expect(result).not.toBeNull();
    tool = result!;
  });

  describe("Mode presets", () => {
    it("returns a structured error instead of throwing when query is missing", async () => {
      const result = await tool.execute("call_missing_query", undefined as never);
      const data = result.details as any;

      expect(data.results).toEqual([]);
      expect(data.error).toContain("query required");
    });

    it("general mode returns default limit 10 with salience scoring", async () => {
      const result = await tool.execute("call_1", { query: "Jason" });
      const data = result.details as any;
      expect(data.mode).toBe("general");
      expect(data.count).toBeLessThanOrEqual(10);
    });

    it("identity mode returns higher limit floor of 25", async () => {
      const result = await tool.execute("call_2", { query: "Jason family pets", mode: "identity" });
      const data = result.details as any;
      expect(data.mode).toBe("identity");
      // Identity mode has limitFloor=25, so count can be up to 25
      // (may be less if gold set + expansion < 25, but should exceed general's 10)
      expect(data.count).toBeGreaterThan(10);
    });

    it("timeline mode auto-filters to event type", async () => {
      const result = await tool.execute("call_3", { query: "recent events", mode: "timeline" });
      const data = result.details as any;
      expect(data.mode).toBe("timeline");
      for (const r of data.results) {
        expect(r.type).toBe("event");
      }
      expect(mockMemoryAdapter.searchKnowledgeObservations).not.toHaveBeenCalled();
    });

    it("preferences mode auto-filters to behavior and profile types", async () => {
      const result = await tool.execute("call_4", { query: "preferences", mode: "preferences" });
      const data = result.details as any;
      expect(data.mode).toBe("preferences");
      for (const r of data.results) {
        expect(["behavior", "profile"]).toContain(r.type);
      }
    });

    it("incident mode enables deep recall and diversity", async () => {
      const result = await tool.execute("call_5", { query: "bug failure", mode: "incident" });
      const data = result.details as any;
      expect(data.mode).toBe("incident");
      // Incident mode has limitFloor=20
      expect(data.count).toBeGreaterThan(0);
    });
  });

  describe("Alias expansion", () => {
    it("resolves mom->Maggie before recall and escalates to identity mode", async () => {
      const result = await tool.execute("call_alias_1", {
        query: "How is my mom doing with dementia safety right now?",
      });
      const data = result.details as any;

      expect(data.mode).toBe("identity");
      expect(data.modeEscalatedFrom).toBe("general");
      expect(data.aliasResolution).toBeDefined();
      expect(data.aliasResolution.matchedAliases).toContain("mom");
      expect(
        data.aliasResolution.resolvedEntities.some(
          (entry: { name: string }) => entry.name === "Maggie",
        ),
      ).toBe(true);
      expect(
        data.results.some((entry: { summary: string }) =>
          String(entry.summary).toLowerCase().includes("maggie"),
        ),
      ).toBe(true);
    });
  });

  describe("Backward compatibility", () => {
    it("omitting mode defaults to general", async () => {
      const result = await tool.execute("call_6", { query: "TypeScript" });
      const data = result.details as any;
      expect(data.mode).toBe("general");
      expect(data.count).toBeLessThanOrEqual(10);
    });

    it("explicit types override mode defaults", async () => {
      const result = await tool.execute("call_7", {
        query: "Jason",
        mode: "timeline",
        types: ["profile", "knowledge"],
      });
      const data = result.details as any;
      for (const r of data.results) {
        expect(["profile", "knowledge"]).toContain(r.type);
      }
    });

    it("explicit deep=false overrides mode deep setting", async () => {
      // Identity mode has deep=true by default, but explicit false should override
      const result = await tool.execute("call_8", {
        query: "Jason",
        mode: "identity",
        deep: false,
      });
      const data = result.details as any;
      expect(data.error).toBeUndefined();
      expect(data.results).toBeDefined();
      expect(data.deep).toBe(false);
    });

    it("deep=true broadens sparse search with token fallback", async () => {
      const originalSearch = mockMemoryAdapter.searchByKeyword;
      const searchMock = vi.fn(async (query: string, limit: number) => {
        if (query === "very specific nohit phrase") return [];
        return mockRecall({ query, limit });
      });
      mockMemoryAdapter.searchByKeyword = searchMock;

      try {
        const result = await tool.execute("call_8b", {
          query: "very specific nohit phrase",
          deep: true,
        });
        const data = result.details as any;
        expect(data.error).toBeUndefined();
        expect(data.deep).toBe(true);
        expect(data.count).toBeGreaterThan(0);
        expect(searchMock).toHaveBeenCalledWith("very specific nohit phrase", expect.any(Number));
        expect(searchMock).toHaveBeenCalledWith("very", expect.any(Number));
      } finally {
        mockMemoryAdapter.searchByKeyword = originalSearch;
      }
    });
  });

  describe("Two-pass retrieval", () => {
    it("identity mode triggers two-pass to fill missing types", async () => {
      const result = await tool.execute("call_9", {
        query: "Jason",
        mode: "identity",
        include_coverage: true,
      });
      const data = result.details as any;
      expect(data.coverage).toBeDefined();
      // Should have more than one type in results due to two-pass
      const typeCount = Object.keys(data.coverage.typesReturned).length;
      expect(typeCount).toBeGreaterThan(1);
    });

    it("min_type_coverage triggers two-pass in general mode", async () => {
      // Use a query that returns mostly one type (knowledge) in pass 1,
      // then min_type_coverage forces expansion into other types
      const result = await tool.execute("call_10", {
        query: "NVIDIA DGX hardware",
        min_type_coverage: 4,
        include_coverage: true,
      });
      const data = result.details as any;
      expect(data.coverage).toBeDefined();
      expect(data.coverage.twoPassUsed).toBe(true);
      expect(data.coverage.twoPassAttempted).toBe(true);
      expect(data.coverage.twoPassReason).toContain("min");
      const typeCount = Object.keys(data.coverage.typesReturned).length;
      // Two-pass should have brought in additional types beyond the initial result set
      expect(typeCount).toBeGreaterThanOrEqual(2);
    });
  });

  describe("Type diversity", () => {
    it("identity mode has multiple types in results (diversity active)", async () => {
      const result = await tool.execute("call_11", {
        query: "Jason",
        mode: "identity",
        include_coverage: true,
      });
      const data = result.details as any;
      const typesReturned = data.coverage.typesReturned as Record<string, number>;
      // Diversity should ensure at least 3 different types are represented
      expect(Object.keys(typesReturned).length).toBeGreaterThanOrEqual(3);
      // No single type should be 100% of results (diversity is doing something)
      const totalCount = data.count;
      for (const count of Object.values(typesReturned)) {
        expect(count).toBeLessThan(totalCount);
      }
    });
  });

  describe("Entity graph expansion", () => {
    it("identity mode expands via entity graph to find Leo", async () => {
      const result = await tool.execute("call_12", {
        query: "Jason family pets",
        mode: "identity",
        include_coverage: true,
      });
      const data = result.details as any;
      const summaries = data.results.map((r: any) => r.summary);
      // Leo's profile memory should be reachable via entity expansion
      expect(summaries.some((s: string) => s.includes("Leo"))).toBe(true);
    });

    it("entity expansion discovers linked entities in coverage", async () => {
      const result = await tool.execute("call_13", {
        query: "Jason family",
        mode: "identity",
        include_coverage: true,
      });
      const data = result.details as any;
      const entities = data.coverage.entitiesMatched as string[];
      // Should find Jason at minimum via entity expansion
      expect(entities.length).toBeGreaterThan(0);
    });
  });

  describe("Coverage metadata", () => {
    it("returns coverage when include_coverage=true", async () => {
      const result = await tool.execute("call_14", {
        query: "Jason",
        include_coverage: true,
      });
      const data = result.details as any;
      expect(data.coverage).toBeDefined();
      expect(data.coverage.typesReturned).toBeDefined();
      expect(data.coverage.typesMissing).toBeDefined();
      expect(data.coverage.entitiesMatched).toBeDefined();
      expect(typeof data.coverage.coverageScore).toBe("number");
      expect(typeof data.coverage.twoPassUsed).toBe("boolean");
      expect(typeof data.coverage.twoPassAttempted).toBe("boolean");
    });

    it("does not return coverage when include_coverage is omitted", async () => {
      const result = await tool.execute("call_15", { query: "Jason" });
      const data = result.details as any;
      expect(data.coverage).toBeUndefined();
    });

    it("coverageScore is between 0 and 1", async () => {
      const result = await tool.execute("call_16", {
        query: "Jason",
        include_coverage: true,
      });
      const data = result.details as any;
      expect(data.coverage.coverageScore).toBeGreaterThanOrEqual(0);
      expect(data.coverage.coverageScore).toBeLessThanOrEqual(1);
    });
  });

  describe("Gold-set recall benchmarks", () => {
    it("identity query retrieves pet records (Leo)", async () => {
      const result = await tool.execute("call_17", {
        query: "Jason's pets dog Leo",
        mode: "identity",
      });
      const data = result.details as any;
      const summaries = data.results.map((r: any) => r.summary);
      expect(summaries.some((s: string) => s.toLowerCase().includes("leo"))).toBe(true);
    });

    it("identity query retrieves relationship records (Richard)", async () => {
      const result = await tool.execute("call_18", {
        query: "Jason's business partner Richard",
        mode: "identity",
      });
      const data = result.details as any;
      const summaries = data.results.map((r: any) => r.summary);
      expect(summaries.some((s: string) => s.toLowerCase().includes("richard"))).toBe(true);
    });

    it("favorite-color query reranks exact slot answer above sibling favorites", async () => {
      const result = await tool.execute("call_18b", {
        query: "What's my favorite color?",
      });
      const data = result.details as any;
      expect(data.queryClass).toBe("identity_property");
      expect(data.mode).toBe("preferences");
      expect(data.modeEscalatedFrom).toBe("general");
      expect(data.results[0]?.summary).toContain("favorite color");
      expect(data.answer?.value).toContain("mossy oak green");
      expect(data.answer?.strategy).toBe("favorite-slot");
      expect(data.recallTelemetry?.queryVariants).toContain("Jason's favorite color");
      expect(data.recallTelemetry?.postRerankTop?.[0]?.summary).toContain("favorite color");
      const topThree = data.results.slice(0, 3).map((r: any) => String(r.summary).toLowerCase());
      expect(topThree[0]).toContain("mossy oak green");
      expect(topThree.some((entry: string) => entry.includes("favorite number"))).toBe(false);
      expect(topThree.some((entry: string) => entry.includes("communication"))).toBe(false);
    });

    it("dog-name query escalates to identity and surfaces direct profile answer", async () => {
      const result = await tool.execute("call_18c", {
        query: "What's my dog's name?",
      });
      const data = result.details as any;
      expect(data.queryClass).toBe("identity_property");
      expect(data.mode).toBe("identity");
      expect(data.modeEscalatedFrom).toBe("general");
      expect(String(data.results[0]?.summary).toLowerCase()).toContain("leo");
      expect(String(data.answer?.value).toLowerCase()).toBe("leo");
      expect(data.answer?.strategy).toBe("dog-name");
    });

    it("favorite-fur-pal query maps to the dog-name path instead of generic favorite noise", async () => {
      const result = await tool.execute("call_18c_fur_pal", {
        query:
          "first time we started talking first conversation beginning of relationship with Jason Brashear exact opening earliest memory pizza toppings Leo favorite fur pal",
        __decomposition_skip: true,
      });
      const data = result.details as any;
      expect(data.queryClass).toBe("identity_property");
      expect(data.mode).toBe("identity");
      expect(String(data.answer?.value).toLowerCase()).toBe("leo");
      expect(data.answer?.strategy).toBe("dog-name");
      expect(data.recallTelemetry?.queryVariants).toContain("Jason dog name");
      expect(
        data.recallTelemetry?.queryVariants.some((entry: string) =>
          entry.includes("favorite fur pal early conversation"),
        ),
      ).toBe(false);
      const topFive = data.results.slice(0, 5).map((r: any) => String(r.summary).toLowerCase());
      expect(topFive.some((entry: string) => entry.includes("no personal information"))).toBe(
        false,
      );
    });

    it("favorite-color query with short-name entity filter resolves canonical profile answer", async () => {
      const result = await tool.execute("call_18d", {
        query: "Jason favorite color",
        mode: "preferences",
        entity: "Jason",
        limit: 8,
        deep: true,
        include_coverage: true,
        min_type_coverage: 2,
      });
      const data = result.details as any;
      expect(data.results[0]?.summary).toContain("favorite color");
      expect(data.entityFilterResolved.entities).toContain("Jason Brashear");
    });

    it("favorite-color query with canonical entity filter still finds short-name memory text", async () => {
      const result = await tool.execute("call_18e", {
        query: "Jason favorite color",
        mode: "preferences",
        entity: "Jason Brashear",
        limit: 8,
        deep: true,
        include_coverage: true,
        min_type_coverage: 2,
      });
      const data = result.details as any;
      expect(data.results[0]?.summary).toContain("favorite color");
      expect(data.entityFilterResolved.matchTerms).toContain("Jason");
    });

    it("mixed favorite-color query trims adjacent clauses before reranking", async () => {
      const result = await tool.execute("call_18e_mixed", {
        query: "oldest memory first time we talked favorite color pizza toppings Jason Brashear",
        __decomposition_skip: true,
      });
      const data = result.details as any;
      expect(data.queryClass).toBe("identity_property");
      expect(data.mode).toBe("preferences");
      expect(String(data.results[0]?.summary).toLowerCase()).toContain("mossy oak green");
      expect(String(data.answer?.value).toLowerCase()).toContain("mossy oak green");
      expect(data.answer?.strategy).toBe("favorite-slot");
      expect(data.recallTelemetry?.queryVariants).toContain("Jason's favorite color");
      expect(data.recallTelemetry?.queryVariants).not.toContain(
        "Jason's favorite color pizza toppings jason brashear",
      );
      const topFive = data.results.slice(0, 5).map((r: any) => String(r.summary).toLowerCase());
      expect(topFive.some((entry: string) => entry.includes("favorite number"))).toBe(false);
      expect(
        topFive.some((entry: string) => entry.includes("pizza topping preferences was found")),
      ).toBe(false);
    });

    it("pizza topping preference query surfaces direct pizza preference memory", async () => {
      const result = await tool.execute("call_18f", {
        query: "What toppings would I put on my pizza?",
      });
      const data = result.details as any;
      expect(data.queryClass).toBe("identity_property");
      expect(data.mode).toBe("preferences");
      expect(String(data.results[0]?.summary).toLowerCase()).toContain("cheese pizza");
      expect(String(data.results[0]?.summary).toLowerCase()).toContain("canadian bacon");
      expect(String(data.answer?.value).toLowerCase()).toContain("canadian bacon");
      expect(data.answer?.strategy).toBe("pizza-preference");
      expect(data.recallTelemetry?.queryVariants).toContain("Jason pizza toppings");
      const topFive = data.results.slice(0, 5).map((r: any) => String(r.summary).toLowerCase());
      expect(topFive.some((entry: string) => entry.includes("no personal information"))).toBe(
        false,
      );
      expect(topFive.some((entry: string) => entry.includes("memo earning his keep"))).toBe(false);
      expect(topFive.some((entry: string) => entry.includes("want me to order"))).toBe(false);
    });

    it("keeps natural multi-fact prompts on the default fast path", async () => {
      const result = await tool.execute("call_18f_fast_path", {
        query: "What's my favorite color and what toppings would I put on my pizza?",
        include_coverage: true,
      });
      const data = result.details as any;
      expect(data.queryClass).not.toBe("multi_fact");
      expect(data.decomposition).toBeUndefined();
      expect(data.coverage?.decompositionUsed).toBeUndefined();
      expect(data.recallTelemetry?.decompositionUsed).not.toBe(true);
    });

    it("still decomposes clearly strict multi-fact recall prompts", async () => {
      const result = await tool.execute("call_18f_strict_phrase", {
        query:
          "What's my favorite color and what toppings would I put on my pizza? Answer separately for each.",
      });
      const data = result.details as any;
      expect(data.queryClass).toBe("multi_fact");
      expect(data.decomposition?.used).toBe(true);
      expect(data.decomposition?.facts).toHaveLength(2);
    });

    it("decomposes multi-fact preference questions into atomic recalls", async () => {
      const result = await tool.execute("call_18f_decomp", {
        query: "What's my favorite color and what toppings would I put on my pizza?",
        decompose: true,
        include_coverage: true,
      });
      const data = result.details as any;
      expect(data.queryClass).toBe("multi_fact");
      expect(data.decomposition?.used).toBe(true);
      expect(data.decomposition?.facts).toHaveLength(2);
      expect(data.decomposition?.facts[0]?.key).toBe("favorite_color");
      expect(data.decomposition?.facts[1]?.key).toBe("pizza_toppings");
      expect(data.decomposition?.facts.every((fact: any) => fact.state === "confirmed")).toBe(true);
      const summaries = data.results.map((r: any) => String(r.summary).toLowerCase());
      expect(summaries.some((entry: string) => entry.includes("mossy oak green"))).toBe(true);
      expect(summaries.some((entry: string) => entry.includes("canadian bacon"))).toBe(true);
      expect(data.coverage?.decompositionUsed).toBe(true);
      expect(data.recallTelemetry?.decompositionUsed).toBe(true);
    });

    it("decomposes mixed chronology and identity questions while preserving weak vs confirmed facts", async () => {
      const result = await tool.execute("call_18f_decomp_mixed", {
        query:
          "Do you remember the first time we started talking, what I would put on my pizza, and who's my favorite fur pal?",
        decompose: true,
      });
      const data = result.details as any;
      expect(data.queryClass).toBe("multi_fact");
      expect(data.decomposition?.used).toBe(true);
      expect(data.decomposition?.facts).toHaveLength(3);
      expect(data.decomposition?.facts.map((fact: any) => fact.key)).toEqual([
        "first_conversation",
        "pizza_toppings",
        "dog_name",
      ]);
      const pizzaFact = data.decomposition?.facts.find(
        (fact: any) => fact.key === "pizza_toppings",
      );
      const dogFact = data.decomposition?.facts.find((fact: any) => fact.key === "dog_name");
      const firstConversationFact = data.decomposition?.facts.find(
        (fact: any) => fact.key === "first_conversation",
      );
      expect(pizzaFact?.state).toBe("confirmed");
      expect(dogFact?.state).toBe("confirmed");
      expect(["weak_recall", "missing"]).toContain(firstConversationFact?.state);
      expect(String(dogFact?.answer?.value).toLowerCase()).toBe("leo");
      expect(String(pizzaFact?.answer?.value).toLowerCase()).toContain("canadian bacon");
    });

    it("timeline-style question routes to timeline class and deep recall", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-03-14T18:00:00Z"));
      try {
        const result = await tool.execute("call_18g", {
          query: "What did we do Tuesday of last week?",
        });
        const data = result.details as any;
        expect(data.queryClass).toBe("timeline_episodic");
        expect(data.mode).toBe("timeline");
        expect(data.deep).toBe(true);
        expect(data.answer?.strategy).toBe("timeline-window");
        expect(String(data.answer?.value)).toContain("Forward Observer");
        expect(data.recallTelemetry?.queryClass).toBe("timeline_episodic");
        expect(data.recallTelemetry?.timelineWindow?.granularity).toBe("day");
        expect(data.recallTelemetry?.timelineWindow?.isoDate).toBe("2026-03-03");
        expect(data.recallTelemetry?.queryVariants).toContain("2026-03-03");
        expect(String(data.results[0]?.summary)).toContain("Forward Observer");
      } finally {
        vi.useRealTimers();
      }
    });

    it("last-week query expands to a week range and summarizes multiple events", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-03-14T18:00:00Z"));
      try {
        const result = await tool.execute("call_18ga", {
          query: "What happened last week?",
        });
        const data = result.details as any;
        expect(data.queryClass).toBe("timeline_episodic");
        expect(data.mode).toBe("timeline");
        expect(data.deep).toBe(true);
        expect(data.answer?.strategy).toBe("timeline-range");
        expect(String(data.answer?.value)).toContain("2026-03-03");
        expect(String(data.answer?.value)).toContain("Forward Observer");
        expect(data.recallTelemetry?.timelineWindow?.granularity).toBe("week");
        expect(data.recallTelemetry?.timelineWindow?.isoDate).toBe("2026-03-02");
        expect(data.recallTelemetry?.timelineWindow?.endIsoDate).toBe("2026-03-08");
        expect(data.recallTelemetry?.queryVariants).toContain("week of 2026-03-02");
        expect(data.recallTelemetry?.queryVariants).toContain(
          "events from 2026-03-02 to 2026-03-08",
        );
        expect(String(data.results[0]?.summary)).toContain("Forward Observer");
      } finally {
        vi.useRealTimers();
      }
    });

    it("entity memories over the past month route to timeline mode with inferred entity filtering", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-02-01T18:00:00Z"));
      try {
        const result = await tool.execute("call_18gaa", {
          query: "Show me memories about Richard from the past month",
          include_coverage: true,
        });
        const data = result.details as any;
        expect(data.queryClass).toBe("timeline_episodic");
        expect(data.mode).toBe("timeline");
        expect(data.deep).toBe(true);
        expect(data.entityFilter).toBe("Richard");
        expect(data.entityFilterInferred).toBe(true);
        expect(data.entityFilterResolved?.entities).toContain("Richard");
        expect(data.recallTelemetry?.timelineWindow?.granularity).toBe("month");
        expect(data.recallTelemetry?.timelineWindow?.isoDate).toBe("2026-01-03");
        expect(data.recallTelemetry?.timelineWindow?.endIsoDate).toBe("2026-02-01");
        expect(data.answer?.strategy).toBe("timeline-range");
        expect(String(data.answer?.value)).toContain("Richard");
        expect(String(data.answer?.value).toLowerCase()).toContain("dashboard");
        const topThree = data.results.slice(0, 3).map((r: any) => String(r.summary));
        expect(topThree.some((summary: string) => summary.includes("Richard"))).toBe(true);
        expect(topThree.some((summary: string) => summary.includes("Leo"))).toBe(false);
        expect(topThree.some((summary: string) => summary.includes("maintenance windows"))).toBe(
          false,
        );
        expect(
          topThree.some((summary: string) => summary.includes("business partner and co-founder")),
        ).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });

    it("conversational remember-about phrasing still routes Richard month recall to timeline mode", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-02-01T18:00:00Z"));
      try {
        const result = await tool.execute("call_18gab", {
          query: "What do you remember about Richard from the last month?",
          include_coverage: true,
        });
        const data = result.details as any;
        expect(data.queryClass).toBe("timeline_episodic");
        expect(data.mode).toBe("timeline");
        expect(data.deep).toBe(true);
        expect(data.entityFilter).toBe("Richard");
        expect(data.entityFilterInferred).toBe(true);
        expect(data.entityFilterResolved?.entities).toContain("Richard");
        expect(data.recallTelemetry?.timelineWindow?.granularity).toBe("month");
        expect(data.answer?.strategy).toBe("timeline-range");
        expect(String(data.answer?.value)).toContain("Richard");
        expect(String(data.answer?.value).toLowerCase()).toContain("dashboard");
        const topThree = data.results.slice(0, 3).map((r: any) => String(r.summary));
        expect(topThree.some((summary: string) => summary.includes("Richard"))).toBe(true);
        expect(topThree.some((summary: string) => summary.includes("Leo"))).toBe(false);
        expect(topThree.some((summary: string) => summary.includes("maintenance windows"))).toBe(
          false,
        );
        expect(
          topThree.some((summary: string) => summary.includes("business partner and co-founder")),
        ).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });

    it("accomplishment recap query routes to timeline and avoids operational noise", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-03-14T18:00:00Z"));
      try {
        const result = await tool.execute("call_18gb", {
          query: "Can you summarize what all we got accomplished last week?",
        });
        const data = result.details as any;
        expect(data.queryClass).toBe("timeline_episodic");
        expect(data.mode).toBe("timeline");
        expect(data.deep).toBe(true);
        expect(data.answer?.strategy).toBe("timeline-range");
        expect(String(data.answer?.value)).toContain("Forward Observer");
        expect(data.recallTelemetry?.queryVariants).toContain("last week accomplishments");
        const topThree = data.results.slice(0, 3).map((r: any) => String(r.summary).toLowerCase());
        expect(topThree.some((summary: string) => summary.includes("cron"))).toBe(false);
        expect(topThree.some((summary: string) => summary.includes("status"))).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });

    it("recent project query routes to decision_project and extracts the canonical project title", async () => {
      const result = await tool.execute("call_18h", {
        query:
          "What's the most recent project that we've been working on together? It's a new development project.",
        include_coverage: true,
      });
      const data = result.details as any;
      expect(data.queryClass).toBe("decision_project");
      expect(data.mode).toBe("incident");
      expect(data.deep).toBe(true);
      expect(data.answer?.strategy).toBe("recent-project");
      expect(data.answer?.value).toBe("Forward Observer Area Intelligence Platform");
      expect(data.recallTelemetry?.queryVariants).toContain("PRP Planning Draft");
      expect(data.recallTelemetry?.queryVariants).toContain("V1 PRD Draft");
      const topThree = data.results.slice(0, 3).map((r: any) => String(r.summary));
      expect(topThree.some((summary: string) => summary.includes("Revision Packet"))).toBe(false);
      expect(
        topThree.some((summary: string) =>
          summary.includes("currently working on several projects"),
        ),
      ).toBe(false);
    });

    it("project recap query classifies as decision_project and prunes stale active-project noise", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-03-14T18:00:00Z"));
      try {
        const result = await tool.execute("call_18ha", {
          query: "What projects did we start building last week and are working on?",
          include_coverage: true,
        });
        const data = result.details as any;
        expect(data.queryClass).toBe("decision_project");
        expect(data.mode).toBe("incident");
        expect(data.deep).toBe(true);
        expect(data.recallTelemetry?.timelineWindow?.granularity).toBe("week");
        expect(data.recallTelemetry?.queryVariants).toContain("projects started last week");
        const topFive = data.results.slice(0, 5).map((r: any) => String(r.summary).toLowerCase());
        expect(topFive.some((summary: string) => summary.includes("atera"))).toBe(false);
        expect(topFive.some((summary: string) => summary.includes("cron job"))).toBe(false);
        expect(topFive.some((summary: string) => summary.includes("mao"))).toBe(false);
        expect(topFive.some((summary: string) => summary.includes("forward observer"))).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });

    it("website/domain project query routes to decision_project and surfaces website build memory instead of cron noise", async () => {
      const result = await tool.execute("call_18hb", {
        query:
          "simple website woman CV resume portfolio collecting data domain Namecheap Cloudflare Coolify",
        mode: "timeline",
        include_coverage: true,
        limit: 10,
        deep: true,
      });
      const data = result.details as any;
      expect(data.queryClass).toBe("decision_project");
      expect(data.mode).toBe("timeline");
      expect(data.deep).toBe(true);
      expect(data.recallTelemetry?.queryVariants).toContain("resume portfolio website");
      expect(data.recallTelemetry?.queryVariants).toContain("domain Namecheap Cloudflare Coolify");
      expect(data.recallTelemetry?.manualProjectCandidates).toBeGreaterThan(0);
      const topFive = data.results.slice(0, 5).map((r: any) => String(r.summary).toLowerCase());
      expect(topFive.some((summary: string) => summary.includes("atera"))).toBe(false);
      expect(topFive.some((summary: string) => summary.includes("cron"))).toBe(false);
      expect(
        topFive.some((summary: string) => summary.includes("client resume portfolio website")),
      ).toBe(true);
    });

    it("falls back to knowledge search when project recall is weak but doc-backed knowledge exists", async () => {
      const originalSearch = mockMemoryAdapter.searchByKeyword;
      mockMemoryAdapter.searchByKeyword = vi.fn(async (query: string, limit: number) => {
        if (/namecheap|cloudflare|coolify|portfolio|resume|website|client|woman/i.test(query)) {
          return mockRecall({ query: "Atera Integration cron status", limit }).filter((result) =>
            ["e7", "e8", "e9", "p13", "p14"].includes(result.item.id),
          );
        }
        return [];
      });
      gatewayCallMock.mockImplementation(async (params: { params?: { query?: string } }) => {
        if (
          /namecheap|cloudflare|coolify|portfolio|resume|website|client|woman/i.test(
            String(params.params?.query ?? ""),
          )
        ) {
          return {
            success: true,
            query: String(params.params?.query ?? ""),
            count: 3,
            totalMatched: 3,
            limit: 8,
            includeShared: false,
            ingestedOnly: true,
            aclEnforced: true,
            results: [
              {
                id: "kw_site2",
                score: 2.4,
                summary: "Project: Desiree Honeypot — OSINT Portfolio Site",
                type: "knowledge",
                citation: "desiree-honeypot.md#chunk-1",
                collection: "docpane",
                sourceFile: "desiree-honeypot.md",
                chunkIndex: 1,
                chunkTotal: 4,
                createdAt: "2026-03-04T16:25:59Z",
              },
              {
                id: "kw_site3",
                score: 2.2,
                summary:
                  "Desiree Honeypot project website uses Namecheap for domain registration, Cloudflare for DNS, and Coolify for deployment.",
                type: "knowledge",
                citation: "desiree-honeypot.md#chunk-2",
                collection: "projects",
                sourceFile: "desiree-honeypot.md",
                chunkIndex: 2,
                chunkTotal: 4,
                createdAt: "2026-03-04T16:30:16Z",
              },
              {
                id: "kw_site4",
                score: 2.1,
                summary:
                  "Desiree Denning portfolio site was planned as a fake but convincing resume website OSINT honeypot for evidence collection.",
                type: "knowledge",
                citation: "desiree-honeypot.md#chunk-3",
                collection: "desiree-honeypot",
                sourceFile: "desiree-honeypot.md",
                chunkIndex: 3,
                chunkTotal: 4,
                createdAt: "2026-03-04T16:39:36Z",
              },
            ],
          };
        }
        return {
          success: true,
          query: String(params.params?.query ?? ""),
          count: 0,
          totalMatched: 0,
          limit: 8,
          includeShared: false,
          ingestedOnly: true,
          aclEnforced: true,
          results: [],
        };
      });

      try {
        const result = await tool.execute("call_18hbb", {
          query:
            "simple website woman CV resume portfolio collecting data domain Namecheap Cloudflare Coolify",
          mode: "timeline",
          include_coverage: true,
          limit: 10,
          deep: true,
        });
        const data = result.details as any;
        expect(data.queryClass).toBe("decision_project");
        expect(data.knowledgeFallback?.used).toBe(true);
        expect(data.knowledgeFallback?.count).toBeGreaterThan(0);
        expect(data.recallTelemetry?.knowledgeFallbackUsed).toBe(true);
        expect(data.recallTelemetry?.knowledgeFallbackCount).toBeGreaterThan(0);
        expect(String(data.answer?.value ?? "").toLowerCase()).toContain("desiree honeypot");
        const topFive = data.results.slice(0, 5).map((r: any) => String(r.summary).toLowerCase());
        expect(topFive.some((summary: string) => summary.includes("atera"))).toBe(false);
        const allSummaries = data.results.map((r: any) => String(r.summary).toLowerCase());
        expect(allSummaries.some((summary: string) => summary.includes("desiree honeypot"))).toBe(
          true,
        );
      } finally {
        mockMemoryAdapter.searchByKeyword = originalSearch;
      }
    });

    it("bare project title query escalates out of identity and surfaces doc-backed project memory", async () => {
      const result = await tool.execute("call_18hc", {
        query: "Desiree Honeypot",
        mode: "identity",
        include_coverage: true,
        limit: 10,
        deep: true,
      });
      const data = result.details as any;
      expect(data.queryClass).toBe("decision_project");
      expect(data.mode).toBe("incident");
      expect(
        (data.recallTelemetry?.queryVariants ?? []).some((entry: string) =>
          entry.includes("project"),
        ),
      ).toBe(true);
      expect(data.recallTelemetry?.manualProjectCandidates).toBeGreaterThan(0);
      expect(String(data.answer?.value ?? "").toLowerCase()).toContain("desiree honeypot");
      const topFive = data.results.slice(0, 5).map((r: any) => String(r.summary).toLowerCase());
      expect(topFive.some((summary: string) => summary.includes("desiree honeypot"))).toBe(true);
      expect(topFive.some((summary: string) => summary.includes("atera"))).toBe(false);
    });

    it("general query for TypeScript returns relevant knowledge", async () => {
      const result = await tool.execute("call_19", { query: "TypeScript language" });
      const data = result.details as any;
      const summaries = data.results.map((r: any) => r.summary);
      expect(summaries.some((s: string) => s.toLowerCase().includes("typescript"))).toBe(true);
    });

    it("identity query returns multiple types, not just knowledge", async () => {
      const result = await tool.execute("call_20", {
        query: "Jason Brashear",
        mode: "identity",
        include_coverage: true,
      });
      const data = result.details as any;
      const typeCount = Object.keys(data.coverage.typesReturned).length;
      // Should have at least 3 types (knowledge, profile, behavior at minimum)
      expect(typeCount).toBeGreaterThanOrEqual(3);
    });
  });

  describe("Priority 1 — Coverage-based auto-trigger", () => {
    it("identity mode auto-triggers two-pass when coverage < 0.75", async () => {
      // Identity has coverageFloor=0.75. With a narrow query that returns
      // mostly one type, coverage will be low and should trigger expansion.
      const result = await tool.execute("call_21", {
        query: "NVIDIA DGX Spark hardware",
        mode: "identity",
        include_coverage: true,
      });
      const data = result.details as any;
      expect(data.coverage).toBeDefined();
      // Should have expanded beyond just knowledge type
      expect(data.coverage.twoPassUsed).toBe(true);
    });

    it("general mode does NOT auto-trigger two-pass (no coverageFloor)", async () => {
      const result = await tool.execute("call_22", {
        query: "NVIDIA DGX Spark hardware",
        include_coverage: true,
      });
      const data = result.details as any;
      expect(data.coverage).toBeDefined();
      expect(data.coverage.twoPassUsed).toBe(false);
    });
  });

  describe("Priority 2 — Mode hardening", () => {
    it("timeline strict mode returns ONLY event type (no bleed)", async () => {
      // Timeline with strictTypes=true should hard-filter to events only
      const result = await tool.execute("call_23", {
        query: "Jason deployment bug",
        mode: "timeline",
      });
      const data = result.details as any;
      // Every result must be event type — no knowledge/profile bleed
      for (const r of data.results) {
        expect(r.type).toBe("event");
      }
    });

    it("preferences strict mode returns ONLY behavior and profile (no bleed)", async () => {
      const result = await tool.execute("call_24", {
        query: "Jason values communication style",
        mode: "preferences",
      });
      const data = result.details as any;
      for (const r of data.results) {
        expect(["behavior", "profile"]).toContain(r.type);
      }
    });

    it("identity mode type priority boosts profile over knowledge", async () => {
      // Identity typePriority: profile=1.5, knowledge=0.8
      // Given equal base scores, profile items should rank higher
      const result = await tool.execute("call_25", {
        query: "Jason",
        mode: "identity",
        include_coverage: true,
      });
      const data = result.details as any;
      // Find first profile and first knowledge result positions
      const results = data.results as Array<{ type: string; score: number }>;
      const firstProfile = results.findIndex((r) => r.type === "profile");
      const firstKnowledge = results.findIndex((r) => r.type === "knowledge");
      // Profile should appear before or at same position as knowledge
      // (both exist in our gold set for "Jason" queries)
      if (firstProfile !== -1 && firstKnowledge !== -1) {
        expect(firstProfile).toBeLessThanOrEqual(firstKnowledge);
      }
    });

    it("incident mode type priority boosts event type", async () => {
      // Incident typePriority: event=1.5, knowledge=1.2
      const result = await tool.execute("call_26", {
        query: "deployment bug failure",
        mode: "incident",
        include_coverage: true,
      });
      const data = result.details as any;
      // Events should be present and boosted toward the top
      const types = (data.results as Array<{ type: string }>).map((r) => r.type);
      expect(types).toContain("event");
    });
  });

  it("surfaces observation fallback for identity/property recall when enabled", async () => {
    mockMemoryAdapter.searchKnowledgeObservations.mockResolvedValue([
      {
        observation: {
          id: "obs-1",
          summary: "Jason prefers Discord for quick project updates",
          confidence: 0.88,
          freshness: 0.91,
          canonicalKey: "entity:jason:operator_preference:delivery_preference",
          status: "active",
        },
        topEvidence: [
          {
            stance: "support",
            excerpt: "Jason prefers Discord for quick project updates",
            itemId: "k10",
            lessonId: null,
            reflectionId: null,
            entityId: null,
          },
        ],
      },
    ]);

    const cfg = {
      agents: { list: [{ id: "main", default: true }] },
      memory: {
        observations: {
          enabled: true,
          retrieval: { enabled: true },
        },
      },
    } as any;
    const result = createMemoryRecallTool({ config: cfg, agentId: "main" });
    expect(result).not.toBeNull();

    const call = await result!.execute("call_obs_1", {
      query: "What do I like for quick project updates?",
    });
    const data = call.details as any;

    expect(data.observationFallback?.used).toBe(true);
    expect(data.currentBeliefs).toHaveLength(1);
    expect(data.currentBeliefs[0]?.summary).toContain("prefers Discord");
    expect(data.recallTelemetry?.knowledgeObservationCount).toBe(1);
  });
});
