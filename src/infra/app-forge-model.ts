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
  "rating",
] as const;

export const APP_FORGE_RATING_ICONS = ["star", "heart", "thumb", "flame"] as const;
export type AppForgeRatingIcon = (typeof APP_FORGE_RATING_ICONS)[number];

/** Default maximum rating value when a rating field omits `ratingMax`. */
export const APP_FORGE_DEFAULT_RATING_MAX = 5;
/** Minimum supported rating scale (avoids degenerate 0/1-only fields). */
export const APP_FORGE_MIN_RATING_MAX = 3;
/** Maximum supported rating scale (keeps the UI from becoming a slider). */
export const APP_FORGE_MAX_RATING_MAX = 10;

export type AppForgeFieldType = (typeof APP_FORGE_FIELD_TYPES)[number];

/**
 * Saved-view kinds that AppForge tables can render. Mirrors the dashboard's
 * `ForgeStructuredViewType` plus `calendar` (Phase 4 parity gap #1),
 * `gallery` (Phase 4 parity gap #2 — Airtable's 2nd-most-used view after
 * Grid), and `timeline` (Phase 4 parity gap #3 — date-range / Gantt-style
 * view) so saved views travel with the table as durable metadata rather
 * than living in the operator-local localStorage cache.
 */
export const APP_FORGE_SAVED_VIEW_TYPES = [
  "grid",
  "kanban",
  "form",
  "review",
  "calendar",
  "gallery",
  "timeline",
] as const;

export type AppForgeSavedViewType = (typeof APP_FORGE_SAVED_VIEW_TYPES)[number];

export type AppForgeSavedViewSortDirection = "asc" | "desc";

/**
 * A durable saved named view persisted on a table. Carries the per-operator
 * preferences (filter / sort / group / visible-fields) that used to live in
 * localStorage, so views are now shareable across operators and survive
 * browser restart / token rotation.
 *
 * Permissions inherit from the parent table — anyone with table-write access
 * may upsert/delete views on it. The migration path from the legacy
 * localStorage-only views is handled in `migrateLegacyLocalStorageSavedViews`
 * which projects the operator's stored shape onto this typed model.
 */
export type AppForgeSavedView = {
  id: string;
  name: string;
  type: AppForgeSavedViewType;
  filterText?: string;
  sortFieldId?: string;
  sortDirection?: AppForgeSavedViewSortDirection;
  groupFieldId?: string;
  visibleFieldIds?: string[];
  createdAt?: string;
  updatedAt?: string;
};

export type AppForgeSavedViewConfigError = {
  viewId: string;
  code:
    | "missing_id"
    | "missing_name"
    | "duplicate_view_id"
    | "duplicate_view_name"
    | "invalid_type"
    | "unknown_sort_field"
    | "unknown_group_field"
    | "unknown_visible_field"
    | "invalid_sort_direction";
  message: string;
};

export type AppForgeSavedViewConfigValidationResult = {
  ok: boolean;
  errors: AppForgeSavedViewConfigError[];
};

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
  /** Maximum value for `rating` fields. Defaults to {@link APP_FORGE_DEFAULT_RATING_MAX}. */
  ratingMax?: number;
  /** Glyph used to render `rating` fields. Defaults to `"star"`. */
  ratingIcon?: AppForgeRatingIcon;
  /**
   * Opt-in: when true on a `rating` field, the cell accepts 0.5 increments
   * (e.g. 4.5★) and renders a half-filled glyph. Defaults to `false`
   * (integer-only) so existing rating columns are unchanged.
   */
  allowHalf?: boolean;
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
  defaultViewId?: string;
  selectedFieldId?: string;
  activeCell?: {
    recordId: string;
    fieldId: string;
  };
  /**
   * Durable saved named views on this table. Each view is a first-class
   * metadata entry — view selection survives browser restart, token rotation,
   * and is shareable across operators. See {@link AppForgeSavedView}.
   */
  views?: AppForgeSavedView[];
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
    | "invalid_array"
    | "invalid_rating";
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
    | "invalid_default"
    | "invalid_rating_max";
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

