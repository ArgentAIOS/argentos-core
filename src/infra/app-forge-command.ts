import {
  validateAppForgeRecordValues,
  type AppForgeBase,
  type AppForgeField,
  type AppForgeFieldType,
  type AppForgeRecord,
  type AppForgeRecordValue,
  type AppForgeTable,
} from "./app-forge-model.js";

export type AppForgeCommandPlanOperation =
  | {
      kind: "table.create";
      table: Pick<AppForgeTable, "id" | "name" | "fields" | "records" | "revision">;
    }
  | {
      kind: "table.rename";
      tableId: string;
      name: string;
    }
  | {
      kind: "field.create";
      tableId: string;
      field: AppForgeField;
    }
  | {
      kind: "record.create";
      tableId: string;
      values: Record<string, AppForgeRecordValue>;
    }
  | {
      kind: "record.update";
      tableId: string;
      recordId: string;
      values: Record<string, AppForgeRecordValue>;
    };

export type AppForgeCommandPlan = {
  ok: boolean;
  command: string;
  summary: string;
  confidence: "high" | "medium" | "low";
  operations: AppForgeCommandPlanOperation[];
  warnings: string[];
  assumptions: string[];
};

function cleanToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function cleanId(value: string, fallback: string): string {
  const cleaned = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return cleaned || fallback;
}

function titleCase(value: string): string {
  return value
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function fieldTypeFromText(value: string | undefined): AppForgeFieldType {
  const normalized = cleanToken(value ?? "").replace(/\s+/g, "_");
  switch (normalized) {
    case "long_text":
      return "long_text";
    case "single_select":
      return "single_select";
    case "multi_select":
      return "multi_select";
    case "number":
      return "number";
    case "date":
      return "date";
    case "checkbox":
      return "checkbox";
    case "url":
      return "url";
    case "email":
      return "email";
    case "attachment":
      return "attachment";
    case "linked_record":
      return "linked_record";
    default:
      return "text";
  }
}

function recordTitleField(table: AppForgeTable): AppForgeField | null {
  return (
    table.fields.find(
      (field) => cleanToken(field.name) === "name" || cleanToken(field.id) === "name",
    ) ??
    table.fields[0] ??
    null
  );
}

function findTable(base: AppForgeBase, reference: string | undefined) {
  if (reference) {
    const normalized = cleanToken(reference);
    return (
      base.tables.find(
        (table) => cleanToken(table.name) === normalized || cleanToken(table.id) === normalized,
      ) ?? null
    );
  }
  return base.tables.find((table) => table.id === base.activeTableId) ?? base.tables[0] ?? null;
}

function findField(table: AppForgeTable, reference: string) {
  const normalized = cleanToken(reference);
  return (
    table.fields.find(
      (field) => cleanToken(field.name) === normalized || cleanToken(field.id) === normalized,
    ) ?? null
  );
}

function findRecord(table: AppForgeTable, reference: string): AppForgeRecord | null {
  const titleField = recordTitleField(table);
  if (!titleField) {
    return null;
  }
  const normalized = cleanToken(reference);
  const matches = table.records.filter(
    (record) => cleanToken(String(record.values[titleField.id] ?? "")) === normalized,
  );
  return matches.length === 1 ? matches[0] : null;
}

function splitAssignments(input: string): string[] {
  const segments: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if ((char === '"' || char === "'") && (!quote || quote === char)) {
      quote = quote ? null : char;
      current += char;
      continue;
    }
    if (char === "," && !quote) {
      if (current.trim()) {
        segments.push(current.trim());
      }
      current = "";
      continue;
    }
    current += char;
  }

  if (current.trim()) {
    segments.push(current.trim());
  }
  return segments;
}

function stripQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function parseAssignment(part: string): [string, string] | null {
  const explicit = /^(.+?)\s*(?:=|:)\s*(.+)$/i.exec(part);
  if (explicit) {
    return [stripQuotes(explicit[1]), stripQuotes(explicit[2])];
  }
  const natural = /^(.+?)\s+is\s+(.+)$/i.exec(part);
  if (natural) {
    return [stripQuotes(natural[1]), stripQuotes(natural[2])];
  }
  return null;
}

