/**
 * Dashboard DocPanel Bridge Plugin
 *
 * This plugin bridges the gap between the ArgentOS agent and the Argent Dashboard's
 * document panel system. When the agent creates a document, this plugin:
 * 1. Saves the document to the dashboard API
 * 2. Broadcasts a WebSocket event that triggers the DocPanel slide-out
 *
 * Tool: doc_panel
 * - Agent uses this to save and display documents in the dashboard DocPanel
 *
 * Gateway method: dashboard.canvas.push
 * - Broadcasts a 'canvas' event to all connected WebSocket clients
 * - The dashboard listens for this event and opens the DocPanel
 *
 * HTTP endpoint: POST /plugins/dashboard-canvas/broadcast
 * - Alternative way to trigger the broadcast
 */

// Store broadcast function from gateway context
let broadcastFn: ((event: string, payload: unknown) => void) | null = null;

// Queue of pending broadcasts (if broadcast isn't ready yet)
const pendingBroadcasts: Array<{ event: string; payload: unknown }> = [];

function doBroadcast(event: string, payload: unknown) {
  if (broadcastFn) {
    broadcastFn(event, payload);
    return true;
  }
  // Queue for later
  pendingBroadcasts.push({ event, payload });
  return false;
}

function flushPendingBroadcasts() {
  if (!broadcastFn) return;
  while (pendingBroadcasts.length > 0) {
    const item = pendingBroadcasts.shift();
    if (item) {
      broadcastFn(item.event, item.payload);
    }
  }
}

