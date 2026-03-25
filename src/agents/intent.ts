import type {
  ArgentConfig,
  IntentAgentConfig,
  IntentConfig,
  IntentDepartmentConfig,
  IntentPolicyConfig,
  IntentRuntimeMode,
  IntentValidationMode,
} from "../config/types.js";
import { normalizeAgentId } from "../routing/session-key.js";

export type IntentIssue = {
  path: string;
  message: string;
};

export type IntentLineage = {
  globalVersion?: string;
  departmentId?: string;
  departmentVersion?: string;
  agentVersion?: string;
  parentGlobalVersion?: string;
  parentDepartmentVersion?: string;
};

export type ResolvedIntentForAgent = {
  agentId: string;
  departmentId?: string;
  runtimeMode: IntentRuntimeMode;
  validationMode: IntentValidationMode;
  policy: IntentPolicyConfig;
  lineage: IntentLineage;
  issues: IntentIssue[];
};

const ADDITIVE_LIST_KEYS = new Set([
  "neverDo",
  "requiresHumanApproval",
  "escalation.customerTiersAlwaysEscalate",
]);

function uniqueStrings(values: string[] | undefined): string[] | undefined {
  if (!values || values.length === 0) {
    return undefined;
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of values) {
    const value = String(raw ?? "").trim();
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    out.push(value);
  }
  return out.length > 0 ? out : undefined;
}

function mergeList(
  parent: string[] | undefined,
  child: string[] | undefined,
): string[] | undefined {
  return uniqueStrings([...(parent ?? []), ...(child ?? [])]);
}

function isSubset(values: string[], parentValues: string[]): boolean {
  const parentSet = new Set(parentValues);
  return values.every((value) => parentSet.has(value));
}

function isSuperset(values: string[], parentValues: string[]): boolean {
  const valueSet = new Set(values);
  return parentValues.every((value) => valueSet.has(value));
}

function hasPrefix(values: string[], prefix: string[]): boolean {
  if (prefix.length > values.length) {
    return false;
  }
  return prefix.every((value, index) => values[index] === value);
}

function normalizePolicy(policy: IntentPolicyConfig | undefined): IntentPolicyConfig {
  if (!policy) {
    return {};
  }
  return {
    ...policy,
    tradeoffHierarchy: uniqueStrings(policy.tradeoffHierarchy),
    neverDo: uniqueStrings(policy.neverDo),
    allowedActions: uniqueStrings(policy.allowedActions),
    requiresHumanApproval: uniqueStrings(policy.requiresHumanApproval),
    escalation: policy.escalation
      ? {
          ...policy.escalation,
          customerTiersAlwaysEscalate: uniqueStrings(policy.escalation.customerTiersAlwaysEscalate),
        }
      : undefined,
  };
}

function mergePolicy(parent: IntentPolicyConfig, child: IntentPolicyConfig): IntentPolicyConfig {
  const normalizedParent = normalizePolicy(parent);
  const normalizedChild = normalizePolicy(child);
  const mergedEscalation = {
    ...(normalizedParent.escalation ?? {}),
    ...(normalizedChild.escalation ?? {}),
  };

  const merged: IntentPolicyConfig = {
    ...normalizedParent,
    ...normalizedChild,
    neverDo: mergeList(normalizedParent.neverDo, normalizedChild.neverDo),
    requiresHumanApproval: mergeList(
      normalizedParent.requiresHumanApproval,
      normalizedChild.requiresHumanApproval,
    ),
    escalation: Object.keys(mergedEscalation).length > 0 ? mergedEscalation : undefined,
  };

  if (
    normalizedParent.escalation?.customerTiersAlwaysEscalate ||
    normalizedChild.escalation?.customerTiersAlwaysEscalate
  ) {
    merged.escalation = {
      ...(merged.escalation ?? {}),
      customerTiersAlwaysEscalate: mergeList(
        normalizedParent.escalation?.customerTiersAlwaysEscalate,
        normalizedChild.escalation?.customerTiersAlwaysEscalate,
      ),
    };
  }

  return merged;
}

function pushIssue(issues: IntentIssue[], path: string, message: string): void {
  issues.push({ path, message });
}

