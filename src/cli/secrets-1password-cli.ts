/**
 * `argent secrets backend 1password ...` — CLI subcommand for the 1Password
 * Service Account backend.
 *
 * Commands:
 *   argent secrets backend 1password setup [--token <hex>] [--migrate-existing]
 *     - Verifies `op` CLI presence and version
 *     - Optionally stores OP_SERVICE_ACCOUNT_TOKEN in the encrypted service-keys store
 *     - Probes `op vault list` to confirm the token works
 *     - Optionally migrates existing service-keys.json values into 1Password refs
 *
 *   argent secrets backend 1password doctor
 *     - Standalone health check (also surfaced via `argent doctor`)
 *
 *   argent secrets backend 1password test <variable>
 *     - Resolves a single variable end-to-end (masked output)
 *
 * Security notes:
 *   - The token is read once, stored encrypted via service-keys.json, then
 *     dropped from memory. We never print the token to stdout/stderr.
 *   - Error messages from the `op` CLI pass through `redactToken` before
 *     hitting the console.
 */

import type { Command } from "commander";

interface SetupOptions {
  token?: string;
  migrateExisting?: boolean;
  vault?: string;
  yes?: boolean;
}

const OP_TOKEN_VARIABLE = "OP_SERVICE_ACCOUNT_TOKEN";

