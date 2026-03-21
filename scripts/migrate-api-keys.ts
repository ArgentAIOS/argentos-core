#!/usr/bin/env bun
/**
 * Migrate API keys from argent.json env.vars to service-keys.json
 *
 * This script:
 * 1. Reads keys from ~/.argentos/argent.json env.vars section
 * 2. Compares with existing keys in ~/.argentos/service-keys.json
 * 3. Adds missing keys with appropriate categorization
 * 4. Optionally removes keys from argent.json (with --remove flag)
 *
 * Usage:
 *   bun scripts/migrate-api-keys.ts              # Dry run (preview only)
 *   bun scripts/migrate-api-keys.ts --apply      # Apply migration
 *   bun scripts/migrate-api-keys.ts --apply --remove  # Apply + remove from argent.json
 */

import fs from "node:fs";
import path from "node:path";

const HOME = process.env.HOME || "";
const ARGENT_CONFIG_PATH = path.join(HOME, ".argentos", "argent.json");
const SERVICE_KEYS_PATH = path.join(HOME, ".argentos", "service-keys.json");

interface ServiceKey {
  id: string;
  name: string;
  variable: string;
  value: string;
  service: string;
  category: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

interface ServiceKeysFile {
  version: number;
  keys: ServiceKey[];
}

// Categorization rules based on variable name
function categorizeKey(variable: string): { category: string; service: string; name: string } {
  const varLower = variable.toLowerCase();

  // LLM providers
  if (
    varLower.includes("anthropic") ||
    varLower.includes("openai") ||
    varLower.includes("groq") ||
    varLower.includes("deepseek") ||
    varLower.includes("codestral") ||
    varLower.includes("google") ||
    varLower.includes("gemini") ||
    varLower.includes("huggingface") ||
    varLower.includes("openrouter") ||
    varLower.includes("open_router") ||
    varLower.includes("perplexity") ||
    varLower.includes("xai") ||
    varLower.includes("context7") ||
    varLower.includes("codegpt") ||
    varLower.includes("totalgpt") ||
    varLower.includes("ollama")
  ) {
    let service = "Unknown";
    if (varLower.includes("anthropic")) service = "Anthropic";
    else if (varLower.includes("openai")) service = "OpenAI";
    else if (varLower.includes("groq")) service = "Groq";
    else if (varLower.includes("deepseek")) service = "DeepSeek";
    else if (varLower.includes("codestral")) service = "Codestral";
    else if (varLower.includes("google") || varLower.includes("gemini")) service = "Google";
    else if (varLower.includes("huggingface")) service = "Hugging Face";
    else if (varLower.includes("openrouter") || varLower.includes("open_router"))
      service = "OpenRouter";
    else if (varLower.includes("perplexity")) service = "Perplexity";
    else if (varLower.includes("xai")) service = "xAI";
    else if (varLower.includes("context7")) service = "Context7";
    else if (varLower.includes("codegpt")) service = "CodeGPT";
    else if (varLower.includes("totalgpt")) service = "TotalGPT";
    else if (varLower.includes("ollama")) service = "Ollama";

    return {
      category: "LLM",
      service,
      name: `${service} (LLM)`,
    };
  }

  // TTS providers
  if (
    varLower.includes("elevenlabs") ||
    varLower.includes("deepgram") ||
    varLower.includes("resemble")
  ) {
    let service = "Unknown";
    if (varLower.includes("elevenlabs")) service = "ElevenLabs";
    else if (varLower.includes("deepgram")) service = "Deepgram";
    else if (varLower.includes("resemble")) service = "Resemble AI";

    return {
      category: "TTS",
      service,
      name: `${service} (TTS)`,
    };
  }

  // Search providers
  if (
    varLower.includes("brave") ||
    varLower.includes("bing") ||
    varLower.includes("exa") ||
    varLower.includes("serpapi") ||
    varLower.includes("serper") ||
    varLower.includes("scale_serp") ||
    varLower.includes("peekapoo")
  ) {
    let service = "Unknown";
    if (varLower.includes("brave")) service = "Brave";
    else if (varLower.includes("bing")) service = "Bing";
    else if (varLower.includes("exa")) service = "Exa";
    else if (varLower.includes("serpapi")) service = "SerpAPI";
    else if (varLower.includes("serper")) service = "Serper";
    else if (varLower.includes("scale_serp")) service = "ScaleSERP";
    else if (varLower.includes("peekapoo")) service = "Peekapoo";

    return {
      category: "Search",
      service,
      name: `${service} (Search)`,
    };
  }

  // Media/Video providers
  if (
    varLower.includes("piapi") ||
    varLower.includes("kling") ||
    varLower.includes("heygen") ||
    varLower.includes("fal") ||
    varLower.includes("replicate") ||
    varLower.includes("imgbb") ||
    varLower.includes("eight_sleep") ||
    varLower.includes("synesthesia")
  ) {
    let service = "Unknown";
    if (varLower.includes("piapi") || varLower.includes("kling")) service = "PiAPI/Kling";
    else if (varLower.includes("heygen")) service = "HeyGen";
    else if (varLower.includes("fal")) service = "FAL";
    else if (varLower.includes("replicate")) service = "Replicate";
    else if (varLower.includes("imgbb")) service = "ImgBB";
    else if (varLower.includes("eight_sleep")) service = "Eight Sleep";
    else if (varLower.includes("synesthesia")) service = "Synesthesia";

    return {
      category: "Media",
      service,
      name: `${service} (Media)`,
    };
  }

  // Social/Communication
  if (varLower.includes("moltyverse")) {
    return {
      category: "Social",
      service: "Moltyverse",
      name: "Moltyverse",
    };
  }

  // Infrastructure/Dev tools
  if (
    varLower.includes("github") ||
    varLower.includes("e2b") ||
    varLower.includes("cloudflare") ||
    varLower.includes("ngrok") ||
    varLower.includes("netlify") ||
    varLower.includes("netfly") ||
    varLower.includes("pinecone") ||
    varLower.includes("langchain")
  ) {
    let service = "Unknown";
    if (varLower.includes("github")) service = "GitHub";
    else if (varLower.includes("e2b")) service = "E2B";
    else if (varLower.includes("cloudflare")) service = "Cloudflare";
    else if (varLower.includes("ngrok")) service = "Ngrok";
    else if (varLower.includes("netlify") || varLower.includes("netfly")) service = "Netlify";
    else if (varLower.includes("pinecone")) service = "Pinecone";
    else if (varLower.includes("langchain")) service = "LangChain";

    return {
      category: "Infrastructure",
      service,
      name: `${service} (Infrastructure)`,
    };
  }

  // Email/Communication
  if (varLower.includes("mailgun")) {
    return {
      category: "Social",
      service: "Mailgun",
      name: "Mailgun (Email)",
    };
  }

  // Home automation
  if (varLower.includes("openhue") || varLower.includes("sonoscli")) {
    const service = varLower.includes("openhue") ? "OpenHue" : "Sonos";
    return {
      category: "Home Automation",
      service,
      name: `${service} (Home)`,
    };
  }

  // CMS/Web tools
  if (varLower.includes("divi") || varLower.includes("tinymce")) {
    const service = varLower.includes("divi") ? "Divi" : "TinyMCE";
    return {
      category: "Web Tools",
      service,
      name: service,
    };
  }

  // Maps/Location
  if (
    varLower.includes("maps") ||
    varLower.includes("vision") ||
    varLower.includes("search_engine")
  ) {
    return {
      category: "Maps & Location",
      service: "Google",
      name: "Google Maps/Vision",
    };
  }

  // Text tools
  if (varLower.includes("jina") || varLower.includes("sag")) {
    const service = varLower.includes("jina") ? "Jina AI" : "SAG";
    return {
      category: "Text Processing",
      service,
      name: service,
    };
  }

  // AI content/inception
  if (varLower.includes("inception")) {
    return {
      category: "AI Tools",
      service: "Inception",
      name: "Inception AI",
    };
  }

  // Default to "Other"
  return {
    category: "Other",
    service: "",
    name: variable,
  };
}

function generateKeyId(variable: string): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `sk-${timestamp}-${random}`;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = !args.includes("--apply");
  const removeFromConfig = args.includes("--remove");

