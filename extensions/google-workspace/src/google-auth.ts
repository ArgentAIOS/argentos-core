import { google, type admin_reports_v1, type admin_directory_v1 } from "googleapis";
import { existsSync, readFileSync } from "node:fs";
import type { PluginConfig } from "./types.js";

const SCOPES = [
  "https://www.googleapis.com/auth/admin.reports.usage.readonly",
  "https://www.googleapis.com/auth/admin.reports.audit.readonly",
  "https://www.googleapis.com/auth/admin.directory.user.readonly",
];

export type ApiClients = {
  reports: admin_reports_v1.Admin;
  directory: admin_directory_v1.Admin;
};

let cachedClients: ApiClients | null = null;
let cachedConfigHash = "";

function configHash(cfg: PluginConfig): string {
  return `${cfg.serviceAccountKeyPath}:${cfg.adminEmail}:${cfg.domain}`;
}

/**
 * Create authenticated Google API clients using service account with domain-wide delegation.
 * Clients are cached as a lazy singleton — recreated only if config changes.
 */
export function getApiClients(config: PluginConfig): ApiClients {
  const hash = configHash(config);
  if (cachedClients && cachedConfigHash === hash) {
    return cachedClients;
  }

  const keyPath = config.serviceAccountKeyPath;
  if (!existsSync(keyPath)) {
    throw new Error(`Service account key file not found: ${keyPath}`);
  }

  const keyFileContent = JSON.parse(readFileSync(keyPath, "utf-8"));

  const auth = new google.auth.JWT({
    email: keyFileContent.client_email,
    key: keyFileContent.private_key,
    scopes: SCOPES,
    subject: config.adminEmail,
  });

  const reports = google.admin({ version: "reports_v1", auth });
  const directory = google.admin({ version: "directory_v1", auth });

  cachedClients = { reports, directory };
  cachedConfigHash = hash;
  return cachedClients;
}

/** Test connectivity by listing a single user. Throws on auth failure. */
export async function testConnectivity(config: PluginConfig): Promise<string> {
  const { directory } = getApiClients(config);
  const res = await directory.users.list({
    domain: config.domain,
    maxResults: 1,
    projection: "basic",
  });
  const count = res.data.users?.length ?? 0;
  return `Connected successfully. Domain: ${config.domain}, users found: ${count > 0 ? "yes" : "no"}`;
}
