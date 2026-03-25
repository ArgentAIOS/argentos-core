import type { GatewayRequestHandlers } from "./types.js";
import { completeSimple, getModel } from "../../agent-core/ai.js";
import { resolveSessionAgentIds } from "../../agents/agent-scope.js";
import { loadConfig } from "../../config/config.js";
import { maybeKickoffSpecforgeFromMessage } from "../../infra/specforge-conductor.js";
import { routeModel } from "../../models/router.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";

type SpecForgeFormData = {
  title: string;
  problem: string;
  users: string;
  successCriteria: string;
  constraints: string;
  scope: string;
};

export const specforgeHandlers: GatewayRequestHandlers = {
  "specforge.suggest": async ({ params, respond }) => {
    try {
      const field = String(params.field || "");
      const currentData = (params.currentData || {}) as SpecForgeFormData;

      if (!field) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "field is required"));
        return;
      }

      const cfg = loadConfig();
      const sessionKey = typeof params.sessionKey === "string" ? params.sessionKey : undefined;
      const { sessionAgentId } = resolveSessionAgentIds({ sessionKey, config: cfg });

      const routerCfg = cfg.agents?.defaults?.modelRouter ?? {};
      const decision = routeModel({
        signals: {
          prompt: "Generate a suggestion for a project spec field.",
          sessionType: "main",
        },
        config: routerCfg,
        defaultProvider: "anthropic",
        defaultModel: "claude-3-5-haiku-latest",
      });

      const model = getModel(decision.provider as any, decision.model);
      if (!model) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.UNAVAILABLE, "No suitable model found for suggestion"),
        );
        return;
      }

      const prompt = `You are an expert product manager assisting a user in filling out a project initiation document (SpecForge).
The user is asking for a suggestion for the "${field}" field.

Current Project Context:
Title: ${currentData.title || "(Empty)"}
Problem Statement: ${currentData.problem || "(Empty)"}
Target Users: ${currentData.users || "(Empty)"}
Success Criteria: ${currentData.successCriteria || "(Empty)"}
Constraints: ${currentData.constraints || "(Empty)"}
Scope boundaries: ${currentData.scope || "(Empty)"}

Write a concise, professional suggestion (1-3 sentences) for the "${field}" field that makes sense given the context provided. Do not provide multiple options or greetings, just the exact text to put in the field.`;

      const res = await completeSimple(
        model,
        {
          systemPrompt: "You are a concise expert PM.",
          messages: [{ role: "user", content: prompt, timestamp: Date.now() }],
        },
        { temperature: 0.7 },
      );

      const textContent = res.content.find((c) => c.type === "text");
      const suggestion = textContent && "text" in textContent ? textContent.text.trim() : "";

      respond(true, { suggestion }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "specforge.kickoff": async ({ params, respond }) => {
    try {
      const data = (params.data || {}) as SpecForgeFormData;
      const title = String(data.title || "").trim();

      if (!title) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "title is required"));
        return;
      }

      const cfg = loadConfig();
      const sessionKey = typeof params.sessionKey === "string" ? params.sessionKey : "";
      const { sessionAgentId } = resolveSessionAgentIds({ sessionKey, config: cfg });

      // Generate a structured message that will trigger maybeKickoffSpecforgeFromMessage securely
      const modalMessage = [
        `I need to build a project. Title: ${title}`,
        "",
        "## SpecForge Parameters",
        `**Problem Statement:** ${data.problem || "Not specified."}`,
        `**Target Users:** ${data.users || "Not specified."}`,
        `**Success Criteria:** ${data.successCriteria || "Not specified."}`,
        `**Constraints:** ${data.constraints || "Not specified."}`,
        `**Scope Boundaries:** ${data.scope || "Not specified."}`,
      ].join("\n");

      const result = await maybeKickoffSpecforgeFromMessage({
        message: modalMessage,
        sessionKey: sessionKey || "agent:argent:main",
        agentId: sessionAgentId,
      });

      respond(true, result, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },
};
