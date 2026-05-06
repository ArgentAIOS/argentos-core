import type { AppForgeFieldType } from "../app-forge-model.js";
import crmTemplateSeed from "./crm.json" with { type: "json" };

export type AppForgeTemplateField = {
  id: string;
  name: string;
  type: AppForgeFieldType;
  description?: string;
  required?: boolean;
  options?: string[];
  linkedTableId?: string;
};

export type AppForgeTemplateViewType = "grid" | "kanban" | "form" | "review";

export type AppForgeTemplateView = {
  id: string;
  name: string;
  type: AppForgeTemplateViewType;
  filterText?: string;
  sortFieldId?: string;
  sortDirection?: "asc" | "desc";
  groupFieldId?: string;
  visibleFieldIds?: string[];
};

export type AppForgeTemplateTable = {
  id: string;
  name: string;
  fields: AppForgeTemplateField[];
  views: AppForgeTemplateView[];
};

export type AppForgeTemplate = {
  id: string;
  name: string;
  category: string;
  description: string;
  tables: AppForgeTemplateTable[];
};

const APP_FORGE_FIELD_TYPES: ReadonlySet<AppForgeFieldType> = new Set<AppForgeFieldType>([
  "text",
  "long_text",
  "single_select",
  "multi_select",
  "number",
  "date",
  "checkbox",
  "url",
  "email",
  "attachment",
  "linked_record",
]);

const APP_FORGE_TEMPLATE_VIEW_TYPES: ReadonlySet<AppForgeTemplateViewType> =
  new Set<AppForgeTemplateViewType>(["grid", "kanban", "form", "review"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function fieldType(value: unknown): AppForgeFieldType {
  return APP_FORGE_FIELD_TYPES.has(value as AppForgeFieldType)
    ? (value as AppForgeFieldType)
    : "text";
}

function viewType(value: unknown): AppForgeTemplateViewType {
  return APP_FORGE_TEMPLATE_VIEW_TYPES.has(value as AppForgeTemplateViewType)
    ? (value as AppForgeTemplateViewType)
    : "grid";
}

function normalizeOptions(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const labels = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return labels.length ? labels : undefined;
}

function normalizeField(value: unknown): AppForgeTemplateField | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = stringValue(value.id);
  const name = stringValue(value.name);
  if (!id || !name) {
    return null;
  }
  return {
    id,
    name,
    type: fieldType(value.type),
    description: stringValue(value.description),
    required: typeof value.required === "boolean" ? value.required : undefined,
    options: normalizeOptions(value.options),
    linkedTableId: stringValue(value.linkedTableId),
  };
}

function normalizeView(value: unknown): AppForgeTemplateView | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = stringValue(value.id);
  const name = stringValue(value.name);
  if (!id || !name) {
    return null;
  }
  return {
    id,
    name,
    type: viewType(value.type),
    filterText: stringValue(value.filterText),
    sortFieldId: stringValue(value.sortFieldId),
    sortDirection: value.sortDirection === "desc" ? "desc" : undefined,
    groupFieldId: stringValue(value.groupFieldId),
    visibleFieldIds: Array.isArray(value.visibleFieldIds)
      ? (value.visibleFieldIds as unknown[]).filter(
          (item): item is string => typeof item === "string" && item.length > 0,
        )
      : undefined,
  };
}

function normalizeTable(value: unknown): AppForgeTemplateTable | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = stringValue(value.id);
  const name = stringValue(value.name);
  if (!id || !name) {
    return null;
  }
  const rawFields = Array.isArray(value.fields) ? value.fields : [];
  const fields = rawFields
    .map((field) => normalizeField(field))
    .filter((field): field is AppForgeTemplateField => Boolean(field));
  if (fields.length === 0) {
    return null;
  }
  const rawViews = Array.isArray(value.views) ? value.views : [];
  const views = rawViews
    .map((view) => normalizeView(view))
    .filter((view): view is AppForgeTemplateView => Boolean(view));
  return { id, name, fields, views };
}

export function normalizeAppForgeTemplate(value: unknown): AppForgeTemplate | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = stringValue(value.id);
  const name = stringValue(value.name);
  if (!id || !name) {
    return null;
  }
  const category = stringValue(value.category) ?? "General";
  const description = stringValue(value.description) ?? "";
  const rawTables = Array.isArray(value.tables) ? value.tables : [];
  const tables = rawTables
    .map((table) => normalizeTable(table))
    .filter((table): table is AppForgeTemplateTable => Boolean(table));
  if (tables.length === 0) {
    return null;
  }
  return { id, name, category, description, tables };
}

const TEMPLATE_SEEDS: unknown[] = [crmTemplateSeed];

let cachedTemplates: AppForgeTemplate[] | null = null;

function loadTemplates(): AppForgeTemplate[] {
  if (cachedTemplates) {
    return cachedTemplates;
  }
  const result: AppForgeTemplate[] = [];
  for (const seed of TEMPLATE_SEEDS) {
    const template = normalizeAppForgeTemplate(seed);
    if (template) {
      result.push(template);
    }
  }
  cachedTemplates = result;
  return result;
}

export function listAppForgeTemplates(): AppForgeTemplate[] {
  return loadTemplates().map((template) => structuredClone(template));
}

export function getAppForgeTemplate(templateId: string): AppForgeTemplate | null {
  const trimmed = templateId.trim();
  if (!trimmed) {
    return null;
  }
  const template = loadTemplates().find((entry) => entry.id === trimmed);
  return template ? structuredClone(template) : null;
}

export function resetAppForgeTemplateCacheForTests(): void {
  cachedTemplates = null;
}
