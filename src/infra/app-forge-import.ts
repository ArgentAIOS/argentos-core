import {
  validateAppForgeRecordValues,
  type AppForgeBase,
  type AppForgeField,
  type AppForgeFieldType,
  type AppForgeRatingIcon,
  type AppForgeRecord,
  type AppForgeRecordValue,
  type AppForgeValidationError,
} from "./app-forge-model.js";

export type AppForgeImportPreviewRequest = {
  csv: string;
  tableName?: string;
  base?: Pick<AppForgeBase, "activeTableId" | "tables"> | null;
  targetTableId?: string;
  maxRows?: number;
  /** Caller overrides for inferred columns (rename / retype / skip). */
  overrides?: AppForgeImportColumnOverride[];
};

export type AppForgeImportColumnOverride = {
  /** Match by header text (case-insensitive cleaned). Either this or fieldId is required. */
  header?: string;
  /** Match by previously-inferred field id, useful after a preview round-trip. */
  fieldId?: string;
  /** Force a different rendered field name. */
  fieldName?: string;
  /** Force a different inferred type. */
  type?: AppForgeFieldType;
  /** Skip this column entirely during commit. */
  skip?: boolean;
  /** Force select option labels (single_select / multi_select only). */
  options?: string[];
};

export type AppForgeImportPreviewColumn = {
  header: string;
  fieldId: string;
  fieldName: string;
  type: AppForgeFieldType;
  required?: boolean;
  options?: string[];
  matchedFieldId?: string;
  /** Maximum value for `rating`-typed columns matched to an existing field. */
  ratingMax?: number;
  /** Glyph for `rating`-typed columns matched to an existing field. */
  ratingIcon?: AppForgeRatingIcon;
  /** True when the caller has marked this column to be skipped at commit. */
  skipped?: boolean;
};

export type AppForgeImportPreviewRow = {
  rowNumber: number;
  raw: Record<string, string>;
  values: Record<string, AppForgeRecordValue>;
  errors: AppForgeValidationError[];
};

export type AppForgeImportPreview = {
  tableName: string;
  delimiter: string;
  columns: AppForgeImportPreviewColumn[];
  fields: AppForgeField[];
  rows: AppForgeImportPreviewRow[];
  totalRows: number;
  previewRowCount: number;
  skippedEmptyRows: number;
  warnings: string[];
};

export type AppForgeImportCommitRequest = {
  csv: string;
  tableName?: string;
  base?: Pick<AppForgeBase, "activeTableId" | "tables"> | null;
  targetTableId?: string;
  overrides?: AppForgeImportColumnOverride[];
  /** Records-per-batch when chunking for commit. Defaults to 50, clamped to [1, 500]. */
  batchSize?: number;
  /** Skip rows with validation errors instead of attempting to write them. Defaults to true. */
  skipInvalidRows?: boolean;
  /** Stable prefix for generated record IDs. Defaults to `imp`. */
  recordIdPrefix?: string;
};

export type AppForgeImportCommitRow = {
  rowNumber: number;
  recordId: string;
  raw: Record<string, string>;
  values: Record<string, AppForgeRecordValue>;
  errors: AppForgeValidationError[];
  /** True when commit should skip this row. */
  skip: boolean;
  /** Reason the row was marked skip. */
  skipReason?: "invalid";
};

export type AppForgeImportCommitPlan = {
  tableName: string;
  delimiter: string;
  columns: AppForgeImportPreviewColumn[];
  fields: AppForgeField[];
  rows: AppForgeImportCommitRow[];
  /** Rows grouped into commit-ready batches (skip rows excluded). */
  batches: AppForgeImportCommitRow[][];
  totalRows: number;
  skippedEmptyRows: number;
  skippedInvalidRows: number;
  validRowCount: number;
  invalidRowCount: number;
  batchSize: number;
  warnings: string[];
};

export type AppForgeImportCommitRowResult = {
  rowNumber: number;
  recordId: string;
  ok: boolean;
  reason?: "invalid" | "write_failed" | "skipped";
  message?: string;
  errors?: AppForgeValidationError[];
};

