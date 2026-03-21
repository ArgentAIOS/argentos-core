/**
 * Twilio Comm Tool
 *
 * Core runtime SMS/WhatsApp messaging via Twilio.
 */

import { Type } from "@sinclair/typebox";
import type { ArgentConfig } from "../../config/config.js";
import { resolveServiceKey } from "../../infra/service-keys.js";
import { type AnyAgentTool, jsonResult, readStringParam } from "./common.js";

const TwilioCommSchema = Type.Object({
  action: Type.Union([
    Type.Literal("test_connection"),
    Type.Literal("list_numbers"),
    Type.Literal("send_sms"),
    Type.Literal("send_whatsapp"),
  ]),
  account_sid: Type.Optional(Type.String()),
  auth_token: Type.Optional(Type.String()),
  from: Type.Optional(Type.String()),
  to: Type.Optional(Type.String()),
  body: Type.Optional(Type.String()),
  include_raw: Type.Optional(Type.Boolean()),
});

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

function ensureWhatsAppPrefix(value: string): string {
  return value.startsWith("whatsapp:") ? value : `whatsapp:${value}`;
}

async function twilioRequest(params: {
  accountSid: string;
  authToken: string;
  method: "GET" | "POST";
  path: string;
  form?: URLSearchParams;
}): Promise<{ status: number; body: unknown }> {
  const base = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(params.accountSid)}`;
  const url = `${base}${params.path}`;
  const auth = Buffer.from(`${params.accountSid}:${params.authToken}`).toString("base64");

  const res = await fetch(url, {
    method: params.method,
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: "application/json",
      ...(params.form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body: params.form,
  });

  const raw = await res.text();
  const body = parseJson(raw);
  if (!res.ok) {
    throw new Error(
      `Twilio API error (${res.status}): ${typeof body === "string" ? body : JSON.stringify(body)}`,
    );
  }

  return { status: res.status, body };
}

export function createTwilioCommTool(options?: {
  agentSessionKey?: string;
  config?: ArgentConfig;
}): AnyAgentTool {
  const resolveKey = (name: string) =>
    resolveServiceKey(name, options?.config, {
      sessionKey: options?.agentSessionKey,
      source: "twilio_comm",
    });

  return {
    label: "Twilio Comm",
    name: "twilio_comm",
    description: `Send SMS/WhatsApp and inspect Twilio account state.

Actions:
- test_connection
- list_numbers
- send_sms
- send_whatsapp`,
    parameters: TwilioCommSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });

      try {
        const accountSid =
          readStringParam(params, "account_sid") ||
          resolveKey("TWILIO_ACCOUNT_SID") ||
          process.env.TWILIO_ACCOUNT_SID;
        const authToken =
          readStringParam(params, "auth_token") ||
          resolveKey("TWILIO_AUTH_TOKEN") ||
          process.env.TWILIO_AUTH_TOKEN;

        if (!accountSid || !authToken) {
          throw new Error("Missing TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN");
        }

        const includeRaw = asBool(params.include_raw);

        if (action === "test_connection") {
          const payload = await twilioRequest({
            accountSid,
            authToken,
            method: "GET",
            path: "/IncomingPhoneNumbers.json?PageSize=1",
          });
          return jsonResult({
            action,
            ok: true,
            status: payload.status,
            raw: includeRaw ? payload.body : undefined,
          });
        }

        if (action === "list_numbers") {
          const payload = await twilioRequest({
            accountSid,
            authToken,
            method: "GET",
            path: "/IncomingPhoneNumbers.json?PageSize=20",
          });
          const data = payload.body as Record<string, unknown>;
          const numbers = Array.isArray(data.incoming_phone_numbers)
            ? data.incoming_phone_numbers
                .filter((row) => row && typeof row === "object")
                .map((row) => {
                  const rec = row as Record<string, unknown>;
                  return {
                    sid: typeof rec.sid === "string" ? rec.sid : undefined,
                    phone_number:
                      typeof rec.phone_number === "string" ? rec.phone_number : undefined,
                    friendly_name:
                      typeof rec.friendly_name === "string" ? rec.friendly_name : undefined,
                  };
                })
            : [];
          return jsonResult({
            action,
            count: numbers.length,
            numbers,
            raw: includeRaw ? payload.body : undefined,
          });
        }

        if (action === "send_sms" || action === "send_whatsapp") {
          const to = readStringParam(params, "to", { required: true });
          const body = readStringParam(params, "body", { required: true, trim: false });
          const from =
            readStringParam(params, "from") ||
            resolveKey("TWILIO_FROM_NUMBER") ||
            process.env.TWILIO_FROM_NUMBER;
          if (!from) {
            throw new Error("Missing from number. Provide from or configure TWILIO_FROM_NUMBER.");
          }

          const form = new URLSearchParams();
          if (action === "send_whatsapp") {
            form.set("To", ensureWhatsAppPrefix(to));
            form.set("From", ensureWhatsAppPrefix(from));
          } else {
            form.set("To", to);
            form.set("From", from);
          }
          form.set("Body", body);

          const payload = await twilioRequest({
            accountSid,
            authToken,
            method: "POST",
            path: "/Messages.json",
            form,
          });

          const rec = payload.body as Record<string, unknown>;
          return jsonResult({
            action,
            sid: typeof rec.sid === "string" ? rec.sid : undefined,
            status: typeof rec.status === "string" ? rec.status : undefined,
            to: typeof rec.to === "string" ? rec.to : undefined,
            from: typeof rec.from === "string" ? rec.from : undefined,
            raw: includeRaw ? payload.body : undefined,
          });
        }

        return textResult(
          "Unknown action. Use: test_connection, list_numbers, send_sms, send_whatsapp",
        );
      } catch (err) {
        return textResult(`twilio_comm error: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  };
}
