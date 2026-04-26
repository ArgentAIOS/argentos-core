#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), "..");
const busDir = path.join(repoRoot, "ops", "threadmaster-bus");
const messagesPath = path.join(busDir, "messages.jsonl");
const acksPath = path.join(busDir, "acks.json");
const tasksPath = path.join(busDir, "tasks.json");

const knownLanes = ["master", "workflows", "appforge", "aou", "aos", "openclaw", "all"];
const taskStatuses = ["todo", "doing", "blocked", "done", "cancelled"];
const taskPriorities = ["low", "normal", "high", "urgent"];

function usage(exitCode = 0) {
  const text = `Threadmaster bus

Usage:
  pnpm threadmaster:post --from workflows --to appforge --subject "Need event contract" --body "..."
  pnpm threadmaster:list [--lane workflows] [--unacked] [--limit 20]
  pnpm threadmaster:ack --lane workflows --id <message-id>
  pnpm threadmaster:status [--lane workflows]
  pnpm threadmaster:poll --lane workflows [--interval 10]
  pnpm threadmaster:task-add --from master --owner appforge --title "Wire records" --body "..."
  pnpm threadmaster:task-list [--lane appforge] [--status todo]
  pnpm threadmaster:task-update --id <task-id> --status blocked --note "Need schema decision"

Commands:
  post      Append a durable message to ops/threadmaster-bus/messages.jsonl
  list      List recent messages, optionally filtered by lane
  ack       Mark a message acknowledged by a lane
  status    Show lane inbox counts
  poll      Re-list a lane inbox every N seconds
  task-add      Create a task for a lane
  task-list     List tasks
  task-update   Update status/owner/note for a task

Fields:
  --from     Sender lane (${knownLanes.join(", ")})
  --to       Target lane or comma-separated lanes; use "all" for broadcast
  --subject  Short message subject
  --body     Message body
  --lane     Lane reading or acknowledging messages
  --id       Message id to acknowledge
  --owner    Lane responsible for a task
  --status   Task status (${taskStatuses.join(", ")})
  --priority Task priority (${taskPriorities.join(", ")})
`;
  process.stdout.write(text);
  process.exit(exitCode);
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      args._.push(token);
      continue;
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    i += 1;
  }
  return args;
}

function ensureBus() {
  fs.mkdirSync(busDir, { recursive: true });
  if (!fs.existsSync(messagesPath)) {
    fs.writeFileSync(messagesPath, "", "utf8");
  }
  if (!fs.existsSync(acksPath)) {
    fs.writeFileSync(acksPath, "{}\n", "utf8");
  }
  if (!fs.existsSync(tasksPath)) {
    fs.writeFileSync(tasksPath, "[]\n", "utf8");
  }
}

function normalizeLane(value, field) {
  const lane = String(value || "")
    .trim()
    .toLowerCase();
  if (!lane) {
    throw new Error(`Missing --${field}`);
  }
  if (!knownLanes.includes(lane)) {
    throw new Error(`Unknown ${field} lane "${lane}". Known: ${knownLanes.join(", ")}`);
  }
  return lane;
}

function normalizeTargets(value) {
  const raw = String(value || "all")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  const targets = raw.length > 0 ? raw : ["all"];
  for (const target of targets) {
    if (!knownLanes.includes(target)) {
      throw new Error(`Unknown target lane "${target}". Known: ${knownLanes.join(", ")}`);
    }
  }
  return [...new Set(targets)];
}

function readMessages() {
  ensureBus();
  const text = fs.readFileSync(messagesPath, "utf8");
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (err) {
        throw new Error(`Invalid JSONL in ${messagesPath} at line ${index + 1}: ${err.message}`);
      }
    });
}

function readAcks() {
  ensureBus();
  try {
    return JSON.parse(fs.readFileSync(acksPath, "utf8"));
  } catch {
    return {};
  }
}