/** Clamp a candidate rating-max to the supported range, returning the field default on garbage. */
export function resolveAppForgeRatingMax(field: Pick<AppForgeField, "ratingMax">): number {
  const candidate = field.ratingMax;
  if (typeof candidate !== "number" || !Number.isFinite(candidate)) {
    return APP_FORGE_DEFAULT_RATING_MAX;
  }
  const rounded = Math.trunc(candidate);
  if (rounded < APP_FORGE_MIN_RATING_MAX) {
    return APP_FORGE_MIN_RATING_MAX;
  }
  if (rounded > APP_FORGE_MAX_RATING_MAX) {
    return APP_FORGE_MAX_RATING_MAX;
  }
  return rounded;
}

/**
 * Normalize a rating value to a value in [0, resolvedMax], or `null` when
 * invalid.
 *
 * - When `field.allowHalf` is truthy the value is snapped to the nearest 0.5
 *   increment (so 3.4 → 3.5, 3.74 → 3.5, 3.76 → 4.0).
 * - Otherwise the value is rounded to the nearest whole integer, preserving
 *   the original integer-only behavior so existing rating columns are
 *   bit-identical after this change.
 */
export function coerceAppForgeRatingValue(
  field: Pick<AppForgeField, "ratingMax" | "allowHalf">,
  value: unknown,
): number | null {
  if (value === null || value === undefined || value === "") {
    return 0;
  }
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  const snapped = field.allowHalf ? Math.round(parsed * 2) / 2 : Math.round(parsed);
  if (snapped < 0) {
    return null;
  }
  const max = resolveAppForgeRatingMax(field);
  if (snapped > max) {
    return null;
  }
  return snapped;
}

/**
 * True iff `value` is a finite non-negative multiple of 0.5 (half steps). Used
 * by validation to reject quarter / arbitrary fractional drafts when
 * `allowHalf` is enabled.
 */
