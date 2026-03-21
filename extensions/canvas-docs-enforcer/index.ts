const handler = async (event: any) => {
  // Only run on agent:bootstrap events
  if (event.type !== "agent" || event.action !== "bootstrap") {
    return;
  }

  // Get config
  const config = event.context.cfg?.plugins?.entries?.["canvas-docs-enforcer"]?.config;
  const docKeywords = config?.docKeywords || [
    "documentation",
    "guide",
    "tutorial",
    "reference",
    "manual",
    "readme",
    "wiki",
    "spec",
    "specification",
    "report",
    "analysis",
    "overview",
    "summary document",
    "research",
  ];

  // Inject doc_panel enforcement instructions
  const enforcementRules = `## 📊 DocPanel — Dashboard Document Panel (CRITICAL)

### ⚠️ TOOL DISAMBIGUATION — READ CAREFULLY
There are TWO tools with similar-sounding names. You MUST use the right one:

| Tool | Purpose | When to Use |
|------|---------|-------------|
| \`doc_panel\` | **Slide-out document panel in the web dashboard** | ALWAYS for documents, reports, analysis |
| \`canvas\` | External node device screens (MacBook, iPad, etc.) | ONLY when user asks to display on a specific device |

**CRITICAL:** \`doc_panel\` and \`canvas\` are completely different tools.
- \`doc_panel\` = dashboard's slide-out document panel (for reports, docs, code)
- \`canvas\` = physical external screens connected as nodes (MacBook M4, iPad, etc.)

**WHEN CREATING ANY DOCUMENT, REPORT, OR STRUCTURED CONTENT:**
→ Use \`doc_panel\` (NEVER \`canvas\`)

**Keywords that trigger this rule:**
${docKeywords.map((k) => `- ${k}`).join("\n")}

**NEVER DO:**
- Use the \`canvas\` tool for documents (it requires an external node device)
- Create HTML files and open them in the browser
- Dump long content inline in chat

**ALWAYS DO:**
- Call \`doc_panel\` with title, content (markdown), and type
- Give a brief verbal summary while the DocPanel shows the full content

**Example call:**
\`\`\`json
{ "title": "Silver Market Analysis", "content": "# Report\\n\\n## Key Findings\\n...", "type": "markdown" }
\`\`\`

The DocPanel will automatically slide out and display your document.`;

  // Add to bootstrap files
  if (event.context.bootstrapFiles) {
    event.context.bootstrapFiles.push({
      path: "CANVAS_ENFORCEMENT.md",
      content: enforcementRules,
      role: "workspace",
    });
  }
};

export default function register(api: any) {
  // Register the bootstrap hook
  api.registerHook("agent:bootstrap", handler, { name: "canvas-docs-enforcer" });

  api.logger.info("[canvas-docs-enforcer] Registered agent:bootstrap hook");
}
