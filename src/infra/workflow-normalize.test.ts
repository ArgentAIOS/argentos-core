import { describe, expect, it } from "vitest";
import { normalizeWorkflow, validateWorkflow } from "./workflow-normalize.js";

describe("workflow-normalize", () => {
  it("normalizes React Flow trigger, agent, approval, connector action, and output nodes", () => {
    const result = normalizeWorkflow({
      id: "wf-1",
      name: "VIP Email Alert",
      deploymentStage: "live",
      nodes: [
        { id: "trigger", type: "trigger", data: { triggerType: "manual" } },
        {
          id: "agent",
          type: "agentStep",
          data: { label: "Classify", agentId: "argent", rolePrompt: "Classify alert" },
        },
        {
          id: "approval",
          type: "gate",
          data: {
            label: "Approve send",
            config: { gateType: "approval", message: "Send Telegram alert?" },
          },
        },
        {
          id: "telegram",
          type: "action",
          data: {
            label: "Send alert",
            config: {
              connectorId: "aos-telegram-workflow",
              credentialId: "cred-1",
              resource: "message",
              operation: "message.send",
              chat_id: "operator",
              text: "{{previous.text}}",
            },
          },
        },
        { id: "out", type: "output", data: { outputType: "docpanel" } },
      ],
      edges: [
        { id: "e1", source: "trigger", target: "agent" },
        { id: "e2", source: "agent", target: "approval" },
        { id: "e3", source: "approval", target: "telegram" },
        { id: "e4", source: "telegram", target: "out" },
      ],
    });

    expect(result.issues.filter((issue) => issue.severity === "error")).toEqual([]);
    expect(result.workflow.nodes.map((node) => node.kind)).toEqual([
      "trigger",
      "agent",
      "gate",
      "action",
      "output",
    ]);
    const action = result.workflow.nodes.find((node) => node.id === "telegram");
    expect(action?.kind).toBe("action");
    if (action?.kind === "action") {
      expect(action.config.actionType).toMatchObject({
        type: "connector_action",
        connectorId: "aos-telegram-workflow",
        credentialId: "cred-1",
        resource: "message",
        operation: "message.send",
        parameters: { chat_id: "operator", text: "{{previous.text}}" },
      });
    }
    expect(result.canvasLayout.nodes).toHaveLength(5);
  });

  it("rejects live unsafe side effects that do not pass through an approval gate", () => {
    const result = normalizeWorkflow({
      id: "wf-unsafe",
      name: "Unsafe send",
      deploymentStage: "live",
      nodes: [
        { id: "trigger", type: "trigger", data: { triggerType: "manual" } },
        {
          id: "send",
          type: "action",
          data: {
            actionType: "send_message",
            config: { channelType: "telegram", channelId: "operator", template: "Hi" },
          },
        },
      ],
      edges: [{ id: "e1", source: "trigger", target: "send" }],
    });

    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "error",
          code: "unsafe_side_effect_without_approval",
          nodeId: "send",
        }),
      ]),
    );
  });

  it("validates canonical definitions without treating canvas layout as executable", () => {
    const result = normalizeWorkflow({
      id: "wf-canonical",
      name: "Canonical",
      nodes: [
        { id: "trigger", kind: "trigger", triggerType: "manual", config: {} },
        {
          id: "out",
          kind: "output",
          label: "Done",
          config: { outputType: "docpanel", title: "Done" },
        },
      ],
      edges: [{ id: "e1", source: "trigger", target: "out" }],
      canvasLayout: {
        nodes: [{ id: "visual", type: "unsupported", data: {} }],
        edges: [],
      },
    });

    expect(validateWorkflow(result.workflow).filter((issue) => issue.severity === "error")).toEqual(
      [],
    );
    expect(result.workflow.nodes).toHaveLength(2);
    expect(result.canvasLayout.nodes).toHaveLength(1);
  });

  it("normalizes model, memory, and tool side-port nodes into agent runtime bindings", () => {
    const result = normalizeWorkflow({
      id: "wf-agent-marketing",
      name: "Marketing workflow",
      deploymentStage: "draft",
      nodes: [
        { id: "trigger", type: "trigger", data: { triggerType: "manual" } },
        {
          id: "agent",
          type: "agentStep",
          data: {
            label: "Write social post",
            agentId: "writer",
            rolePrompt: "Draft campaign copy",
          },
        },
        {
          id: "model",
          type: "modelProvider",
          data: {
            label: "Campaign model",
            config: { provider: "anthropic", model: "claude-sonnet-4-6" },
          },
        },
        {
          id: "memory",
          type: "memorySource",
          data: {
            label: "Brand memory",
            config: { sourceType: "knowledge_collection", collectionId: "brand-voice" },
          },
        },
        {
          id: "tool",
          type: "toolGrant",
          data: {
            label: "Social connector",
            config: { grantType: "connector", connectorId: "aos-buffer-workflow" },
          },
        },
      ],
      edges: [
        { id: "e1", source: "trigger", target: "agent" },
        { id: "m", source: "model", target: "agent", targetHandle: "model" },
        { id: "k", source: "memory", target: "agent", targetHandle: "memory" },
        { id: "t", source: "tool", target: "agent", targetHandle: "tools" },
      ],
    });

    const agent = result.workflow.nodes.find((node) => node.id === "agent");
    expect(agent?.kind).toBe("agent");
    if (agent?.kind === "agent") {
      expect(agent.config.modelProviderNodeId).toBe("model");
      expect(agent.config.memorySourceNodeIds).toEqual(["memory"]);
      expect(agent.config.toolGrantNodeIds).toEqual(["tool"]);
    }

    const model = result.workflow.nodes.find((node) => node.id === "model");
    expect(model?.kind).toBe("gate");
    if (model?.kind === "gate") {
      expect(model.config).toMatchObject({
        gateType: "error_handler",
        nodeType: "model_provider",
        provider: "anthropic",
        model: "claude-sonnet-4-6",
      });
    }
    expect(result.issues.filter((issue) => issue.code === "disconnected_node")).toEqual([]);
  });

  it("normalizes current canvas gate form fields into executable gate config", () => {
    const result = normalizeWorkflow({
      id: "wf-gates",
      name: "Gate form mapping",
      deploymentStage: "draft",
      nodes: [
        { id: "trigger", type: "trigger", data: { triggerType: "manual" } },
        {
          id: "condition",
          type: "gate",
          data: {
            gateType: "condition",
            conditionField: "score",
            conditionOperator: ">=",
            conditionValue: "7",
          },
        },
        {
          id: "approval",
          type: "gate",
          data: {
            gateType: "approval",
            approvalMessage: "Approve campaign send?",
            showPreviousOutput: false,
            timeoutMinutes: 15,
            timeoutAction: "deny",
          },
        },
        {
          id: "event",
          type: "gate",
          data: {
            gateType: "wait_event",
            eventType: "workflow.review.completed",
            eventFilterJson: '{"status":"approved"}',
            timeoutMinutes: 10,
            timeoutAction: "fail",
          },
        },
      ],
      edges: [
        { id: "e1", source: "trigger", target: "condition" },
        { id: "e2", source: "condition", target: "approval" },
        { id: "e3", source: "approval", target: "event" },
      ],
    });

    const condition = result.workflow.nodes.find((node) => node.id === "condition");
    expect(condition?.kind).toBe("gate");
    if (condition?.kind === "gate") {
      expect(condition.config).toMatchObject({
        gateType: "condition",
        expression: { field: "score", operator: ">=", value: 7 },
      });
    }

    const approval = result.workflow.nodes.find((node) => node.id === "approval");
    expect(approval?.kind).toBe("gate");
    if (approval?.kind === "gate") {
      expect(approval.config).toMatchObject({
        gateType: "approval",
        message: "Approve campaign send?",
        showPreviousOutput: false,
        timeoutMs: 900_000,
        timeoutAction: "deny",
      });
    }

    const event = result.workflow.nodes.find((node) => node.id === "event");
    expect(event?.kind).toBe("gate");
    if (event?.kind === "gate") {
      expect(event.config).toMatchObject({
        gateType: "wait_event",
        eventType: "workflow.review.completed",
        eventFilter: { status: "approved" },
        timeoutMs: 600_000,
        timeoutAction: "fail",
      });
    }
    expect(result.issues.filter((issue) => issue.severity === "error")).toEqual([]);
  });

  it("normalizes AppForge event trigger fields from the canvas form", () => {
    const result = normalizeWorkflow({
      id: "wf-appforge-trigger",
      name: "AppForge Event",
      deploymentStage: "draft",
      nodes: [
        {
          id: "trigger",
          type: "trigger",
          data: {
            triggerType: "appforge_event",
            appId: "app-1",
            capabilityId: "review",
            eventType: "forge.review.completed",
            eventFilterJson: '{"decision":"approved"}',
          },
        },
        { id: "out", type: "output", data: { outputType: "docpanel" } },
      ],
      edges: [{ id: "e1", source: "trigger", target: "out" }],
    });

    const trigger = result.workflow.nodes.find((node) => node.id === "trigger");
    expect(trigger?.kind).toBe("trigger");
    if (trigger?.kind === "trigger") {
      expect(trigger.triggerType).toBe("appforge_event");
      expect(trigger.config).toMatchObject({
        appId: "app-1",
        capabilityId: "review",
        eventType: "forge.review.completed",
        eventFilter: { decision: "approved" },
      });
    }
    expect(result.issues.filter((issue) => issue.severity === "error")).toEqual([]);
  });

  it("normalizes current canvas output form fields into executable output config", () => {
    const result = normalizeWorkflow({
      id: "wf-outputs",
      name: "Output form mapping",
      deploymentStage: "draft",
      nodes: [
        { id: "trigger", type: "trigger", data: { triggerType: "manual" } },
        {
          id: "email",
          type: "output",
          data: {
            target: "email",
            recipient: "operator@example.com",
            subject: "Daily report",
            body: "Report: {{previous.text}}",
          },
        },
        {
          id: "webhook",
          type: "output",
          data: {
            target: "webhook",
            webhookUrl: "https://example.com/hook",
            method: "PUT",
            body: '{"ok":true}',
          },
        },
        {
          id: "discord",
          type: "output",
          data: {
            target: "discord",
            channelId: "campaigns",
            template: "{{previous.text}}",
          },
        },
      ],
      edges: [
        { id: "e1", source: "trigger", target: "email" },
        { id: "e2", source: "email", target: "webhook" },
        { id: "e3", source: "webhook", target: "discord" },
      ],
    });

    const email = result.workflow.nodes.find((node) => node.id === "email");
    expect(email?.kind).toBe("output");
    if (email?.kind === "output") {
      expect(email.config).toMatchObject({
        outputType: "email",
        to: "operator@example.com",
        subject: "Daily report",
        bodyTemplate: "Report: {{previous.text}}",
      });
    }

    const webhook = result.workflow.nodes.find((node) => node.id === "webhook");
    expect(webhook?.kind).toBe("output");
    if (webhook?.kind === "output") {
      expect(webhook.config).toMatchObject({
        outputType: "webhook",
        url: "https://example.com/hook",
        method: "PUT",
        bodyTemplate: '{"ok":true}',
      });
    }

    const discord = result.workflow.nodes.find((node) => node.id === "discord");
    expect(discord?.kind).toBe("output");
    if (discord?.kind === "output") {
      expect(discord.config).toMatchObject({
        outputType: "channel",
        channelType: "discord",
        channelId: "campaigns",
        template: "{{previous.text}}",
      });
    }
    expect(result.issues.filter((issue) => issue.severity === "error")).toEqual([]);
  });

  it("normalizes output source and payload template fields", () => {
    const result = normalizeWorkflow({
      id: "wf-output-source",
      name: "Output Source",
      deploymentStage: "draft",
      nodes: [
        { id: "trigger", type: "trigger", data: { triggerType: "manual" } },
        {
          id: "out",
          type: "output",
          data: {
            target: "doc_panel",
            title: "Operator Brief",
            sourceMode: "summary",
            sourceNodeId: "agent-1",
            contentTemplate: "Summary: {{previous.text}}",
          },
        },
      ],
      edges: [{ id: "e1", source: "trigger", target: "out" }],
    });

    const output = result.workflow.nodes.find((node) => node.id === "out");
    expect(output?.kind).toBe("output");
    if (output?.kind === "output") {
      expect(output.config).toMatchObject({
        outputType: "docpanel",
        title: "Operator Brief",
        sourceMode: "summary",
        sourceNodeId: "agent-1",
        contentTemplate: "Summary: {{previous.text}}",
      });
    }
  });

  it("parses action JSON fields from the canvas form", () => {
    const result = normalizeWorkflow({
      id: "wf-action-json",
      name: "Action JSON",
      deploymentStage: "draft",
      nodes: [
        { id: "trigger", type: "trigger", data: { triggerType: "manual" } },
        {
          id: "hook",
          type: "action",
          data: {
            actionType: "webhook_call",
            config: {
              url: "https://example.com/webhook",
              method: "POST",
              headers: '{"X-Workflow":"yes"}',
              body: '{"text":"{{previous.text}}"}',
            },
          },
        },
      ],
      edges: [{ id: "e1", source: "trigger", target: "hook" }],
    });

    const hook = result.workflow.nodes.find((node) => node.id === "hook");
    expect(hook?.kind).toBe("action");
    if (hook?.kind === "action") {
      expect(hook.config.actionType).toMatchObject({
        type: "webhook_call",
        headers: { "X-Workflow": "yes" },
        bodyTemplate: '{"text":"{{previous.text}}"}',
      });
    }
    expect(result.issues.filter((issue) => issue.code === "invalid_json_object")).toEqual([]);
  });
});