export default function register(api: any) {
  api.logger.info("Dashboard DocPanel Bridge plugin loaded");

  // Register gateway method that broadcasts canvas events
  // This also captures the broadcast function for tool use
  api.registerGatewayMethod("dashboard.canvas.push", async ({ params, respond, context }: any) => {
    // Capture broadcast function for tool use
    if (!broadcastFn) {
      broadcastFn = context.broadcast;
      flushPendingBroadcasts();
    }

    const { title, content, type, language, id } = params as {
      title?: string;
      content?: string;
      type?: string;
      language?: string;
      id?: string;
    };

    if (!title || !content) {
      respond(false, undefined, {
        code: "invalid_params",
        message: "title and content are required",
      });
      return;
    }

    // Broadcast canvas event to all connected WebSocket clients
    context.broadcast("canvas", {
      action: "push",
      id: id || `doc-${Date.now()}`,
      title,
      content,
      type: type || "markdown",
      language,
      timestamp: Date.now(),
    });

    api.logger.info(`Broadcast canvas event: ${title}`);

    respond(true, {
      success: true,
      message: "Canvas event broadcast to all connected clients",
    });
  });

  api.logger.info("Registered gateway method: dashboard.canvas.push");

  // Register HTTP route for triggering broadcasts (alternative mechanism)
  api.registerHttpRoute({
    path: "/plugins/dashboard-canvas/broadcast",
    handler: async (req: any, res: any) => {
      if (req.method !== "POST") {
        res.statusCode = 405;
        res.end("Method Not Allowed");
        return;
      }

      // Read JSON body
      let body = "";
      for await (const chunk of req) {
        body += chunk;
      }

      try {
        const { title, content, type, language, id } = JSON.parse(body);

        if (!title || !content) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: "title and content are required" }));
          return;
        }

        const payload = {
          action: "push",
          id: id || `doc-${Date.now()}`,
          title,
          content,
          type: type || "markdown",
          language,
          timestamp: Date.now(),
        };

        const success = doBroadcast("canvas", payload);

        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify({
            success,
            queued: !success,
            message: success
              ? "Broadcast sent"
              : "Broadcast queued (gateway method not yet called)",
          }),
        );
      } catch (err) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: "Invalid JSON" }));
      }
    },
  });

  api.logger.info("Registered HTTP route: /plugins/dashboard-canvas/broadcast");

  // Register tool for agent to use
  const dashboardCanvasTool = {
    name: "doc_panel",
    description:
      'Save and display a document in the Argent Dashboard DocPanel. The panel will automatically slide out to show the document while you verbally summarize it. NOTE: This is NOT the same as the "canvas" tool (which controls external node device screens). Use doc_panel for ALL documents, reports, and structured content.',
    parameters: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Title of the document",
        },
        content: {
          type: "string",
          description: "The document content (markdown, code, or plain text)",
        },
        type: {
          type: "string",
          enum: ["markdown", "code", "text"],
          description: "Document type (default: markdown)",
        },
        language: {
          type: "string",
          description: "Programming language for code documents",
        },
      },
      required: ["title", "content"],
    },
    execute: async (
      _callId: string,
      params: {
        title: string;
        content: string;
        type?: "markdown" | "code" | "text";
        language?: string;
      },
    ) => {
      const { title, content, type = "markdown", language } = params;
      const docId = `doc-${Date.now()}`;

      api.logger.info(`[doc_panel] Saving document: ${title}`);

      try {
        // Save to dashboard API
        const saveResponse = await fetch("http://localhost:9242/api/canvas/save", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            doc: {
              id: docId,
              title,
              content,
              type,
              language,
              createdAt: new Date().toISOString(),
            },
          }),
        });

        if (!saveResponse.ok) {
          throw new Error(`Failed to save document: ${saveResponse.statusText}`);
        }

        const saveResult = await saveResponse.json();
        api.logger.info(`[doc_panel] Saved with tags: ${saveResult.tags?.join(", ") || "none"}`);

        // Broadcast to dashboard via gateway
        const payload = {
          action: "push",
          id: docId,
          title,
          content,
          type,
          language,
          timestamp: Date.now(),
        };

        const broadcastSent = doBroadcast("canvas", payload);

        if (broadcastSent) {
          api.logger.info(`[doc_panel] Broadcast canvas event to dashboard`);
        } else {
          // Try HTTP endpoint as fallback
          api.logger.info(`[doc_panel] Broadcast queued - trying HTTP fallback`);
          try {
            await fetch("http://localhost:18789/plugins/dashboard-canvas/broadcast", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ id: docId, title, content, type, language }),
            });
          } catch (httpErr) {
            api.logger.warn(`[doc_panel] HTTP fallback failed: ${httpErr}`);
          }
        }

        return {
          content: [
            {
              type: "text" as const,
              text: `Document "${title}" saved and displayed in dashboard DocPanel.\n\nDocument ID: ${docId}\nType: ${type}\nTags: ${saveResult.tags?.join(", ") || "none"}`,
            },
          ],
        };
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        api.logger.error(`[doc_panel] Error: ${error}`);
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to save document: ${error}`,
            },
          ],
          isError: true,
        };
      }
    },
  };

  // NOTE: doc_panel tool is now built-in (src/agents/tools/doc-panel-tool.ts).
  // The built-in tool calls /api/canvas/save which triggers SSE document_saved events.
  // Plugin still provides: gateway broadcast, HTTP endpoint, bootstrap hook, auto-router.
  // api.registerTool(dashboardCanvasTool)  // DISABLED — conflicts with built-in
  api.logger.info("Skipping doc_panel tool registration (now built-in)");

  // Register agent:bootstrap hook to instruct agent when to use doc_panel
  api.registerHook(
    "agent:bootstrap",
    async (event: any) => {
      if (event.type !== "agent" || event.action !== "bootstrap") return;

      const instructions = `## 📄 DocPanel Tool

