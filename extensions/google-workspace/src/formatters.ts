import type { EmailUsageReport, GmailActivityEvent, WorkspaceUser, EmailSummary } from "./types.js";

/** Tabular email stats: date | sent | received | spam */
export function formatEmailStats(reports: EmailUsageReport[]): string {
  if (reports.length === 0) return "No email usage data found for the specified range.";

  const lines = ["Date         | Sent | Received | Spam", "------------ | ---- | -------- | ----"];
  for (const r of reports) {
    lines.push(
      `${r.date.padEnd(12)} | ${String(r.sent).padStart(4)} | ${String(r.received).padStart(8)} | ${String(r.spam).padStart(4)}`,
    );
  }

  const totals = reports.reduce(
    (acc, r) => ({
      sent: acc.sent + r.sent,
      received: acc.received + r.received,
      spam: acc.spam + r.spam,
    }),
    { sent: 0, received: 0, spam: 0 },
  );
  lines.push("------------ | ---- | -------- | ----");
  lines.push(
    `TOTAL        | ${String(totals.sent).padStart(4)} | ${String(totals.received).padStart(8)} | ${String(totals.spam).padStart(4)}`,
  );

  return lines.join("\n");
}

/** User info: name, email, org unit, last login, status */
export function formatUserInfo(user: WorkspaceUser): string {
  const status = user.suspended ? "SUSPENDED" : "Active";
  const admin = user.isAdmin ? " (Admin)" : "";
  return [
    `Name: ${user.name}${admin}`,
    `Email: ${user.email}`,
    `Org Unit: ${user.orgUnit}`,
    `Status: ${status}`,
    `Last Login: ${user.lastLogin}`,
    `Created: ${user.creationTime}`,
  ].join("\n");
}

/** Compact user list */
export function formatUserList(users: WorkspaceUser[]): string {
  if (users.length === 0) return "No users found.";

  const lines = [`${users.length} user(s) found:\n`];
  for (const u of users) {
    const flags = [u.suspended ? "SUSPENDED" : "", u.isAdmin ? "admin" : ""]
      .filter(Boolean)
      .join(", ");
    const suffix = flags ? ` [${flags}]` : "";
    lines.push(`  ${u.email} — ${u.name} (${u.orgUnit})${suffix}`);
  }
  return lines.join("\n");
}

/** Management overview: totals + top N senders/receivers */
export function formatEmailSummary(summary: EmailSummary): string {
  const lines = [
    `Email Summary: ${summary.startDate} to ${summary.endDate}`,
    `Users: ${summary.userCount}`,
    `Total Sent: ${summary.totalSent}`,
    `Total Received: ${summary.totalReceived}`,
    `Total Spam: ${summary.totalSpam}`,
    "",
    "Top Senders:",
  ];
  for (const s of summary.topSenders) {
    lines.push(`  ${s.email}: ${s.sent} sent`);
  }
  lines.push("", "Top Receivers:");
  for (const r of summary.topReceivers) {
    lines.push(`  ${r.email}: ${r.received} received`);
  }
  return lines.join("\n");
}

/** Activity events: timestamp, actor, event type */
export function formatActivityEvents(events: GmailActivityEvent[]): string {
  if (events.length === 0) return "No activity events found for the specified criteria.";

  const lines = [`${events.length} event(s):\n`];
  for (const e of events) {
    const parts = [e.timestamp, e.actor, e.eventType];
    if (e.recipient) parts.push(`→ ${e.recipient}`);
    if (e.subject) parts.push(`"${e.subject}"`);
    lines.push(`  ${parts.join(" | ")}`);
  }
  return lines.join("\n");
}
