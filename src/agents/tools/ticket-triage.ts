/**
 * Ticket Triage System — NLP-based ticket classification, urgency scoring,
 * and Tier 1/2/3 routing logic for MSP tickets.
 *
 * Provides:
 * - Category classification (pattern-matched + keyword NLP)
 * - Urgency scoring (0-100) based on multiple weighted signals
 * - Tier routing (T1 help desk, T2 systems, T3 engineering/escalation)
 * - Confidence scoring with explanation
 * - Batch triage for queue prioritization
 *
 * Design: deterministic rule engine + weighted keyword NLP.
 * No external ML model dependency — runs fully offline at sub-ms latency.
 * Accuracy target: 90%+ on real Atera ticket data.
 */

// ────────────────────────────────────────────────────────────────
// Category Taxonomy
// ────────────────────────────────────────────────────────────────

/**
 * Top-level ticket categories derived from real MSP ticket patterns.
 */
export type TicketCategory =
  | "server_offline"
  | "disk_alert"
  | "email_issue"
  | "network_connectivity"
  | "security_alert"
  | "threatlocker_request"
  | "user_access"
  | "new_employee_setup"
  | "hardware_request"
  | "software_install"
  | "voip_telephony"
  | "backup_recovery"
  | "dns_domain"
  | "printing"
  | "performance"
  | "vendor_coordination"
  | "internal_task"
  | "general_support";

/**
 * Support tier for routing.
 */
export type SupportTier = "tier1" | "tier2" | "tier3";

/**
 * Urgency level derived from score.
 */
export type UrgencyLevel = "critical" | "high" | "medium" | "low" | "informational";

// ────────────────────────────────────────────────────────────────
// Triage Result Types
// ────────────────────────────────────────────────────────────────

export interface TriageResult {
  /** Primary category classification. */
  category: TicketCategory;
  /** Secondary/related categories (max 2). */
  relatedCategories: TicketCategory[];
  /** Urgency score 0-100. */
  urgencyScore: number;
  /** Human-readable urgency level. */
  urgencyLevel: UrgencyLevel;
  /** Recommended support tier. */
  tier: SupportTier;
  /** Confidence in classification (0-1). */
  confidence: number;
  /** Explanation of why this classification was chosen. */
  reasoning: string;
  /** Signals that contributed to the urgency score. */
  urgencySignals: UrgencySignal[];
  /** Suggested SLA response time in minutes. */
  suggestedSlaMinutes: number;
  /** Whether this ticket can likely be auto-resolved or auto-routed. */
  autoResolvable: boolean;
  /** Suggested auto-action if applicable. */
  autoAction?: string;
}

export interface UrgencySignal {
  /** Signal name. */
  name: string;
  /** Points added to urgency score. */
  points: number;
  /** Why this signal fired. */
  reason: string;
}

export interface TicketInput {
  /** Ticket title/subject line. */
  title: string;
  /** Ticket description/body text. */
  description?: string;
  /** Atera ticket priority (if set). */
  priority?: string;
  /** Ticket type from Atera. */
  type?: string;
  /** Source: Email, Phone, Api, Portal. */
  source?: string;
  /** Customer name. */
  customerName?: string;
  /** Whether an alert triggered this ticket. */
  isAlertGenerated?: boolean;
  /** Hours since ticket was created. */
  ageHours?: number;
  /** Whether the customer has replied. */
  hasCustomerReply?: boolean;
  /** Number of devices affected (if known). */
  devicesAffected?: number;
}

// ────────────────────────────────────────────────────────────────
// Classification Rules Engine
// ────────────────────────────────────────────────────────────────

interface ClassificationRule {
  category: TicketCategory;
  /** Patterns matched against title (case-insensitive). */
  titlePatterns: RegExp[];
  /** Patterns matched against description (case-insensitive). */
  descriptionPatterns?: RegExp[];
  /** Keywords that boost confidence when found. */
  boostKeywords?: string[];
  /** Base confidence when title pattern matches. */
  baseConfidence: number;
  /** Default tier if no override signals. */
  defaultTier: SupportTier;
  /** Base urgency points from category alone. */
  baseUrgency: number;
  /** Whether this category is typically auto-resolvable. */
  typicallyAutoResolvable: boolean;
  /** Auto-action suggestion. */
  autoAction?: string;
}