export type AppForgeImportCommitReport = {
  tableName: string;
  totalRows: number;
  attempted: number;
  committed: number;
  failed: number;
  skippedInvalid: number;
  skippedEmpty: number;
  batchSize: number;
  batchCount: number;
  warnings: string[];
  rows: AppForgeImportCommitRowResult[];
};

export type AppForgeImportWriteRecordContext = {
  rowNumber: number;
  batchIndex: number;
  rowIndexInBatch: number;
};

export type AppForgeImportWriteRecordOutcome =
  | { ok: true; record?: AppForgeRecord }
  | { ok: false; message?: string };

export type AppForgeImportWriteRecordFn = (
  record: AppForgeRecord,
  context: AppForgeImportWriteRecordContext,
) => Promise<AppForgeImportWriteRecordOutcome>;

type ParsedCsv = {
  rows: string[][];
  delimiter: string;
};

const DEFAULT_BATCH_SIZE = 50;
const MIN_BATCH_SIZE = 1;
const MAX_BATCH_SIZE = 500;

function isBlankRow(row: string[]): boolean {
  return row.every((value) => value.trim() === "");
}

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
  const trimmed = value.trim();
  if (!trimmed) {
    return "Column";
  }
  return trimmed
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function inferDelimiter(text: string): string {
  const sample = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .find((line) => line.trim().length > 0);
  if (!sample) {
    return ",";
  }
  const candidates = [",", "\t", ";", "|"];
  let winner = ",";
  let bestScore = -1;
  for (const candidate of candidates) {
    const score = sample.split(candidate).length - 1;
    if (score > bestScore) {
      winner = candidate;
      bestScore = score;
    }
  }
  return winner;
}

function parseCsv(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (inQuotes) {
      if (char === '"') {
        if (next === '"') {
          cell += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      continue;
    }

    if (char === delimiter) {
      row.push(cell);
      cell = "";
      continue;
    }

    if (char === "\r") {
      if (next === "\n") {
        index += 1;
      }
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }

    if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }

    cell += char;
  }

  row.push(cell);
  if (row.length > 1 || row[0] !== "" || rows.length === 0) {
    rows.push(row);
  }

  return rows;
}

function parseCsvText(text: string): ParsedCsv {
  const normalized = text.replace(/^\uFEFF/, "");
  const delimiter = inferDelimiter(normalized);
  return {
    delimiter,
    rows: parseCsv(normalized, delimiter),
  };
}

function findTargetTable(
  base: Pick<AppForgeBase, "activeTableId" | "tables"> | null | undefined,
  targetTableId: string | undefined,
) {
  if (!base) {
    return null;
  }
  if (targetTableId) {
    return (
      base.tables.find(
        (table) =>
          table.id === targetTableId || cleanToken(table.name) === cleanToken(targetTableId),
      ) ?? null
    );
  }
  return base.tables.find((table) => table.id === base.activeTableId) ?? base.tables[0] ?? null;
}

function dateLike(value: string): boolean {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return true;
  }
  if (/^\d{4}-\d{2}-\d{2}t/i.test(value)) {
    return !Number.isNaN(Date.parse(value));
  }
  return false;
}

