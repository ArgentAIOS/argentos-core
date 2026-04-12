/**
 * Email Delivery Tool
 *
 * Core runtime email sending via Resend, Mailgun, and SendGrid.
 */

import { Type } from "@sinclair/typebox";
import type { ArgentConfig } from "../../config/config.js";
import { resolveServiceKey } from "../../infra/service-keys.js";
import { type AnyAgentTool, jsonResult, readStringArrayParam, readStringParam } from "./common.js";

const EmailDeliverySchema = Type.Object({
  action: Type.Union([
    Type.Literal("test_provider"),
    Type.Literal("send_resend"),
    Type.Literal("send_mailgun"),
    Type.Literal("send_sendgrid"),
  ]),
  provider: Type.Optional(
    Type.Union([Type.Literal("resend"), Type.Literal("mailgun"), Type.Literal("sendgrid")], {
      default: "resend",
    }),
  ),
  to: Type.Optional(Type.Array(Type.String())),
  from: Type.Optional(Type.String()),
  subject: Type.Optional(Type.String()),
  text: Type.Optional(Type.String()),
  html: Type.Optional(Type.String()),
  mailgun_domain: Type.Optional(Type.String()),
  include_raw: Type.Optional(Type.Boolean()),
});

type JsonObject = Record<string, unknown>;

