/**
 * Widget Builder Tool for Agents
 *
 * Provides tools for agents to create and manage custom dashboard widgets:
 * - create: Build a new widget (HTML/CSS/JS)
 * - update: Modify an existing widget
 * - list: List all widgets (built-in + custom)
 * - get: Get a single widget with full code
 * - delete: Soft-delete a widget
 * - assign: Assign a widget to a dashboard slot position
 * - layout: Get current slot assignments
 */

import { Type } from "@sinclair/typebox";
import { dashboardApiHeaders } from "../../utils/dashboard-api.js";
import { type AnyAgentTool, readStringParam, readNumberParam } from "./common.js";

const DASHBOARD_API = process.env.ARGENT_DASHBOARD_API || "http://localhost:9242";

function textResult(text: string) {
  return {
    content: [{ type: "text" as const, text }],
    details: undefined,
  };
}

// Built-in widgets for the list action
const BUILTIN_WIDGETS = [
  { id: "clock", name: "Clock", icon: "🕐", description: "Live time and date display" },
  {
    id: "calendar-agenda",
    name: "Calendar Agenda",
    icon: "📅",
    description: "Next 5 upcoming events",
  },
  { id: "tickets", name: "Ticket List", icon: "🎫", description: "Active support tickets" },
  { id: "tasks", name: "Tasks", icon: "✓", description: "Asana/project tasks" },
  {
    id: "silver-price",
    name: "Silver Price",
    icon: "🪙",
    description: "Live silver spot prices & gold/silver ratio",
  },
  {
    id: "stock-news",
    name: "Stock News",
    icon: "📰",
    description: "Latest market news from Silver Intel Report",
  },
  { id: "empty", name: "Empty", icon: "⬜", description: "Placeholder widget" },
];

// ============================================================================
// Schema
// ============================================================================

const WidgetBuilderToolSchema = Type.Object({
  action: Type.Union([
    Type.Literal("create"),
    Type.Literal("update"),
    Type.Literal("list"),
    Type.Literal("get"),
    Type.Literal("delete"),
    Type.Literal("assign"),
    Type.Literal("layout"),
  ]),
  name: Type.Optional(Type.String()),
  description: Type.Optional(Type.String()),
  icon: Type.Optional(Type.String()),
  code: Type.Optional(Type.String()),
  widgetId: Type.Optional(Type.String()),
  position: Type.Optional(Type.Number()),
});

// ============================================================================
// Tool Implementation
// ============================================================================