  console.log("🔑 API Key Migration Tool");
  console.log("==========================\n");

  if (dryRun) {
    console.log("🔍 DRY RUN MODE - No changes will be made");
    console.log("   Use --apply to actually perform the migration\n");
  }

  // Read argent.json
  if (!fs.existsSync(ARGENT_CONFIG_PATH)) {
    console.error(`❌ Config file not found: ${ARGENT_CONFIG_PATH}`);
    process.exit(1);
  }

  const argentConfig = JSON.parse(fs.readFileSync(ARGENT_CONFIG_PATH, "utf-8"));
  const envVars = argentConfig.env?.vars || {};

  console.log(`📖 Found ${Object.keys(envVars).length} keys in argent.json env.vars`);

  // Read service-keys.json
  let serviceKeysData: ServiceKeysFile;
  if (fs.existsSync(SERVICE_KEYS_PATH)) {
    serviceKeysData = JSON.parse(fs.readFileSync(SERVICE_KEYS_PATH, "utf-8"));
    console.log(`📖 Found ${serviceKeysData.keys.length} existing keys in service-keys.json\n`);
  } else {
    serviceKeysData = { version: 1, keys: [] };
    console.log("📝 service-keys.json not found, will create new file\n");
  }

  // Build set of existing variable names
  const existingVariables = new Set(serviceKeysData.keys.map((k) => k.variable));