function emailLike(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function urlLike(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function checkboxLike(value: string): boolean {
  return /^(true|false|yes|no|y|n|1|0)$/i.test(value);
}

function inferField(header: string, values: string[]): Pick<AppForgeField, "type" | "options"> {
  const nonEmpty = values.map((value) => value.trim()).filter(Boolean);
  if (nonEmpty.length === 0) {
    return { type: "text" };
  }

  if (nonEmpty.every(checkboxLike)) {
    return { type: "checkbox" };
  }

  if (nonEmpty.every((value) => Number.isFinite(Number(value)))) {
    return { type: "number" };
  }

  if (nonEmpty.every(dateLike)) {
    return { type: "date" };
  }

  if (nonEmpty.every(emailLike)) {
    return { type: "email" };
  }

  if (nonEmpty.every(urlLike)) {
    return { type: "url" };
  }

  const unique = [...new Set(nonEmpty)];
  const normalizedHeader = cleanToken(header);
  if (
    unique.length > 0 &&
    unique.length <= 8 &&
    (unique.length < nonEmpty.length ||
      /(^| )(status|stage|state|priority|category|type)( |$)/.test(normalizedHeader))
  ) {
    return { type: "single_select", options: unique };
  }

  if (nonEmpty.some((value) => value.includes("\n") || value.length > 120)) {
    return { type: "long_text" };
  }

  return { type: "text" };
}

function uniqueHeaders(headers: string[], warnings: string[]): string[] {
  const seen = new Map<string, number>();
  return headers.map((header, index) => {
    const base = header.trim() || `Column ${index + 1}`;
    const key = cleanToken(base) || `column-${index + 1}`;
    const count = (seen.get(key) ?? 0) + 1;
    seen.set(key, count);
    if (count === 1) {
      return base;
    }
    warnings.push(`Duplicate header "${base}" was renamed to "${base} ${count}" for preview.`);
    return `${base} ${count}`;
  });
}

function indexOverrides(
  overrides: AppForgeImportColumnOverride[] | undefined,
): Map<string, AppForgeImportColumnOverride> {
  const map = new Map<string, AppForgeImportColumnOverride>();
  if (!overrides) {
    return map;
  }
  for (const override of overrides) {
    if (override.header) {
      map.set(`h:${cleanToken(override.header)}`, override);
    }
    if (override.fieldId) {
      map.set(`f:${override.fieldId}`, override);
    }
  }
  return map;
}

function findOverride(
  overrides: Map<string, AppForgeImportColumnOverride>,
  header: string,
  fieldId: string,
): AppForgeImportColumnOverride | undefined {
  return overrides.get(`f:${fieldId}`) ?? overrides.get(`h:${cleanToken(header)}`) ?? undefined;
}

type ResolvedSchema = {
  delimiter: string;
  warnings: string[];
  columns: AppForgeImportPreviewColumn[];
  fields: AppForgeField[];
  headers: string[];
  dataRows: string[][];
  skippedEmptyRows: number;
  resolvedTableName: string;
};

function parseAndResolve(
  csv: string,
  request: {
    tableName?: string;
    base?: Pick<AppForgeBase, "activeTableId" | "tables"> | null;
    targetTableId?: string;
    overrides?: AppForgeImportColumnOverride[];
  },
): ResolvedSchema {
  const warnings: string[] = [];
  const parsed = parseCsvText(csv);
  const rawRows = parsed.rows.filter(
    (row, index) => !(index === parsed.rows.length - 1 && isBlankRow(row)),
  );
  const [headerRow = []] = rawRows;
  const allDataRows = rawRows.slice(1);
  const headers = uniqueHeaders(headerRow, warnings);
  const targetTable = findTargetTable(request.base, request.targetTableId);

  const matchedFields = new Map(
    (targetTable?.fields ?? []).map(
      (field) => [cleanToken(field.name || field.id), field] as const,
    ),
  );
  const overrideIndex = indexOverrides(request.overrides);

  let skippedEmptyRows = 0;
  const dataRows = allDataRows.filter((row) => {
    const keep = !isBlankRow(row);
    if (!keep) {
      skippedEmptyRows += 1;
    }
    return keep;
  });

  const columns = headers.map((header, index): AppForgeImportPreviewColumn => {
    const existingField = matchedFields.get(cleanToken(header));
    const sampleValues = dataRows.map((row) => row[index] ?? "");
    const inferred = existingField
      ? { type: existingField.type, options: existingField.options }
      : inferField(header, sampleValues);
    const fallbackFieldId = existingField?.id ?? cleanId(header, `field-${index + 1}`);
    const override = findOverride(overrideIndex, header, fallbackFieldId);
    const fieldId = override?.fieldId ?? fallbackFieldId;
    const type = override?.type ?? inferred.type;
    const isRating = type === "rating" && existingField?.type === "rating";
    const skipped = override?.skip === true;

    return {
      header,
      fieldId,
      fieldName: override?.fieldName ?? existingField?.name ?? titleCase(header),
      type,
      required: existingField?.required,
      options: override?.options ?? inferred.options,
      matchedFieldId: existingField?.id,
      ratingMax: isRating ? existingField?.ratingMax : undefined,
      ratingIcon: isRating ? existingField?.ratingIcon : undefined,
      skipped: skipped || undefined,
    };
  });

  const fields: AppForgeField[] = columns
    .filter((column) => !column.skipped)
    .map((column) => ({
      id: column.fieldId,
      name: column.fieldName,
      type: column.type,
      required: column.required,
      options: column.options,
      ratingMax: column.ratingMax,
      ratingIcon: column.ratingIcon,
    }));

  return {
    delimiter: parsed.delimiter,
    warnings,
    columns,
    fields,
    headers,
    dataRows,
    skippedEmptyRows,
    resolvedTableName: request.tableName?.trim() || targetTable?.name || "Imported Table",
  };
}

function buildRowValueMaps(
  row: string[],
  columns: AppForgeImportPreviewColumn[],
): { raw: Record<string, string>; rawValues: Record<string, string> } {
  const raw: Record<string, string> = {};
  const rawValues: Record<string, string> = {};
  for (const [columnIndex, column] of columns.entries()) {
    const value = row[columnIndex] ?? "";
    raw[column.fieldId] = value;
    if (column.skipped) {
      continue;
    }
    rawValues[column.fieldId] = value;
  }
  return { raw, rawValues };
}

function maybeWarnWidthMismatch(
  row: string[],
  headers: string[],
  warnings: string[],
  warnedRef: { warned: boolean },
) {
  if (!warnedRef.warned && row.length !== headers.length) {
    warnings.push(
      "Some rows have a different column count than the header row; missing cells were blank-filled.",
    );
    warnedRef.warned = true;
  }
}

function clampBatchSize(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_BATCH_SIZE;
  }
  return Math.max(MIN_BATCH_SIZE, Math.min(MAX_BATCH_SIZE, Math.floor(value)));
}

function sanitizeRecordIdPrefix(prefix: string | undefined): string {
  const cleaned = (prefix ?? "imp").replace(/[^a-z0-9-]/gi, "").slice(0, 32);
  return cleaned || "imp";
}

export function buildAppForgeImportPreview(
  request: AppForgeImportPreviewRequest,
): AppForgeImportPreview {
  const parse = parseAndResolve(request.csv, {
    tableName: request.tableName,
    base: request.base,
    targetTableId: request.targetTableId,
    overrides: request.overrides,
  });
  const previewLimit = Math.max(1, request.maxRows ?? 20);
  const warnedRef = { warned: false };

  const rows = parse.dataRows
    .slice(0, previewLimit)
    .map((row, rowIndex): AppForgeImportPreviewRow => {
      maybeWarnWidthMismatch(row, parse.headers, parse.warnings, warnedRef);
      const { raw, rawValues } = buildRowValueMaps(row, parse.columns);
      const validation = validateAppForgeRecordValues(parse.fields, rawValues);
      return {
        rowNumber: rowIndex + 2,
        raw,
        values: validation.values,
        errors: validation.errors,
      };
    });

  return {
    tableName: parse.resolvedTableName,
    delimiter: parse.delimiter,
    columns: parse.columns,
    fields: parse.fields,
    rows,
    totalRows: parse.dataRows.length,
    previewRowCount: rows.length,
    skippedEmptyRows: parse.skippedEmptyRows,
    warnings: parse.warnings,
  };
}

export function buildAppForgeImportCommitPlan(
  request: AppForgeImportCommitRequest,
): AppForgeImportCommitPlan {
  const parse = parseAndResolve(request.csv, {
    tableName: request.tableName,
    base: request.base,
    targetTableId: request.targetTableId,
    overrides: request.overrides,
  });
  const batchSize = clampBatchSize(request.batchSize);
  const skipInvalid = request.skipInvalidRows !== false;
  const idPrefix = sanitizeRecordIdPrefix(request.recordIdPrefix);
  const warnedRef = { warned: false };

  let skippedInvalidRows = 0;
  let invalidRowCount = 0;
  let validRowCount = 0;

  const rows = parse.dataRows.map((row, rowIndex): AppForgeImportCommitRow => {
    maybeWarnWidthMismatch(row, parse.headers, parse.warnings, warnedRef);
    const rowNumber = rowIndex + 2;
    const { raw, rawValues } = buildRowValueMaps(row, parse.columns);
    const validation = validateAppForgeRecordValues(parse.fields, rawValues);
    const hasErrors = validation.errors.length > 0;
    if (hasErrors) {
      invalidRowCount += 1;
    } else {
      validRowCount += 1;
    }
    const skip = hasErrors && skipInvalid;
    if (skip) {
      skippedInvalidRows += 1;
    }
    return {
      rowNumber,
      recordId: `${idPrefix}-${rowIndex + 1}`,
      raw,
      values: validation.values,
      errors: validation.errors,
      skip,
      skipReason: skip ? "invalid" : undefined,
    };
  });

  const commitable = rows.filter((row) => !row.skip);
  const batches: AppForgeImportCommitRow[][] = [];
  for (let index = 0; index < commitable.length; index += batchSize) {
    batches.push(commitable.slice(index, index + batchSize));
  }

  return {
    tableName: parse.resolvedTableName,
    delimiter: parse.delimiter,
    columns: parse.columns,
    fields: parse.fields,
    rows,
    batches,
    totalRows: parse.dataRows.length,
    skippedEmptyRows: parse.skippedEmptyRows,
    skippedInvalidRows,
    validRowCount,
    invalidRowCount,
    batchSize,
    warnings: parse.warnings,
  };
}

/**
 * Executes a previously-built commit plan, invoking `writeRecord` once per
 * committable row, batch by batch. Invalid rows that the plan already marked
 * skip are surfaced in the final report as `reason: "invalid"`.
 *
 * The caller is responsible for routing the per-row `AppForgeRecord` payload
 * to the desired persistence layer (gateway adapter, fetch call, in-memory
 * store, etc.) — this function is intentionally adapter-agnostic.
 */
export async function executeAppForgeImportCommit(
  plan: AppForgeImportCommitPlan,
  writeRecord: AppForgeImportWriteRecordFn,
  options: { nowIso?: string } = {},
): Promise<AppForgeImportCommitReport> {
  const nowIso = options.nowIso ?? new Date().toISOString();
  const rowResults = new Map<number, AppForgeImportCommitRowResult>();

  for (const row of plan.rows) {
    if (row.skip) {
      rowResults.set(row.rowNumber, {
        rowNumber: row.rowNumber,
        recordId: row.recordId,
        ok: false,
        reason: row.skipReason === "invalid" ? "invalid" : "skipped",
        message:
          row.skipReason === "invalid"
            ? `Row skipped due to ${row.errors.length} validation error(s).`
            : "Row skipped.",
        errors: row.errors.length > 0 ? row.errors : undefined,
      });
    }
  }

  let committed = 0;
  let failed = 0;

  for (const [batchIndex, batch] of plan.batches.entries()) {
    for (const [rowIndexInBatch, row] of batch.entries()) {
      const recordPayload: AppForgeRecord = {
        id: row.recordId,
        values: row.values,
        revision: 0,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      let outcome: AppForgeImportWriteRecordOutcome;
      try {
        outcome = await writeRecord(recordPayload, {
          rowNumber: row.rowNumber,
          batchIndex,
          rowIndexInBatch,
        });
      } catch (error) {
        outcome = {
          ok: false,
          message: error instanceof Error ? error.message : "record write failed",
        };
      }
      if (outcome.ok) {
        committed += 1;
        rowResults.set(row.rowNumber, {
          rowNumber: row.rowNumber,
          recordId: outcome.record?.id ?? row.recordId,
          ok: true,
        });
      } else {
        failed += 1;
        rowResults.set(row.rowNumber, {
          rowNumber: row.rowNumber,
          recordId: row.recordId,
          ok: false,
          reason: "write_failed",
          message: outcome.message ?? "record write failed",
        });
      }
    }
  }

  const orderedResults: AppForgeImportCommitRowResult[] = plan.rows.map(
    (row) =>
      rowResults.get(row.rowNumber) ?? {
        rowNumber: row.rowNumber,
        recordId: row.recordId,
        ok: false,
        reason: "skipped",
        message: "Row was not attempted.",
      },
  );

  const attempted = plan.batches.reduce((total, batch) => total + batch.length, 0);

  return {
    tableName: plan.tableName,
    totalRows: plan.totalRows,
    attempted,
    committed,
    failed,
    skippedInvalid: plan.skippedInvalidRows,
    skippedEmpty: plan.skippedEmptyRows,
    batchSize: plan.batchSize,
    batchCount: plan.batches.length,
    warnings: plan.warnings,
    rows: orderedResults,
  };
}
