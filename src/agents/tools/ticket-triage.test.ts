import { describe, it, expect } from "vitest";
import {
  triageTicket,
  triageBatch,
  type TicketInput,
  type TicketCategory,
  type SupportTier,
  type UrgencyLevel,
} from "./ticket-triage.js";

// ────────────────────────────────────────────────────────────────
// Real Atera ticket data (anonymized from live system)
// ────────────────────────────────────────────────────────────────

const REAL_TICKETS: {
  id: string;
  input: TicketInput;
  expected: { category: TicketCategory; minUrgency: UrgencyLevel; tier: SupportTier };
}[] = [
  {
    id: "57223",
    input: {
      title: "CCSERVER Offline - Cromwell (CCI) - 17+ hours",
      description:
        "Server Alert: CCSERVER offline for 17+ hours. Device has been non-responsive since approximately March 4th, 2026 around 11 PM CST. This is a critical infrastructure issue affecting Cromwell's operations.",
      priority: "Medium",
      type: "Incident",
      source: "Api",
      customerName: "Cromwell (CCI)",
      isAlertGenerated: true,
      ageHours: 17,
    },
    expected: { category: "server_offline", minUrgency: "critical", tier: "tier3" },
  },
  {
    id: "57190",
    input: {
      title: "Disk Usage alert - CHERYL-PC2025 (McGirr Law)",
      description:
        "Critical Disk Usage alert on C: drive for CHERYL-PC2025. Alert #115662 created at 3/5/2026, 11:35:38 AM shows critical disk usage. Device is online but drive is at capacity.",
      priority: "Medium",
      type: "Incident",
      source: "Api",
      customerName: "McGirr Law",
      isAlertGenerated: true,
    },
    expected: { category: "disk_alert", minUrgency: "medium", tier: "tier1" },
  },
  {
    id: "57217",
    input: {
      title: "New ethernet drops",
      description:
        "Good afternoon, We are remodeling and will be shifting our surgery and x-ray area back into the room that used to be our dog kennel. The contractor is finishing up over the next few days- we will need new ethernet drops.",
      priority: "Low",
      type: "Incident",
      source: "Email",
      customerName: "Burnet Road Animal Hospital",
    },
    expected: { category: "network_connectivity", minUrgency: "low", tier: "tier2" },
  },
  {
    id: "57215",
    input: {
      title: "IP Address Change",
      description:
        "Hi there, Thanks again for coming by again today! I wanted to check in, was there any changes of our IP during all this IT closet poking around? We have a website, Cornerstone, we use to submit documents.",
      priority: "Low",
      type: "Incident",
      source: "Email",
      customerName: "Park Place",
    },
    expected: { category: "dns_domain", minUrgency: "low", tier: "tier2" },
  },
  {
    id: "57211",
    input: {
      title: "Re: Email Forwarding Request – Alexandria Milstead to Jeff Dierking",
      description:
        "Lexi@resibrands.com should also be forwarded to Jeff@pinkswindows.com - please confirm when done.",
      priority: "Low",
      type: "Incident",
      source: "Email",
      customerName: "ResiBrands",
    },
    expected: { category: "email_issue", minUrgency: "low", tier: "tier1" },
  },
  {
    id: "57204-tl",
    input: {
      title: "Control Panel USA - ThreatLocker Application Request for CPU104",
      description:
        "https://portal.d.threatlocker.com/approval-center?ar=cc3d9961 You can view more details, approve or deny the request from the ThreatLocker Portal.",
      priority: "Low",
      type: "Incident",
      source: "Email",
      customerName: "Threatlocker Requests",
    },
    expected: { category: "threatlocker_request", minUrgency: "informational", tier: "tier1" },
  },
  {
    id: "57194",
    input: {
      title: "Fw: David's signed evaluation",
      description:
        "Hey Team, This is the third email that I've received from Greg that arrived extremely late. The email below was sent from Greg's work device on February 12th at 2:53pm and I just received it on March 5th.",
      priority: "Low",
      type: "Incident",
      source: "Email",
      customerName: "BriefCase LLC",
    },
    expected: { category: "email_issue", minUrgency: "low", tier: "tier1" },
  },
  {
    id: "57148",
    input: {
      title: "New Employee and New Intern",
      description:
        "We have a new employee starting Monday and a new intern. Please set up accounts.",
      priority: "Low",
      type: "Incident",
      source: "Email",
      customerName: "A New Entry",
    },
    expected: { category: "new_employee_setup", minUrgency: "low", tier: "tier1" },
  },
  {
    id: "57179",
    input: {
      title: "Texa/7eagle - add two extensions per Jordie",
      description:
        "MARY CARLSON Carlson@7Eagle.com No current phone 100 extension CHAD WALTERS Chad@7Eagle.com 618-670-1554 200 extension",
      priority: "Low",
      type: "Change",
      source: "Phone",
      customerName: "Titanium Computing(Internal)",
    },
    expected: { category: "voip_telephony", minUrgency: "low", tier: "tier1" },
  },
  {
    id: "57218",
    input: {
      title: "DFox Article Review: 10 Common Examples of Negligence",
      description: "",
      priority: "Low",
      type: "7",
      source: "Phone",
      customerName: "Titanium Computing(Internal)",
    },
    expected: { category: "internal_task", minUrgency: "informational", tier: "tier1" },
  },
  {
    id: "57212",
    input: {
      title: "Coro/TL meeting with Skylar",
      description: "",
      priority: "Low",
      type: "7",
      source: "Phone",
      customerName: "Titanium Computing(Internal)",
    },
    expected: { category: "vendor_coordination", minUrgency: "informational", tier: "tier1" },
  },
  {
    id: "57178",
    input: {
      title: "Corridor - Setup and deploy BSN training",
      description: "",
      priority: "Low",
      type: "7",
      source: "Phone",
      customerName: "Titanium Computing(Internal)",
    },
    expected: { category: "vendor_coordination", minUrgency: "informational", tier: "tier1" },
  },
  {
    id: "57206",
    input: {
      title: "Make TValue5 PrintBoss",
      description: "",
      priority: "Low",
      type: "Incident",
      source: "Phone",
      customerName: "Titanium Computing(Internal)",
    },
    expected: { category: "printing", minUrgency: "informational", tier: "tier1" },
  },
];

