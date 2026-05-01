export const APP_FORGE_FIELD_TYPES = [
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
] as const;

export type AppForgeFieldType = (typeof APP_FORGE_FIELD_TYPES)[number];

export type AppForgeRecordValue = string | number | boolean | string[] | null;

export type AppForgeSelectOption = {
  id?: string;
  label: string;
  color?: string;
};

export type AppForgeField = {
  id: string;
  name: string;
  type: AppForgeFieldType;
  required?: boolean;
  description?: string;
  defaultValue?: AppForgeRecordValue;
  options?: string[];
  selectOptions?: AppForgeSelectOption[];
};

export type AppForgeRecord = {
  id: string;
  values: Record<string, AppForgeRecordValue>;
  revision: number;
  createdAt: string;
  updatedAt: string;
};

export type AppForgeTable = {
  id: string;
  name: string;
  fields: AppForgeField[];
  records: AppForgeRecord[];
  revision: number;
  activeViewId?: string;
  selectedFieldId?: string;
  views?: unknown[];
  metadata?: Record<string, unknown>;
};

export type AppForgeBase = {
  id: string;
  appId: string;
  name: string;
  description?: string;
  activeTableId: string;
  tables: AppForgeTable[];
  revision: number;
  updatedAt: string;
};

export type AppForgeValidationError = {
  fieldId: string;
  code:
    | "required"
    | "invalid_number"
    | "invalid_boolean"
    | "invalid_date"
    | "invalid_option"
    | "invalid_email"
    | "invalid_url"
    | "invalid_array";
  message: string;
};

export type AppForgeRecordValidationResult = {
  ok: boolean;
  values: Record<string, AppForgeRecordValue>;
  errors: AppForgeValidationError[];
};

export type AppForgeFieldConfigError = {
  fieldId: string;
  code:
    | "missing_name"
    | "duplicate_field_id"
    | "missing_option"
    | "duplicate_option"
    | "invalid_default";
  message: string;
};

export type AppForgeFieldConfigValidationResult = {
  ok: boolean;
  errors: AppForgeFieldConfigError[];
};

export type AppForgeRevisionCheck =
  | { ok: true }
  | {
      ok: false;
      code: "revision_conflict";
      expectedRevision: number;
      actualRevision: number;
      message: string;
    };