You have access to the \`doc_panel\` tool which displays documents in a slide-out panel on the Argent Dashboard.

**IMPORTANT:** \`doc_panel\` is NOT the same as \`canvas\`. The \`canvas\` tool controls external node device screens (MacBook, iPad, etc.). The \`doc_panel\` tool shows documents in the dashboard's slide-out panel.

**USE \`doc_panel\` WHEN:**
- Creating reports, documentation, guides, or tutorials
- Generating code files, scripts, or configurations
- Creating structured content (lists, tables, specifications)
- Producing content longer than 10-15 lines
- User explicitly asks to "save", "create a document", or "write a report"
- Creating content the user will want to reference, copy, or save

**DO NOT USE \`doc_panel\` WHEN:**
- Giving short answers or explanations (just reply normally)
- Having a conversation or answering quick questions
- Providing brief code snippets (under 10 lines)
- Giving status updates or confirmations

**EXAMPLE USAGE:**
- "Write a guide on Docker" → Use doc_panel (long-form documentation)
- "What is Docker?" → Reply normally (short explanation)
- "Create a Python script for..." → Use doc_panel (code file)
- "How do I fix this error?" → Reply normally (troubleshooting help)
- "Generate a report on..." → Use doc_panel (structured report)

When using \`doc_panel\`, you can still provide a brief verbal summary while the document appears in the panel.`;

      if (event.context.bootstrapFiles) {
        event.context.bootstrapFiles.push({
          path: "DOC_PANEL_TOOL.md",
          content: instructions,
          role: "workspace",
        });
      }
    },
    { name: "dashboard-canvas-bridge" },
  );

  api.logger.info("Registered agent:bootstrap hook for doc_panel instructions");

  // ============================================================
  // CANVAS ROUTER: Automatic document detection and routing
  // ============================================================
  // This hook intercepts agent responses and automatically decides:
  // - Short/conversational → send as chat message
  // - Long/structured/document-like → push to canvas + summarize in chat

  const MIN_LINES_FOR_CANVAS = 15;
  const MIN_CHARS_FOR_CANVAS = 800;
  const CODE_BLOCK_THRESHOLD = 2;

  const DOCUMENT_PATTERNS = [
    /^#+ .+/m, // Markdown headers
    /^\d+\.\s+\*\*.+\*\*/m, // Numbered bold items
    /^[-*]\s+\*\*.+\*\*:/m, // Bullet with bold label
    /\|.+\|.+\|/, // Table rows
    /^```[\s\S]+?```/m, // Code blocks
    /^>\s+.+/m, // Blockquotes
  ];

  const CHAT_PATTERNS = [
    /^(Yes|No|Sure|Okay|Got it|I see|Thanks|Here's|Let me|I'll|I can|I will)/i,
    /^(The error|The issue|The problem|That's|This is|It looks like)/i,
  ];

  function analyzeContent(content: string) {
    const lines = content.split("\n");
    const lineCount = lines.length;
    const charCount = content.length;
    const codeBlockMatches = content.match(/```[\s\S]*?```/g) || [];
    const codeBlockCount = codeBlockMatches.length;

    let documentScore = 0;
    let reasons: string[] = [];

    // Length factors
    if (lineCount >= MIN_LINES_FOR_CANVAS) {
      documentScore += 30;
      reasons.push(`${lineCount} lines`);
    }
    if (charCount >= MIN_CHARS_FOR_CANVAS) {
      documentScore += 20;
      reasons.push(`${charCount} chars`);
    }

    // Code blocks
    if (codeBlockCount >= CODE_BLOCK_THRESHOLD) {
      documentScore += 25;
      reasons.push(`${codeBlockCount} code blocks`);
    }

    // Document patterns
    let patternMatches = 0;
    for (const pattern of DOCUMENT_PATTERNS) {
      if (pattern.test(content)) patternMatches++;
    }
    if (patternMatches >= 3) {
      documentScore += 25;
      reasons.push(`${patternMatches} doc patterns`);
    } else if (patternMatches >= 1) {
      documentScore += 10;
    }

    // Chat pattern penalty
    for (const pattern of CHAT_PATTERNS) {
      if (pattern.test(content) && lineCount < 10) {
        documentScore -= 20;
        reasons.push("chat-like");
        break;
      }
    }

    // Extract title
    let suggestedTitle = "Document";
    const headerMatch = content.match(/^#+ (.+)$/m);
    if (headerMatch) {
      suggestedTitle = headerMatch[1].trim();
    } else {
      const boldMatch = content.match(/^\*\*(.+?)\*\*/m);
      if (boldMatch) suggestedTitle = boldMatch[1].trim();
    }

    // Detect content type
    let contentType: "markdown" | "code" | "text" = "markdown";
    let language: string | undefined;
    if (codeBlockCount > 0) {
      const codeContent = codeBlockMatches.join("").length;
      if (codeContent > content.length * 0.6) {
        contentType = "code";
        const langMatch = content.match(/```(\w+)/);
        if (langMatch) language = langMatch[1];
      }
    }

    return {
      isDocument: documentScore >= 50,
      confidence: documentScore,
      reason: reasons.join(", ") || "short response",
      suggestedTitle,
      contentType,
      language,
    };
  }

  async function pushToCanvasAPI(
    title: string,
    content: string,
    type: string,
    language?: string,
  ): Promise<boolean> {
    try {
      const docId = `doc-${Date.now()}`;
      const response = await fetch("http://localhost:9242/api/canvas/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          doc: {
            id: docId,
            title,
            content,
            type,
            language,
            createdAt: new Date().toISOString(),
            autoRouted: true,
          },
        }),
      });
      return response.ok;
    } catch (err) {
      api.logger.error(`[canvas-router] Failed to push: ${err}`);
      return false;
    }
  }

  function generateSummary(content: string, title: string): string {
    const lines = content.split("\n").filter((l) => l.trim() && !l.startsWith("#"));
    const preview = lines.slice(0, 2).join(" ").slice(0, 150);
    return `📄 I've created **"${title}"** and displayed it in the DocPanel.\n\n${preview}${preview.length >= 150 ? "..." : ""}`;
  }

  // Auto-router: intercept long/structured responses and route to DocPanel
  api.registerHook(
    "message_sending",
    async (event: any, ctx: any) => {
      // Extract message text (format varies by channel)
      const text =
        event.content?.text ||
        event.text ||
        (typeof event.content === "string" ? event.content : "");
      if (!text || typeof text !== "string") return;

      // Skip if agent already used doc_panel tool this turn
      const toolCalls = ctx?.toolCalls || [];
      const usedDocPanel = toolCalls.some(
        (tc: any) => tc?.name === "doc_panel" || tc?.name === "dashboard_canvas",
      );
      if (usedDocPanel) {
        api.logger.info("[doc-router] Skipping — agent already used doc_panel");
        return;
      }

      // Analyze the response content
      const analysis = analyzeContent(text);

      if (!analysis.isDocument) return;

      api.logger.info(
        `[doc-router] Auto-routing to DocPanel (score: ${analysis.confidence}, reason: ${analysis.reason}, title: "${analysis.suggestedTitle}")`,
      );

      // Push to DocPanel API
      const pushed = await pushToCanvasAPI(
        analysis.suggestedTitle,
        text,
        analysis.contentType,
        analysis.language,
      );

      if (!pushed) {
        api.logger.warn("[doc-router] Failed to push to DocPanel API — sending as chat");
        return;
      }

      // Also broadcast the WebSocket event so the panel slides out
      doBroadcast("canvas", {
        action: "push",
        id: `doc-${Date.now()}`,
        title: analysis.suggestedTitle,
        content: text,
        type: analysis.contentType,
        language: analysis.language,
        timestamp: Date.now(),
      });

      // Replace the chat message with a brief summary
      const summary = generateSummary(text, analysis.suggestedTitle);
      return { content: summary };
    },
    { name: "doc-panel-auto-router", priority: 50 },
  );

  api.logger.info("[doc-router] Auto-routing enabled — long/structured content → DocPanel");
}