const CLASSIFICATION_RULES: ClassificationRule[] = [
  // ── Critical Infrastructure ──────────────────────────────
  {
    category: "server_offline",
    titlePatterns: [
      /server\s*(is\s*)?offline/i,
      /server\s*(is\s*)?down/i,
      /\boffline\b.*\bserver\b/i,
      /\bserver\b.*\bunresponsive\b/i,
      /\bserver\b.*\bcrash/i,
      /\bdc\d*\s*(is\s*)?offline/i,
      /\bhost\b.*\boffline\b/i,
    ],
    descriptionPatterns: [
      /offline\s*(for|since)\s*\d+/i,
      /non-responsive/i,
      /critical\s*infrastructure/i,
    ],
    boostKeywords: ["offline", "down", "unresponsive", "crash", "critical", "production", "hours"],
    baseConfidence: 0.95,
    defaultTier: "tier2",
    baseUrgency: 70,
    typicallyAutoResolvable: false,
  },
  {
    category: "disk_alert",
    titlePatterns: [
      /disk\s*(usage|space|full|alert|critical)/i,
      /drive\s*(full|space|alert|critical)/i,
      /storage\s*(full|alert|critical|low)/i,
      /low\s*disk/i,
      /\bc:\s*drive\b.*\b(full|alert|critical)/i,
    ],
    descriptionPatterns: [/disk\s*usage/i, /at\s*capacity/i, /drive\s*(is\s*)?full/i],
    boostKeywords: ["disk", "storage", "capacity", "drive", "full", "alert"],
    baseConfidence: 0.93,
    defaultTier: "tier1",
    baseUrgency: 50,
    typicallyAutoResolvable: false,
    autoAction: "Run disk cleanup analysis and report space usage breakdown",
  },

  // ── Security ─────────────────────────────────────────────
  {
    category: "threatlocker_request",
    titlePatterns: [
      /threatlocker\s*(application\s*)?request/i,
      /threatlocker.*approval/i,
      /control\s*panel.*threatlocker/i,
    ],
    descriptionPatterns: [/portal\.d\.threatlocker\.com/i, /approve\s*or\s*deny/i],
    boostKeywords: ["threatlocker", "approval", "application request"],
    baseConfidence: 0.99,
    defaultTier: "tier1",
    baseUrgency: 15,
    typicallyAutoResolvable: true,
    autoAction: "Route to ThreatLocker approval queue — review and approve/deny in portal",
  },
  {
    category: "security_alert",
    titlePatterns: [
      /security\s*(alert|breach|incident)/i,
      /malware/i,
      /ransomware/i,
      /phishing/i,
      /compromised/i,
      /unauthorized\s*access/i,
      /suspicious\s*(activity|login)/i,
      /\bcoro\b.*\b(alert|threat|incident|detect|block|quarantine)\b/i,
    ],
    descriptionPatterns: [/threat\s*detected/i, /virus/i, /intrusion/i],
    boostKeywords: [
      "malware",
      "ransomware",
      "phishing",
      "breach",
      "compromised",
      "suspicious",
      "unauthorized",
    ],
    baseConfidence: 0.92,
    defaultTier: "tier3",
    baseUrgency: 80,
    typicallyAutoResolvable: false,
  },

  // ── Email & Communication ────────────────────────────────
  {
    category: "email_issue",
    titlePatterns: [
      /email\s*(issue|problem|not\s*working|delay|forwarding|bounce)/i,
      /\bmail\b.*(delay|late|bounce|forward|issue)/i,
      /\bgmail\b|\boutlook\b|\bo365\b|\bexchange\b/i,
      /email\s*forwarding/i,
      /junk\s*mail/i,
      /spam\s*filter/i,
      /\bdkim\b|\bspf\b|\bdmarc\b/i,
    ],
    descriptionPatterns: [
      /email.*delay/i,
      /received.*late/i,
      /forwarding.*request/i,
      /mail\s*flow/i,
    ],
    boostKeywords: [
      "email",
      "forwarding",
      "mailbox",
      "exchange",
      "outlook",
      "gmail",
      "spam",
      "junk",
      "dkim",
      "dmarc",
    ],
    baseConfidence: 0.88,
    defaultTier: "tier1",
    baseUrgency: 30,
    typicallyAutoResolvable: false,
  },

  // ── Network ──────────────────────────────────────────────
  {
    category: "network_connectivity",
    titlePatterns: [
      /network\s*(issue|down|problem|slow|outage)/i,
      /internet\s*(down|slow|issue|outage)/i,
      /\bvpn\b.*(issue|down|connect|fail)/i,
      /\bwifi\b|\bwi-fi\b/i,
      /connectivity\s*(issue|problem)/i,
      /ethernet\s*drop/i,
      /\bswitch\b.*\b(down|fail|issue)\b/i,
      /\bfirewall\b/i,
    ],
    descriptionPatterns: [/ethernet/i, /network\s*port/i, /cable\s*run/i],
    boostKeywords: [
      "network",
      "internet",
      "vpn",
      "wifi",
      "connectivity",
      "ethernet",
      "switch",
      "firewall",
    ],
    baseConfidence: 0.87,
    defaultTier: "tier2",
    baseUrgency: 45,
    typicallyAutoResolvable: false,
  },

  // ── User Management ──────────────────────────────────────
  {
    category: "new_employee_setup",
    titlePatterns: [
      /new\s*(employee|user|hire|staff|intern)/i,
      /onboard/i,
      /setup\s*(new|user|employee)/i,
      /add\s*(user|employee|extension)/i,
    ],
    descriptionPatterns: [/new\s*employee/i, /start\s*date/i, /onboarding/i],
    boostKeywords: ["new employee", "onboarding", "setup", "hire", "intern", "extension"],
    baseConfidence: 0.91,
    defaultTier: "tier1",
    baseUrgency: 25,
    typicallyAutoResolvable: false,
    autoAction: "Follow new employee onboarding checklist",
  },
  {
    category: "user_access",
    titlePatterns: [
      /password\s*(reset|issue|expired|change)/i,
      /\baccount\s*(lock|locked|disable|enable)/i,
      /\baccess\s*(issue|denied|request|permission)/i,
      /\bmfa\b|\b2fa\b/i,
      /login\s*(issue|fail|problem)/i,
      /can't\s*(log\s*in|sign\s*in|access)/i,
    ],
    descriptionPatterns: [/locked\s*out/i, /password/i, /permission/i, /unable\s*to\s*access/i],
    boostKeywords: ["password", "locked", "access", "login", "permission", "mfa"],
    baseConfidence: 0.9,
    defaultTier: "tier1",
    baseUrgency: 35,
    typicallyAutoResolvable: false,
  },

  // ── Hardware & Software ──────────────────────────────────
  {
    category: "hardware_request",
    titlePatterns: [
      /hardware\s*(request|order|replace|issue|fail)/i,
      /\blaptop\b|\bdesktop\b|\bmonitor\b|\bkeyboard\b|\bmouse\b/i,
      /\bdocking\s*station\b/i,
      /computer\s*(issue|slow|replace|new)/i,
    ],
    descriptionPatterns: [/purchase/i, /new\s*computer/i, /equipment/i],
    boostKeywords: ["hardware", "laptop", "desktop", "monitor", "purchase", "replace"],
    baseConfidence: 0.85,
    defaultTier: "tier1",
    baseUrgency: 20,
    typicallyAutoResolvable: false,
  },
  {
    category: "software_install",
    titlePatterns: [
      /software\s*(install|update|issue|license)/i,
      /\binstall\b.*\b(app|application|program|software)\b/i,
      /application\s*(request|install|issue)/i,
      /\blicense\b/i,
      /\bupdate\b.*\b(software|app|program)\b/i,
    ],
    descriptionPatterns: [/install/i, /license\s*key/i, /activation/i],
    boostKeywords: ["install", "software", "license", "application", "update"],
    baseConfidence: 0.86,
    defaultTier: "tier1",
    baseUrgency: 20,
    typicallyAutoResolvable: false,
  },

  // ── VoIP / Telephony ────────────────────────────────────
  {
    category: "voip_telephony",
    titlePatterns: [
      /\bvoip\b|\bphone\s*system\b/i,
      /\bextension\b/i,
      /\bcall\s*(quality|drop|issue|fail)/i,
      /\btelephone\b|\bhandset\b/i,
      /\bpbx\b|\bsip\b/i,
      /ring\s*group/i,
    ],
    descriptionPatterns: [/extension/i, /phone\s*number/i, /call\s*routing/i],
    boostKeywords: ["voip", "phone", "extension", "call", "pbx", "sip", "ring group"],
    baseConfidence: 0.87,
    defaultTier: "tier1",
    baseUrgency: 30,
    typicallyAutoResolvable: false,
  },

  // ── Backup & Recovery ───────────────────────────────────
  {
    category: "backup_recovery",
    titlePatterns: [
      /backup\s*(fail|issue|alert|error|restore)/i,
      /\brestore\b.*\b(file|data|backup)\b/i,
      /data\s*(loss|recovery|restore)/i,
      /\bveeam\b|\bdatto\b|\baxcient\b/i,
    ],
    descriptionPatterns: [/backup\s*job/i, /restore\s*request/i, /data\s*loss/i],
    boostKeywords: ["backup", "restore", "recovery", "data loss", "veeam", "datto"],
    baseConfidence: 0.9,
    defaultTier: "tier2",
    baseUrgency: 55,
    typicallyAutoResolvable: false,
  },

  // ── DNS / Domain ────────────────────────────────────────
  {
    category: "dns_domain",
    titlePatterns: [
      /\bdns\b/i,
      /\bdomain\b.*(transfer|issue|expir|renew)/i,
      /\bip\s*address\s*(change|update|static)/i,
      /\bssl\b|\bcertificate\b/i,
      /\bmx\s*record\b/i,
      /\bwebsite\b.*(down|issue|error)/i,
    ],
    descriptionPatterns: [/dns\s*record/i, /domain\s*registrar/i, /nameserver/i],
    boostKeywords: ["dns", "domain", "ip address", "ssl", "certificate", "mx"],
    baseConfidence: 0.88,
    defaultTier: "tier2",
    baseUrgency: 35,
    typicallyAutoResolvable: false,
  },

  // ── Printing ────────────────────────────────────────────
  {
    category: "printing",
    titlePatterns: [
      /print(er|ing)?\s*(issue|problem|not\s*working|jam|error|offline)/i,
      /\bprint\s*boss\b/i,
      /\bprint\s*server\b/i,
      /\bscanner\b.*(issue|problem|not\s*working)/i,
    ],
    descriptionPatterns: [/print/i, /toner/i, /paper\s*jam/i],
    boostKeywords: ["printer", "printing", "scanner", "toner", "print boss"],
    baseConfidence: 0.89,
    defaultTier: "tier1",
    baseUrgency: 20,
    typicallyAutoResolvable: false,
  },

  // ── Performance ─────────────────────────────────────────
  {
    category: "performance",
    titlePatterns: [
      /\b(slow|sluggish|lag|hanging|frozen|freeze)\b/i,
      /performance\s*(issue|problem|degraded)/i,
      /\bblue\s*screen\b|\bbsod\b/i,
      /cpu\s*(high|spike|100%)/i,
      /memory\s*(high|usage|leak)/i,
    ],
    descriptionPatterns: [/slow/i, /performance/i, /high\s*cpu/i, /memory\s*usage/i],
    boostKeywords: ["slow", "performance", "freeze", "bsod", "cpu", "memory", "lag"],
    baseConfidence: 0.86,
    defaultTier: "tier1",
    baseUrgency: 30,
    typicallyAutoResolvable: false,
  },

  // ── Vendor / Internal ───────────────────────────────────
  {
    category: "vendor_coordination",
    titlePatterns: [
      /vendor\s*(meeting|coordination|call)/i,
      /\bmeeting\s*with\b/i,
      /\btraining\b/i,
      /\bsetup\s*(and\s*)?deploy\s*(training|bsn)/i,
    ],
    descriptionPatterns: [/vendor/i, /training\s*session/i],
    boostKeywords: ["vendor", "meeting", "training", "coordination"],
    baseConfidence: 0.82,
    defaultTier: "tier1",
    baseUrgency: 10,
    typicallyAutoResolvable: false,
  },
  {
    category: "internal_task",
    titlePatterns: [/\barticle\s*review\b/i, /\binternal\b/i, /\bdocumentation\b/i, /\baudit\b/i],
    descriptionPatterns: [/internal\s*task/i, /documentation/i],
    boostKeywords: ["internal", "review", "documentation", "audit"],
    baseConfidence: 0.8,
    defaultTier: "tier1",
    baseUrgency: 5,
    typicallyAutoResolvable: false,
  },
];