function validateChildPolicyMonotonic(params: {
  parent: IntentPolicyConfig;
  child: IntentPolicyConfig;
  childPath: string;
}): IntentIssue[] {
  const issues: IntentIssue[] = [];
  const parent = normalizePolicy(params.parent);
  const child = normalizePolicy(params.child);

  if (parent.tradeoffHierarchy && child.tradeoffHierarchy) {
    if (!hasPrefix(child.tradeoffHierarchy, parent.tradeoffHierarchy)) {
      pushIssue(
        issues,
        `${params.childPath}.tradeoffHierarchy`,
        "tradeoffHierarchy must preserve parent ordering (parent sequence must be a prefix).",
      );
    }
  }

  if (parent.allowedActions && child.allowedActions) {
    if (!isSubset(child.allowedActions, parent.allowedActions)) {
      pushIssue(
        issues,
        `${params.childPath}.allowedActions`,
        "allowedActions must be a subset of parent allowedActions.",
      );
    }
  }

  for (const key of ADDITIVE_LIST_KEYS) {
    if (key === "escalation.customerTiersAlwaysEscalate") {
      const parentValues = parent.escalation?.customerTiersAlwaysEscalate;
      const childValues = child.escalation?.customerTiersAlwaysEscalate;
      if (parentValues && childValues && !isSuperset(childValues, parentValues)) {
        pushIssue(
          issues,
          `${params.childPath}.${key}`,
          "customerTiersAlwaysEscalate may only add inherited tiers, never remove them.",
        );
      }
      continue;
    }
    const parentValues = parent[key as keyof IntentPolicyConfig] as string[] | undefined;
    const childValues = child[key as keyof IntentPolicyConfig] as string[] | undefined;
    if (parentValues && childValues && !isSuperset(childValues, parentValues)) {
      pushIssue(issues, `${params.childPath}.${key}`, `${key} may only add inherited entries.`);
    }
  }

  const stickyTrueFields: Array<keyof IntentPolicyConfig> = [
    "requireAcknowledgmentBeforeClose",
    "usePersistentHistory",
    "weightPreviousEscalations",
  ];
  for (const field of stickyTrueFields) {
    if (parent[field] === true && child[field] === false) {
      pushIssue(
        issues,
        `${params.childPath}.${String(field)}`,
        `${String(field)} cannot be set to false when parent requires true.`,
      );
    }
  }

  const parentSentiment = parent.escalation?.sentimentThreshold;
  const childSentiment = child.escalation?.sentimentThreshold;
  if (
    typeof parentSentiment === "number" &&
    typeof childSentiment === "number" &&
    childSentiment < parentSentiment
  ) {
    pushIssue(
      issues,
      `${params.childPath}.escalation.sentimentThreshold`,
      "sentimentThreshold must be >= parent threshold (higher means escalate sooner).",
    );
  }

  const parentAttempts = parent.escalation?.maxAttemptsBeforeEscalation;
  const childAttempts = child.escalation?.maxAttemptsBeforeEscalation;
  if (
    typeof parentAttempts === "number" &&
    typeof childAttempts === "number" &&
    childAttempts > parentAttempts
  ) {
    pushIssue(
      issues,
      `${params.childPath}.escalation.maxAttemptsBeforeEscalation`,
      "maxAttemptsBeforeEscalation must be <= parent threshold.",
    );
  }

  const parentTime = parent.escalation?.timeInConversationMinutes;
  const childTime = child.escalation?.timeInConversationMinutes;
  if (typeof parentTime === "number" && typeof childTime === "number" && childTime > parentTime) {
    pushIssue(
      issues,
      `${params.childPath}.escalation.timeInConversationMinutes`,
      "timeInConversationMinutes must be <= parent threshold.",
    );
  }

  return issues;
}

function resolveIntentAgentKey(intent: IntentConfig, agentId: string): string | undefined {
  const agents = intent.agents;
  if (!agents) {
    return undefined;
  }
  if (Object.hasOwn(agents, agentId)) {
    return agentId;
  }
  const normalized = normalizeAgentId(agentId);
  return Object.keys(agents).find((key) => normalizeAgentId(key) === normalized);
}

function resolveIntentAgentConfig(
  intent: IntentConfig,
  agentId: string,
): IntentAgentConfig | undefined {
  const key = resolveIntentAgentKey(intent, agentId);
  return key ? intent.agents?.[key] : undefined;
}