function coerceValue(field: AppForgeField, raw: string): AppForgeRecordValue {
  if (field.type === "number") {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : raw;
  }
  if (field.type === "checkbox") {
    return /^(true|yes|1)$/i.test(raw);
  }
  return raw;
}

function planCreateTable(base: AppForgeBase, command: string): AppForgeCommandPlan | null {
  const match = /^(?:create|add)\s+(?:a\s+)?table(?:\s+(?:called|named))?\s+(.+)$/i.exec(command);
  if (!match) {
    return null;
  }
  const name = titleCase(stripQuotes(match[1]));
  return {
    ok: true,
    command,
    summary: `Create table ${name}.`,
    confidence: "high",
    operations: [
      {
        kind: "table.create",
        table: {
          id: cleanId(name, `table-${base.tables.length + 1}`),
          name,
          fields: [],
          records: [],
          revision: 0,
        },
      },
    ],
    warnings: [],
    assumptions: [],
  };
}

function planRenameTable(base: AppForgeBase, command: string): AppForgeCommandPlan | null {
  const match = /^rename\s+table\s+(.+?)\s+to\s+(.+)$/i.exec(command);
  if (!match) {
    return null;
  }
  const table = findTable(base, stripQuotes(match[1]));
  if (!table) {
    return {
      ok: false,
      command,
      summary: "Could not find the table to rename.",
      confidence: "low",
      operations: [],
      warnings: [`No AppForge table matched "${stripQuotes(match[1])}".`],
      assumptions: [],
    };
  }
  const name = titleCase(stripQuotes(match[2]));
  return {
    ok: true,
    command,
    summary: `Rename table ${table.name} to ${name}.`,
    confidence: "high",
    operations: [{ kind: "table.rename", tableId: table.id, name }],
    warnings: [],
    assumptions: [],
  };
}

function planAddField(base: AppForgeBase, command: string): AppForgeCommandPlan | null {
  const match =
    /^add\s+(?:(text|long text|single select|multi select|number|date|checkbox|url|email|attachment|linked record)\s+)?field\s+(?:(?:called|named)\s+)?(.+?)(?:\s+to\s+|\s+in\s+)(.+)$/i.exec(
      command,
    );
  if (!match) {
    return null;
  }
  const table = findTable(base, stripQuotes(match[3]));
  if (!table) {
    return {
      ok: false,
      command,
      summary: "Could not find the target table for the new field.",
      confidence: "low",
      operations: [],
      warnings: [`No AppForge table matched "${stripQuotes(match[3])}".`],
      assumptions: [],
    };
  }
  const name = titleCase(stripQuotes(match[2]));
  const fieldType = fieldTypeFromText(match[1]);
  return {
    ok: true,
    command,
    summary: `Add ${fieldType.replace(/_/g, " ")} field ${name} to ${table.name}.`,
    confidence: "high",
    operations: [
      {
        kind: "field.create",
        tableId: table.id,
        field: {
          id: cleanId(name, `field-${table.fields.length + 1}`),
          name,
          type: fieldType,
          options: fieldType === "single_select" || fieldType === "multi_select" ? [] : undefined,
        },
      },
    ],
    warnings: [],
    assumptions: [],
  };
}

