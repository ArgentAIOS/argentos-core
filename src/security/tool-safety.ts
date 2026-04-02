/**
 * Canonical tool/runtime safety boundary helpers.
 *
 * This module centralizes the minimum Track 1 hardening ArgentOS needs before
 * tool outputs or endpoint targets cross runtime boundaries:
 *
 * - text redaction with structured leak-scan reporting
 * - optional external/untrusted content wrapping
 * - standardized safety metadata attached to tool results
 * - outbound HTTP target validation for guarded fetch sites
 */

import { resolvePinnedHostnameWithPolicy, type SsrFPolicy } from "../infra/net/ssrf.js";
import { redactSensitiveTextWithReport, type SensitiveRedactionReport } from "../utils/redact.js";
import {
  wrapExternalContent,
  type ExternalContentSource,
  type WrapExternalContentOptions,
} from "./external-content.js";

type ToolContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string }
  | Record<string, unknown>;

type ToolResultLike<TDetails = unknown> = {
  content: ToolContentBlock[];
  details: TDetails;
};

export type ToolSafetyExternalContentOptions = {
  source: ExternalContentSource;
  sender?: string;
  subject?: string;
  includeWarning?: boolean;
};

export type ToolSafetySummary = {
  boundary: "tool-safety-v1";
  externalContentWrapped: boolean;
  leakScan: Pick<SensitiveRedactionReport, "redacted" | "redactionCount" | "categories">;
};

export type SanitizedToolText = {
  text: string;
  safety: ToolSafetySummary;
};

/**
 * Sanitize model-visible text at the tool/runtime boundary.
 *
 * Redaction always runs first so any secret-like material is masked before the
 * text is optionally wrapped as external/untrusted content.
 */
export function sanitizeToolTextForModel(
  text: string | null | undefined,
  options: { externalContent?: ToolSafetyExternalContentOptions } = {},
): SanitizedToolText {
  const redaction = redactSensitiveTextWithReport(text);
  let nextText = redaction.text;
  let externalContentWrapped = false;

  if (options.externalContent) {
    const wrapOptions: WrapExternalContentOptions = {
      ...options.externalContent,
      includeWarning: options.externalContent.includeWarning ?? true,
    };
    nextText = wrapExternalContent(nextText, wrapOptions);
    externalContentWrapped = true;
  }

  return {
    text: nextText,
    safety: {
      boundary: "tool-safety-v1",
      externalContentWrapped,
      leakScan: {
        redacted: redaction.redacted,
        redactionCount: redaction.redactionCount,
        categories: redaction.categories,
      },
    },
  };
}

function mergeSafetyDetails<TDetails>(
  details: TDetails,
  safety: ToolSafetySummary,
): TDetails | ({ safety: ToolSafetySummary } & Record<string, unknown>) {
  if (details && typeof details === "object" && !Array.isArray(details)) {
    return { ...(details as Record<string, unknown>), safety };
  }
  return { safety, ...(details === undefined ? {} : { originalDetails: details }) };
}

/**
 * Apply the canonical safety boundary to a full agent tool result.
 *
 * Only text blocks are transformed. Image and other non-text blocks are left
 * untouched, while details get a consistent `safety` envelope.
 */
export function sanitizeToolResultForModel<TDetails>(
  result: ToolResultLike<TDetails>,
  options: { externalContent?: ToolSafetyExternalContentOptions } = {},
): ToolResultLike<TDetails | ({ safety: ToolSafetySummary } & Record<string, unknown>)> {
  let aggregateSafety: ToolSafetySummary = {
    boundary: "tool-safety-v1",
    externalContentWrapped: false,
    leakScan: {
      redacted: false,
      redactionCount: 0,
      categories: [],
    },
  };

  const categorySet = new Set<string>();
  const content = (Array.isArray(result.content) ? result.content : []).map((block) => {
    if (!block || typeof block !== "object") {
      return block;
    }
    const record = block as { type?: unknown; text?: unknown };
    if (record.type !== "text" || typeof record.text !== "string") {
      return block;
    }

    const sanitized = sanitizeToolTextForModel(record.text, options);
    aggregateSafety = {
      boundary: "tool-safety-v1",
      externalContentWrapped:
        aggregateSafety.externalContentWrapped || sanitized.safety.externalContentWrapped,
      leakScan: {
        redacted: aggregateSafety.leakScan.redacted || sanitized.safety.leakScan.redacted,
        redactionCount:
          aggregateSafety.leakScan.redactionCount + sanitized.safety.leakScan.redactionCount,
        categories: aggregateSafety.leakScan.categories,
      },
    };
    for (const category of sanitized.safety.leakScan.categories) {
      categorySet.add(category);
    }
    return { ...block, text: sanitized.text };
  });

  aggregateSafety = {
    ...aggregateSafety,
    leakScan: {
      ...aggregateSafety.leakScan,
      categories: Array.from(categorySet),
    },
  };

  return {
    content,
    details: mergeSafetyDetails(result.details, aggregateSafety),
  };
}

/**
 * Validate an outbound HTTP(S) endpoint against a fail-closed allowlist/SSRF
 * policy before a runtime fetch uses it.
 */
export async function assertSafeHttpEndpoint(url: string, policy?: SsrFPolicy): Promise<string> {
  const trimmed = String(url ?? "").trim();
  if (!trimmed) {
    throw new Error("URL is required");
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`Invalid URL: ${trimmed}`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Invalid URL protocol: ${parsed.protocol}`);
  }

  await resolvePinnedHostnameWithPolicy(parsed.hostname, { policy });
  return parsed.toString();
}