export function resolveIntentDepartmentConfig(
  intent: IntentConfig,
  departmentId: string | undefined,
): IntentDepartmentConfig | undefined {
  if (!departmentId) {
    return undefined;
  }
  const id = departmentId.trim();
  if (!id) {
    return undefined;
  }
  return intent.departments?.[id];
}

export function resolveEffectiveIntentForDepartment(params: {
  config: ArgentConfig;
  departmentId: string | undefined;
}): IntentPolicyConfig | undefined {
  const intent = params.config.intent;
  if (!intent || intent.enabled === false) {
    return undefined;
  }
  const department = resolveIntentDepartmentConfig(intent, params.departmentId);
  if (!department) {
    return undefined;
  }
  return mergePolicy(intent.global ?? {}, department);
}

export function resolveIntentValidationMode(cfg?: ArgentConfig): IntentValidationMode {
  const intent = cfg?.intent;
  if (!intent || intent.enabled === false) {
    return "off";
  }
  return intent.validationMode ?? "enforce";
}

export function resolveIntentRuntimeMode(cfg?: ArgentConfig): IntentRuntimeMode {
  const intent = cfg?.intent;
  if (!intent || intent.enabled === false) {
    return "off";
  }
  return intent.runtimeMode ?? "advisory";
}

export function validateIntentHierarchy(cfg?: ArgentConfig): IntentIssue[] {
  const intent = cfg?.intent;
  if (!intent || intent.enabled === false) {
    return [];
  }
  const issues: IntentIssue[] = [];
  const globalPolicy = normalizePolicy(intent.global);
  const globalVersion = intent.global?.version?.trim() || undefined;
  const departments = intent.departments ?? {};

  for (const [departmentId, departmentConfig] of Object.entries(departments)) {
    const departmentPath = `intent.departments.${departmentId}`;
    const parentGlobalVersion = departmentConfig.parentGlobalVersion?.trim();
    if (parentGlobalVersion) {
      if (!globalVersion) {
        pushIssue(
          issues,
          `${departmentPath}.parentGlobalVersion`,
          "parentGlobalVersion is set but intent.global.version is missing.",
        );
      } else if (parentGlobalVersion !== globalVersion) {
        pushIssue(
          issues,
          `${departmentPath}.parentGlobalVersion`,
          `parentGlobalVersion "${parentGlobalVersion}" does not match intent.global.version "${globalVersion}".`,
        );
      }
    }
    issues.push(
      ...validateChildPolicyMonotonic({
        parent: globalPolicy,
        child: departmentConfig,
        childPath: departmentPath,
      }),
    );
  }

  const agents = intent.agents ?? {};
  for (const [agentId, agentConfig] of Object.entries(agents)) {
    const agentPath = `intent.agents.${agentId}`;
    const parentGlobalVersion = agentConfig.parentGlobalVersion?.trim();
    if (parentGlobalVersion) {
      if (!globalVersion) {
        pushIssue(
          issues,
          `${agentPath}.parentGlobalVersion`,
          "parentGlobalVersion is set but intent.global.version is missing.",
        );
      } else if (parentGlobalVersion !== globalVersion) {
        pushIssue(
          issues,
          `${agentPath}.parentGlobalVersion`,
          `parentGlobalVersion "${parentGlobalVersion}" does not match intent.global.version "${globalVersion}".`,
        );
      }
    }

    const departmentId = agentConfig.departmentId?.trim();
    const department = resolveIntentDepartmentConfig(intent, departmentId);
    if (departmentId && !department) {
      pushIssue(
        issues,
        `${agentPath}.departmentId`,
        `Unknown departmentId "${departmentId}" (not present in intent.departments).`,
      );
    }

    const parentDepartmentVersion = agentConfig.parentDepartmentVersion?.trim();
    if (parentDepartmentVersion) {
      if (!departmentId) {
        pushIssue(
          issues,
          `${agentPath}.parentDepartmentVersion`,
          "parentDepartmentVersion requires departmentId.",
        );
      } else if (!department) {
        pushIssue(
          issues,
          `${agentPath}.parentDepartmentVersion`,
          `parentDepartmentVersion is set but department "${departmentId}" does not exist.`,
        );
      } else {
        const actualDepartmentVersion = department.version?.trim();
        if (!actualDepartmentVersion) {
          pushIssue(
            issues,
            `${agentPath}.parentDepartmentVersion`,
            `parentDepartmentVersion "${parentDepartmentVersion}" is set but intent.departments.${departmentId}.version is missing.`,
          );
        } else if (actualDepartmentVersion !== parentDepartmentVersion) {
          pushIssue(
            issues,
            `${agentPath}.parentDepartmentVersion`,
            `parentDepartmentVersion "${parentDepartmentVersion}" does not match intent.departments.${departmentId}.version "${actualDepartmentVersion}".`,
          );
        }
      }
    }

    const parent = department ?? globalPolicy;
    issues.push(
      ...validateChildPolicyMonotonic({
        parent,
        child: agentConfig,
        childPath: agentPath,
      }),
    );
  }
  return issues;
}

