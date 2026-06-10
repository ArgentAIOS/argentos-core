/**
 * Organization secret synchronization
 *
 * Fetches shared secrets from the ArgentOS marketplace and upserts them
 * into the local service-keys.json store. Manual keys are never overwritten.
 */

import { bulkUpsertServiceKeys, type UpsertResult } from "../infra/service-keys.js";
import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("secret-sync");

interface OrgSecretEntry {
  variable: string;
  value: string;
  name?: string;
  service?: string;
  category?: string;
}

interface SyncResponse {
  orgId: string;
  orgName: string;
  secrets: OrgSecretEntry[];
  syncedAt: string;
}

export interface SyncResult {
  synced: number;
  skipped: number;
  errors: string[];
}

/**
 * Fetch organization secrets from the marketplace and upsert into local key store.
 *
 * @param apiUrl  Marketplace API base URL (e.g. "https://license.argentos.ai/api")
 * @param instanceToken  JWT obtained via instance authentication
 */
export async function syncOrgSecrets(apiUrl: string, instanceToken: string): Promise<SyncResult> {
  const result: SyncResult = { synced: 0, skipped: 0, errors: [] };

  let data: SyncResponse;
  try {
    const url = `${apiUrl}/enterprise/secrets/sync`;
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${instanceToken}`,
        "User-Agent": "ArgentOS-SecretSync/1.0",
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      const msg = `Marketplace returned ${response.status}: ${body}`.trim();
      log.warn("secret sync fetch failed", { status: response.status });
      result.errors.push(msg);
      return result;
    }

    data = (await response.json()) as SyncResponse;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn("secret sync network error", { error: msg });
    result.errors.push(`Network error: ${msg}`);
    return result;
  }

  if (!Array.isArray(data.secrets) || data.secrets.length === 0) {
    log.info("secret sync: no secrets to sync", { orgId: data.orgId });
    return result;
  }

  let upsertResults: UpsertResult[];
  try {
    upsertResults = bulkUpsertServiceKeys(
      data.secrets.map((s) => ({
        variable: s.variable,
        value: s.value,
        name: s.name,
        service: s.service,
        category: s.category,
        source: "org-sync" as const,
      })),
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn("secret sync upsert error", { error: msg });
    result.errors.push(`Upsert error: ${msg}`);
    return result;
  }

  for (const r of upsertResults) {
    if (r.action === "created" || r.action === "updated") {
      result.synced++;
    } else {
      result.skipped++;
    }
  }

  log.info("secret sync complete", {
    orgId: data.orgId,
    orgName: data.orgName,
    synced: result.synced,
    skipped: result.skipped,
    total: data.secrets.length,
  });

  return result;
}