// ────────────────────────────────────────────────────────────────
// Urgency Signal Definitions
// ────────────────────────────────────────────────────────────────

interface UrgencySignalDef {
  name: string;
  evaluate: (input: TicketInput, text: string) => UrgencySignal | null;
}

const URGENCY_SIGNALS: UrgencySignalDef[] = [
  {
    name: "server_down",
    evaluate: (input, text) => {
      if (/server.*(offline|down|crash|unresponsive)/i.test(text)) {
        return { name: "server_down", points: 25, reason: "Server offline/down detected" };
      }
      return null;
    },
  },
  {
    name: "multi_user_impact",
    evaluate: (input, text) => {
      if (/everyone|all\s*users|entire\s*(office|company|team)|multiple\s*users/i.test(text)) {
        return {
          name: "multi_user_impact",
          points: 20,
          reason: "Multiple users or entire office affected",
        };
      }
      return null;
    },
  },
  {
    name: "extended_downtime",
    evaluate: (input, text) => {
      // Match both "17+ hours offline" and "offline for 17+ hours"
      const hourMatch = text.match(/(\d+)\+?\s*hours?/i);
      if (hourMatch && /(offline|down|outage|non-responsive|unresponsive)/i.test(text)) {
        const hours = parseInt(hourMatch[1]!, 10);
        if (hours >= 24)
          return { name: "extended_downtime", points: 20, reason: `${hours}+ hours downtime` };
        if (hours >= 8)
          return { name: "extended_downtime", points: 15, reason: `${hours}+ hours downtime` };
        if (hours >= 2)
          return { name: "extended_downtime", points: 10, reason: `${hours}+ hours downtime` };
      }
      if (input.ageHours && input.ageHours > 24) {
        return {
          name: "extended_downtime",
          points: 15,
          reason: `Ticket open ${Math.round(input.ageHours)}h without resolution`,
        };
      }
      return null;
    },
  },
  {
    name: "data_loss_risk",
    evaluate: (_input, text) => {
      if (/data\s*loss|cannot\s*recover|corruption|ransomware|encrypt/i.test(text)) {
        return { name: "data_loss_risk", points: 25, reason: "Data loss or corruption risk" };
      }
      return null;
    },
  },
  {
    name: "security_threat",
    evaluate: (_input, text) => {
      if (/malware|ransomware|breach|compromised|unauthorized|phishing|intrusion/i.test(text)) {
        return { name: "security_threat", points: 30, reason: "Security threat detected" };
      }
      return null;
    },
  },
  {
    name: "vip_customer",
    evaluate: (input, _text) => {
      // Can be extended with a VIP customer list lookup
      if (input.customerName && /\b(vip|enterprise|premium)\b/i.test(input.customerName)) {
        return { name: "vip_customer", points: 10, reason: "VIP/enterprise customer" };
      }
      return null;
    },
  },
  {
    name: "alert_generated",
    evaluate: (input, _text) => {
      if (input.isAlertGenerated || input.source === "Api") {
        return {
          name: "alert_generated",
          points: 10,
          reason: "Automated alert/monitoring trigger",
        };
      }
      return null;
    },
  },
  {
    name: "high_priority_set",
    evaluate: (input, _text) => {
      if (
        input.priority?.toLowerCase() === "high" ||
        input.priority?.toLowerCase() === "critical"
      ) {
        return {
          name: "high_priority_set",
          points: 15,
          reason: `Atera priority: ${input.priority}`,
        };
      }
      return null;
    },
  },
  {
    name: "business_critical_keywords",
    evaluate: (_input, text) => {
      if (/can't\s*work|business\s*stop|revenue|deadline|urgent|asap|emergency/i.test(text)) {
        return {
          name: "business_critical_keywords",
          points: 15,
          reason: "Business-critical urgency language detected",
        };
      }
      return null;
    },
  },
  {
    name: "repeated_issue",
    evaluate: (_input, text) => {
      if (
        /again|third\s*time|keeps\s*happening|recurring|same\s*issue|this\s*is\s*the\s*(second|third)/i.test(
          text,
        )
      ) {
        return {
          name: "repeated_issue",
          points: 10,
          reason: "Recurring/repeated issue flagged by customer",
        };
      }
      return null;
    },
  },
  {
    name: "disk_critical",
    evaluate: (_input, text) => {
      if (
        /disk.*critical|at\s*capacity|drive\s*(is\s*)?full|0\s*(bytes|mb|gb)\s*(free|remaining)/i.test(
          text,
        )
      ) {
        return { name: "disk_critical", points: 15, reason: "Disk at critical capacity" };
      }
      return null;
    },
  },
  {
    name: "multiple_devices",
    evaluate: (input, _text) => {
      if (input.devicesAffected && input.devicesAffected > 3) {
        return {
          name: "multiple_devices",
          points: 15,
          reason: `${input.devicesAffected} devices affected`,
        };
      }
      return null;
    },
  },
];

