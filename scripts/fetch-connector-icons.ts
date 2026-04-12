#!/usr/bin/env bun
/**
 * Fetch connector icons from Simple Icons CDN and normalize to square SVGs.
 *
 * Usage: bun scripts/fetch-connector-icons.ts
 *
 * Output: tools/aos/icons/{connector-slug}.svg  (monochrome, 24x24 viewBox)
 *         tools/aos/icons/{connector-slug}-color.svg  (brand color fill)
 *         tools/aos/icons/manifest.json  (slug → brand color + name mapping)
 *
 * Simple Icons CDN: https://cdn.simpleicons.org/{slug}/{color}
 * All icons are 24x24 viewBox, single path, perfect for uniform catalog.
 */

import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ICONS_DIR = join(import.meta.dirname, "..", "tools", "aos", "icons");
const CDN_BASE = "https://cdn.simpleicons.org";

// Connector name → Simple Icons slug mapping
// See https://simpleicons.org/ for available slugs
const CONNECTOR_MAP: Record<string, { slug: string; name: string; color?: string }> = {
  // CRM
  salesforce: { slug: "salesforce", name: "Salesforce" },
  pipedrive: { slug: "pipedrive", name: "Pipedrive" },
  close: { slug: "close", name: "Close" },
  hubspot: { slug: "hubspot", name: "HubSpot" },

  // Project Management
  jira: { slug: "jira", name: "Jira" },
  clickup: { slug: "clickup", name: "ClickUp" },
  asana: { slug: "asana", name: "Asana" },
  linear: { slug: "linear", name: "Linear" },
  monday: { slug: "monday", name: "Monday.com" },
  trello: { slug: "trello", name: "Trello" },
  notion: { slug: "notion", name: "Notion" },

  // Communication
  slack: { slug: "slack", name: "Slack" },
  discord: { slug: "discord", name: "Discord" },
  teams: { slug: "microsoftteams", name: "Microsoft Teams" },
  twilio: { slug: "twilio", name: "Twilio" },

  // Email
  sendgrid: { slug: "sendgrid", name: "SendGrid" },
  resend: { slug: "resend", name: "Resend" },
  klaviyo: { slug: "klaviyo", name: "Klaviyo" },
  mailchimp: { slug: "mailchimp", name: "Mailchimp" },

  // Commerce
  stripe: { slug: "stripe", name: "Stripe" },
  square: { slug: "square", name: "Square" },
  woocommerce: { slug: "woocommerce", name: "WooCommerce" },
  shopify: { slug: "shopify", name: "Shopify" },

  // Documents & Storage
  "google-drive": { slug: "googledrive", name: "Google Drive" },
  dropbox: { slug: "dropbox", name: "Dropbox" },
  box: { slug: "box", name: "Box" },
  wordpress: { slug: "wordpress", name: "WordPress" },

  // Database
  supabase: { slug: "supabase", name: "Supabase" },
  neon: { slug: "neon", name: "Neon" },
  pinecone: { slug: "pinecone", name: "Pinecone" },

  // AI
  openai: { slug: "openai", name: "OpenAI" },
  anthropic: { slug: "anthropic", name: "Anthropic" },

  // Voice
  elevenlabs: { slug: "elevenlabs", name: "ElevenLabs" },

  // Accounting
  xero: { slug: "xero", name: "Xero" },
  quickbooks: { slug: "quickbooks", name: "QuickBooks" },

  // MSP / IT
  pagerduty: { slug: "pagerduty", name: "PagerDuty" },

  // Scheduling
  calendly: { slug: "calendly", name: "Calendly" },

  // Social
  buffer: { slug: "buffer", name: "Buffer" },
  hootsuite: { slug: "hootsuite", name: "Hootsuite" },

  // Automation
  zapier: { slug: "zapier", name: "Zapier" },
  n8n: { slug: "n8n", name: "n8n" },

  // Developer
  github: { slug: "github", name: "GitHub" },
  airtable: { slug: "airtable", name: "Airtable" },

  // Google
  google: { slug: "google", name: "Google" },

  // Microsoft
  m365: { slug: "microsoft365", name: "Microsoft 365" },

  // Firecrawl
  firecrawl: { slug: "firecrawl", name: "Firecrawl" },
};

