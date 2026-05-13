/**
 * `argent doctor` check for the 1Password Service Account backend.
 *
 * Triggers ONLY when at least one service-key entry stores a 1Password
 * reference (`op://...`). For users not opting in, this check is a no-op.
 *
 * What we verify:
 *   1. `op` CLI is reachable
 *   2. OP_SERVICE_ACCOUNT_TOKEN is present (env or argent's secret store)
 *   3. A sample reference resolves (uses the first detected op:// entry)
 *
 * Failures emit a single `note` block with clear remediation; they never
 * throw or block the rest of the doctor run.
 */

import { formatCliCommand } from "../cli/command-format.js";
import {
  isOnePasswordRef,
  probeOnePasswordHealth,
  resolveServiceAccountToken,
} from "../infra/onepassword-resolver.js";
import { decryptSecret } from "../infra/secret-crypto.js";
import { readServiceKeys } from "../infra/service-keys.js";
import { note } from "../terminal/note.js";

export interface OnePasswordDoctorReport {
  active: boolean;
  refsDetected: number;
  installed: boolean;
  tokenPresent: boolean;
  sampleOk?: boolean;
  errors: string[];
}

export function inspectOnePasswordBackend(): OnePasswordDoctorReport {
  const store = readServiceKeys();
  // Detect any entries that store an op://... reference (after decryption).
  let firstRef: string | undefined;
  let refsDetected = 0;
  for (const entry of store.keys) {
    if (!entry.value || entry.enabled === false) continue;
    try {
      const decrypted = decryptSecret(entry.value);
      if (isOnePasswordRef(decrypted)) {
        refsDetected += 1;
        if (!firstRef) firstRef = decrypted;
      }
    } catch {
      // Skip undecryptable entries — they're flagged elsewhere by doctor.
    }
  }

  const report: OnePasswordDoctorReport = {
    active: refsDetected > 0,
    refsDetected,
    installed: false,
    tokenPresent: false,
    errors: [],
  };

  if (!report.active) return report;

  const probe = probeOnePasswordHealth({ sampleRef: firstRef });
  report.installed = probe.installed;
  report.tokenPresent = probe.tokenPresent;
  if (probe.sample) report.sampleOk = probe.sample.ok;

  if (!probe.installed) {
    report.errors.push(
      "- `op` CLI not found on PATH but 1Password references exist in service-keys.\n" +
        "  Install: https://developer.1password.com/docs/cli/get-started/",
    );
  }
  if (!probe.tokenPresent) {
    report.errors.push(
      "- OP_SERVICE_ACCOUNT_TOKEN is missing.\n" +
        `  Fix: ${formatCliCommand("argent secrets backend 1password setup --token <token>")}\n` +
        "  Or export OP_SERVICE_ACCOUNT_TOKEN in the gateway environment.",
    );
  }
  if (firstRef && probe.sample && !probe.sample.ok) {
    report.errors.push(
      `- Sample 1Password resolution failed (${probe.sample.errorCode ?? "unknown"}):` +
        ` ${probe.sample.errorMessage ?? "(no message)"}\n` +
        `  Run: ${formatCliCommand("argent secrets backend 1password doctor --sample <ref>")} for details.`,
    );
  }
  return report;
}

export function noteOnePasswordBackend(): void {
  const report = inspectOnePasswordBackend();
  if (!report.active) return;

  const headline = `1Password backend in use (${report.refsDetected} key${
    report.refsDetected === 1 ? "" : "s"
  } via op://)`;

  if (report.errors.length === 0) {
    const sampleSuffix = report.sampleOk === true ? "; sample resolution succeeded" : "";
    const tokenSummary = `token=${report.tokenPresent ? "present" : "missing"}`;
    note(`${headline}\n  ok — op CLI present; ${tokenSummary}${sampleSuffix}.`, "1Password");
    return;
  }
  // Even when present, the token itself is never echoed —
  // resolveServiceAccountToken returns a string we only test for null.
  const _tokenIsPresent = resolveServiceAccountToken() !== null;
  void _tokenIsPresent;
  note([headline, ...report.errors].join("\n"), "1Password");
}