// ────────────────────────────────────────────────────────────────
// Tier Override Rules
// ────────────────────────────────────────────────────────────────

/**
 * Conditions that override the default tier from category classification.
 */
function computeTierOverride(
  category: TicketCategory,
  urgencyScore: number,
  signals: UrgencySignal[],
): SupportTier {
  const signalNames = new Set(signals.map((s) => s.name));

  // Security threats always T3
  if (signalNames.has("security_threat")) return "tier3";

  // Data loss risk → T3
  if (signalNames.has("data_loss_risk")) return "tier3";

  // Server down with extended downtime → T3
  if (signalNames.has("server_down") && signalNames.has("extended_downtime")) return "tier3";

  // Critical urgency (80+) → at least T2
  if (urgencyScore >= 80) {
    const defaultTier = CLASSIFICATION_RULES.find((r) => r.category === category)?.defaultTier;
    if (defaultTier === "tier1") return "tier2";
  }

  // High urgency (60+) with multi-user impact → T2
  if (urgencyScore >= 60 && signalNames.has("multi_user_impact")) return "tier2";

  // Return null to use default
  return CLASSIFICATION_RULES.find((r) => r.category === category)?.defaultTier ?? "tier1";
}

// ────────────────────────────────────────────────────────────────
// SLA Mapping
// ────────────────────────────────────────────────────────────────