type LegacyAppForgeApp = {
  id: string;
  name: string;
  description?: string;
  metadata?: unknown;
  createdAt?: string;
  updatedAt?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function stringArrayValue(value: unknown): string[] | undefined {
  if (typeof value === "string") {
    return value
      .split(/[\n,]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function isArrayFieldType(
  type: AppForgeFieldType,
): type is "multi_select" | "attachment" | "linked_record" {
  return type === "multi_select" || type === "attachment" || type === "linked_record";
}

function fieldSupportsOptions(type: AppForgeFieldType): boolean {
  return type === "single_select" || type === "multi_select";
}

function fieldSupportsDefaultValue(type: AppForgeFieldType): boolean {
  return type !== "attachment" && type !== "linked_record";
}

function nowIso(): string {
  return new Date().toISOString();
}

function fieldType(value: unknown): AppForgeFieldType {
  return APP_FORGE_FIELD_TYPES.includes(value as AppForgeFieldType)
    ? (value as AppForgeFieldType)
    : "text";
}

function isEmptyValue(value: AppForgeRecordValue): boolean {
  return value === null || value === "" || (Array.isArray(value) && value.length === 0);
}

function validationError(
  field: AppForgeField,
  code: AppForgeValidationError["code"],
  message: string,
): AppForgeValidationError {
  return { fieldId: field.id, code, message };
}

function fieldConfigError(
  field: AppForgeField,
  code: AppForgeFieldConfigError["code"],
  message: string,
): AppForgeFieldConfigError {
  return { fieldId: field.id, code, message };
}

function optionLabelsForField(field: AppForgeField): string[] {
  const labels = field.selectOptions?.length
    ? field.selectOptions.map((option) => option.label.trim()).filter((label) => label.length > 0)
    : (field.options ?? []).map((option) => option.trim()).filter((option) => option.length > 0);
  return [...new Set(labels)];
}

export function checkAppForgeRevision(
  actualRevision: number,
  expectedRevision: number | undefined,
): AppForgeRevisionCheck {
  if (expectedRevision === undefined || expectedRevision === actualRevision) {
    return { ok: true };
  }
  return {
    ok: false,
    code: "revision_conflict",
    expectedRevision,
    actualRevision,
    message: `Expected revision ${expectedRevision}, found ${actualRevision}.`,
  };
}

export function coerceAppForgeRecordValue(
  field: AppForgeField,
  value: unknown,
): AppForgeRecordValue {
  if (value === null || value === undefined || value === "") {
    if (field.type === "checkbox") {
      return false;
    }
    if (isArrayFieldType(field.type)) {
      return [];
    }
    return "";
  }

  if (field.type === "number") {
    const parsed = typeof value === "number" ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  if (field.type === "checkbox") {
    if (typeof value === "boolean") {
      return value;
    }
    if (typeof value === "string") {
      return value.trim().toLowerCase() === "true";
    }
    return null;
  }

  if (isArrayFieldType(field.type)) {
    return stringArrayValue(value) ?? null;
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return null;
}

export function validateAppForgeRecordValues(
  fields: AppForgeField[],
  values: Record<string, unknown>,
): AppForgeRecordValidationResult {
  const errors: AppForgeValidationError[] = [];
  const normalized: Record<string, AppForgeRecordValue> = {};

  for (const field of fields) {
    const rawValue = values[field.id];
    const rawProvided = rawValue !== null && rawValue !== undefined && rawValue !== "";
    const value = coerceAppForgeRecordValue(field, rawValue);
    normalized[field.id] = value;

    if (field.required && isEmptyValue(value)) {
      errors.push(validationError(field, "required", `${field.name} is required.`));
      continue;
    }

    if (isEmptyValue(value) && !rawProvided) {
      continue;
    }

    if (field.type === "number" && typeof value !== "number") {
      errors.push(validationError(field, "invalid_number", `${field.name} must be a number.`));
    }

    if (field.type === "checkbox" && typeof value !== "boolean") {
      errors.push(validationError(field, "invalid_boolean", `${field.name} must be a boolean.`));
    }

    if (
      field.type === "date" &&
      (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    ) {
      errors.push(validationError(field, "invalid_date", `${field.name} must be YYYY-MM-DD.`));
    }

    if (
      field.type === "single_select" &&
      optionLabelsForField(field).length &&
      (typeof value !== "string" || !optionLabelsForField(field).includes(value))
    ) {
      errors.push(validationError(field, "invalid_option", `${field.name} has an invalid option.`));
    }

    if (isArrayFieldType(field.type)) {
      if (!Array.isArray(value)) {
        errors.push(validationError(field, "invalid_array", `${field.name} must be an array.`));
      } else if (field.type === "multi_select" && optionLabelsForField(field).length) {
        const labels = optionLabelsForField(field);
        const invalid = value.find((option) => !labels.includes(option));
        if (invalid) {
          errors.push(
            validationError(field, "invalid_option", `${field.name} has an invalid option.`),
          );
        }
      }
    }

    if (
      field.type === "email" &&
      (typeof value !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
    ) {
      errors.push(validationError(field, "invalid_email", `${field.name} must be an email.`));
    }

    if (field.type === "url" && typeof value === "string") {
      try {
        new URL(value);
      } catch {
        errors.push(validationError(field, "invalid_url", `${field.name} must be a URL.`));
      }
    }
  }

  return { ok: errors.length === 0, values: normalized, errors };
}

export function validateAppForgeFieldDefinitions(
  fields: AppForgeField[],
): AppForgeFieldConfigValidationResult {
  const errors: AppForgeFieldConfigError[] = [];
  const fieldIds = new Set<string>();

  for (const field of fields) {
    if (!field.name.trim()) {
      errors.push(fieldConfigError(field, "missing_name", "Field name is required."));
    }

    if (fieldIds.has(field.id)) {
      errors.push(
        fieldConfigError(field, "duplicate_field_id", `Duplicate field id "${field.id}".`),
      );
    }
    fieldIds.add(field.id);

    if (fieldSupportsOptions(field.type)) {
      const rawLabels = field.selectOptions?.length
        ? field.selectOptions.map((option) => option.label)
        : (field.options ?? []);
      const seenLabels = new Set<string>();
      for (const [index, label] of rawLabels.entries()) {
        const trimmed = label.trim();
        if (!trimmed) {
          errors.push(
            fieldConfigError(
              field,
              "missing_option",
              `${field.name} option ${index + 1} needs a label.`,
            ),
          );
          continue;
        }
        const key = trimmed.toLowerCase();
        if (seenLabels.has(key)) {
          errors.push(
            fieldConfigError(
              field,
              "duplicate_option",
              `${field.name} option "${trimmed}" is duplicated.`,
            ),
          );
        }
        seenLabels.add(key);
      }
    }

    if (field.defaultValue !== undefined) {
      if (!fieldSupportsDefaultValue(field.type)) {
        errors.push(
          fieldConfigError(
            field,
            "invalid_default",
            `${field.name} does not support default values yet.`,
          ),
        );
        continue;
      }
      const validation = validateAppForgeRecordValues([{ ...field, required: false }], {
        [field.id]: field.defaultValue,
      });
      if (!validation.ok || (field.required && isEmptyValue(validation.values[field.id] ?? ""))) {
        errors.push(
          fieldConfigError(field, "invalid_default", `${field.name} has an invalid default value.`),
        );
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

export function normalizeLegacyAppForgeField(value: unknown): AppForgeField | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = stringValue(value.id);
  const name = stringValue(value.name);
  if (!id || !name) {
    return null;
  }
  const type = fieldType(value.type);
  const options = stringArrayValue(value.options);
  const selectOptions = Array.isArray(value.selectOptions)
    ? value.selectOptions
        .filter(isRecord)
        .map((option): AppForgeSelectOption | null => {
          const label = stringValue(option.label);
          if (!label) {
            return null;
          }
          return {
            id: stringValue(option.id),
            label,
            color: stringValue(option.color),
          };
        })
        .filter((option): option is AppForgeSelectOption => Boolean(option))
    : undefined;
  const field: AppForgeField = {
    id,
    name,
    type,
    required: booleanValue(value.required),
    description: stringValue(value.description),
    options: fieldSupportsOptions(type)
      ? (selectOptions?.map((option) => option.label) ?? options)
      : undefined,
    selectOptions: fieldSupportsOptions(type) ? selectOptions : undefined,
  };
  const defaultValue = value.defaultValue;
  if (
    defaultValue === null ||
    typeof defaultValue === "string" ||
    typeof defaultValue === "number" ||
    typeof defaultValue === "boolean" ||
    Array.isArray(defaultValue)
  ) {
    field.defaultValue = coerceAppForgeRecordValue(field, defaultValue);
  }
  return field;
}

export function normalizeLegacyAppForgeRecord(
  value: unknown,
  fields: AppForgeField[],
): AppForgeRecord | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = stringValue(value.id);
  if (!id) {
    return null;
  }
  const rawValues = isRecord(value.values) ? value.values : {};
  return {
    id,
    values: validateAppForgeRecordValues(fields, rawValues).values,
    revision: numberValue(value.revision) ?? 1,
    createdAt: stringValue(value.createdAt) ?? nowIso(),
    updatedAt: stringValue(value.updatedAt) ?? nowIso(),
  };
}

export function projectLegacyAppForgeBase(app: LegacyAppForgeApp): AppForgeBase {
  const metadata = isRecord(app.metadata) ? app.metadata : {};
  const appForge = isRecord(metadata.appForge) ? metadata.appForge : {};
  const structured = isRecord(appForge.structured) ? appForge.structured : {};
  const rawTables = Array.isArray(structured.tables) ? structured.tables : [];
  const tables = rawTables
    .map((table): AppForgeTable | null => {
      if (!isRecord(table)) {
        return null;
      }
      const id = stringValue(table.id);
      const name = stringValue(table.name);
      if (!id || !name) {
        return null;
      }
      const fields = Array.isArray(table.fields)
        ? table.fields
            .map(normalizeLegacyAppForgeField)
            .filter((field): field is AppForgeField => Boolean(field))
        : [];
      const records = Array.isArray(table.records)
        ? table.records
            .map((record) => normalizeLegacyAppForgeRecord(record, fields))
            .filter((record): record is AppForgeRecord => Boolean(record))
        : [];
      return {
        id,
        name,
        fields,
        records,
        revision: numberValue(table.revision) ?? 1,
      };
    })
    .filter((table): table is AppForgeTable => Boolean(table));

  const activeTableId = stringValue(structured.activeTableId);
  const fallbackTable: AppForgeTable = {
    id: "table-main",
    name: "Projects",
    fields: [],
    records: [],
    revision: 1,
  };
  const normalizedTables = tables.length > 0 ? tables : [fallbackTable];

  return {
    id: stringValue(structured.baseId) ?? `base-${app.id}`,
    appId: app.id,
    name: app.name,
    description: app.description,
    activeTableId:
      activeTableId && normalizedTables.some((table) => table.id === activeTableId)
        ? activeTableId
        : normalizedTables[0].id,
    tables: normalizedTables,
    revision: numberValue(structured.revision) ?? 1,
    updatedAt: stringValue(structured.updatedAt) ?? app.updatedAt ?? app.createdAt ?? nowIso(),
  };
}
