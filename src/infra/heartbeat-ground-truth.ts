/**
 * Heartbeat Ground Truth — Deterministic State Checks
 *
 * Instead of trusting the agent's claims about what it did,
 * this module queries real APIs to get actual state and feeds
 * that ground truth to the verification sidecar.
 *
 * Currently supports:
 * - Moltyverse Email: unread count, recent sent count
 *
 * Future candidates:
 * - Dashboard tasks: actual task states from DB
 * - GitHub: actual open issues/mentions
 * - Moltyverse: actual post/comment activity
 */

import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("heartbeat/ground-truth");

// ── Types ──────────────────────────────────────────────────────────────────

export interface GroundTruthResult {
  taskId: string;
  /** Human-readable summary of actual state */
  actual: string;
  /** Raw data for the verifier to compare */
  data: Record<string, unknown>;
}

export interface GroundTruthReport {
  checks: GroundTruthResult[];
  collectedAt: number;
}

// ── Email Ground Truth ─────────────────────────────────────────────────────

const MOLTYVERSE_EMAIL_API = "https://api.moltyverse.email";

interface EmailMessage {
  id: string;
  direction: "inbound" | "outbound";
  from: string;
  to: string;
  subject: string;
  created_at: string;
  read: boolean;
}

async function checkEmailGroundTruth(apiKey: string): Promise<GroundTruthResult | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    const res = await fetch(`${MOLTYVERSE_EMAIL_API}/api/messages`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      log.warn("email ground truth: API returned non-OK", { status: res.status });
      return null;
    }

    const data = (await res.json()) as { messages?: EmailMessage[] };
    const messages = data.messages ?? [];

    const unread = messages.filter((m) => !m.read && m.direction === "inbound");
    const recentSent = messages.filter((m) => {
      if (m.direction !== "outbound") return false;
      const sentAt = new Date(m.created_at).getTime();
      const fifteenMinAgo = Date.now() - 15 * 60 * 1000;
      return sentAt > fifteenMinAgo;
    });

    const unreadSummary =
      unread.length > 0
        ? unread
            .slice(0, 5)
            .map((m) => `  - From: ${m.from}, Subject: "${m.subject}" (${m.created_at})`)
            .join("\n")
        : "  (none)";

    return {
      taskId: "email",
      actual: [
        `Email inbox ACTUAL state:`,
        `- Total messages: ${messages.length}`,
        `- Unread inbound: ${unread.length}`,
        `- Sent in last 15 min: ${recentSent.length}`,
        unread.length > 0 ? `- Unread messages:\n${unreadSummary}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
      data: {
        totalMessages: messages.length,
        unreadCount: unread.length,
        recentSentCount: recentSent.length,
        unreadFrom: unread.map((m) => m.from),
        unreadSubjects: unread.map((m) => m.subject),
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.debug("email ground truth: failed", { error: msg });
    return null;
  }
}

// ── Public API ─────────────────────────────────────────────────────────────

// ── Moltyverse Social Ground Truth ─────────────────────────────────────────

const MOLTYVERSE_API = "https://api.moltyverse.app/api/v1";

interface MoltyverseNotification {
  id: string;
  type: string;
  read: boolean;
  created_at: string;
}

async function checkMoltyverseGroundTruth(apiKey: string): Promise<GroundTruthResult | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    // Check notifications for unread activity
    const notifRes = await fetch(`${MOLTYVERSE_API}/notifications`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    });

    clearTimeout(timeout);

    let unreadNotifs = 0;
    let totalNotifs = 0;
    if (notifRes.ok) {
      const notifData = (await notifRes.json()) as {
        notifications?: MoltyverseNotification[];
      };
      const notifs = notifData.notifications ?? [];
      totalNotifs = notifs.length;
      unreadNotifs = notifs.filter((n) => !n.read).length;
    }

    // Check recent posts by the agent (last 15 min)
    const controller2 = new AbortController();
    const timeout2 = setTimeout(() => controller2.abort(), 10_000);

    const postsRes = await fetch(`${MOLTYVERSE_API}/posts?author=me&limit=5`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller2.signal,
    });

    clearTimeout(timeout2);

    let recentPosts = 0;
    let recentComments = 0;
    if (postsRes.ok) {
      const postData = (await postsRes.json()) as {
        posts?: Array<{ created_at: string; type?: string }>;
      };
      const posts = postData.posts ?? [];
      const fifteenMinAgo = Date.now() - 15 * 60 * 1000;
      for (const p of posts) {
        const createdAt = new Date(p.created_at).getTime();
        if (createdAt > fifteenMinAgo) {
          if (p.type === "comment") recentComments++;
          else recentPosts++;
        }
      }
    }

    return {
      taskId: "moltyverse",
      actual: [
        `Moltyverse ACTUAL state:`,
        `- Unread notifications: ${unreadNotifs}`,
        `- Total notifications: ${totalNotifs}`,
        `- Posts by agent in last 15 min: ${recentPosts}`,
        `- Comments by agent in last 15 min: ${recentComments}`,
        recentPosts + recentComments === 0
          ? "- Agent has NOT posted or commented in the last 15 minutes"
          : "",
      ]
        .filter(Boolean)
        .join("\n"),
      data: {
        unreadNotifs,
        totalNotifs,
        recentPosts,
        recentComments,
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.debug("moltyverse ground truth: failed", { error: msg });
    return null;
  }
}

// ── Config ─────────────────────────────────────────────────────────────────

export interface GroundTruthConfig {
  /** Moltyverse Email API key (if available) */
  moltyverseEmailApiKey?: string;
  /** Moltyverse social API key (if available) */
  moltyverseApiKey?: string;
}

/**
 * Collect ground truth for all supported task types.
 * Returns a report with actual state data that the verifier uses
 * to compare against the agent's claims.
 */
export async function collectGroundTruth(config: GroundTruthConfig): Promise<GroundTruthReport> {
  const checks: GroundTruthResult[] = [];

  // Email check
  if (config.moltyverseEmailApiKey) {
    const emailTruth = await checkEmailGroundTruth(config.moltyverseEmailApiKey);
    if (emailTruth) {
      checks.push(emailTruth);
      log.info("ground truth: email collected", {
        unread: emailTruth.data.unreadCount,
        recentSent: emailTruth.data.recentSentCount,
      });
    }
  }

  // Moltyverse social check
  if (config.moltyverseApiKey) {
    const moltyTruth = await checkMoltyverseGroundTruth(config.moltyverseApiKey);
    if (moltyTruth) {
      checks.push(moltyTruth);
      log.info("ground truth: moltyverse collected", {
        unreadNotifs: moltyTruth.data.unreadNotifs,
        recentPosts: moltyTruth.data.recentPosts,
      });
    }
  }

  // Future: dashboard tasks, GitHub, etc.

  return { checks, collectedAt: Date.now() };
}

/**
 * Format ground truth into a string that gets injected into the
 * verification prompt alongside the task contract and agent response.
 */
export function formatGroundTruthForVerifier(report: GroundTruthReport): string {
  if (report.checks.length === 0) return "";

  const lines = ["## GROUND TRUTH (actual system state — use this to verify agent claims)"];

  for (const check of report.checks) {
    lines.push("", `### Task: ${check.taskId}`, check.actual);
  }

  lines.push(
    "",
    "IMPORTANT: If the agent claims 0 messages but ground truth shows unread messages, mark as NOT_VERIFIED.",
    "The agent's claims must match the actual state. Ground truth overrides agent self-reporting.",
  );

  return lines.join("\n");
}
