/**
 * Secrets CLI — Manage encrypted secrets and migrate to PostgreSQL.
 *
 * Commands:
 *   argent secrets list        — List all service keys (masked)
 *   argent secrets migrate     — Migrate JSON secrets to PostgreSQL
 *   argent secrets status      — Show encryption and storage status
 */

import type { Command } from "commander";

export function registerSecretsCli(program: Command): void {
  const secrets = program.command("secrets").description("Encrypted secret management");

  secrets
    .command("list")
    .description("List all service keys (masked)")
    .action(async () => {
      const { readServiceKeys } = await import("../infra/service-keys.js");
      const { decryptSecret, isEncrypted } = await import("../infra/secret-crypto.js");

      const store = readServiceKeys();
      if (store.keys.length === 0) {
        console.log("No service keys configured.");
        return;
      }

      console.log(`\n  Service Keys (${store.keys.length}):\n`);
      for (const key of store.keys) {
        const decrypted = decryptSecret(key.value);
        const masked =
          decrypted.length > 8 ? `${decrypted.slice(0, 4)}...${decrypted.slice(-4)}` : "****";
        const encrypted = isEncrypted(key.value) ? "encrypted" : "PLAINTEXT";
        const status = key.enabled !== false ? "enabled" : "disabled";
        console.log(`  ${key.variable.padEnd(30)} ${masked.padEnd(16)} [${encrypted}] [${status}]`);
      }
      console.log();
    });

  secrets
    .command("migrate")
    .description("Migrate secrets from JSON files to PostgreSQL")
    .action(async () => {
      const { migrateServiceKeysToPg } = await import("../infra/service-keys.js");

      console.log("\nMigrating secrets to PostgreSQL...\n");
      const result = await migrateServiceKeysToPg();

      if (result.error) {
        console.error(`  Error: ${result.error}`);
        process.exitCode = 1;
        return;
      }

      console.log(`  Migrated: ${result.migrated}`);
      console.log(`  Skipped:  ${result.skipped}`);
      console.log("\nDone.\n");
    });

  secrets
    .command("status")
    .description("Show encryption and storage backend status")
    .action(async () => {
      const { hasMasterKey } = await import("../infra/keychain.js");
      const { readServiceKeys } = await import("../infra/service-keys.js");
      const { isEncrypted } = await import("../infra/secret-crypto.js");

      console.log("\n  Secret Store Status:\n");

      // Master key
      const hasKey = hasMasterKey();
      console.log(`  Master key:     ${hasKey ? "present" : "not found"}`);
      console.log(
        `  Key location:   ${process.platform === "darwin" ? "macOS Keychain" : "~/.argentos/.master-key"}`,
      );

      // Service keys encryption status
      const store = readServiceKeys();
      const total = store.keys.length;
      const encrypted = store.keys.filter((k) => isEncrypted(k.value)).length;
      console.log(`  Service keys:   ${total} total, ${encrypted} encrypted`);

      // PG status
      try {
        const { resolveStorageConfig, isPostgresEnabled } =
          await import("../data/storage-config.js");
        const cfg = resolveStorageConfig();
        if (isPostgresEnabled(cfg) && cfg.postgres) {
          const { getPgClient, pgHealthCheck } = await import("../data/pg-client.js");
          const sql = getPgClient(cfg.postgres);
          const health = await pgHealthCheck(sql);
          console.log(`  PostgreSQL:     ${health.ok ? "connected" : "error"}`);
          if (health.ok) {
            // Check if service_keys table has data
            const [{ count }] = await sql`SELECT count(*)::int AS count FROM service_keys`;
            console.log(`  PG secrets:     ${count} service keys in database`);
          }
        } else {
          console.log("  PostgreSQL:     not configured (using JSON files only)");
        }
      } catch {
        console.log("  PostgreSQL:     not available");
      }

      console.log();
    });

  secrets
    .command("policy")
    .description("Show policy for one key or all keys")
    .option("--secret <variable>", "Service key env variable name (e.g. ATERA_API_KEY)")
    .action(async (options: { secret?: string }) => {
      const { listServiceKeyPolicies } = await import("../infra/service-keys.js");
      const policies = listServiceKeyPolicies();
      const secret = options.secret?.trim();
      const selected = secret ? policies.filter((p) => p.variable === secret) : policies;
      if (selected.length === 0) {
        console.log(secret ? `No key found for ${secret}.` : "No service keys configured.");
        return;
      }
      for (const policy of selected) {
        console.log(`\n${policy.variable} (${policy.name})`);
        console.log(`  denyAll: ${policy.denyAll ? "true" : "false"}`);
        console.log(
          `  roles: ${policy.allowedRoles.length > 0 ? policy.allowedRoles.join(", ") : "(none)"}`,
        );
        console.log(
          `  agents: ${policy.allowedAgents.length > 0 ? policy.allowedAgents.join(", ") : "(none)"}`,
        );
        console.log(
          `  teams: ${policy.allowedTeams.length > 0 ? policy.allowedTeams.join(", ") : "(none)"}`,
        );
      }
      console.log();
    });

  secrets
    .command("grant")
    .description("Grant role/agent/team access to a key policy")
    .requiredOption("--secret <variable>", "Service key env variable name")
    .option("--role <role>", "Agent role allowed to access this key")
    .option("--agent <agentId>", "Specific agent id allowed to access this key")
    .option("--team <team>", "Specific team allowed to access this key")
    .action(async (options: { secret: string; role?: string; agent?: string; team?: string }) => {
      const { grantServiceKeyAccess } = await import("../infra/service-keys.js");
      const result = grantServiceKeyAccess({
        variable: options.secret.trim(),
        role: options.role,
        agent: options.agent,
        team: options.team,
      });
      if (!result.updated) {
        console.error(`Error: ${result.reason ?? "grant failed"}`);
        process.exitCode = 1;
        return;
      }
      console.log("Grant applied.\n");
    });

  secrets
    .command("revoke")
    .description("Revoke role/agent/team access from a key policy")
    .requiredOption("--secret <variable>", "Service key env variable name")
    .option("--role <role>", "Agent role to revoke")
    .option("--agent <agentId>", "Specific agent id to revoke")
    .option("--team <team>", "Specific team to revoke")
    .action(async (options: { secret: string; role?: string; agent?: string; team?: string }) => {
      const { revokeServiceKeyAccess } = await import("../infra/service-keys.js");
      const result = revokeServiceKeyAccess({
        variable: options.secret.trim(),
        role: options.role,
        agent: options.agent,
        team: options.team,
      });
      if (!result.updated) {
        console.error(`Error: ${result.reason ?? "revoke failed"}`);
        process.exitCode = 1;
        return;
      }
      console.log("Revoke applied.\n");
    });

  secrets
    .command("restore-key")
    .description("Restore the master encryption key from a backup")
    .argument("<hex>", "64-character hex string (256-bit AES key)")
    .action(async (hex: string) => {
      const { restoreMasterKey } = await import("../infra/keychain.js");
      const result = restoreMasterKey(hex);
      if (!result.ok) {
        console.error(`\n  Error: ${result.error}\n`);
        process.exitCode = 1;
        return;
      }

      // Verify against existing encrypted secrets
      try {
        const { readServiceKeys } = await import("../infra/service-keys.js");
        const { decryptSecret, isEncrypted } = await import("../infra/secret-crypto.js");
        const store = readServiceKeys();
        const encKey = store.keys.find((k) => isEncrypted(k.value));
        if (encKey) {
          decryptSecret(encKey.value); // throws if wrong key
          console.log("\n  Master key restored and verified against existing secrets.");
        } else {
          console.log("\n  Master key restored (no encrypted secrets to verify against).");
        }
      } catch {
        console.error("\n  WARNING: Key stored but does NOT decrypt existing secrets.");
        console.error("  The provided key may be incorrect.\n");
        process.exitCode = 1;
        return;
      }

      console.log(`  Stored: ${result.stored.keychain ? "keychain + " : ""}file`);
      console.log("  Restart the gateway for the change to take effect.\n");
    });

  secrets
    .command("backup-key")
    .description("Display the current master encryption key for backup")
    .action(async () => {
      const { getMasterKeyHex } = await import("../infra/keychain.js");
      const hex = getMasterKeyHex();
      if (!hex) {
        console.error("\n  No master key found. Run `argent gateway install` to generate one.\n");
        process.exitCode = 1;
        return;
      }
      console.log("\n  ┌──────────────────────────────────────────────────────────────────┐");
      console.log("  │ MASTER ENCRYPTION KEY — COPY AND STORE SECURELY                 │");
      console.log("  ├──────────────────────────────────────────────────────────────────┤");
      console.log(`  │ ${hex} │`);
      console.log("  ├──────────────────────────────────────────────────────────────────┤");
      console.log("  │ If lost, ALL encrypted API keys become unrecoverable.           │");
      console.log("  │ Restore: argent secrets restore-key <hex>                        │");
      console.log("  │     or:  Dashboard > Settings > Encryption > Restore Key         │");
      console.log("  └──────────────────────────────────────────────────────────────────┘\n");
    });

  secrets
    .command("audit")
    .description("Query secret audit events")
    .option("--secret <variable>", "Filter by service key variable")
    .option("--actor <actorId>", "Filter by actor id")
    .option("--result <result>", "Filter by result: success|denied|error")
    .option(
      "--action <action>",
      "Filter by action: fetch|denied|create|update|delete|grant|revoke|rotate",
    )
    .option("--limit <n>", "Max events to return (default 50)", "50")
    .action(
      async (options: {
        secret?: string;
        actor?: string;
        result?: "success" | "denied" | "error";
        action?:
          | "fetch"
          | "denied"
          | "create"
          | "update"
          | "delete"
          | "grant"
          | "revoke"
          | "rotate";
        limit: string;
      }) => {
        const { queryServiceKeyAudit } = await import("../infra/service-keys.js");
        const limit = Number.isFinite(Number(options.limit)) ? Number(options.limit) : 50;
        const rows = await queryServiceKeyAudit({
          secretVariable: options.secret?.trim(),
          actorId: options.actor?.trim(),
          result: options.result,
          action: options.action,
          limit,
        });
        if (rows.length === 0) {
          console.log("No audit events found.\n");
          return;
        }
        for (const row of rows) {
          const actor = row.actorId ? ` actor=${row.actorId}` : "";
          const session = row.sessionKey ? ` session=${row.sessionKey}` : "";
          const reason = row.denialReason ? ` reason=${row.denialReason}` : "";
          console.log(
            `${row.timestamp} ${row.action} ${row.secretVariable} result=${row.result}${actor}${session}${reason}`,
          );
        }
        console.log();
      },
    );
}