function isHalfStep(value: number): boolean {
  if (!Number.isFinite(value) || value < 0) {
    return false;
  }
  return Number.isInteger(value * 2);
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
    if (field.type === "rating") {
      return 0;
    }
    return "";
  }

  if (field.type === "number") {
    const parsed = typeof value === "number" ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  if (field.type === "rating") {
    return coerceAppForgeRatingValue(field, value);
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

    if (field.type === "rating") {
      const max = resolveAppForgeRatingMax(field);
      const allowHalf = field.allowHalf === true;
      const isValid =
        typeof value === "number" &&
        value >= 0 &&
        value <= max &&
        (allowHalf ? isHalfStep(value) : Number.isInteger(value));
      if (!isValid) {
        errors.push(
          validationError(
            field,
            "invalid_rating",
            allowHalf
              ? `${field.name} must be a multiple of 0.5 between 0 and ${max}.`
              : `${field.name} must be a whole number between 0 and ${max}.`,
          ),
        );
      }
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

    if (field.type === "rating" && field.ratingMax !== undefined) {
      if (
        typeof field.ratingMax !== "number" ||
        !Number.isFinite(field.ratingMax) ||
        !Number.isInteger(field.ratingMax) ||
        field.ratingMax < APP_FORGE_MIN_RATING_MAX ||
        field.ratingMax > APP_FORGE_MAX_RATING_MAX
      ) {
        errors.push(
          fieldConfigError(
            field,
            "invalid_rating_max",
            `${field.name} must use a rating scale between ${APP_FORGE_MIN_RATING_MAX} and ${APP_FORGE_MAX_RATING_MAX}.`,
          ),
        );
      }
    }

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
  if (type === "rating") {
    const rawMax = numberValue(value.ratingMax);
    if (rawMax !== undefined) {
      field.ratingMax = resolveAppForgeRatingMax({ ratingMax: rawMax });
    }
    const rawIcon = stringValue(value.ratingIcon);
    if (rawIcon && (APP_FORGE_RATING_ICONS as readonly string[]).includes(rawIcon)) {
      field.ratingIcon = rawIcon as AppForgeRatingIcon;
    }
    const rawAllowHalf = booleanValue(value.allowHalf);
    if (rawAllowHalf !== undefined) {
      field.allowHalf = rawAllowHalf;
    }
  }
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

// ---------------------------------------------------------------------------
// Saved-view durable model (Phase 4 gap #1)
// ---------------------------------------------------------------------------

function savedViewTypeValue(value: unknown): AppForgeSavedViewType {
  return APP_FORGE_SAVED_VIEW_TYPES.includes(value as AppForgeSavedViewType)
    ? (value as AppForgeSavedViewType)
    : "grid";
}

function sortDirectionValue(value: unknown): AppForgeSavedViewSortDirection | undefined {
  return value === "asc" || value === "desc" ? value : undefined;
}

/**
 * Normalize an unknown candidate into a typed {@link AppForgeSavedView}.
 *
 * - Unknown `type` values fall back to `"grid"` (matches dashboard behavior).
 * - `sortDirection` is dropped when not `"asc" | "desc"` (avoids storing the
 *   string `"none"` legacy callers used to write).
 * - Identifier and name are required; if either is missing/blank the function
 *   returns `null` so callers can drop the view from the durable list.
 */
export function normalizeAppForgeSavedView(value: unknown): AppForgeSavedView | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = stringValue(value.id);
  const name = stringValue(value.name);
  if (!id || !name) {
    return null;
  }
  const view: AppForgeSavedView = {
    id,
    name,
    type: savedViewTypeValue(value.type),
  };
  const filterText = typeof value.filterText === "string" ? value.filterText : undefined;
  if (filterText !== undefined) {
    view.filterText = filterText;
  }
  const sortFieldId = typeof value.sortFieldId === "string" ? value.sortFieldId : undefined;
  if (sortFieldId !== undefined) {
    view.sortFieldId = sortFieldId;
  }
  const sortDirection = sortDirectionValue(value.sortDirection);
  if (sortDirection !== undefined) {
    view.sortDirection = sortDirection;
  }
  const groupFieldId = typeof value.groupFieldId === "string" ? value.groupFieldId : undefined;
  if (groupFieldId !== undefined) {
    view.groupFieldId = groupFieldId;
  }
  const visibleFieldIds = stringArrayValue(value.visibleFieldIds);
  if (visibleFieldIds !== undefined) {
    view.visibleFieldIds = visibleFieldIds;
  }
  const createdAt = stringValue(value.createdAt);
  if (createdAt) {
    view.createdAt = createdAt;
  }
  const updatedAt = stringValue(value.updatedAt);
  if (updatedAt) {
    view.updatedAt = updatedAt;
  }
  return view;
}

/**
 * Normalize an arbitrary array of view candidates, dropping invalid entries.
 * Used by stores when projecting persisted metadata back into the model so
 * callers always see typed views (no `unknown[]` escape hatches).
 */
export function normalizeAppForgeSavedViews(value: unknown): AppForgeSavedView[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const normalized: AppForgeSavedView[] = [];
  for (const candidate of value) {
    const view = normalizeAppForgeSavedView(candidate);
    if (view) {
      normalized.push(view);
    }
  }
  return normalized;
}

function savedViewConfigError(
  viewId: string,
  code: AppForgeSavedViewConfigError["code"],
  message: string,
): AppForgeSavedViewConfigError {
  return { viewId, code, message };
}

/**
 * Validate a list of saved views against the field set on their parent table.
 * Catches duplicate ids/names, unknown sort/group/visible field references,
 * and bad enum values before the views become durable table metadata.
 *
 * Backward-compat: fields are optional. When omitted, only structural checks
 * (id/name/type/sortDirection/duplicate-id/duplicate-name) run — this is the
 * mode legacy callers without table context get.
 */
export function validateAppForgeSavedViews(
  views: AppForgeSavedView[],
  fields?: Pick<AppForgeField, "id">[],
): AppForgeSavedViewConfigValidationResult {
  const errors: AppForgeSavedViewConfigError[] = [];
  const seenIds = new Set<string>();
  const seenNameKeys = new Set<string>();
  const fieldIds = fields ? new Set(fields.map((field) => field.id)) : null;

  for (const view of views) {
    if (!view.id.trim()) {
      errors.push(savedViewConfigError(view.id ?? "", "missing_id", "View id is required."));
    }
    if (!view.name.trim()) {
      errors.push(savedViewConfigError(view.id, "missing_name", "View name is required."));
    }

    if (seenIds.has(view.id)) {
      errors.push(
        savedViewConfigError(view.id, "duplicate_view_id", `Duplicate view id "${view.id}".`),
      );
    }
    seenIds.add(view.id);

    const nameKey = view.name.trim().toLowerCase();
    if (nameKey) {
      if (seenNameKeys.has(nameKey)) {
        errors.push(
          savedViewConfigError(
            view.id,
            "duplicate_view_name",
            `Duplicate view name "${view.name}".`,
          ),
        );
      }
      seenNameKeys.add(nameKey);
    }

    if (!APP_FORGE_SAVED_VIEW_TYPES.includes(view.type)) {
      errors.push(
        savedViewConfigError(view.id, "invalid_type", `View "${view.name}" has an invalid type.`),
      );
    }

    if (
      view.sortDirection !== undefined &&
      view.sortDirection !== "asc" &&
      view.sortDirection !== "desc"
    ) {
      errors.push(
        savedViewConfigError(
          view.id,
          "invalid_sort_direction",
          `View "${view.name}" sort direction must be "asc" or "desc".`,
        ),
      );
    }

    if (fieldIds) {
      if (view.sortFieldId && view.sortFieldId.trim() && !fieldIds.has(view.sortFieldId)) {
        errors.push(
          savedViewConfigError(
            view.id,
            "unknown_sort_field",
            `View "${view.name}" sorts by unknown field "${view.sortFieldId}".`,
          ),
        );
      }
      if (view.groupFieldId && view.groupFieldId.trim() && !fieldIds.has(view.groupFieldId)) {
        errors.push(
          savedViewConfigError(
            view.id,
            "unknown_group_field",
            `View "${view.name}" groups by unknown field "${view.groupFieldId}".`,
          ),
        );
      }
      if (view.visibleFieldIds?.length) {
        for (const fieldId of view.visibleFieldIds) {
          if (!fieldIds.has(fieldId)) {
            errors.push(
              savedViewConfigError(
                view.id,
                "unknown_visible_field",
                `View "${view.name}" exposes unknown field "${fieldId}".`,
              ),
            );
          }
        }
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

/**
 * One-time migration helper: project the operator's legacy localStorage view
 * shape into the durable {@link AppForgeSavedView} model. Existing operators'
 * stored views are translated lazily on first read so no manual data
 * migration is required — and missing/extra fields default cleanly.
 *
 * Returns `null` when the candidate has neither an `id` nor a `name`,
 * matching the dashboard's drop-stale-cache behavior.
 */
export function migrateLegacyLocalStorageSavedView(value: unknown): AppForgeSavedView | null {
  if (!isRecord(value)) {
    return null;
  }
  // Legacy entries used "kind" instead of "type" in one short-lived format.
  const normalized: Record<string, unknown> = {
    ...value,
    type: value.type ?? (value as { kind?: unknown }).kind,
  };
  // Fold "viewMode" (older AppForgeNamedView shape) into type as last resort.
  if (
    normalized.type === undefined &&
    typeof (value as { viewMode?: unknown }).viewMode === "string"
  ) {
    normalized.type = (value as { viewMode: string }).viewMode;
  }
  return normalizeAppForgeSavedView(normalized);
}
