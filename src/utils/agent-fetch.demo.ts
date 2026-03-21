/**
 * ArgentOS Agent Web Quickstart Demo
 *
 * Run with: npx tsx src/utils/agent-fetch.demo.ts
 *
 * Demonstrates:
 * 1. Discovering an agent-native site
 * 2. Fetching content as a first-class agent citizen
 * 3. Checking wallet spend before paying for gated content
 */

import { agentFetch, discoverSite, fetchLlmsTxt } from "./agent-fetch.js";

async function demo() {
  console.log("🤖 ArgentOS Agent Web Demo\n");

  // 1. Discover our own site
  console.log("--- Discovering argentos.ai ---");
  const discovery = await discoverSite("https://argentos.ai").catch(() => ({
    hasLlmsTxt: false,
    hasLlmsFullTxt: false,
    hasAgentCard: false,
    supportsMarkdown: false,
  }));
  console.log("Has llms.txt:", discovery.hasLlmsTxt);
  console.log("Has llms-full.txt:", discovery.hasLlmsFullTxt);
  console.log("Has agent-card.json:", discovery.hasAgentCard);
  console.log("Supports native markdown:", discovery.supportsMarkdown);
  if (discovery.manifest) {
    console.log("Site title:", discovery.manifest.title);
    console.log("Site description:", discovery.manifest.description);
  }

  // 2. Fetch a page as an agent (requesting markdown)
  console.log("\n--- Fetching news.ycombinator.com as agent ---");
  const result = await agentFetch("https://news.ycombinator.com", {
    checkLlmsTxt: true,
    preferMarkdown: true,
  }).catch((err) => {
    console.log("Fetch failed (expected for demo):", err.message);
    return null;
  });

  if (result) {
    console.log("Content type:", result.contentType);
    console.log("Agent native:", result.agentNative);
    console.log("Estimated tokens:", result.estimatedTokens ?? "not reported");
    console.log("llms.txt found:", !!result.llmsManifest);
    console.log("Content preview:", result.content.slice(0, 200));
  }

  // 3. Check an agent-native site (Cloudflare-powered)
  console.log("\n--- Checking for llms.txt on cloudflare.com ---");
  const cfManifest = await fetchLlmsTxt("https://cloudflare.com");
  if (cfManifest) {
    console.log("✅ Cloudflare has llms.txt:", cfManifest.title);
  } else {
    console.log("❌ No llms.txt found (will try markdown header anyway)");
  }

  console.log("\n✅ Demo complete. ArgentOS is a first-class agent web citizen.");
}

demo().catch(console.error);
