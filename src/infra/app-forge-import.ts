import {
  validateAppForgeRecordValues,
  type AppForgeBase,
  type AppForgeField,
  type AppForgeFieldType,
  type AppForgeRecordValue,
  type AppForgeValidationError,
} from "./app-forge-model.js";

export type AppForgeImportPreviewRequest = {
  csv: string;
  tableName?: string;
  base?: Pick<AppForgeBase, "activeTableId" | "tables"> | null;
  targetTableId?: string;
  maxRows?: number;
};

export type AppForgeImportPreviewColumn = {
  header: string;
  fieldId: string;
  fieldName: string;
  type: AppForgeFieldType;
  required?: boolean;
  options?: string[];
  matchedFieldId?: string;
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

type ParsedCsv = {
  rows: string[][];
  delimiter: string;
};

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

export function buildAppForgeImportPreview(
  request: AppForgeImportPreviewRequest,
): AppForgeImportPreview {
  const warnings: string[] = [];
  const parsed = parseCsvText(request.csv);
  const rawRows = parsed.rows.filter(
    (row, index) => !(index === parsed.rows.length - 1 && isBlankRow(row)),
  );
  const [headerRow = []] = rawRows;
  const dataRows = rawRows.slice(1);
  const headers = uniqueHeaders(headerRow, warnings);
  const targetTable = findTargetTable(request.base, request.targetTableId);
  const previewLimit = Math.max(1, request.maxRows ?? 20);
  const matchedFields = new Map(
    (targetTable?.fields ?? []).map(
      (field) => [cleanToken(field.name || field.id), field] as const,
    ),
  );

  const columns = headers.map((header, index): AppForgeImportPreviewColumn => {
    const existingField = matchedFields.get(cleanToken(header));
    const sampleValues = dataRows.map((row) => row[index] ?? "");
    const inferred = existingField
      ? { type: existingField.type, options: existingField.options }
      : inferField(header, sampleValues);
    const fieldId = existingField?.id ?? cleanId(header, `field-${index + 1}`);
    return {
      header,
      fieldId,
      fieldName: existingField?.name ?? titleCase(header),
      type: inferred.type,
      required: existingField?.required,
      options: inferred.options,
      matchedFieldId: existingField?.id,
    };
  });

  const fields: AppForgeField[] = columns.map((column) => ({
    id: column.fieldId,
    name: column.fieldName,
    type: column.type,
    required: column.required,
    options: column.options,
  }));

  let skippedEmptyRows = 0;
  let widthMismatchWarningAdded = false;
  const previewDataRows = dataRows.filter((row) => {
    const keep = !isBlankRow(row);
    if (!keep) {
      skippedEmptyRows += 1;
    }
    return keep;
  });

  const rows = previewDataRows
    .slice(0, previewLimit)
    .map((row, rowIndex): AppForgeImportPreviewRow => {
      if (!widthMismatchWarningAdded && row.length !== headers.length) {
        warnings.push(
          "Some rows have a different column count than the header row; missing cells were blank-filled.",
        );
        widthMismatchWarningAdded = true;
      }
      const raw: Record<string, string> = {};
      const recordValues: Record<string, string> = {};
      for (const [columnIndex, column] of columns.entries()) {
        const value = row[columnIndex] ?? "";
        raw[column.fieldId] = value;
        recordValues[column.fieldId] = value;
      }
      const validation = validateAppForgeRecordValues(fields, recordValues);
      return {
        rowNumber: rowIndex + 2,
        raw,
        values: validation.values,
        errors: validation.errors,
      };
    });

  return {
    tableName: request.tableName?.trim() || targetTable?.name || "Imported Table",
    delimiter: parsed.delimiter,
    columns,
    fields,
    rows,
    totalRows: previewDataRows.length,
    previewRowCount: rows.length,
    skippedEmptyRows,
    warnings,
  };
}