export function createWidgetBuilderTool(): AnyAgentTool {
  return {
    label: "Widgets",
    name: "widgets",
    description: `Create and manage custom dashboard widgets for the ArgentOS dashboard.

ACTIONS:
- create: Build a new custom widget (requires name, code; optional description, icon)
- update: Modify an existing widget (requires widgetId; optional name, code, icon, description)
- list: List all widgets (built-in + custom)
- get: Get a widget with full source code (requires widgetId)
- delete: Delete a custom widget (requires widgetId)
- assign: Assign a widget to a dashboard slot (requires widgetId, position 1-7)
- layout: Get current slot assignments

WIDGET CODE REQUIREMENTS:
- Must be a complete HTML document (include <!DOCTYPE html> or <html>)
- Self-contained: all CSS and JS inline (no external dependencies)
- Widgets run in sandboxed iframes (no parent DOM access, no network)
- Use \`prefers-color-scheme\` media query, default to dark theme
- Design for small sizes: ~200x200px for positions 1-6, ~280px tall for position 7
- Use modern CSS and vanilla JS

SLOT POSITIONS:
- 1-3: Left column widgets
- 4-6: Right column widgets
- 7: Bottom-left widget (bubble position)

EXAMPLES:
- Create: { "action": "create", "name": "Countdown", "description": "Countdown timer", "icon": "⏱️", "code": "<!DOCTYPE html>..." }
- Assign: { "action": "assign", "widgetId": "uuid", "position": 3 }
- Layout: { "action": "layout" }`,
    parameters: WidgetBuilderToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });

      switch (action) {
        case "create": {
          const name = readStringParam(params, "name", { required: true });
          const code = readStringParam(params, "code", { required: true });
          const description = readStringParam(params, "description");
          const icon = readStringParam(params, "icon");

          if (
            !code.includes("<html") &&
            !code.includes("<!DOCTYPE") &&
            !code.includes("<!doctype")
          ) {
            return textResult(
              "Error: Widget code must be a complete HTML document. Include <!DOCTYPE html> and <html> tags.",
            );
          }

          try {
            const res = await fetch(`${DASHBOARD_API}/api/widgets`, {
              method: "POST",
              headers: dashboardApiHeaders({ "Content-Type": "application/json" }),
              body: JSON.stringify({ name, description, icon, code }),
            });

            if (!res.ok) {
              const err = await res.json().catch(() => ({ error: "Unknown error" }));
              return textResult(`Error creating widget: ${err.error || res.statusText}`);
            }

            const data = await res.json();
            return textResult(
              `Created widget "${data.widget.name}" (ID: ${data.widget.id}, v${data.widget.version})\n\nThe widget is now available in the dashboard widget dropdown. Use the assign action to place it in a slot.`,
            );
          } catch (err) {
            return textResult(
              `Error connecting to dashboard API: ${err instanceof Error ? err.message : "Unknown error"}`,
            );
          }
        }

        case "update": {
          const widgetId = readStringParam(params, "widgetId", { required: true });
          const name = readStringParam(params, "name");
          const code = readStringParam(params, "code");
          const description = readStringParam(params, "description");
          const icon = readStringParam(params, "icon");

          if (
            code &&
            !code.includes("<html") &&
            !code.includes("<!DOCTYPE") &&
            !code.includes("<!doctype")
          ) {
            return textResult(
              "Error: Widget code must be a complete HTML document. Include <!DOCTYPE html> and <html> tags.",
            );
          }

          try {
            const body: Record<string, string> = {};
            if (name) body.name = name;
            if (code) body.code = code;
            if (description) body.description = description;
            if (icon) body.icon = icon;

            const res = await fetch(`${DASHBOARD_API}/api/widgets/${widgetId}`, {
              method: "PATCH",
              headers: dashboardApiHeaders({ "Content-Type": "application/json" }),
              body: JSON.stringify(body),
            });

            if (!res.ok) {
              const err = await res.json().catch(() => ({ error: "Unknown error" }));
              return textResult(`Error updating widget: ${err.error || res.statusText}`);
            }

            const data = await res.json();
            return textResult(`Updated widget "${data.widget.name}" (v${data.widget.version})`);
          } catch (err) {
            return textResult(
              `Error connecting to dashboard API: ${err instanceof Error ? err.message : "Unknown error"}`,
            );
          }
        }

        case "list": {
          try {
            const res = await fetch(`${DASHBOARD_API}/api/widgets`, {
              headers: dashboardApiHeaders(),
            });
            if (!res.ok) {
              return textResult("Error listing widgets");
            }

            const data = await res.json();
            const customWidgets = data.widgets || [];

            const lines: string[] = [];

            lines.push("=== Built-in Widgets ===");
            for (const w of BUILTIN_WIDGETS) {
              lines.push(`${w.icon} ${w.name} (ID: ${w.id}) — ${w.description}`);
            }

            lines.push("");
            lines.push("=== Custom Widgets ===");
            if (customWidgets.length === 0) {
              lines.push("No custom widgets created yet.");
            } else {
              for (const w of customWidgets) {
                lines.push(
                  `${w.icon || "📦"} ${w.name} (ID: ${w.id.slice(0, 8)}, v${w.version}) — ${w.description || "No description"}`,
                );
              }
            }

            return textResult(lines.join("\n"));
          } catch (err) {
            return textResult(
              `Error connecting to dashboard API: ${err instanceof Error ? err.message : "Unknown error"}`,
            );
          }
        }

        case "get": {
          const widgetId = readStringParam(params, "widgetId", { required: true });

          try {
            const res = await fetch(`${DASHBOARD_API}/api/widgets/${widgetId}`, {
              headers: dashboardApiHeaders(),
            });
            if (!res.ok) {
              return textResult(`Widget not found: ${widgetId}`);
            }

            const data = await res.json();
            const w = data.widget;

            return textResult(
              `Widget: ${w.name} (v${w.version})\nIcon: ${w.icon || "📦"}\nDescription: ${w.description || "none"}\nCreated: ${w.createdAt}\n\nCode:\n${w.code}`,
            );
          } catch (err) {
            return textResult(
              `Error connecting to dashboard API: ${err instanceof Error ? err.message : "Unknown error"}`,
            );
          }
        }

        case "delete": {
          const widgetId = readStringParam(params, "widgetId", { required: true });

          try {
            const res = await fetch(`${DASHBOARD_API}/api/widgets/${widgetId}`, {
              method: "DELETE",
              headers: dashboardApiHeaders(),
            });

            if (!res.ok) {
              const err = await res.json().catch(() => ({ error: "Unknown error" }));
              return textResult(`Error deleting widget: ${err.error || res.statusText}`);
            }

            return textResult("Widget deleted successfully.");
          } catch (err) {
            return textResult(
              `Error connecting to dashboard API: ${err instanceof Error ? err.message : "Unknown error"}`,
            );
          }
        }

        case "assign": {
          const widgetId = readStringParam(params, "widgetId", { required: true });
          const position = readNumberParam(params, "position", {
            required: true,
            integer: true,
          });

          if (position === undefined || position < 1 || position > 7) {
            return textResult("Error: Position must be between 1 and 7.");
          }

          try {
            const res = await fetch(`${DASHBOARD_API}/api/widgets/assign`, {
              method: "POST",
              headers: dashboardApiHeaders({ "Content-Type": "application/json" }),
              body: JSON.stringify({ widgetId, position }),
            });

            if (!res.ok) {
              const err = await res.json().catch(() => ({ error: "Unknown error" }));
              return textResult(`Error assigning widget: ${err.error || res.statusText}`);
            }

            const positionLabels: Record<number, string> = {
              1: "left column, top",
              2: "left column, middle",
              3: "left column, bottom",
              4: "right column, top",
              5: "right column, middle",
              6: "right column, bottom",
              7: "bottom-left (bubble position)",
            };

            return textResult(
              `Widget assigned to slot ${position} (${positionLabels[position] || "unknown"}).`,
            );
          } catch (err) {
            return textResult(
              `Error connecting to dashboard API: ${err instanceof Error ? err.message : "Unknown error"}`,
            );
          }
        }

        case "layout": {
          try {
            const res = await fetch(`${DASHBOARD_API}/api/widgets/layout`, {
              headers: dashboardApiHeaders(),
            });
            if (!res.ok) {
              return textResult("Error fetching layout");
            }

            const data = await res.json();
            const slots = data.layout || [];

            if (slots.length === 0) {
              return textResult(
                "No custom slot assignments. All positions use their default widgets (configured in dashboard settings).",
              );
            }

            const lines = ["Current slot assignments:"];
            for (const slot of slots) {
              lines.push(`  Position ${slot.position}: ${slot.widgetId}`);
            }

            return textResult(lines.join("\n"));
          } catch (err) {
            return textResult(
              `Error connecting to dashboard API: ${err instanceof Error ? err.message : "Unknown error"}`,
            );
          }
        }

        default:
          throw new Error(`Unknown action: ${action}`);
      }
    },
  };
}
