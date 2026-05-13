import type { ComponentType } from "react";
import { Flame, Heart, Loader2, Star, ThumbsUp, Upload, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ForgeRatingIcon, GatewayRequestFn } from "../../hooks/useForgeStructuredData";

export type AppForgeImportPreviewColumn = {
  header: string;
  fieldId: string;
  fieldName: string;
  type: string;
  required?: boolean;
  options?: string[];
  matchedFieldId?: string;
  /** Maximum value for `rating`-typed columns matched to an existing field. */
  ratingMax?: number;
  /** Glyph for `rating`-typed columns matched to an existing field. */
  ratingIcon?: ForgeRatingIcon;
  /** When true the caller has chosen to drop this column at commit. */
  skipped?: boolean;
};

export type AppForgeImportColumnOverride = {
  header?: string;
  fieldId?: string;
  fieldName?: string;
  type?: string;
  skip?: boolean;
  options?: string[];
};

export type AppForgeImportCommitRowResult = {
  rowNumber: number;
  recordId: string;
  ok: boolean;
  reason?: "invalid" | "write_failed" | "skipped";
  message?: string;
  errors?: Array<{ fieldId: string; code: string; message: string }>;
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

const SUPPORTED_OVERRIDE_TYPES: ReadonlyArray<{ value: string; label: string }> = [
  { value: "text", label: "Text" },
  { value: "long_text", label: "Long text" },
  { value: "number", label: "Number" },
  { value: "checkbox", label: "Checkbox" },
  { value: "date", label: "Date" },
  { value: "email", label: "Email" },
  { value: "url", label: "URL" },
  { value: "single_select", label: "Single select" },
  { value: "multi_select", label: "Multi-select" },
  { value: "rating", label: "Rating" },
];

const RATING_ICON_GLYPHS: Record<ForgeRatingIcon, ComponentType<{ className?: string }>> = {
  star: Star,
  heart: Heart,
  thumb: ThumbsUp,
  flame: Flame,
};

const RATING_ICON_PALETTE: Record<ForgeRatingIcon, { active: string; idle: string }> = {
  star: { active: "text-amber-300", idle: "text-white/22" },
  heart: { active: "text-rose-300", idle: "text-white/22" },
  thumb: { active: "text-sky-300", idle: "text-white/22" },
  flame: { active: "text-orange-300", idle: "text-white/22" },
};

const RATING_MIN_MAX = 3;
const RATING_MAX_MAX = 10;
const RATING_DEFAULT_MAX = 5;

function resolveRatingMax(candidate: number | undefined): number {
  if (typeof candidate !== "number" || !Number.isFinite(candidate)) {
    return RATING_DEFAULT_MAX;
  }
  const rounded = Math.trunc(candidate);
  if (rounded < RATING_MIN_MAX) return RATING_MIN_MAX;
  if (rounded > RATING_MAX_MAX) return RATING_MAX_MAX;
  return rounded;
}

function resolveRatingIcon(candidate: ForgeRatingIcon | undefined): ForgeRatingIcon {
  return candidate && candidate in RATING_ICON_GLYPHS ? candidate : "star";
}

type RatingPreviewCellProps = {
  rawValue: string;
  parsedValue: unknown;
  ratingMax: number | undefined;
  ratingIcon: ForgeRatingIcon | undefined;
  hasError: boolean;
};

function RatingPreviewCell({
  rawValue,
  parsedValue,
  ratingMax,
  ratingIcon,
  hasError,
}: RatingPreviewCellProps) {
  const max = resolveRatingMax(ratingMax);
  const iconKey = resolveRatingIcon(ratingIcon);
  const Icon = RATING_ICON_GLYPHS[iconKey];
  const palette = RATING_ICON_PALETTE[iconKey];

  // If the value didn't coerce to a valid integer in [0, max], show the raw
  // string with an out-of-range marker so the user can decide to drop/clamp.
  if (hasError || typeof parsedValue !== "number" || !Number.isInteger(parsedValue)) {
    const display = rawValue.trim() === "" ? "—" : rawValue;
    return (
      <span
        className="inline-flex items-center gap-1 rounded-sm bg-amber-500/15 px-1.5 py-0.5 font-mono text-[11px] text-amber-100"
        data-testid="appforge-csv-import-rating-invalid"
        title={`Out of range (0–${max})`}
      >
        {display}
      </span>
    );
  }

  const numeric = Math.max(0, Math.min(max, parsedValue));
  const label = numeric === 0 ? "Unrated" : `${numeric} of ${max}`;
  return (
    <div
      className="flex items-center gap-0.5"
      data-testid="appforge-csv-import-rating-cell"
      data-rating-value={numeric}
      data-rating-max={max}
      aria-label={label}
      title={label}
    >
      {Array.from({ length: max }).map((_, index) => {
        const filled = index < numeric;
        return (
          <Icon
            key={index}
            className={`h-3 w-3 ${filled ? `${palette.active} fill-current` : palette.idle}`}
          />
        );
      })}
    </div>
  );
}

export type AppForgeImportPreviewRow = {
  rowNumber: number;
  raw: Record<string, string>;
  values: Record<string, unknown>;
  errors: Array<{ fieldId: string; code: string; message: string }>;
};

export type AppForgeImportPreview = {
  tableName: string;
  delimiter: string;
  columns: AppForgeImportPreviewColumn[];
  fields: Array<{
    id: string;
    name: string;
    type: string;
    required?: boolean;
    options?: string[];
  }>;
  rows: AppForgeImportPreviewRow[];
  totalRows: number;
  previewRowCount: number;
  skippedEmptyRows: number;
  warnings: string[];
};

type CsvImportApplyInput = {
  baseName: string;
  tableName: string;
  csv: string;
  preview: AppForgeImportPreview;
  overrides: AppForgeImportColumnOverride[];
};

type CsvImportDialogProps = {
  open: boolean;
  busy?: boolean;
  gatewayRequest?: GatewayRequestFn;
  onCancel: () => void;
  onApply: (input: CsvImportApplyInput) => Promise<void> | void;
  /** Optional post-commit report rendered inside the dialog when present. */
  commitReport?: AppForgeImportCommitReport | null;
};

type ColumnOverrideEntry = {
  fieldName?: string;
  type?: string;
  skip?: boolean;
};

const SAMPLE_CSV =
  "Name,Email,Status,Tags\n" +
  "Alice,alice@example.com,New,VIP\n" +
  "Bob,bob@example.com,Contacted,Investor\n" +
  "Carol,carol@example.com,Qualified,VIP, Investor\n";

export function CsvImportDialog({
  open,
  busy,
  gatewayRequest,
  onCancel,
  onApply,
  commitReport,
}: CsvImportDialogProps) {
  const [csvText, setCsvText] = useState("");
  const [tableName, setTableName] = useState("Imported Table");
  const [baseName, setBaseName] = useState("Imported base");
  const [preview, setPreview] = useState<AppForgeImportPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [overrideMap, setOverrideMap] = useState<Record<string, ColumnOverrideEntry>>({});
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      setCsvText("");
      setTableName("Imported Table");
      setBaseName("Imported base");
      setPreview(null);
      setPreviewError(null);
      setPreviewing(false);
      setOverrideMap({});
    }
  }, [open]);

  const overridesArray = useMemo<AppForgeImportColumnOverride[]>(() => {
    const entries: AppForgeImportColumnOverride[] = [];
    for (const [header, override] of Object.entries(overrideMap)) {
      if (!override.fieldName && !override.type && !override.skip) {
        continue;
      }
      entries.push({
        header,
        fieldName: override.fieldName,
        type: override.type,
        skip: override.skip,
      });
    }
    return entries;
  }, [overrideMap]);

  const appliedColumns = useMemo<AppForgeImportPreviewColumn[]>(() => {
    if (!preview) {
      return [];
    }
    return preview.columns.map((column) => {
      const override = overrideMap[column.header];
      if (!override) {
        return column;
      }
      return {
        ...column,
        fieldName: override.fieldName ?? column.fieldName,
        type: override.type ?? column.type,
        skipped: override.skip === true ? true : column.skipped,
      };
    });
  }, [overrideMap, preview]);

  const appliedFieldCount = useMemo(
    () => appliedColumns.filter((column) => !column.skipped).length,
    [appliedColumns],
  );

  const canPreview = !!csvText.trim() && !!gatewayRequest && !previewing && !busy;
  const canApply = !!preview && appliedFieldCount > 0 && !busy;

  const updateOverride = useCallback((header: string, patch: Partial<ColumnOverrideEntry>) => {
    setOverrideMap((current) => {
      const previousEntry = current[header] ?? {};
      const merged: ColumnOverrideEntry = { ...previousEntry, ...patch };
      if (!merged.fieldName && !merged.type && !merged.skip) {
        if (!(header in current)) {
          return current;
        }
        const next = { ...current };
        delete next[header];
        return next;
      }
      return { ...current, [header]: merged };
    });
  }, []);

  const requestPreview = useCallback(async () => {
    if (!gatewayRequest) {
      setPreviewError("Gateway is not connected. Connect a gateway and retry.");
      return;
    }
    setPreviewing(true);
    setPreviewError(null);
    try {
      const result = await gatewayRequest<{ preview: AppForgeImportPreview }>(
        "appforge.import.preview",
        { csv: csvText, tableName, maxRows: 25 },
        { timeoutMs: 8_000 },
      );
      setPreview(result.preview);
      setOverrideMap({});
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to build CSV preview.";
      setPreviewError(message);
      setPreview(null);
    } finally {
      setPreviewing(false);
    }
  }, [csvText, gatewayRequest, tableName]);

  const handleFile = useCallback((file: File) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      setCsvText(result);
      const baseFromFile = file.name.replace(/\.[^.]+$/, "");
      if (baseFromFile) {
        setTableName(baseFromFile);
        setBaseName(`${baseFromFile} base`);
      }
      setPreview(null);
      setPreviewError(null);
      setOverrideMap({});
    });
    reader.addEventListener("error", () => setPreviewError("Failed to read file."));
    reader.readAsText(file);
  }, []);

  const totalErrors = useMemo(
    () => preview?.rows.reduce((total, row) => total + row.errors.length, 0) ?? 0,
    [preview],
  );

  const failedReportRows = useMemo(
    () => commitReport?.rows.filter((row) => !row.ok) ?? [],
    [commitReport],
  );

  if (!open) {
    return null;
  }

  return (
    <div
      data-testid="appforge-csv-import-dialog"
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/65 px-6 py-12"
    >
      <div className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-white/12 bg-zinc-950 shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
          <div>
            <div className="text-sm font-semibold text-white">Create base from CSV</div>
            <div className="mt-0.5 text-xs text-white/55">
              Paste a CSV or upload a file. We&apos;ll infer field types and build a preview.
            </div>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onCancel}
            className="rounded-md p-1 text-white/55 hover:bg-white/10 hover:text-white"
            disabled={busy}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex flex-1 flex-col overflow-y-auto px-6 py-4">
          <div className="flex flex-col gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-xs text-white/65">
                Base name
                <input
                  value={baseName}
                  onChange={(event) => setBaseName(event.target.value)}
                  className="rounded-md border border-white/12 bg-black/35 px-2 py-1.5 text-sm text-white outline-none focus:border-sky-300/55"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-white/65">
                Table name
                <input
                  value={tableName}
                  onChange={(event) => setTableName(event.target.value)}
                  className="rounded-md border border-white/12 bg-black/35 px-2 py-1.5 text-sm text-white outline-none focus:border-sky-300/55"
                />
              </label>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 rounded-md border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-medium text-white/82 hover:bg-white/10"
                disabled={busy}
              >
                <Upload className="h-3.5 w-3.5" />
                Upload .csv
              </button>
              <button
                type="button"
                onClick={() => setCsvText(SAMPLE_CSV)}
                className="rounded-md border border-white/10 px-2 py-1 text-[11px] font-medium text-white/55 hover:bg-white/8 hover:text-white/80"
                disabled={busy}
              >
                Use sample
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv,text/plain"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) {
                    handleFile(file);
                  }
                  event.target.value = "";
                }}
              />
            </div>
            <textarea
              value={csvText}
              onChange={(event) => {
                setCsvText(event.target.value);
                setPreview(null);
                setPreviewError(null);
              }}
              spellCheck={false}
              placeholder="Paste CSV here, including the header row..."
              data-testid="appforge-csv-import-textarea"
              className="h-40 w-full resize-y rounded-md border border-white/12 bg-black/55 px-3 py-2 font-mono text-xs text-white outline-none focus:border-sky-300/55"
            />
            <div className="flex items-center justify-between gap-2">
              <div className="text-[11px] text-white/45">
                Tip: the first row is treated as headers. Tabs, semicolons, and pipes are also
                supported.
              </div>
              <button
                type="button"
                onClick={() => void requestPreview()}
                disabled={!canPreview}
                data-testid="appforge-csv-import-preview-btn"
                className="inline-flex items-center gap-1.5 rounded-md bg-sky-500/85 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition disabled:cursor-not-allowed disabled:bg-white/8 disabled:text-white/45 hover:bg-sky-400"
              >
                {previewing ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Previewing...
                  </>
                ) : (
                  <>Preview schema</>
                )}
              </button>
            </div>
            {previewError && (
              <div
                role="alert"
                data-testid="appforge-csv-import-error"
                className="rounded-md border border-rose-400/40 bg-rose-500/10 px-3 py-2 text-xs font-medium text-rose-100"
              >
                {previewError}
              </div>
            )}
            {preview && (
              <div className="mt-1 flex flex-col gap-3 rounded-lg border border-white/10 bg-white/[0.04] p-3">
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-white/55">
                  <span className="rounded-full bg-emerald-500/12 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-emerald-100/85">
                    {appliedFieldCount} fields
                  </span>
                  <span>{preview.totalRows} data rows</span>
                  <span>delimiter "{preview.delimiter}"</span>
                  {preview.skippedEmptyRows > 0 && (
                    <span>{preview.skippedEmptyRows} blank row(s) skipped</span>
                  )}
                  {totalErrors > 0 && (
                    <span className="text-amber-200">{totalErrors} validation issue(s)</span>
                  )}
                </div>
                <div className="rounded-md border border-white/10 bg-black/30 p-2">
                  <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-white/55">
                    Column mapping
                  </div>
                  <ul
                    className="flex flex-col gap-1"
                    data-testid="appforge-csv-import-mapping-list"
                  >
                    {appliedColumns.map((column) => {
                      const override = overrideMap[column.header] ?? {};
                      return (
                        <li
                          key={column.header}
                          className={`flex flex-wrap items-center gap-2 rounded-sm px-1 py-1 text-[11px] ${
                            column.skipped ? "opacity-55" : ""
                          }`}
                          data-testid="appforge-csv-import-mapping-row"
                          data-column-header={column.header}
                          data-column-skipped={column.skipped ? "true" : "false"}
                        >
                          <span className="min-w-[8rem] truncate text-white/55">
                            {column.header}
                          </span>
                          <input
                            value={override.fieldName ?? column.fieldName}
                            disabled={busy || column.skipped}
                            onChange={(event) =>
                              updateOverride(column.header, {
                                fieldName:
                                  event.target.value.trim() === "" ? undefined : event.target.value,
                              })
                            }
                            data-testid="appforge-csv-import-mapping-name"
                            className="min-w-[8rem] flex-1 rounded-sm border border-white/10 bg-black/35 px-2 py-0.5 text-white outline-none focus:border-sky-300/55 disabled:cursor-not-allowed disabled:opacity-50"
                          />
                          <select
                            value={override.type ?? column.type}
                            disabled={busy || column.skipped}
                            onChange={(event) =>
                              updateOverride(column.header, {
                                type:
                                  event.target.value === column.type
                                    ? undefined
                                    : event.target.value,
                              })
                            }
                            data-testid="appforge-csv-import-mapping-type"
                            className="rounded-sm border border-white/10 bg-black/35 px-1.5 py-0.5 text-white outline-none focus:border-sky-300/55 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {SUPPORTED_OVERRIDE_TYPES.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                          <label className="inline-flex items-center gap-1 text-white/55">
                            <input
                              type="checkbox"
                              checked={column.skipped === true}
                              disabled={busy}
                              onChange={(event) =>
                                updateOverride(column.header, {
                                  skip: event.target.checked ? true : undefined,
                                })
                              }
                              data-testid="appforge-csv-import-mapping-skip"
                              className="h-3 w-3"
                            />
                            Skip
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                </div>
                <div className="overflow-x-auto rounded-md border border-white/10">
                  <table className="min-w-full text-xs">
                    <thead className="bg-white/[0.06] text-[10px] uppercase tracking-[0.08em] text-white/55">
                      <tr>
                        {appliedColumns
                          .filter((column) => !column.skipped)
                          .map((column) => (
                            <th
                              key={column.fieldId}
                              className="px-3 py-1.5 text-left font-semibold"
                              data-testid="appforge-csv-import-column"
                            >
                              <div className="text-white/85">{column.fieldName}</div>
                              <div className="text-[10px] text-white/45">{column.type}</div>
                            </th>
                          ))}
                      </tr>
                    </thead>
                    <tbody className="text-white/75">
                      {preview.rows.slice(0, 5).map((row) => (
                        <tr key={row.rowNumber} className="border-t border-white/[0.07]">
                          {appliedColumns
                            .filter((column) => !column.skipped)
                            .map((column) => {
                              const rawValue = row.raw[column.fieldId] ?? "";
                              if (column.type === "rating") {
                                const hasError = row.errors.some(
                                  (error) => error.fieldId === column.fieldId,
                                );
                                return (
                                  <td
                                    key={column.fieldId}
                                    className="max-w-[14rem] px-3 py-1 align-top"
                                  >
                                    <RatingPreviewCell
                                      rawValue={rawValue}
                                      parsedValue={row.values[column.fieldId]}
                                      ratingMax={column.ratingMax}
                                      ratingIcon={column.ratingIcon}
                                      hasError={hasError}
                                    />
                                  </td>
                                );
                              }
                              return (
                                <td
                                  key={column.fieldId}
                                  className="max-w-[14rem] truncate px-3 py-1 align-top"
                                >
                                  {rawValue}
                                </td>
                              );
                            })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {preview.warnings.length > 0 && (
                  <ul className="list-disc pl-4 text-[11px] text-amber-100/80">
                    {preview.warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {commitReport && (
              <div
                data-testid="appforge-csv-import-report"
                className="mt-1 flex flex-col gap-2 rounded-lg border border-emerald-400/30 bg-emerald-500/[0.05] p-3 text-[11px] text-white/75"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-emerald-100/85">
                    Imported
                  </span>
                  <span>
                    <strong className="text-white/85">{commitReport.committed}</strong> of{" "}
                    {commitReport.totalRows} rows committed
                  </span>
                  {commitReport.failed > 0 && (
                    <span className="text-rose-200">{commitReport.failed} write failure(s)</span>
                  )}
                  {commitReport.skippedInvalid > 0 && (
                    <span className="text-amber-200">
                      {commitReport.skippedInvalid} invalid row(s) skipped
                    </span>
                  )}
                  <span className="text-white/45">
                    {commitReport.batchCount} batch(es) of up to {commitReport.batchSize}
                  </span>
                </div>
                {failedReportRows.length > 0 && (
                  <div
                    className="max-h-32 overflow-y-auto rounded-sm border border-white/10 bg-black/30"
                    data-testid="appforge-csv-import-report-failures"
                  >
                    <table className="min-w-full text-[11px]">
                      <thead className="bg-white/[0.06] text-[10px] uppercase tracking-[0.08em] text-white/55">
                        <tr>
                          <th className="px-2 py-1 text-left">Row</th>
                          <th className="px-2 py-1 text-left">Reason</th>
                          <th className="px-2 py-1 text-left">Detail</th>
                        </tr>
                      </thead>
                      <tbody>
                        {failedReportRows.map((row) => (
                          <tr
                            key={row.rowNumber}
                            className="border-t border-white/[0.07]"
                            data-testid="appforge-csv-import-report-failure"
                          >
                            <td className="px-2 py-1 text-white/75">{row.rowNumber}</td>
                            <td className="px-2 py-1 text-white/75">{row.reason ?? "failed"}</td>
                            <td className="px-2 py-1 text-white/55">{row.message ?? ""}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-white/10 px-6 py-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-md border border-white/12 px-3 py-1.5 text-xs font-medium text-white/75 hover:bg-white/10"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              if (!preview) {
                return;
              }
              void onApply({
                baseName: baseName.trim() || "Imported base",
                tableName: tableName.trim() || preview.tableName || "Imported Table",
                csv: csvText,
                preview,
                overrides: overridesArray,
              });
            }}
            disabled={!canApply}
            data-testid="appforge-csv-import-apply-btn"
            className="inline-flex items-center gap-1.5 rounded-md bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition disabled:cursor-not-allowed disabled:bg-white/8 disabled:text-white/45 hover:bg-emerald-400"
          >
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Create base from CSV
          </button>
        </div>
      </div>
    </div>
  );
}
