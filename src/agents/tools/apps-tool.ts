/**
 * App Forge Tools for Agents
 *
 * Provides tools for agents to create and manage micro-apps:
 * - create: Build a new app (HTML/JS/CSS + SVG icon)
 * - update: Modify an existing app
 * - list: List all apps
 * - get: Get a single app with full code
 * - delete: Soft-delete an app
 */

import { Type } from "@sinclair/typebox";
import { dashboardApiHeaders } from "../../utils/dashboard-api.js";
import { type AnyAgentTool, readStringParam } from "./common.js";

const DASHBOARD_API = process.env.ARGENT_DASHBOARD_API || "http://localhost:9242";

// Helper to return text result
function textResult(text: string) {
  return {
    content: [{ type: "text" as const, text }],
  };
}

// ============================================================================
// Schema
// ============================================================================

const AppsToolSchema = Type.Object({
  action: Type.Union([
    Type.Literal("create"),
    Type.Literal("update"),
    Type.Literal("list"),
    Type.Literal("get"),
    Type.Literal("delete"),
  ]),
  name: Type.Optional(Type.String()),
  description: Type.Optional(Type.String()),
  icon: Type.Optional(Type.String()),
  code: Type.Optional(Type.String()),
  appId: Type.Optional(Type.String()),
  query: Type.Optional(Type.String()),
});

// ============================================================================
// Tool Implementation
// ============================================================================

export function createAppsTool(): AnyAgentTool {
  return {
    label: "Apps",
    name: "apps",
    description: `Create and manage micro-apps on the ArgentOS App Forge desktop.

ACTIONS:
- create: Build a new app (requires name, code; optional description, icon)
- update: Modify an existing app (requires appId; optional name, code, icon, description)
- list: List all apps
- get: Get a single app with full code (requires appId)
- delete: Delete an app (requires appId)

APP CODE REQUIREMENTS:
- Must be a complete HTML document (include <!DOCTYPE html> or <html>)
- Self-contained: all CSS and JS inline (no external dependencies)
- Apps run in sandboxed iframes (no parent DOM access, no network)
- Use modern CSS and vanilla JS

ICON REQUIREMENTS:
- SVG string with viewBox="0 0 32 32"
- Simple shapes, purple accent color (#a855f7)
- No external references

EXAMPLES:
- Create: { "action": "create", "name": "Calculator", "description": "Simple calculator", "code": "<!DOCTYPE html>...", "icon": "<svg viewBox='0 0 32 32'>...</svg>" }
- Update: { "action": "update", "appId": "uuid", "code": "<!DOCTYPE html>..." }
- List: { "action": "list" }`,
    parameters: AppsToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });

      switch (action) {
        case "create": {
          const name = readStringParam(params, "name", { required: true });
          const code = readStringParam(params, "code", { required: true });
          const description = readStringParam(params, "description");
          const icon = readStringParam(params, "icon");

          // Validate HTML
          if (
            !code.includes("<html") &&
            !code.includes("<!DOCTYPE") &&
            !code.includes("<!doctype")
          ) {
            return textResult(
              "Error: App code must be a complete HTML document. Include <!DOCTYPE html> and <html> tags.",
            );
          }

          try {
            const res = await fetch(`${DASHBOARD_API}/api/apps`, {
              method: "POST",
              headers: dashboardApiHeaders({ "Content-Type": "application/json" }),
              body: JSON.stringify({ name, description, icon, code }),
            });

            if (!res.ok) {
              const err = await res.json().catch(() => ({ error: "Unknown error" }));
              return textResult(`Error creating app: ${err.error || res.statusText}`);
            }

            const data = await res.json();
            return textResult(
              `Created app "${data.app.name}" (ID: ${data.app.id}, v${data.app.version})\n\nThe app is now available in the App Forge desktop.`,
            );
          } catch (err) {
            return textResult(
              `Error connecting to dashboard API: ${err instanceof Error ? err.message : "Unknown error"}`,
            );
          }
        }

        case "update": {
          const appId = readStringParam(params, "appId", { required: true });
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
              "Error: App code must be a complete HTML document. Include <!DOCTYPE html> and <html> tags.",
            );
          }

          try {
            const body: Record<string, string> = {};
            if (name) body.name = name;
            if (code) body.code = code;
            if (description) body.description = description;
            if (icon) body.icon = icon;

            const res = await fetch(`${DASHBOARD_API}/api/apps/${appId}`, {
              method: "PATCH",
              headers: dashboardApiHeaders({ "Content-Type": "application/json" }),
              body: JSON.stringify(body),
            });

            if (!res.ok) {
              const err = await res.json().catch(() => ({ error: "Unknown error" }));
              return textResult(`Error updating app: ${err.error || res.statusText}`);
            }

            const data = await res.json();
            return textResult(`Updated app "${data.app.name}" (v${data.app.version})`);
          } catch (err) {
            return textResult(
              `Error connecting to dashboard API: ${err instanceof Error ? err.message : "Unknown error"}`,
            );
          }
        }

        case "list": {
          try {
            const res = await fetch(`${DASHBOARD_API}/api/apps`, {
              headers: dashboardApiHeaders(),
            });
            if (!res.ok) {
              return textResult("Error listing apps");
            }

            const data = await res.json();
            const apps = data.apps || [];

            if (apps.length === 0) {
              return textResult("No apps found in App Forge.");
            }

            const lines = apps.map(
              (app: {
                name: string;
                id: string;
                pinned: boolean;
                openCount: number;
                version: number;
              }) =>
                `${app.pinned ? "📌 " : ""}${app.name} (ID: ${app.id.slice(0, 8)}, v${app.version}, opened ${app.openCount}x)`,
            );

            return textResult(`Found ${apps.length} app(s):\n\n${lines.join("\n")}`);
          } catch (err) {
            return textResult(
              `Error connecting to dashboard API: ${err instanceof Error ? err.message : "Unknown error"}`,
            );
          }
        }

        case "get": {
          const appId = readStringParam(params, "appId", { required: true });

          try {
            const res = await fetch(`${DASHBOARD_API}/api/apps/${appId}`, {
              headers: dashboardApiHeaders(),
            });
            if (!res.ok) {
              return textResult(`App not found: ${appId}`);
            }

            const data = await res.json();
            const app = data.app;

            return textResult(
              `App: ${app.name} (v${app.version})\nDescription: ${app.description || "none"}\nCreated: ${app.createdAt}\n\nCode:\n${app.code}`,
            );
          } catch (err) {
            return textResult(
              `Error connecting to dashboard API: ${err instanceof Error ? err.message : "Unknown error"}`,
            );
          }
        }

        case "delete": {
          const appId = readStringParam(params, "appId", { required: true });

          try {
            const res = await fetch(`${DASHBOARD_API}/api/apps/${appId}`, {
              method: "DELETE",
              headers: dashboardApiHeaders(),
            });

            if (!res.ok) {
              const err = await res.json().catch(() => ({ error: "Unknown error" }));
              return textResult(`Error deleting app: ${err.error || res.statusText}`);
            }

            return textResult(`App deleted successfully.`);
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