// Urgency level ordering for comparison
const URGENCY_ORDER: Record<UrgencyLevel, number> = {
  informational: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

// ── Category Classification ──────────────────────────────────

describe("Category Classification", () => {
  for (const ticket of REAL_TICKETS) {
    it(`classifies #${ticket.id}: "${ticket.input.title}" as ${ticket.expected.category}`, () => {
      const result = triageTicket(ticket.input);
      expect(result.category).toBe(ticket.expected.category);
    });
  }

  it("achieves ≥90% accuracy on real ticket set", () => {
    let correct = 0;
    for (const ticket of REAL_TICKETS) {
      const result = triageTicket(ticket.input);
      if (result.category === ticket.expected.category) correct++;
    }
    const accuracy = correct / REAL_TICKETS.length;
    expect(accuracy).toBeGreaterThanOrEqual(0.9);
  });

  it("classifies unknown tickets as general_support", () => {
    const result = triageTicket({ title: "Random thing happened today" });
    expect(result.category).toBe("general_support");
    expect(result.confidence).toBeLessThanOrEqual(0.6);
  });
});

// ── Urgency Scoring ──────────────────────────────────────────

describe("Urgency Scoring", () => {
  it("scores server offline 17+ hours as critical", () => {
    const result = triageTicket(REAL_TICKETS[0]!.input);
    expect(result.urgencyScore).toBeGreaterThanOrEqual(80);
    expect(result.urgencyLevel).toBe("critical");
  });

  it("scores disk alert as medium or higher urgency", () => {
    const result = triageTicket(REAL_TICKETS[1]!.input);
    expect(result.urgencyScore).toBeGreaterThanOrEqual(40);
    // Disk at capacity + alert-generated signals push this to high
    expect(URGENCY_ORDER[result.urgencyLevel]).toBeGreaterThanOrEqual(URGENCY_ORDER["medium"]);
  });

  it("scores ThreatLocker requests as low/informational", () => {
    const result = triageTicket(REAL_TICKETS[5]!.input);
    expect(result.urgencyScore).toBeLessThanOrEqual(25);
  });

  it("boosts urgency for repeated issues", () => {
    const result = triageTicket(REAL_TICKETS[6]!.input); // "third email received late"
    const signals = result.urgencySignals.map((s) => s.name);
    expect(signals).toContain("repeated_issue");
  });

  it("boosts urgency for alert-generated tickets", () => {
    const result = triageTicket(REAL_TICKETS[0]!.input); // server offline from Api
    const signals = result.urgencySignals.map((s) => s.name);
    expect(signals).toContain("alert_generated");
  });

  it("detects extended downtime signal from description", () => {
    const result = triageTicket(REAL_TICKETS[0]!.input); // 17+ hours
    const signals = result.urgencySignals.map((s) => s.name);
    expect(signals).toContain("extended_downtime");
  });

  for (const ticket of REAL_TICKETS) {
    it(`#${ticket.id} urgency ≥ ${ticket.expected.minUrgency}`, () => {
      const result = triageTicket(ticket.input);
      expect(URGENCY_ORDER[result.urgencyLevel]).toBeGreaterThanOrEqual(
        URGENCY_ORDER[ticket.expected.minUrgency],
      );
    });
  }
});

// ── Tier Routing ─────────────────────────────────────────────

describe("Tier Routing", () => {
  it("routes server down + extended downtime to T3", () => {
    const result = triageTicket(REAL_TICKETS[0]!.input);
    expect(result.tier).toBe("tier3");
  });

  it("routes simple email forwarding to T1", () => {
    const result = triageTicket(REAL_TICKETS[4]!.input);
    expect(result.tier).toBe("tier1");
  });

  it("routes ThreatLocker to T1", () => {
    const result = triageTicket(REAL_TICKETS[5]!.input);
    expect(result.tier).toBe("tier1");
  });

  it("routes ethernet/network to T2", () => {
    const result = triageTicket(REAL_TICKETS[2]!.input);
    expect(result.tier).toBe("tier2");
  });

  it("routes security threats to T3", () => {
    const result = triageTicket({
      title: "Ransomware detected on ACCOUNTING-PC",
      description:
        "Malware alert triggered. Files may be encrypted. Unauthorized access suspected.",
      priority: "High",
      source: "Api",
      isAlertGenerated: true,
    });
    expect(result.tier).toBe("tier3");
    expect(result.urgencyLevel).toBe("critical");
  });

  for (const ticket of REAL_TICKETS) {
    it(`#${ticket.id} routes to ${ticket.expected.tier}`, () => {
      const result = triageTicket(ticket.input);
      expect(result.tier).toBe(ticket.expected.tier);
    });
  }
});

// ── Confidence & Reasoning ───────────────────────────────────

describe("Confidence & Reasoning", () => {
  it("provides high confidence for clear matches", () => {
    const result = triageTicket(REAL_TICKETS[0]!.input); // server offline
    expect(result.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it("provides reasoning string", () => {
    const result = triageTicket(REAL_TICKETS[0]!.input);
    expect(result.reasoning).toBeTruthy();
    expect(result.reasoning).toContain("Category:");
    expect(result.reasoning).toContain("server_offline");
  });

  it("includes urgency signal breakdown in reasoning", () => {
    const result = triageTicket(REAL_TICKETS[0]!.input);
    expect(result.reasoning).toContain("Urgency signals:");
  });

  it("ThreatLocker has highest confidence (pattern-specific)", () => {
    const result = triageTicket(REAL_TICKETS[5]!.input);
    expect(result.confidence).toBeGreaterThanOrEqual(0.95);
  });
});

// ── Auto-Resolve Detection ───────────────────────────────────

describe("Auto-Resolve Detection", () => {
  it("marks ThreatLocker as auto-resolvable", () => {
    const result = triageTicket(REAL_TICKETS[5]!.input);
    expect(result.autoResolvable).toBe(true);
    expect(result.autoAction).toBeTruthy();
  });

  it("marks server offline as NOT auto-resolvable", () => {
    const result = triageTicket(REAL_TICKETS[0]!.input);
    expect(result.autoResolvable).toBe(false);
  });
});

// ── SLA Suggestion ───────────────────────────────────────────

describe("SLA Suggestion", () => {
  it("suggests 15 min SLA for critical tickets", () => {
    const result = triageTicket(REAL_TICKETS[0]!.input);
    expect(result.suggestedSlaMinutes).toBe(15);
  });

  it("suggests longer SLA for low priority", () => {
    const result = triageTicket(REAL_TICKETS[5]!.input); // ThreatLocker
    expect(result.suggestedSlaMinutes).toBeGreaterThanOrEqual(480);
  });
});

// ── Batch Triage ─────────────────────────────────────────────

describe("Batch Triage", () => {
  it("triages all tickets and returns prioritized order", () => {
    const ticketMap = new Map<string, TicketInput>();
    for (const t of REAL_TICKETS) {
      ticketMap.set(t.id, t.input);
    }

    const batch = triageBatch(ticketMap);
    expect(batch.results.size).toBe(REAL_TICKETS.length);
    expect(batch.prioritizedOrder.length).toBe(REAL_TICKETS.length);

    // First item should be highest urgency (server offline)
    expect(batch.prioritizedOrder[0]!.category).toBe("server_offline");

    // Summary should have correct total
    expect(batch.summary.total).toBe(REAL_TICKETS.length);
    expect(batch.summary.autoResolvableCount).toBeGreaterThanOrEqual(1);
  });

  it("prioritized order is sorted by urgency descending", () => {
    const ticketMap = new Map<string, TicketInput>();
    for (const t of REAL_TICKETS) {
      ticketMap.set(t.id, t.input);
    }

    const batch = triageBatch(ticketMap);
    for (let i = 1; i < batch.prioritizedOrder.length; i++) {
      expect(batch.prioritizedOrder[i - 1]!.urgencyScore).toBeGreaterThanOrEqual(
        batch.prioritizedOrder[i]!.urgencyScore,
      );
    }
  });

  it("summary tier counts sum to total", () => {
    const ticketMap = new Map<string, TicketInput>();
    for (const t of REAL_TICKETS) {
      ticketMap.set(t.id, t.input);
    }

    const batch = triageBatch(ticketMap);
    const tierSum =
      batch.summary.byTier.tier1 + batch.summary.byTier.tier2 + batch.summary.byTier.tier3;
    expect(tierSum).toBe(batch.summary.total);
  });
});

// ── Edge Cases ───────────────────────────────────────────────

describe("Edge Cases", () => {
  it("handles empty description", () => {
    const result = triageTicket({ title: "Server offline" });
    expect(result.category).toBe("server_offline");
  });

  it("handles empty title gracefully", () => {
    const result = triageTicket({ title: "" });
    expect(result.category).toBe("general_support");
  });

  it("handles very long descriptions without crashing", () => {
    const result = triageTicket({
      title: "Help needed",
      description: "a ".repeat(10000),
    });
    expect(result).toBeDefined();
    expect(result.category).toBe("general_support");
  });

  it("handles special characters in title", () => {
    const result = triageTicket({
      title: "Re: [#56275] Re: [#56268] Re: [#56263] Email Forwarding Request",
    });
    expect(result.category).toBe("email_issue");
  });

  it("handles combined signals (security + data loss)", () => {
    const result = triageTicket({
      title: "Ransomware attack - data encrypted",
      description:
        "All files encrypted. Cannot recover. Unauthorized access confirmed. Malware spreading.",
      priority: "High",
      isAlertGenerated: true,
    });
    expect(result.urgencyScore).toBeGreaterThanOrEqual(90);
    expect(result.tier).toBe("tier3");
    const signalNames = result.urgencySignals.map((s) => s.name);
    expect(signalNames).toContain("security_threat");
    expect(signalNames).toContain("data_loss_risk");
  });
});