function computeSlaMinutes(urgencyLevel: UrgencyLevel): number {
  switch (urgencyLevel) {
    case "critical":
      return 15;
    case "high":
      return 60;
    case "medium":
      return 240; // 4 hours
    case "low":
      return 480; // 8 hours (1 business day)
    case "informational":
      return 1440; // 24 hours
  }
}

function scoreToUrgencyLevel(score: number): UrgencyLevel {
  if (score >= 80) return "critical";
  if (score >= 60) return "high";
  if (score >= 40) return "medium";
  if (score >= 20) return "low";
  return "informational";
}

// ────────────────────────────────────────────────────────────────
// Core Triage Function
// ────────────────────────────────────────────────────────────────

/**
 * Classify and score a ticket for triage routing.
 *
 * @param input - Ticket data to classify
 * @returns Full triage result with category, urgency, tier, and reasoning
 */
export function triageTicket(input: TicketInput): TriageResult {
  const combinedText = `${input.title} ${input.description ?? ""}`.trim();
  const lowerText = combinedText.toLowerCase();

  // ── Step 1: Category Classification ──────────────────────
  let bestMatch: { rule: ClassificationRule; confidence: number } | null = null;
  const relatedCategories: TicketCategory[] = [];

  for (const rule of CLASSIFICATION_RULES) {
    let matched = false;
    let confidence = 0;

    // Check title patterns (higher weight)
    for (const pattern of rule.titlePatterns) {
      if (pattern.test(input.title)) {
        matched = true;
        confidence = rule.baseConfidence;
        break;
      }
    }

    // Check description patterns (lower weight, additive)
    if (!matched && rule.descriptionPatterns) {
      for (const pattern of rule.descriptionPatterns) {
        if (pattern.test(input.description ?? "")) {
          matched = true;
          confidence = rule.baseConfidence * 0.85; // slightly lower for desc-only match
          break;
        }
      }
    }

    // Boost confidence with keyword density
    if (matched && rule.boostKeywords) {
      let keywordHits = 0;
      for (const kw of rule.boostKeywords) {
        if (lowerText.includes(kw.toLowerCase())) keywordHits++;
      }
      const boostFactor = Math.min(keywordHits * 0.02, 0.05); // max +5% from keywords
      confidence = Math.min(confidence + boostFactor, 1.0);
    }

    if (matched) {
      if (!bestMatch || confidence > bestMatch.confidence) {
        // Demote previous best to related
        if (bestMatch) relatedCategories.push(bestMatch.rule.category);
        bestMatch = { rule, confidence };
      } else {
        relatedCategories.push(rule.category);
      }
    }
  }

  // Fallback to general_support
  const category: TicketCategory = bestMatch?.rule.category ?? "general_support";
  const confidence = bestMatch?.confidence ?? 0.5;
  const baseUrgency = bestMatch?.rule.baseUrgency ?? 20;

  // ── Step 2: Urgency Scoring ──────────────────────────────
  const urgencySignals: UrgencySignal[] = [];
  for (const signalDef of URGENCY_SIGNALS) {
    const signal = signalDef.evaluate(input, combinedText);
    if (signal) urgencySignals.push(signal);
  }

  const signalPoints = urgencySignals.reduce((sum, s) => sum + s.points, 0);
  const urgencyScore = Math.min(baseUrgency + signalPoints, 100);
  const urgencyLevel = scoreToUrgencyLevel(urgencyScore);

  // ── Step 3: Tier Routing ─────────────────────────────────
  const tier = computeTierOverride(category, urgencyScore, urgencySignals);

  // ── Step 4: Build Reasoning ──────────────────────────────
  const reasoningParts: string[] = [];
  reasoningParts.push(`Category: ${category} (confidence: ${(confidence * 100).toFixed(0)}%)`);
  if (urgencySignals.length > 0) {
    reasoningParts.push(
      `Urgency signals: ${urgencySignals.map((s) => `${s.name} (+${s.points})`).join(", ")}`,
    );
  }
  reasoningParts.push(
    `Base urgency: ${baseUrgency}, Signal boost: +${signalPoints}, Final: ${urgencyScore}`,
  );
  const reasoning = reasoningParts.join(". ");

  // ── Step 5: Auto-resolve check ───────────────────────────
  const autoResolvable = bestMatch?.rule.typicallyAutoResolvable ?? false;
  const autoAction = bestMatch?.rule.autoAction;

  return {
    category,
    relatedCategories: relatedCategories.slice(0, 2),
    urgencyScore,
    urgencyLevel,
    tier,
    confidence,
    reasoning,
    urgencySignals,
    suggestedSlaMinutes: computeSlaMinutes(urgencyLevel),
    autoResolvable,
    autoAction,
  };
}