  // Find keys to migrate
  const keysToMigrate: Array<{ variable: string; value: string }> = [];

  for (const [variable, value] of Object.entries(envVars)) {
    if (typeof value !== "string") continue;
    if (existingVariables.has(variable)) continue;

    keysToMigrate.push({ variable, value });
  }

  if (keysToMigrate.length === 0) {
    console.log("✅ All keys are already in service-keys.json - nothing to migrate!");
    return;
  }

  console.log(`🔄 Will migrate ${keysToMigrate.length} keys:\n`);

  // Group by category for display
  const byCategory: Record<string, Array<{ variable: string; value: string }>> = {};

  for (const key of keysToMigrate) {
    const { category } = categorizeKey(key.variable);
    if (!byCategory[category]) byCategory[category] = [];
    byCategory[category].push(key);
  }

  for (const [category, keys] of Object.entries(byCategory)) {
    console.log(`  ${category}:`);
    for (const key of keys) {
      const { service, name } = categorizeKey(key.variable);
      console.log(`    - ${key.variable} → ${name} [${service}]`);
    }
    console.log();
  }

  if (dryRun) {
    console.log("\n✋ Dry run complete. Use --apply to perform the migration.");
    return;
  }

  // Perform migration
  const now = new Date().toISOString();

  for (const { variable, value } of keysToMigrate) {
    const { category, service, name } = categorizeKey(variable);

    const newKey: ServiceKey = {
      id: generateKeyId(variable),
      name,
      variable,
      value,
      service,
      category,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    };

    serviceKeysData.keys.push(newKey);
  }

  // Write service-keys.json
  fs.writeFileSync(SERVICE_KEYS_PATH, JSON.stringify(serviceKeysData, null, 2) + "\n", "utf-8");
  console.log(`✅ Updated ${SERVICE_KEYS_PATH} with ${keysToMigrate.length} new keys`);

  // Optionally remove from argent.json
  if (removeFromConfig) {
    for (const { variable } of keysToMigrate) {
      delete argentConfig.env.vars[variable];
    }

    fs.writeFileSync(ARGENT_CONFIG_PATH, JSON.stringify(argentConfig, null, 2) + "\n", "utf-8");
    console.log(`✅ Removed ${keysToMigrate.length} keys from ${ARGENT_CONFIG_PATH}`);
    console.log(
      "\n⚠️  Note: Restart the gateway for env var changes to take effect: argent gateway restart",
    );
  } else {
    console.log(
      `\nℹ️  Keys remain in argent.json for backward compatibility. Use --remove to clean up.`,
    );
  }

  console.log("\n🎉 Migration complete!");
}

main().catch((err) => {
  console.error("❌ Error:", err);
  process.exit(1);
});
