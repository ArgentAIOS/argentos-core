#!/usr/bin/env node
/**
 * Conductor demo kit — seeds the "Ticket Triage Conductor" governed-job demo.
 *
 * Creates: (1) six realistic MSP support tickets as open board tasks
 * ("[TICKET] ..." title convention), and (2) the "Ticket Triage Conductor"
 * job template (simulate mode: the worker triages, routes, and drafts reply
 * emails in its run output — it touches nothing).
 *
 * The worker + assignment are intentionally left to the operator via the
 * dashboard's Guided Worker Wizard (Workforce Board → Worker Roster), or
 * pass --assign <agentId> to wire an assignment here.
 *
 * Usage:
 *   node scripts/demo/conductor-demo.mjs [--gateway ws://127.0.0.1:18789]
 *     [--api http://127.0.0.1:9242] [--token <gateway token>]
 *     [--assign <agentId>] [--run-now]
 *
 * Token default: gateway.auth.token from ~/.argentos/argent.json.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import WebSocket from "ws";

const args = process.argv.slice(2);
function arg(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : fallback;
}
const GATEWAY = arg("gateway", "ws://127.0.0.1:18789");
const API = arg("api", "http://127.0.0.1:9242");
const ASSIGN = arg("assign", null);
const RUN_NOW = args.includes("--run-now");

function defaultToken() {
  try {
    const cfg = JSON.parse(
      fs.readFileSync(path.join(os.homedir(), ".argentos", "argent.json"), "utf8"),
    );
    return cfg?.gateway?.auth?.token ?? "";
  } catch {
    return "";
  }
}
const TOKEN = arg("token", defaultToken());
if (!TOKEN) {
  console.error("no gateway token (pass --token or configure gateway.auth.token)");
  process.exit(1);
}

const TICKETS = [
  {
    customer: "Brightway Dental",
    subject: "Email not syncing on front-desk iMac since this morning",
    body: "Outlook keeps asking for a password and won't accept the right one. Front desk can't see appointment confirmations.",
    priority: "high",
  },
  {
    customer: "Lakeside CPA Group",
    subject: "VPN drops every 20-30 minutes for remote staff",
    body: "Three remote employees report the VPN disconnecting mid-session since yesterday's ISP maintenance window.",
    priority: "high",
  },
  {
    customer: "Mooreland Logistics",
    subject: "Request: new hire onboarding (starts Monday)",
    body: "Need laptop image, M365 account, warehouse-scanner access, and badge for Daniel R., dispatch team, starting Monday.",
    priority: "normal",
  },
  {
    customer: "Brightway Dental",
    subject: "Printer in operatory 3 jamming on every tray",
    body: "Replaced paper and cleaned rollers per the guide; still jams. Model HL-L6200DW. Need on-site service or replacement decision.",
    priority: "low",
  },
  {
    customer: "Harbor Point HOA",
    subject: "Suspicious email asking for gift card purchase",
    body: "Office manager received an email appearing to be from the board president requesting urgent gift card purchases. Did not click anything.",
    priority: "urgent",
  },
  {
    customer: "Lakeside CPA Group",
    subject: "QuickBooks multi-user mode locked after update",
    body: "After last night's QB update only one user can open the company file. Tax deadline week — partners escalating.",
    priority: "urgent",
  },
];

const ROLE_PROMPT = `You are the Ticket Triage Conductor for an MSP (managed service provider).
You coordinate incoming support tickets: you do not fix issues yourself, you
orchestrate. For every open ticket you produce a triage decision a human
dispatcher could act on immediately.`;

const SOP = `1. Use the tasks tool to list open, unassigned tasks whose title starts with "[TICKET]". These ticket tasks are READ-ONLY source material — never modify, assign, complete, or comment on them.
2. For each ticket, determine: (a) issue category (email/auth, network, onboarding, hardware, security, line-of-business app), (b) severity and business impact, (c) the right assignee queue (Tier 1, Tier 2, Field Tech, Security, or Account Manager), (d) anything that should be escalated immediately.
3. Draft the reply email that would be sent to the ticket's user: professional, concrete next step, realistic ETA. Mark security-suspicious tickets for phishing review and include user-safety guidance in the draft.
4. Compose the FULL triage log: one section per ticket with category, severity, routing decision, escalation flag, and the complete reply draft. Do NOT send any message or email — the triage log is the deliverable.
5. Finish with ONE work_report call: outcome "done", and put the ENTIRE triage log from step 4 in the summary field. Filing the report completes the run — do not modify ANY task on the board, including your own.`;

const SUCCESS = `A work_report is filed whose summary covers every open [TICKET] task with: category, severity, routing queue, escalation flag, and a complete reply-email draft. Zero board mutations by the worker; zero outbound messages.`;

let nextId = 1;
const pending = new Map();
const ws = new WebSocket(GATEWAY);
function send(method, params = {}) {
  const id = String(nextId++);
  ws.send(JSON.stringify({ type: "req", id, method, params }));
  return new Promise((resolve, reject) => {
    pending.set(id, resolve);
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`timeout: ${method}`));
      }
    }, 30000);
  });
}
ws.on("message", (raw) => {
  const frame = JSON.parse(String(raw));
  if (frame.type === "res" && pending.has(frame.id)) {
    pending.get(frame.id)(frame);
    pending.delete(frame.id);
  }
});
ws.on("error", (err) => {
  console.error("gateway connection failed:", err.message);
  process.exit(1);
});
ws.on("open", () => {
  send("connect", {
    auth: { token: TOKEN },
    client: { id: "test", mode: "test", version: "demo", platform: "node" },
    caps: [],
    role: "operator",
    scopes: ["operator.admin"],
    minProtocol: 3,
    maxProtocol: 3,
  }).catch(() => {});
});

async function seedTickets() {
  let created = 0;
  for (const t of TICKETS) {
    const res = await fetch(`${API}/api/tasks`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({
        title: `[TICKET] ${t.customer}: ${t.subject}`,
        details: `Customer: ${t.customer}\nPriority: ${t.priority}\n\n${t.body}`,
        priority: t.priority === "urgent" ? "high" : t.priority,
        metadata: { demo: "conductor", customer: t.customer, ticketPriority: t.priority },
      }),
    });
    if (res.ok) {
      created += 1;
    } else {
      console.error(`  ticket seed failed (${res.status}): ${t.subject}`);
    }
  }
  console.log(`tickets seeded: ${created}/${TICKETS.length}`);
}

async function main() {
  await new Promise((r) => setTimeout(r, 1500));

  await seedTickets();

  const existing = await send("jobs.templates.list", {});
  const prior = (existing.payload?.templates ?? []).find(
    (t) => t.name === "Ticket Triage Conductor",
  );
  let templateId = prior?.id;
  if (templateId) {
    console.log(`template exists: ${templateId}`);
  } else {
    const tpl = await send("jobs.templates.create", {
      name: "Ticket Triage Conductor",
      description:
        "Coordinates open support tickets: categorize, route, escalate, and draft user replies. Simulate-stage demo of governed workforce execution.",
      rolePrompt: ROLE_PROMPT,
      sop: SOP,
      successDefinition: SUCCESS,
      defaultMode: "simulate",
      toolsAllow: ["tasks", "memory_recall"],
      tags: ["demo", "conductor"],
    });
    if (!tpl.ok) {
      console.error("template create failed:", JSON.stringify(tpl.error));
      process.exit(1);
    }
    templateId = tpl.payload?.template?.id;
    console.log(`template created: ${templateId}`);
  }

  if (ASSIGN) {
    const asg = await send("jobs.assignments.create", {
      templateId,
      agentId: ASSIGN,
      title: `Ticket Triage Conductor (${ASSIGN})`,
      executionMode: "simulate",
      enabled: true,
      cadenceMinutes: 30,
    });
    if (!asg.ok) {
      console.error("assignment create failed:", JSON.stringify(asg.error));
      process.exit(1);
    }
    const assignmentId = asg.payload?.assignment?.id;
    console.log(`assignment created: ${assignmentId} -> ${ASSIGN}`);
    if (RUN_NOW) {
      const run = await send("jobs.assignments.runNow", { assignmentId });
      console.log(run.ok ? "runNow dispatched" : `runNow failed: ${JSON.stringify(run.error)}`);
    }
  } else {
    console.log(`
next steps (operator):
  1. Dashboard -> Operations -> Workforce Board -> Worker Roster -> "Guided Worker Wizard"
     to create the conductor worker (or reuse an existing agent).
  2. Assign it the "Ticket Triage Conductor" template (simulate, 30m cadence).
  3. Enable the execution worker if disabled:
       agents.defaults.executionWorker: { "enabled": true, "every": "5m" }
  4. Run Now on the assignment, then read the run in Workforce Board -> Runs.`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("demo setup failed:", err.message);
  process.exit(2);
});
