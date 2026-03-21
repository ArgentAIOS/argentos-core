#!/usr/bin/env bun
/**
 * Re-authenticate OpenAI Codex OAuth to get a new token with api.responses.write scope.
 * Usage: bun scripts/reauth-codex.ts
 */

import { exec } from "node:child_process";
import { randomBytes, createHash } from "node:crypto";
import { writeFile, readFile, mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import * as readline from "node:readline";
import { URL, URLSearchParams } from "node:url";

const AGENT_DIR = join(homedir(), ".argentos", "agents", "main", "agent");
const AUTH_PROFILES_PATH = join(AGENT_DIR, "auth-profiles.json");
const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const REDIRECT_URI = "http://localhost:1455/callback";
const AUTH_URL = "https://auth.openai.com/authorize";
const TOKEN_URL = "https://auth.openai.com/oauth/token";
const SCOPE = "openid profile email offline_access api.connectors.read api.connectors.invoke";
const AUDIENCE = "https://api.openai.com/v1";

function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function main() {
  // Generate PKCE
  const verifier = randomBytes(64).toString("base64url").slice(0, 128);
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const state = randomBytes(32).toString("hex");

  const params = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: SCOPE,
    audience: AUDIENCE,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });

  const authUrl = `${AUTH_URL}?${params.toString()}`;

  // Start callback server
  let resolveCode: (code: string) => void;
  const codePromise = new Promise<string>((resolve) => {
    resolveCode = resolve;
  });

  const server = createServer((req, res) => {
    const url = new URL(req.url || "/", "http://localhost:1455");
    if (url.pathname === "/callback") {
      const code = url.searchParams.get("code");
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<html><body><h1>Success! You can close this tab.</h1></body></html>");
      if (code) resolveCode(code);
    }
  });

  server.listen(1455, "127.0.0.1", () => {
    console.log("Callback server listening on port 1455\n");
  });

  console.log("Opening browser for OpenAI authentication...");
  console.log(`Scope requested: ${SCOPE}\n`);
  exec(`open "${authUrl}"`);

  console.log("Waiting for browser callback...");
  console.log("If the browser doesn't redirect, paste the full redirect URL below.\n");

  // Race: callback server vs manual paste
  const manualPromise = (async () => {
    await new Promise((r) => setTimeout(r, 10000)); // wait 10s before offering manual
    const url = await prompt("Paste redirect URL (or press Enter to keep waiting): ");
    if (!url) {
      // Keep waiting for server callback
      return codePromise;
    }
    const parsed = new URL(url);
    return parsed.searchParams.get("code") || "";
  })();

  const code = await Promise.race([codePromise, manualPromise]);
  server.close();

  if (!code) {
    console.error("No authorization code received. Aborting.");
    process.exit(1);
  }

  console.log("\nExchanging code for tokens...");

  // Exchange code for tokens
  const tokenBody = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: CLIENT_ID,
    code_verifier: verifier,
    code,
    redirect_uri: REDIRECT_URI,
  });

  const tokenRes = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: tokenBody.toString(),
  });

  if (!tokenRes.ok) {
    const text = await tokenRes.text();
    console.error(`Token exchange failed (${tokenRes.status}): ${text}`);
    process.exit(1);
  }

  const tokenData = (await tokenRes.json()) as any;
  console.log(`\nToken received!`);
  console.log(`  Scope: ${tokenData.scope}`);
  console.log(`  Expires in: ${tokenData.expires_in}s`);

  // Update auth-profiles.json
  let profiles: any = {};
  try {
    profiles = JSON.parse(await readFile(AUTH_PROFILES_PATH, "utf-8"));
  } catch {
    await mkdir(AGENT_DIR, { recursive: true });
  }

  profiles.profiles = profiles.profiles || {};
  const existingProfile = profiles.profiles["openai-codex:default"] || {};
  profiles.profiles["openai-codex:default"] = {
    type: "oauth",
    provider: "openai-codex",
    access: tokenData.access_token,
    refresh: tokenData.refresh_token || existingProfile.refresh,
    expires: tokenData.expires_in
      ? Date.now() + tokenData.expires_in * 1000
      : existingProfile.expires,
    accountId: existingProfile.accountId,
  };

  profiles.providerProfiles = profiles.providerProfiles || {};
  profiles.providerProfiles["openai-codex"] = profiles.providerProfiles["openai-codex"] || [
    "openai-codex:default",
  ];
  profiles.defaultProfiles = profiles.defaultProfiles || {};
  profiles.defaultProfiles["openai-codex"] = "openai-codex:default";

  await writeFile(AUTH_PROFILES_PATH, JSON.stringify(profiles, null, 4) + "\n");

  console.log(`\nCredentials written to ${AUTH_PROFILES_PATH}`);
  console.log("\nRestart the gateway:");
  console.log("  launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/ai.argent.gateway.plist");
  console.log("  launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/ai.argent.gateway.plist");
}

main().catch((err) => {
  console.error("Failed:", err.message);
  process.exit(1);
});