// Connectors NOT on Simple Icons — need manual sourcing
const MANUAL_SOURCING: Record<string, { name: string; reason: string }> = {
  dart: { name: "Dart (PM)", reason: "Dart PM tool, not the language — no Simple Icons entry" },
  connectwise: { name: "ConnectWise", reason: "Not on Simple Icons" },
  make: { name: "Make (Integromat)", reason: "Not on Simple Icons as 'make'" },
  nanob: { name: "NanoB", reason: "Not on Simple Icons" },
  "google-places": { name: "Google Places", reason: "Use Google Maps icon or Google icon variant" },

  // Connectors without Simple Icons entries — source manually if they ship.
};

async function fetchIcon(slug: string): Promise<string | null> {
  try {
    const res = await fetch(`${CDN_BASE}/${slug}`);
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

async function fetchIconWithColor(slug: string, color: string): Promise<string | null> {
  try {
    const res = await fetch(`${CDN_BASE}/${slug}/${color}`);
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

// Wrap raw SVG path in a padded square container for uniform display
function normalizeToSquare(svg: string, brandColor?: string): { mono: string; color: string } {
  // Simple Icons SVGs are already 24x24 viewBox with a single path.
  // We wrap them in a 32x32 viewBox with 4px padding for breathing room.
  const pathMatch = svg.match(/<path\s+d="([^"]+)"/);
  if (!pathMatch) return { mono: svg, color: svg };

  const d = pathMatch[1];
  const fill = brandColor || "#FFFFFF";

  const mono = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-4 -4 32 32" width="128" height="128">
  <path d="${d}" fill="currentColor"/>
</svg>`;

  const color = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-4 -4 32 32" width="128" height="128">
  <path d="${d}" fill="${fill}"/>
</svg>`;

  return { mono, color };
}

async function main() {
  mkdirSync(ICONS_DIR, { recursive: true });

  const manifest: Record<
    string,
    {
      name: string;
      hasIcon: boolean;
      source: "simpleicons" | "manual";
      brandColor?: string;
    }
  > = {};

  console.log("Fetching connector icons from Simple Icons CDN...\n");

  // Fetch from Simple Icons
  const entries = Object.entries(CONNECTOR_MAP);
  let fetched = 0;
  let failed = 0;

  for (const [connectorId, { slug, name, color }] of entries) {
    const svg = await fetchIcon(slug);
    if (svg) {
      // Extract brand color from the SVG or use provided color
      // Simple Icons CDN returns black by default; we fetch the JSON for brand color
      let brandColor = color;
      if (!brandColor) {
        try {
          // Try to get brand color from Simple Icons API
          const jsonRes = await fetch(
            `https://raw.githubusercontent.com/simple-icons/simple-icons/develop/icons/${slug}.svg`,
          );
          // The CDN default is black (#000000), brand colors come from the package
          // We'll use a fallback approach
        } catch {
          /* ignore */
        }
      }

      const normalized = normalizeToSquare(svg, brandColor);
      writeFileSync(join(ICONS_DIR, `${connectorId}.svg`), normalized.mono);
      if (brandColor) {
        writeFileSync(join(ICONS_DIR, `${connectorId}-color.svg`), normalized.color);
      }

      manifest[connectorId] = {
        name,
        hasIcon: true,
        source: "simpleicons",
        brandColor,
      };

      fetched++;
      console.log(`  ✅ ${name} (${slug})`);
    } else {
      failed++;
      console.log(`  ❌ ${name} (${slug}) — not found on CDN`);
      manifest[connectorId] = {
        name,
        hasIcon: false,
        source: "simpleicons",
      };
    }
  }

  // Record manual sourcing entries
  for (const [connectorId, { name, reason }] of Object.entries(MANUAL_SOURCING)) {
    manifest[connectorId] = {
      name,
      hasIcon: false,
      source: "manual",
    };
    console.log(`  ⚠️  ${name} — ${reason}`);
  }

  // Write manifest
  writeFileSync(join(ICONS_DIR, "manifest.json"), JSON.stringify(manifest, null, 2));

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(
    `  Fetched: ${fetched}  |  Failed: ${failed}  |  Manual: ${Object.keys(MANUAL_SOURCING).length}`,
  );
  console.log(`  Output:  ${ICONS_DIR}/`);
  console.log(`  Manifest: ${ICONS_DIR}/manifest.json`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
}

main().catch(console.error);