// ────────────────────────────────────────────────────────────────
// Batch Triage
// ────────────────────────────────────────────────────────────────

export interface BatchTriageResult {
  /** Triage results keyed by a caller-provided ID. */
  results: Map<string, TriageResult>;
  /** Results sorted by urgency (highest first). */
  prioritizedOrder: { id: string; urgencyScore: number; category: TicketCategory }[];
  /** Summary statistics. */
  summary: {
    total: number;
    byTier: Record<SupportTier, number>;
    byUrgency: Record<UrgencyLevel, number>;
    byCategory: Record<string, number>;
    autoResolvableCount: number;
  };
}

/**
 * Triage a batch of tickets and return prioritized results.
 */
export function triageBatch(tickets: Map<string, TicketInput>): BatchTriageResult {
  const results = new Map<string, TriageResult>();
  const tierCounts: Record<SupportTier, number> = { tier1: 0, tier2: 0, tier3: 0 };
  const urgencyCounts: Record<UrgencyLevel, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    informational: 0,
  };
  const categoryCounts: Record<string, number> = {};
  let autoResolvableCount = 0;

  for (const [id, input] of tickets) {
    const result = triageTicket(input);
    results.set(id, result);
    tierCounts[result.tier]++;
    urgencyCounts[result.urgencyLevel]++;
    categoryCounts[result.category] = (categoryCounts[result.category] ?? 0) + 1;
    if (result.autoResolvable) autoResolvableCount++;
  }

  // Sort by urgency score descending
  const prioritizedOrder = Array.from(results.entries())
    .sort(([, a], [, b]) => b.urgencyScore - a.urgencyScore)
    .map(([id, r]) => ({ id, urgencyScore: r.urgencyScore, category: r.category }));

  return {
    results,
    prioritizedOrder,
    summary: {
      total: tickets.size,
      byTier: tierCounts,
      byUrgency: urgencyCounts,
      byCategory: categoryCounts,
      autoResolvableCount,
    },
  };
}