export function resolveEffectiveIntentForAgent(params: {
  config?: ArgentConfig;
  agentId: string;
}): ResolvedIntentForAgent | null {
  const intent = params.config?.intent;
  if (!intent || intent.enabled === false) {
    return null;
  }
  const issues = validateIntentHierarchy(params.config);
  const agentId = normalizeAgentId(params.agentId);
  const agentIntent = resolveIntentAgentConfig(intent, agentId);
  const departmentId = agentIntent?.departmentId?.trim() || undefined;
  const department = resolveIntentDepartmentConfig(intent, departmentId);

  let policy: IntentPolicyConfig = normalizePolicy(intent.global);
  if (department) {
    policy = mergePolicy(policy, department);
  }
  if (agentIntent) {
    policy = mergePolicy(policy, agentIntent);
  }

  return {
    agentId,
    departmentId,
    runtimeMode: resolveIntentRuntimeMode(params.config),
    validationMode: resolveIntentValidationMode(params.config),
    policy,
    lineage: {
      globalVersion: intent.global?.version,
      departmentId,
      departmentVersion: department?.version,
      agentVersion: agentIntent?.version,
      parentGlobalVersion: agentIntent?.parentGlobalVersion ?? department?.parentGlobalVersion,
      parentDepartmentVersion: agentIntent?.parentDepartmentVersion,
    },
    issues,
  };
}

export function buildIntentSystemPromptHint(policy: IntentPolicyConfig): string | undefined {
  const normalized = normalizePolicy(policy);
  const lines: string[] = ["## Intent Constraints (authoritative)"];
  if (normalized.objective) {
    lines.push(`Primary objective: ${normalized.objective}`);
  }
  if (normalized.tradeoffHierarchy && normalized.tradeoffHierarchy.length > 0) {
    lines.push(`Tradeoff order: ${normalized.tradeoffHierarchy.join(" > ")}`);
  }
  if (normalized.neverDo && normalized.neverDo.length > 0) {
    lines.push(`Never do: ${normalized.neverDo.join("; ")}`);
  }
  if (normalized.allowedActions && normalized.allowedActions.length > 0) {
    lines.push(`Allowed autonomous actions: ${normalized.allowedActions.join("; ")}`);
  }
  if (normalized.requiresHumanApproval && normalized.requiresHumanApproval.length > 0) {
    lines.push(`Always require human approval: ${normalized.requiresHumanApproval.join("; ")}`);
  }
  if (normalized.escalation?.sentimentThreshold !== undefined) {
    lines.push(`Escalate when sentiment <= ${normalized.escalation.sentimentThreshold}.`);
  }
  if (normalized.escalation?.maxAttemptsBeforeEscalation !== undefined) {
    lines.push(
      `Escalate after ${normalized.escalation.maxAttemptsBeforeEscalation} autonomous attempts.`,
    );
  }
  if (normalized.escalation?.timeInConversationMinutes !== undefined) {
    lines.push(
      `Escalate after ${normalized.escalation.timeInConversationMinutes} minutes in-conversation.`,
    );
  }
  if (
    normalized.escalation?.customerTiersAlwaysEscalate &&
    normalized.escalation.customerTiersAlwaysEscalate.length > 0
  ) {
    lines.push(
      `Always escalate tiers: ${normalized.escalation.customerTiersAlwaysEscalate.join(", ")}.`,
    );
  }
  if (lines.length === 1) {
    return undefined;
  }
  return lines.join("\n");
}