function writeAcks(acks) {
  ensureBus();
  const tmp = `${acksPath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(acks, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, acksPath);
}

function readTasks() {
  ensureBus();
  try {
    const tasks = JSON.parse(fs.readFileSync(tasksPath, "utf8"));
    return Array.isArray(tasks) ? tasks : [];
  } catch {
    return [];
  }
}

function writeTasks(tasks) {
  ensureBus();
  const tmp = `${tasksPath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(tasks, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, tasksPath);
}

function messageTargetsLane(message, lane) {
  return message.to.includes("all") || message.to.includes(lane) || lane === "all";
}

function isAcked(message, lane, acks) {
  return Boolean(acks[lane]?.[message.id]);
}

function makeId() {
  const stamp = new Date()
    .toISOString()
    .replace(/[-:.TZ]/g, "")
    .slice(0, 14);
  const random = Math.random().toString(36).slice(2, 8);
  return `tm-${stamp}-${random}`;
}

function makeTaskId() {
  return makeId().replace("tm-", "task-");
}

function normalizeStatus(value, fallback = "todo") {
  const status = String(value || fallback)
    .trim()
    .toLowerCase();
  if (!taskStatuses.includes(status)) {
    throw new Error(`Unknown task status "${status}". Known: ${taskStatuses.join(", ")}`);
  }
  return status;
}

function normalizePriority(value, fallback = "normal") {
  const priority = String(value || fallback)
    .trim()
    .toLowerCase();
  if (!taskPriorities.includes(priority)) {
    throw new Error(`Unknown task priority "${priority}". Known: ${taskPriorities.join(", ")}`);
  }
  return priority;
}

function currentGitRef() {
  try {
    const head = fs.readFileSync(path.join(repoRoot, ".git", "HEAD"), "utf8").trim();
    if (head.startsWith("ref: ")) {
      return head.slice("ref: refs/heads/".length) || head;
    }
    return head.slice(0, 12);
  } catch {
    return "unknown";
  }
}

function cmdPost(args) {
  ensureBus();
  const from = normalizeLane(args.from, "from");
  const to = normalizeTargets(args.to);
  const subject = String(args.subject || "").trim();
  const body = String(args.body || "").trim();
  if (!subject) {
    throw new Error("Missing --subject");
  }
  if (!body) {
    throw new Error("Missing --body");
  }
  const message = {
    id: makeId(),
    createdAt: new Date().toISOString(),
    from,
    to,
    subject,
    body,
    repo: "ArgentAIOS/argentos-core",
    cwd: repoRoot,
    branch: currentGitRef(),
    host: os.hostname(),
  };
  fs.appendFileSync(messagesPath, `${JSON.stringify(message)}\n`, "utf8");
  process.stdout.write(`posted ${message.id} ${from} -> ${to.join(",")}: ${subject}\n`);
}

function formatMessage(message, acks, lane) {
  const ackMark = lane && isAcked(message, lane, acks) ? "✓" : " ";
  return [
    `[${ackMark}] ${message.id} ${message.createdAt}`,
    `    ${message.from} -> ${message.to.join(", ")} | ${message.subject}`,
    `    ${message.body}`,
    `    branch=${message.branch ?? "unknown"} host=${message.host ?? "unknown"}`,
  ].join("\n");
}

function cmdList(args) {
  const lane = args.lane ? normalizeLane(args.lane, "lane") : "";
  const limit = Number.parseInt(String(args.limit || "30"), 10);
  const unacked = Boolean(args.unacked);
  const acks = readAcks();
  let messages = readMessages();
  if (lane) {
    messages = messages.filter((message) => messageTargetsLane(message, lane));
  }
  if (lane && unacked) {
    messages = messages.filter((message) => !isAcked(message, lane, acks));
  }
  messages = messages.slice(-Math.max(1, Number.isFinite(limit) ? limit : 30));
  if (messages.length === 0) {
    process.stdout.write("No messages.\n");
    return;
  }
  process.stdout.write(
    `${messages.map((message) => formatMessage(message, acks, lane)).join("\n\n")}\n`,
  );
}

function cmdAck(args) {
  const lane = normalizeLane(args.lane, "lane");
  const id = String(args.id || "").trim();
  if (!id) {
    throw new Error("Missing --id");
  }
  const messages = readMessages();
  if (!messages.some((message) => message.id === id)) {
    throw new Error(`No message with id ${id}`);
  }
  const acks = readAcks();
  acks[lane] ??= {};
  acks[lane][id] = new Date().toISOString();
  writeAcks(acks);
  process.stdout.write(`acknowledged ${id} as ${lane}\n`);
}

function cmdStatus(args) {
  const lane = args.lane ? normalizeLane(args.lane, "lane") : "";
  const lanes = lane ? [lane] : knownLanes.filter((entry) => entry !== "all");
  const messages = readMessages();
  const acks = readAcks();
  const tasks = readTasks();
  for (const entry of lanes) {
    const inbox = messages.filter((message) => messageTargetsLane(message, entry));
    const unacked = inbox.filter((message) => !isAcked(message, entry, acks));
    const activeTasks = tasks.filter(
      (task) => task.owner === entry && !["done", "cancelled"].includes(task.status),
    );
    const blockedTasks = activeTasks.filter((task) => task.status === "blocked");
    process.stdout.write(
      `${entry}: ${unacked.length} unacked / ${inbox.length} messages; ${activeTasks.length} active tasks (${blockedTasks.length} blocked)\n`,
    );
  }
}

function cmdTaskAdd(args) {
  const from = normalizeLane(args.from || "master", "from");
  const owner = normalizeLane(args.owner || args.to, "owner");
  const title = String(args.title || "").trim();
  const body = String(args.body || "").trim();
  if (!title) {
    throw new Error("Missing --title");
  }
  if (!body) {
    throw new Error("Missing --body");
  }
  const now = new Date().toISOString();
  const task = {
    id: makeTaskId(),
    createdAt: now,
    updatedAt: now,
    from,
    owner,
    title,
    body,
    status: normalizeStatus(args.status, "todo"),
    priority: normalizePriority(args.priority, "normal"),
    branch: currentGitRef(),
    notes: [],
  };
  const tasks = readTasks();
  tasks.push(task);
  writeTasks(tasks);
  process.stdout.write(`task ${task.id} -> ${owner}: ${title}\n`);
}

function formatTask(task) {
  const lines = [
    `${task.id} [${task.priority}] [${task.status}] owner=${task.owner} from=${task.from}`,
    `    ${task.title}`,
    `    ${task.body}`,
    `    updated=${task.updatedAt} branch=${task.branch ?? "unknown"}`,
  ];
  const latestNote = task.notes?.at?.(-1);
  if (latestNote) {
    lines.push(`    latest-note(${latestNote.lane}): ${latestNote.note}`);
  }
  return lines.join("\n");
}

function cmdTaskList(args) {
  const lane = args.lane ? normalizeLane(args.lane, "lane") : "";
  const status = args.status ? normalizeStatus(args.status) : "";
  const limit = Number.parseInt(String(args.limit || "40"), 10);
  let tasks = readTasks();
  if (lane) {
    tasks = tasks.filter((task) => task.owner === lane || lane === "all");
  }
  if (status) {
    tasks = tasks.filter((task) => task.status === status);
  }
  tasks = tasks.slice(-Math.max(1, Number.isFinite(limit) ? limit : 40));
  if (tasks.length === 0) {
    process.stdout.write("No tasks.\n");
    return;
  }
  process.stdout.write(`${tasks.map(formatTask).join("\n\n")}\n`);
}

function cmdTaskUpdate(args) {
  const id = String(args.id || "").trim();
  if (!id) {
    throw new Error("Missing --id");
  }
  const tasks = readTasks();
  const task = tasks.find((entry) => entry.id === id);
  if (!task) {
    throw new Error(`No task with id ${id}`);
  }
  if (args.owner) {
    task.owner = normalizeLane(args.owner, "owner");
  }
  if (args.status) {
    task.status = normalizeStatus(args.status);
  }
  if (args.priority) {
    task.priority = normalizePriority(args.priority);
  }
  const note = String(args.note || "").trim();
  if (note) {
    task.notes ??= [];
    task.notes.push({
      at: new Date().toISOString(),
      lane: args.lane ? normalizeLane(args.lane, "lane") : task.owner,
      note,
    });
  }
  task.updatedAt = new Date().toISOString();
  writeTasks(tasks);
  process.stdout.write(`updated ${task.id} [${task.status}] owner=${task.owner}\n`);
}

async function cmdPoll(args) {
  const lane = normalizeLane(args.lane, "lane");
  const interval = Math.max(2, Number.parseInt(String(args.interval || "10"), 10) || 10);
  for (;;) {
    process.stdout.write(`\n--- ${new Date().toISOString()} ${lane} inbox ---\n`);
    cmdList({ lane, unacked: true, limit: args.limit || "20" });
    await new Promise((resolve) => setTimeout(resolve, interval * 1000));
  }
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  try {
    switch (command) {
      case "post":
        cmdPost(args);
        break;
      case "list":
        cmdList(args);
        break;
      case "ack":
        cmdAck(args);
        break;
      case "status":
        cmdStatus(args);
        break;
      case "poll":
        await cmdPoll(args);
        break;
      case "task-add":
        cmdTaskAdd(args);
        break;
      case "task-list":
        cmdTaskList(args);
        break;
      case "task-update":
        cmdTaskUpdate(args);
        break;
      case "help":
      case "--help":
      case "-h":
      case undefined:
        usage(0);
        break;
      default:
        throw new Error(`Unknown command "${command}"`);
    }
  } catch (err) {
    process.stderr.write(`threadmaster-bus: ${err.message}\n\n`);
    usage(1);
  }
}

await main();
