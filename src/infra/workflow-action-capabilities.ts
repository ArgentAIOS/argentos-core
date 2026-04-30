import type { ActionType } from "./workflow-types.js";

export type WorkflowActionSideEffect =
  | "none"
  | "local_write"
  | "external_write"
  | "outbound_delivery"
  | "media_generation"
  | "script_execution";

export type WorkflowActionCapability = {
  id: ActionType["type"];
  label: string;
  category: string;
  description: string;
  sideEffect: WorkflowActionSideEffect;
  requiresOperatorApproval: boolean;
  dryRunSupported: boolean;
  outputHint: "text" | "artifact" | "document" | "structured";
};

export const WORKFLOW_ACTION_CAPABILITIES: WorkflowActionCapability[] = [
  {
    id: "send_message",
    label: "Send Message",
    category: "Delivery",
    description: "Send a workflow message through a configured channel such as Telegram.",
    sideEffect: "outbound_delivery",
    requiresOperatorApproval: true,
    dryRunSupported: true,
    outputHint: "text",
  },
  {
    id: "send_email",
    label: "Send Email",
    category: "Delivery",
    description: "Send a workflow email through the configured mail provider.",
    sideEffect: "outbound_delivery",
    requiresOperatorApproval: true,
    dryRunSupported: true,
    outputHint: "text",
  },
  {
    id: "create_task",
    label: "Create Task",
    category: "Operations",
    description: "Create a task from workflow output.",
    sideEffect: "external_write",
    requiresOperatorApproval: true,
    dryRunSupported: true,
    outputHint: "structured",
  },
  {
    id: "store_memory",
    label: "Store Memory",
    category: "Knowledge",
    description: "Store workflow output in agent memory.",
    sideEffect: "local_write",
    requiresOperatorApproval: false,
    dryRunSupported: true,
    outputHint: "structured",
  },
  {
    id: "store_knowledge",
    label: "Store Knowledge",
    category: "Knowledge",
    description: "Store workflow output in a knowledge collection.",
    sideEffect: "local_write",
    requiresOperatorApproval: false,
    dryRunSupported: true,
    outputHint: "structured",
  },
  {
    id: "webhook_call",
    label: "Call Webhook",
    category: "Integration",
    description: "Call an external webhook endpoint.",
    sideEffect: "external_write",
    requiresOperatorApproval: true,
    dryRunSupported: true,
    outputHint: "structured",
  },
  {
    id: "api_call",
    label: "Call API",
    category: "Integration",
    description: "Call an external API endpoint.",
    sideEffect: "external_write",
    requiresOperatorApproval: true,
    dryRunSupported: true,
    outputHint: "structured",
  },
  {
    id: "run_script",
    label: "Run Script",
    category: "Automation",
    description: "Run a sandboxed local script.",
    sideEffect: "script_execution",
    requiresOperatorApproval: true,
    dryRunSupported: true,
    outputHint: "structured",
  },
  {
    id: "generate_image",
    label: "Generate Image",
    category: "Media",
    description: "Generate an image artifact.",
    sideEffect: "media_generation",
    requiresOperatorApproval: true,
    dryRunSupported: true,
    outputHint: "artifact",
  },
  {
    id: "generate_audio",
    label: "Generate Audio",
    category: "Media",
    description: "Generate an audio artifact with text-to-speech.",
    sideEffect: "media_generation",
    requiresOperatorApproval: true,
    dryRunSupported: true,
    outputHint: "artifact",
  },
  {
    id: "podcast_plan",
    label: "Podcast Plan",
    category: "Podcast",
    description: "Normalize a podcast script into the payload expected by podcast generation.",
    sideEffect: "none",
    requiresOperatorApproval: false,
    dryRunSupported: true,
    outputHint: "structured",
  },
  {
    id: "podcast_generate",
    label: "Podcast Generate",
    category: "Podcast",
    description: "Render a full ElevenLabs v3 podcast episode from a planned dialogue payload.",
    sideEffect: "media_generation",
    requiresOperatorApproval: true,
    dryRunSupported: true,
    outputHint: "artifact",
  },
  {
    id: "save_to_docpanel",
    label: "Save to DocPanel",
    category: "Document",
    description: "Save workflow output to DocPanel.",
    sideEffect: "local_write",
    requiresOperatorApproval: false,
    dryRunSupported: true,
    outputHint: "document",
  },
  {
    id: "connector_action",
    label: "Connector Action",
    category: "Integration",
    description: "Run a configured connector action.",
    sideEffect: "external_write",
    requiresOperatorApproval: true,
    dryRunSupported: true,
    outputHint: "structured",
  },
];

const CAPABILITIES_BY_ID = new Map(
  WORKFLOW_ACTION_CAPABILITIES.map((capability) => [capability.id, capability]),
);

export function getWorkflowActionCapability(
  id: ActionType["type"],
): WorkflowActionCapability | undefined {
  return CAPABILITIES_BY_ID.get(id);
}

export function workflowActionRequiresApproval(id: ActionType["type"]): boolean {
  return CAPABILITIES_BY_ID.get(id)?.requiresOperatorApproval ?? true;
}