function planCreateRecord(base: AppForgeBase, command: string): AppForgeCommandPlan | null {
  const match = /^(?:add|create)\s+(?:a\s+)?record\s+(?:to|in)\s+(.+?)\s+with\s+(.+)$/i.exec(
    command,
  );
  if (!match) {
    return null;
  }
  const table = findTable(base, stripQuotes(match[1]));
  if (!table) {
    return {
      ok: false,
      command,
      summary: "Could not find the target table for the new record.",
      confidence: "low",
      operations: [],
      warnings: [`No AppForge table matched "${stripQuotes(match[1])}".`],
      assumptions: [],
    };
  }

  const rawValues: Record<string, AppForgeRecordValue> = {};
  const warnings: string[] = [];
  for (const part of splitAssignments(match[2])) {
    const assignment = parseAssignment(part);
    if (!assignment) {
      warnings.push(`Could not parse assignment "${part}". Use field=value pairs.`);
      continue;
    }
    const [fieldName, rawValue] = assignment;
    const field = findField(table, fieldName);
    if (!field) {
      warnings.push(`No field matched "${fieldName}" in ${table.name}.`);
      continue;
    }
    rawValues[field.id] = coerceValue(field, rawValue);
  }

  const validation = validateAppForgeRecordValues(
    table.fields,
    Object.fromEntries(Object.entries(rawValues).map(([key, value]) => [key, value])),
  );
  if (!validation.ok) {
    warnings.push(...validation.errors.map((error) => error.message));
  }

  return {
    ok: warnings.length === 0 && validation.ok,
    command,
    summary: `Create a record in ${table.name}.`,
    confidence: warnings.length === 0 ? "high" : "medium",
    operations: [{ kind: "record.create", tableId: table.id, values: validation.values }],
    warnings,
    assumptions: [],
  };
}

function planUpdateRecord(base: AppForgeBase, command: string): AppForgeCommandPlan | null {
  const match = /^set\s+(.+?)\s+to\s+(.+?)\s+for\s+(.+?)(?:\s+in\s+(.+))?$/i.exec(command);
  if (!match) {
    return null;
  }
  const assumptions: string[] = [];
  const table = findTable(base, stripQuotes(match[4]));
  if (!table) {
    return {
      ok: false,
      command,
      summary: "Could not determine which table to update.",
      confidence: "low",
      operations: [],
      warnings: [
        match[4]
          ? `No AppForge table matched "${stripQuotes(match[4])}".`
          : "No active AppForge table is available for this command.",
      ],
      assumptions,
    };
  }
  if (!match[4]) {
    assumptions.push(`Used active table ${table.name}.`);
  }

  const field = findField(table, stripQuotes(match[1]));
  if (!field) {
    return {
      ok: false,
      command,
      summary: "Could not find the field to update.",
      confidence: "low",
      operations: [],
      warnings: [`No field matched "${stripQuotes(match[1])}" in ${table.name}.`],
      assumptions,
    };
  }

  const record = findRecord(table, stripQuotes(match[3]));
  if (!record) {
    return {
      ok: false,
      command,
      summary: "Could not find a unique record to update.",
      confidence: "low",
      operations: [],
      warnings: [`No unique record matched "${stripQuotes(match[3])}" in ${table.name}.`],
      assumptions,
    };
  }

  const nextValues = { ...record.values, [field.id]: coerceValue(field, stripQuotes(match[2])) };
  const validation = validateAppForgeRecordValues(table.fields, nextValues);
  const warnings = validation.errors.map((error) => error.message);

  return {
    ok: validation.ok,
    command,
    summary: `Update ${table.name} record ${record.id}.`,
    confidence: warnings.length === 0 ? "high" : "medium",
    operations: [
      {
        kind: "record.update",
        tableId: table.id,
        recordId: record.id,
        values: { [field.id]: validation.values[field.id] },
      },
    ],
    warnings,
    assumptions,
  };
}

export function planAppForgeCommand(base: AppForgeBase, command: string): AppForgeCommandPlan {
  const trimmed = command.trim();
  const planners = [
    planCreateTable,
    planRenameTable,
    planAddField,
    planCreateRecord,
    planUpdateRecord,
  ];
  for (const planner of planners) {
    const plan = planner(base, trimmed);
    if (plan) {
      return plan;
    }
  }
  return {
    ok: false,
    command: trimmed,
    summary: "Command was not recognized.",
    confidence: "low",
    operations: [],
    warnings: [
      "Supported commands currently cover creating or renaming tables, adding fields, creating records, and setting a field for a record.",
    ],
    assumptions: [],
  };
}
