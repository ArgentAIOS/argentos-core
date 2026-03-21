import Ajv2020 from "ajv/dist/2020.js";
import type { AnyAgentTool } from "./pi-tools.types.js";
import { cleanSchemaForGemini } from "./schema/clean-for-gemini.js";

const ajv2020 = new Ajv2020({
  allErrors: false,
  strict: false,
  validateFormats: false,
});

type SchemaContext = {
  toolName: string;
  toolIndex: number;
  strict: boolean;
};

function toDraft2020SchemaOrFallback(
  schema: unknown,
  context: SchemaContext,
): Record<string, unknown> {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    if (context.strict) {
      throw new Error(
        `Invalid tool schema: tools.${context.toolIndex}.${context.toolName}.input_schema is not an object schema`,
      );
    }
    return { type: "object", properties: {} };
  }
  try {
    const valid = ajv2020.validateSchema(schema);
    if (valid) {
      return schema as Record<string, unknown>;
    }
    if (context.strict) {
      const details =
        ajv2020.errorsText(ajv2020.errors, { separator: "; " }) || "unknown schema error";
      throw new Error(
        `Invalid tool schema: tools.${context.toolIndex}.${context.toolName}.input_schema failed draft-2020-12 validation: ${details}`,
      );
    }
  } catch (error) {
    if (context.strict) {
      if (error instanceof Error) {
        throw error;
      }
      throw new Error(
        `Invalid tool schema: tools.${context.toolIndex}.${context.toolName}.input_schema could not be validated`,
      );
    }
  }
  // Safety fallback: one invalid tool schema should not reject the entire LLM request.
  return { type: "object", properties: {} };
}

function extractEnumValues(schema: unknown): unknown[] | undefined {
  if (!schema || typeof schema !== "object") {
    return undefined;
  }
  const record = schema as Record<string, unknown>;
  if (Array.isArray(record.enum)) {
    return record.enum;
  }
  if ("const" in record) {
    return [record.const];
  }
  const variants = Array.isArray(record.anyOf)
    ? record.anyOf
    : Array.isArray(record.oneOf)
      ? record.oneOf
      : null;
  if (variants) {
    const values = variants.flatMap((variant) => {
      const extracted = extractEnumValues(variant);
      return extracted ?? [];
    });
    return values.length > 0 ? values : undefined;
  }
  return undefined;
}

function mergePropertySchemas(existing: unknown, incoming: unknown): unknown {
  if (!existing) {
    return incoming;
  }
  if (!incoming) {
    return existing;
  }

  const existingEnum = extractEnumValues(existing);
  const incomingEnum = extractEnumValues(incoming);
  if (existingEnum || incomingEnum) {
    const values = Array.from(new Set([...(existingEnum ?? []), ...(incomingEnum ?? [])]));
    const merged: Record<string, unknown> = {};
    for (const source of [existing, incoming]) {
      if (!source || typeof source !== "object") {
        continue;
      }
      const record = source as Record<string, unknown>;
      for (const key of ["title", "description", "default"]) {
        if (!(key in merged) && key in record) {
          merged[key] = record[key];
        }
      }
    }
    const types = new Set(values.map((value) => typeof value));
    if (types.size === 1) {
      merged.type = Array.from(types)[0];
    }
    merged.enum = values;
    return merged;
  }

  return existing;
}