function textResult(text: string) {
  return {
    content: [{ type: "text" as const, text }],
  } as import("../../agent-core/core.js").AgentToolResult<unknown>;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function asBool(value: unknown): boolean {
  return value === true;
}

function requireMessageFields(params: Record<string, unknown>) {
  const to = readStringArrayParam(params, "to", { required: true });
  const from = readStringParam(params, "from", { required: true });
  const subject = readStringParam(params, "subject", { required: true });
  const text = readStringParam(params, "text");
  const html = readStringParam(params, "html");
  if (!text && !html) {
    throw new Error("Either text or html body is required");
  }
  return { to, from, subject, text, html };
}

async function parseResponse(res: Response): Promise<unknown> {
  const raw = await res.text();
  return parseJson(raw);
}

export function createEmailDeliveryTool(options?: {
  agentSessionKey?: string;
  config?: ArgentConfig;
}): AnyAgentTool {
  const resolveKey = (name: string) =>
    resolveServiceKey(name, options?.config, {
      sessionKey: options?.agentSessionKey,
      source: "email_delivery",
    });

  return {
    label: "Email Delivery",
    name: "email_delivery",
    description: `Send/test email providers from core runtime.

Actions:
- test_provider: check provider credentials
- send_resend
- send_mailgun
- send_sendgrid`,
    parameters: EmailDeliverySchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });

      try {
        const includeRaw = asBool(params.include_raw);

        if (action === "test_provider") {
          const provider = (readStringParam(params, "provider") || "resend").toLowerCase();

          if (provider === "resend") {
            const key = resolveKey("RESEND_API_KEY") || process.env.RESEND_API_KEY;
            if (!key) throw new Error("No RESEND_API_KEY configured.");
            const res = await fetch("https://api.resend.com/domains", {
              headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
            });
            const body = await parseResponse(res);
            if (!res.ok)
              throw new Error(`Resend test failed (${res.status}): ${JSON.stringify(body)}`);
            return jsonResult({ action, provider, ok: true, raw: includeRaw ? body : undefined });
          }

          if (provider === "mailgun") {
            const key = resolveKey("MAILGUN_API_KEY") || process.env.MAILGUN_API_KEY;
            if (!key) throw new Error("No MAILGUN_API_KEY configured.");
            const auth = Buffer.from(`api:${key}`).toString("base64");
            const res = await fetch("https://api.mailgun.net/v3/domains", {
              headers: { Authorization: `Basic ${auth}`, Accept: "application/json" },
            });
            const body = await parseResponse(res);
            if (!res.ok)
              throw new Error(`Mailgun test failed (${res.status}): ${JSON.stringify(body)}`);
            return jsonResult({ action, provider, ok: true, raw: includeRaw ? body : undefined });
          }

          if (provider === "sendgrid") {
            const key = resolveKey("SENDGRID_API_KEY") || process.env.SENDGRID_API_KEY;
            if (!key) throw new Error("No SENDGRID_API_KEY configured.");
            const res = await fetch("https://api.sendgrid.com/v3/user/profile", {
              headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
            });
            const body = await parseResponse(res);
            if (!res.ok)
              throw new Error(`SendGrid test failed (${res.status}): ${JSON.stringify(body)}`);
            return jsonResult({ action, provider, ok: true, raw: includeRaw ? body : undefined });
          }

          throw new Error('Unknown provider. Use "resend", "mailgun", or "sendgrid".');
        }

        if (action === "send_resend") {
          const key = resolveKey("RESEND_API_KEY") || process.env.RESEND_API_KEY;
          if (!key) throw new Error("No RESEND_API_KEY configured.");
          const msg = requireMessageFields(params);

          const res = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${key}`,
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify({
              from: msg.from,
              to: msg.to,
              subject: msg.subject,
              ...(msg.text ? { text: msg.text } : {}),
              ...(msg.html ? { html: msg.html } : {}),
            }),
          });

          const body = await parseResponse(res);
          if (!res.ok)
            throw new Error(`Resend send failed (${res.status}): ${JSON.stringify(body)}`);
          return jsonResult({
            action,
            provider: "resend",
            accepted: true,
            result: body,
            raw: includeRaw ? body : undefined,
          });
        }

        if (action === "send_mailgun") {
          const key = resolveKey("MAILGUN_API_KEY") || process.env.MAILGUN_API_KEY;
          if (!key) throw new Error("No MAILGUN_API_KEY configured.");

          const domain =
            readStringParam(params, "mailgun_domain") ||
            resolveKey("MAILGUN_DOMAIN") ||
            process.env.MAILGUN_DOMAIN;
          if (!domain) throw new Error("mailgun_domain or MAILGUN_DOMAIN is required");

          const msg = requireMessageFields(params);
          const form = new URLSearchParams();
          form.append("from", msg.from);
          msg.to.forEach((entry) => form.append("to", entry));
          form.append("subject", msg.subject);
          if (msg.text) form.append("text", msg.text);
          if (msg.html) form.append("html", msg.html);

          const auth = Buffer.from(`api:${key}`).toString("base64");
          const res = await fetch(`https://api.mailgun.net/v3/${domain}/messages`, {
            method: "POST",
            headers: {
              Authorization: `Basic ${auth}`,
              "Content-Type": "application/x-www-form-urlencoded",
              Accept: "application/json",
            },
            body: form,
          });

          const body = await parseResponse(res);
          if (!res.ok)
            throw new Error(`Mailgun send failed (${res.status}): ${JSON.stringify(body)}`);
          return jsonResult({
            action,
            provider: "mailgun",
            accepted: true,
            result: body,
            raw: includeRaw ? body : undefined,
          });
        }

        if (action === "send_sendgrid") {
          const key = resolveKey("SENDGRID_API_KEY") || process.env.SENDGRID_API_KEY;
          if (!key) throw new Error("No SENDGRID_API_KEY configured.");
          const msg = requireMessageFields(params);

          const payload: JsonObject = {
            personalizations: [{ to: msg.to.map((entry) => ({ email: entry })) }],
            from: { email: msg.from },
            subject: msg.subject,
            content: [
              ...(msg.text ? [{ type: "text/plain", value: msg.text }] : []),
              ...(msg.html ? [{ type: "text/html", value: msg.html }] : []),
            ],
          };

          const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${key}`,
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify(payload),
          });

          const body = await parseResponse(res);
          if (!res.ok)
            throw new Error(`SendGrid send failed (${res.status}): ${JSON.stringify(body)}`);
          return jsonResult({
            action,
            provider: "sendgrid",
            accepted: true,
            result: body,
            raw: includeRaw ? body : undefined,
          });
        }

        return textResult(
          "Unknown action. Use: test_provider, send_resend, send_mailgun, send_sendgrid",
        );
      } catch (err) {
        return textResult(
          `email_delivery error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
  };
}