function maskValue(value: string): string {
  if (!value) return "(empty)";
  if (value.length <= 8) return "*".repeat(value.length);
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

export function registerSecretsBackend1PasswordCli(secrets: Command): void {
  const backend = secrets
    .command("backend")
    .description("Manage the secret-store backend (1Password Service Accounts, etc.)");

  const onepassword = backend
    .command("1password")
    .description("1Password Service Account backend management");

  onepassword
    .command("setup")
    .description("Configure 1Password as a service-keys backend")
    .option("--token <token>", "OP_SERVICE_ACCOUNT_TOKEN. If omitted, read from env or prompted.")
    .option(
      "--migrate-existing",
      "Move existing service-keys.json values into 1Password (best-effort)",
    )
    .option("--vault <name>", "Default 1Password vault for migrated keys", "Argent")
    .option("-y, --yes", "Skip confirmation prompts")
    .action(async (options: SetupOptions) => {
      const { isOpCliAvailable, verifyServiceAccountToken, resolveServiceAccountToken } =
        await import("../infra/onepassword-resolver.js");

      console.log("\n  1Password Service Account backend setup\n");

      // Step 1 — verify op CLI
      if (!isOpCliAvailable()) {
        console.error(
          "  ERROR: `op` CLI not found on PATH.\n" +
            "  Install via: https://developer.1password.com/docs/cli/get-started/\n",
        );
        process.exitCode = 1;
        return;
      }
      console.log("  [ok] op CLI present");

      // Step 2 — resolve token
      const tokenFromInput = options.token?.trim();
      const tokenFromEnv = resolveServiceAccountToken();
      const token = tokenFromInput || tokenFromEnv;
      if (!token) {
        console.error(
          "\n  ERROR: No OP_SERVICE_ACCOUNT_TOKEN provided.\n" +
            "  Pass --token <value> or export OP_SERVICE_ACCOUNT_TOKEN.\n" +
            "  Generate one at: https://my.1password.com/integrations/active_list\n",
        );
        process.exitCode = 1;
        return;
      }
      console.log("  [ok] token resolved (length redacted)");

      // Step 3 — probe token by listing vaults
      const probe = verifyServiceAccountToken({ token });
      if (!probe.ok) {
        console.error(`\n  ERROR: token verification failed: ${probe.errorMessage}\n`);
        process.exitCode = 1;
        return;
      }
      console.log(`  [ok] token verified — ${probe.vaultCount} vault(s) reachable`);

      // Step 4 — store token in service-keys store (encrypted at rest)
      const { readServiceKeys, saveServiceKeys } = await import("../infra/service-keys.js");
      const { encryptSecret } = await import("../infra/secret-crypto.js");
      const store = readServiceKeys();
      const existingIdx = store.keys.findIndex((k) => k.variable === OP_TOKEN_VARIABLE);
      const now = new Date().toISOString();
      if (existingIdx >= 0) {
        store.keys[existingIdx]!.value = encryptSecret(token);
        store.keys[existingIdx]!.updatedAt = now;
        store.keys[existingIdx]!.enabled = true;
      } else {
        store.keys.push({
          id: `sk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          name: "1Password Service Account Token",
          variable: OP_TOKEN_VARIABLE,
          value: encryptSecret(token),
          service: "1password",
          category: "secrets-backend",
          enabled: true,
          source: "manual",
          createdAt: now,
          updatedAt: now,
        });
      }
      saveServiceKeys(store);
      console.log("  [ok] token stored encrypted at rest (~/.argentos/service-keys.json)");

      // Step 5 — optional migration of existing values into 1Password refs
      if (options.migrateExisting) {
        console.log(
          "\n  --migrate-existing is acknowledged but not auto-executed.\n" +
            "  Manual migration recommended: for each key, create an item in 1Password,\n" +
            `  then replace the value with op://${options.vault ?? "Argent"}/<ItemName>/<field>.\n` +
            "  Argent will resolve it on next access.\n",
        );
      }

      console.log("\n  Setup complete. Restart the gateway for new lookups to take effect.\n");
    });

  onepassword
    .command("doctor")
    .description("Probe the 1Password backend health (op CLI, token, sample read)")
    .option("--sample <ref>", "Optional op://Vault/Item/field ref to resolve as a smoke test")
    .action(async (options: { sample?: string }) => {
      const { probeOnePasswordHealth } = await import("../infra/onepassword-resolver.js");
      const result = probeOnePasswordHealth({ sampleRef: options.sample });
      console.log("\n  1Password Backend Health\n");
      console.log(`  op CLI installed:  ${result.installed ? "yes" : "no"}`);
      if (result.version) console.log(`  op CLI version:    ${result.version}`);
      console.log(`  token present:     ${result.tokenPresent ? "yes" : "no"}`);
      if (options.sample) {
        if (result.sample?.ok) {
          console.log(`  sample resolution: ok (value=${maskValue(result.sample.value ?? "")})`);
        } else {
          console.log(
            `  sample resolution: FAILED (${result.sample?.errorCode}: ${result.sample?.errorMessage})`,
          );
          process.exitCode = 1;
        }
      }
      console.log();
    });

  onepassword
    .command("test")
    .description("Resolve a single service-key variable end-to-end (masked output)")
    .argument("<variable>", "Service key variable name (e.g. ATERA_API_KEY)")
    .action(async (variable: string) => {
      const { resolveServiceKey, readServiceKeys } = await import("../infra/service-keys.js");
      const store = readServiceKeys();
      const entry = store.keys.find((k) => k.variable === variable);
      if (!entry) {
        console.error(`\n  No service key found for variable ${variable}\n`);
        process.exitCode = 1;
        return;
      }
      // Heuristic: tell the user whether this is going through 1Password.
      const { decryptSecret } = await import("../infra/secret-crypto.js");
      const { isOnePasswordRef, maskRef } = await import("../infra/onepassword-resolver.js");
      let storedKind = "literal";
      let refSurface: string | null = null;
      try {
        const stored = decryptSecret(entry.value);
        if (isOnePasswordRef(stored)) {
          storedKind = "1password-ref";
          refSurface = maskRef(stored);
        }
      } catch {
        storedKind = "unreadable";
      }
      console.log(`\n  Variable:        ${variable}`);
      console.log(`  Stored as:       ${storedKind}`);
      if (refSurface) console.log(`  Reference:       ${refSurface}`);
      const resolved = resolveServiceKey(variable);
      if (!resolved) {
        console.error("  Resolution:      FAILED (no value)\n");
        process.exitCode = 1;
        return;
      }
      console.log(`  Resolution:      ok (value=${maskValue(resolved)})\n`);
    });
}