export function normalizeToolParameters(
  tool: AnyAgentTool,
  options?: { strict?: boolean; toolIndex?: number },
): AnyAgentTool {
  const schema =
    tool.parameters && typeof tool.parameters === "object"
      ? (tool.parameters as Record<string, unknown>)
      : undefined;
  if (!schema) {
    return tool;
  }

  // Provider quirks:
  // - Gemini rejects several JSON Schema keywords, so we scrub those.
  // - OpenAI rejects function tool schemas unless the *top-level* is `type: "object"`.
  //   (TypeBox root unions compile to `{ anyOf: [...] }` without `type`).
  //
  // Normalize once here so callers can always pass `tools` through unchanged.

  // If schema already has type + properties (no top-level anyOf to merge),
  // still clean it for Gemini compatibility
  const schemaContext: SchemaContext = {
    strict: options?.strict === true,
    toolIndex: options?.toolIndex ?? -1,
    toolName: tool.name,
  };
  if ("type" in schema && "properties" in schema && !Array.isArray(schema.anyOf)) {
    return {
      ...tool,
      parameters: toDraft2020SchemaOrFallback(cleanSchemaForGemini(schema), schemaContext),
    };
  }

  // Some tool schemas (esp. unions) may omit `type` at the top-level. If we see
  // object-ish fields, force `type: "object"` so OpenAI accepts the schema.
  if (
    !("type" in schema) &&
    (typeof schema.properties === "object" || Array.isArray(schema.required)) &&
    !Array.isArray(schema.anyOf) &&
    !Array.isArray(schema.oneOf)
  ) {
    return {
      ...tool,
      parameters: toDraft2020SchemaOrFallback(
        cleanSchemaForGemini({ ...schema, type: "object" }),
        schemaContext,
      ),
    };
  }

  const variantKey = Array.isArray(schema.anyOf)
    ? "anyOf"
    : Array.isArray(schema.oneOf)
      ? "oneOf"
      : null;
  if (!variantKey) {
    return {
      ...tool,
      parameters: toDraft2020SchemaOrFallback(cleanSchemaForGemini(schema), schemaContext),
    };
  }
  const variants = schema[variantKey] as unknown[];
  const mergedProperties: Record<string, unknown> = {};
  const requiredCounts = new Map<string, number>();
  let objectVariants = 0;

  for (const entry of variants) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const props = (entry as { properties?: unknown }).properties;
    if (!props || typeof props !== "object") {
      continue;
    }
    objectVariants += 1;
    for (const [key, value] of Object.entries(props as Record<string, unknown>)) {
      if (!(key in mergedProperties)) {
        mergedProperties[key] = value;
        continue;
      }
      mergedProperties[key] = mergePropertySchemas(mergedProperties[key], value);
    }
    const required = Array.isArray((entry as { required?: unknown }).required)
      ? (entry as { required: unknown[] }).required
      : [];
    for (const key of required) {
      if (typeof key !== "string") {
        continue;
      }
      requiredCounts.set(key, (requiredCounts.get(key) ?? 0) + 1);
    }
  }

  const baseRequired = Array.isArray(schema.required)
    ? schema.required.filter((key) => typeof key === "string")
    : undefined;
  const mergedRequired =
    baseRequired && baseRequired.length > 0
      ? baseRequired
      : objectVariants > 0
        ? Array.from(requiredCounts.entries())
            .filter(([, count]) => count === objectVariants)
            .map(([key]) => key)
        : undefined;

  const nextSchema: Record<string, unknown> = { ...schema };
  return {
    ...tool,
    // Flatten union schemas into a single object schema:
    // - Gemini doesn't allow top-level `type` together with `anyOf`.
    // - OpenAI rejects schemas without top-level `type: "object"`.
    // Merging properties preserves useful enums like `action` while keeping schemas portable.
    parameters: toDraft2020SchemaOrFallback(
      cleanSchemaForGemini({
        type: "object",
        ...(typeof nextSchema.title === "string" ? { title: nextSchema.title } : {}),
        ...(typeof nextSchema.description === "string"
          ? { description: nextSchema.description }
          : {}),
        properties:
          Object.keys(mergedProperties).length > 0 ? mergedProperties : (schema.properties ?? {}),
        ...(mergedRequired && mergedRequired.length > 0 ? { required: mergedRequired } : {}),
        additionalProperties: "additionalProperties" in schema ? schema.additionalProperties : true,
      }),
      schemaContext,
    ),
  };
}

export function cleanToolSchemaForGemini(schema: Record<string, unknown>): unknown {
  return cleanSchemaForGemini(schema);
}
