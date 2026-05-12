import { ExternalLink, Flame, Heart, Search, Star, ThumbsUp, X } from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import type {
  ForgeRatingIcon,
  ForgeStructuredField,
  ForgeStructuredRecord,
  ForgeStructuredRecordValue,
  ForgeStructuredTable,
} from "../../hooks/useForgeStructuredData";

export type GridCellEditorRequest = {
  recordId: string;
  fieldId: string;
  value: string;
};

type GridCellEditorProps = {
  field: ForgeStructuredField;
  draft: GridCellEditorRequest;
  onChange: (next: GridCellEditorRequest) => void;
  onCommit: () => void;
  onCancel: () => void;
};

function fieldInputType(field: ForgeStructuredField): string {
  if (field.type === "number") {
    return "number";
  }
  if (field.type === "date") {
    return "date";
  }
  if (field.type === "url") {
    return "url";
  }
  if (field.type === "email") {
    return "email";
  }
  return "text";
}

function selectOptionLabels(field: ForgeStructuredField): string[] {
  if (field.selectOptions && field.selectOptions.length) {
    return field.selectOptions.map((option) => option.label).filter(Boolean);
  }
  return field.options ?? [];
}

// Pure helpers live in the substrate (`src/infra/app-forge-cell-editing.ts`)
// so the dashboard editor and the gateway import path agree on tokenization.
function parseMultiSelectValue(value: string): string[] {
  if (!value) {
    return [];
  }
  const parsed = value
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  return Array.from(new Set(parsed));
}

function serializeMultiSelectValue(values: ReadonlyArray<string>): string {
  return Array.from(new Set(values.filter(Boolean))).join(", ");
}

function isValidUrlInput(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) {
    return true;
  }
  try {
    new URL(trimmed);
    return true;
  } catch {
    return false;
  }
}

// Mirrors `validateAppForgeRecordValues` for the `number` field type so the
// inline editor surfaces the same rejection the gateway/import paths apply.
// Empty input is accepted (clears the cell). The canonical implementation
// lives in `src/infra/app-forge-cell-editing.ts`; kept local here so the
// dashboard component bundle stays self-contained.
function isValidNumberInput(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) {
    return true;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed);
}

// Mirrors the email regex in `validateAppForgeRecordValues`. Empty input is
// accepted (clears the cell).
function isValidEmailInput(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) {
    return true;
  }
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

// Linked-record relation-picker helpers. Mirror the substrate helpers in
// `src/infra/app-forge-cell-editing.ts` (tested there) so the dashboard
// component bundle stays self-contained without an extra import boundary.
// See the substrate file for design notes — these copies must stay in sync.

type RelationPickerCandidate = {
  id: string;
  label: string;
};

const DEFAULT_RELATION_PICKER_LIMIT = 50;

function relationLabelFromValue(value: ForgeStructuredRecordValue | undefined): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (Array.isArray(value)) {
    return value
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .join(", ");
  }
  if (typeof value === "string") {
    return value.trim();
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "";
}

function pickRelationTitleField(
  fields: ReadonlyArray<ForgeStructuredField>,
): ForgeStructuredField | null {
  if (fields.length === 0) {
    return null;
  }
  const named = fields.find((field) => field.name.trim().toLowerCase() === "name");
  return named ?? fields[0] ?? null;
}

function buildRelationPickerCandidates(
  fields: ReadonlyArray<ForgeStructuredField>,
  records: ReadonlyArray<ForgeStructuredRecord>,
): RelationPickerCandidate[] {
  const titleField = pickRelationTitleField(fields);
  return records.map((record) => {
    const raw = titleField ? record.values[titleField.id] : undefined;
    const label = relationLabelFromValue(raw);
    return {
      id: record.id,
      label: label || record.id,
    };
  });
}

function resolveRelationLabel(
  id: string,
  candidates: ReadonlyArray<RelationPickerCandidate>,
): string {
  if (!id) {
    return "";
  }
  return candidates.find((candidate) => candidate.id === id)?.label ?? id;
}

function filterRelationPickerCandidates(
  candidates: ReadonlyArray<RelationPickerCandidate>,
  query: string,
  excludeIds: ReadonlyArray<string>,
  limit: number = DEFAULT_RELATION_PICKER_LIMIT,
): RelationPickerCandidate[] {
  const lowered = query.trim().toLowerCase();
  const exclude = new Set(excludeIds);
  const matches: RelationPickerCandidate[] = [];
  for (const candidate of candidates) {
    if (exclude.has(candidate.id)) {
      continue;
    }
    if (lowered) {
      const matchesLabel = candidate.label.toLowerCase().includes(lowered);
      const matchesId = candidate.id.toLowerCase().includes(lowered);
      if (!matchesLabel && !matchesId) {
        continue;
      }
    }
    matches.push(candidate);
    if (matches.length >= limit) {
      break;
    }
  }
  return matches;
}

function parseLinkedRecordIds(value: string): string[] {
  // Linked-record cells share the multi-select serialization shape (comma-
  // separated). Reuse the existing parser so legacy cells edited with the
  // old free-text input round-trip cleanly through the new picker.
  return parseMultiSelectValue(value);
}

function serializeLinkedRecordIds(ids: ReadonlyArray<string>): string {
  return serializeMultiSelectValue(ids);
}

export function MultiSelectCellEditor({
  field,
  draft,
  onChange,
  onCommit,
  onCancel,
}: GridCellEditorProps) {
  const [pending, setPending] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const selected = useMemo(() => parseMultiSelectValue(draft.value), [draft.value]);
  const allLabels = useMemo(() => selectOptionLabels(field), [field]);
  const suggestions = useMemo(() => {
    const lowered = pending.trim().toLowerCase();
    return allLabels.filter(
      (label) => !selected.includes(label) && (!lowered || label.toLowerCase().includes(lowered)),
    );
  }, [allLabels, pending, selected]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const apply = (next: string[]) => {
    onChange({ ...draft, value: serializeMultiSelectValue(next) });
  };

  const handleAdd = (label: string) => {
    const trimmed = label.trim();
    if (!trimmed) {
      return;
    }
    if (selected.includes(trimmed)) {
      setPending("");
      return;
    }
    apply([...selected, trimmed]);
    setPending("");
  };

  const handleRemove = (label: string) => {
    apply(selected.filter((entry) => entry !== label));
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      if (pending.trim()) {
        event.preventDefault();
        handleAdd(pending);
        return;
      }
      event.preventDefault();
      onCommit();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
      return;
    }
    if (event.key === "Backspace" && !pending && selected.length > 0) {
      event.preventDefault();
      apply(selected.slice(0, -1));
    }
  };

  return (
    <div
      data-testid="appforge-multi-select-editor"
      className="flex w-full flex-wrap items-center gap-1 rounded-md border border-sky-400/40 bg-black/55 px-2 py-1 text-sm text-white"
    >
      {selected.map((label) => (
        <span
          key={label}
          className="inline-flex items-center gap-1 rounded-md bg-emerald-500/22 px-2 py-0.5 text-xs font-medium text-emerald-100"
        >
          {label}
          <button
            type="button"
            aria-label={`Remove ${label}`}
            onMouseDown={(event) => {
              // prevent blur on the input which would commit
              event.preventDefault();
            }}
            onClick={() => handleRemove(label)}
            className="rounded-full p-0.5 text-emerald-100/80 hover:bg-emerald-500/35 hover:text-white"
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        list={`appforge-multi-options-${field.id}`}
        value={pending}
        onChange={(event) => setPending(event.target.value)}
        onBlur={() => {
          if (pending.trim()) {
            handleAdd(pending);
          }
          // Blur commits, mirroring the other editors.
          onCommit();
        }}
        onKeyDown={handleKeyDown}
        placeholder={selected.length === 0 ? "Type to add tags…" : ""}
        className="min-w-[80px] flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/35"
      />
      {allLabels.length > 0 && (
        <datalist id={`appforge-multi-options-${field.id}`}>
          {suggestions.map((label) => (
            <option key={label} value={label} />
          ))}
        </datalist>
      )}
    </div>
  );
}

export function UrlCellEditor({ field, draft, onChange, onCommit, onCancel }: GridCellEditorProps) {
  const [touched, setTouched] = useState(false);
  const valid = isValidUrlInput(draft.value);
  return (
    <div className="flex w-full flex-col gap-1">
      <input
        autoFocus
        type={fieldInputType(field)}
        value={draft.value}
        onChange={(event) => {
          setTouched(true);
          onChange({ ...draft, value: event.target.value });
        }}
        onBlur={() => {
          if (valid) {
            onCommit();
          }
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            if (valid) {
              onCommit();
            }
          }
          if (event.key === "Escape") {
            onCancel();
          }
        }}
        placeholder="https://example.com"
        className={`w-full rounded-md border px-2 py-1 text-sm outline-none ${
          valid
            ? "border-sky-400/40 bg-black/45 text-white"
            : "border-rose-400/55 bg-rose-500/8 text-white"
        }`}
      />
      {touched && !valid && (
        <span
          data-testid="appforge-url-editor-error"
          className="text-[11px] font-medium text-rose-200"
        >
          Enter a valid URL or press Escape to cancel.
        </span>
      )}
    </div>
  );
}

export function NumberCellEditor({
  field,
  draft,
  onChange,
  onCommit,
  onCancel,
}: GridCellEditorProps) {
  const [touched, setTouched] = useState(false);
  const valid = isValidNumberInput(draft.value);
  return (
    <div className="flex w-full flex-col gap-1">
      <input
        autoFocus
        type="text"
        inputMode="decimal"
        value={draft.value}
        onChange={(event) => {
          setTouched(true);
          onChange({ ...draft, value: event.target.value });
        }}
        onBlur={() => {
          if (valid) {
            onCommit();
          }
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            if (valid) {
              onCommit();
            }
          }
          if (event.key === "Escape") {
            onCancel();
          }
        }}
        placeholder="0"
        aria-label={field.name}
        data-testid="appforge-number-editor-input"
        className={`w-full rounded-md border px-2 py-1 text-sm outline-none ${
          valid
            ? "border-sky-400/40 bg-black/45 text-white"
            : "border-rose-400/55 bg-rose-500/8 text-white"
        }`}
      />
      {touched && !valid && (
        <span
          data-testid="appforge-number-editor-error"
          className="text-[11px] font-medium text-rose-200"
        >
          Enter a valid number or press Escape to cancel.
        </span>
      )}
    </div>
  );
}

export function EmailCellEditor({
  field,
  draft,
  onChange,
  onCommit,
  onCancel,
}: GridCellEditorProps) {
  const [touched, setTouched] = useState(false);
  const valid = isValidEmailInput(draft.value);
  return (
    <div className="flex w-full flex-col gap-1">
      <input
        autoFocus
        type="email"
        value={draft.value}
        onChange={(event) => {
          setTouched(true);
          onChange({ ...draft, value: event.target.value });
        }}
        onBlur={() => {
          if (valid) {
            onCommit();
          }
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            if (valid) {
              onCommit();
            }
          }
          if (event.key === "Escape") {
            onCancel();
          }
        }}
        placeholder="name@example.com"
        aria-label={field.name}
        data-testid="appforge-email-editor-input"
        className={`w-full rounded-md border px-2 py-1 text-sm outline-none ${
          valid
            ? "border-sky-400/40 bg-black/45 text-white"
            : "border-rose-400/55 bg-rose-500/8 text-white"
        }`}
      />
      {touched && !valid && (
        <span
          data-testid="appforge-email-editor-error"
          className="text-[11px] font-medium text-rose-200"
        >
          Enter a valid email or press Escape to cancel.
        </span>
      )}
    </div>
  );
}

type LinkedRecordCellEditorProps = GridCellEditorProps & {
  /**
   * The linked target table (resolved from `field.linkedTableId`). When this
   * is null the picker degrades gracefully — it still lets the user remove
   * existing chips but cannot offer record suggestions because we have no
   * target table to search.
   */
  targetTable: ForgeStructuredTable | null;
  /** Display name for the target table — used in the empty-state hint. */
  targetTableName?: string;
};

export function LinkedRecordCellEditor({
  field,
  draft,
  onChange,
  onCommit,
  onCancel,
  targetTable,
  targetTableName,
}: LinkedRecordCellEditorProps) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const suppressBlurCommitRef = useRef(false);

  const selectedIds = useMemo(() => parseLinkedRecordIds(draft.value), [draft.value]);

  const candidates = useMemo<RelationPickerCandidate[]>(
    () =>
      targetTable ? buildRelationPickerCandidates(targetTable.fields, targetTable.records) : [],
    [targetTable],
  );

  const matches = useMemo(
    () => filterRelationPickerCandidates(candidates, query, selectedIds),
    [candidates, query, selectedIds],
  );

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const apply = (next: ReadonlyArray<string>) => {
    onChange({ ...draft, value: serializeLinkedRecordIds(next) });
  };

  const handleAdd = (id: string) => {
    if (!id || selectedIds.includes(id)) {
      setQuery("");
      return;
    }
    apply([...selectedIds, id]);
    setQuery("");
  };

  const handleRemove = (id: string) => {
    apply(selectedIds.filter((entry) => entry !== id));
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      // Pressing Enter selects the first match if one is showing; otherwise
      // it commits whatever is already selected. Mirrors the multi-select
      // editor's keyboard contract.
      if (matches.length > 0) {
        event.preventDefault();
        handleAdd(matches[0].id);
        return;
      }
      event.preventDefault();
      onCommit();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
      return;
    }
    if (event.key === "Backspace" && !query && selectedIds.length > 0) {
      event.preventDefault();
      apply(selectedIds.slice(0, -1));
    }
  };

  const fallbackTableName = targetTableName ?? "linked table";
  const dropdownEmptyHint = !targetTable
    ? `Configure a linked table for "${field.name}" in the field inspector to enable the picker.`
    : candidates.length === 0
      ? `No records yet in ${fallbackTableName} — add one in that table first.`
      : query.trim()
        ? `No matches for "${query.trim()}" in ${fallbackTableName}.`
        : `Type to search ${fallbackTableName}.`;

  return (
    <div
      ref={containerRef}
      data-testid="appforge-linked-record-editor"
      className="relative flex w-full flex-col gap-1"
    >
      <div className="flex w-full flex-wrap items-center gap-1 rounded-md border border-sky-400/40 bg-black/55 px-2 py-1 text-sm text-white">
        {selectedIds.map((id) => {
          const label = resolveRelationLabel(id, candidates);
          const orphan = !candidates.some((candidate) => candidate.id === id);
          return (
            <span
              key={id}
              data-testid="appforge-linked-record-chip"
              data-orphan={orphan ? "true" : "false"}
              title={orphan ? `Unresolved link (${id})` : `${label} (${id})`}
              className={`inline-flex max-w-40 items-center gap-1 truncate rounded-md px-2 py-0.5 text-xs font-medium ${
                orphan
                  ? "border border-amber-300/35 bg-amber-400/15 text-amber-100"
                  : "bg-sky-400/22 text-sky-100"
              }`}
            >
              <span className="truncate">{label}</span>
              <button
                type="button"
                aria-label={`Remove link to ${label}`}
                onMouseDown={(event) => {
                  // Stop the input from blurring & committing before the
                  // click handler fires.
                  event.preventDefault();
                  suppressBlurCommitRef.current = true;
                }}
                onClick={() => handleRemove(id)}
                className="rounded-full p-0.5 text-current/80 hover:bg-white/15 hover:text-white"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          );
        })}
        <span className="flex min-w-[80px] flex-1 items-center gap-1">
          <Search className="h-3 w-3 flex-shrink-0 text-white/35" aria-hidden />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onBlur={() => {
              if (suppressBlurCommitRef.current) {
                suppressBlurCommitRef.current = false;
                // Refocus so further picks/removals don't dismiss the editor.
                queueMicrotask(() => inputRef.current?.focus());
                return;
              }
              onCommit();
            }}
            onKeyDown={handleKeyDown}
            placeholder={selectedIds.length === 0 ? `Search ${fallbackTableName}…` : "Add another…"}
            aria-label={`Search ${fallbackTableName}`}
            data-testid="appforge-linked-record-search-input"
            className="min-w-[80px] flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/35"
          />
        </span>
      </div>
      <div
        data-testid="appforge-linked-record-dropdown"
        className="absolute left-0 right-0 top-full z-30 mt-1 max-h-56 overflow-y-auto rounded-md border border-white/12 bg-black/85 shadow-lg shadow-black/40 backdrop-blur"
      >
        {matches.length === 0 ? (
          <div
            data-testid="appforge-linked-record-empty"
            className="px-3 py-2 text-xs text-white/55"
          >
            {dropdownEmptyHint}
          </div>
        ) : (
          <ul className="flex flex-col py-1">
            {matches.map((candidate) => (
              <li key={candidate.id}>
                <button
                  type="button"
                  data-testid="appforge-linked-record-option"
                  data-record-id={candidate.id}
                  onMouseDown={(event) => {
                    // Suppress blur-commit so the search input keeps focus
                    // and the picker stays open for multi-select.
                    event.preventDefault();
                    suppressBlurCommitRef.current = true;
                  }}
                  onClick={() => handleAdd(candidate.id)}
                  className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm text-white/85 hover:bg-sky-400/15 hover:text-white"
                >
                  <span className="truncate">{candidate.label}</span>
                  <span className="text-[10px] uppercase tracking-wide text-white/35">
                    {candidate.id}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

type UrlCellDisplayProps = {
  value: string;
};

export function UrlCellDisplay({ value }: UrlCellDisplayProps) {
  const trimmed = value.trim();
  if (!trimmed) {
    return <span className="text-white/24">No link</span>;
  }
  if (!isValidUrlInput(trimmed) || trimmed === "") {
    return <span className="truncate text-white/66">{trimmed}</span>;
  }
  return (
    <a
      href={trimmed}
      target="_blank"
      rel="noopener noreferrer"
      data-testid="appforge-url-cell-link"
      onClick={(event) => event.stopPropagation()}
      className="inline-flex max-w-[14rem] items-center gap-1 truncate text-sky-200 hover:text-sky-100 hover:underline"
      title={trimmed}
    >
      <span className="truncate">{trimmed}</span>
      <ExternalLink className="h-3 w-3 flex-shrink-0" />
    </a>
  );
}

type MultiSelectCellDisplayProps = {
  value: ForgeStructuredRecordValue | undefined;
};

export function MultiSelectCellDisplay({ value }: MultiSelectCellDisplayProps) {
  const items = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value
          .split(/[\n,]/)
          .map((entry) => entry.trim())
          .filter(Boolean)
      : [];
  if (items.length === 0) {
    return <span className="text-white/24">—</span>;
  }
  return (
    <div className="flex max-w-[16rem] flex-wrap gap-1" data-testid="appforge-multi-select-cell">
      {items.map((label) => (
        <span
          key={label}
          className="inline-flex max-w-[10rem] truncate rounded-md bg-emerald-500/18 px-2 py-0.5 text-xs font-medium text-emerald-100"
        >
          {label}
        </span>
      ))}
    </div>
  );
}

// Rating helpers — mirror of `src/infra/app-forge-cell-editing.ts` so the
// substrate and the dashboard agree on draft tokenization. The substrate
// tests are the source of truth; this duplication matches the pattern used
// for multi-select.
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

function ratingIconFor(field: Pick<ForgeStructuredField, "ratingIcon">): ForgeRatingIcon {
  return field.ratingIcon && RATING_ICON_GLYPHS[field.ratingIcon] ? field.ratingIcon : "star";
}

function ratingMaxFor(field: Pick<ForgeStructuredField, "ratingMax">): number {
  const candidate = field.ratingMax;
  if (typeof candidate !== "number" || !Number.isFinite(candidate)) {
    return 5;
  }
  const rounded = Math.trunc(candidate);
  if (rounded < 3) {
    return 3;
  }
  if (rounded > 10) {
    return 10;
  }
  return rounded;
}

function ratingAllowHalfFor(field: Pick<ForgeStructuredField, "allowHalf">): boolean {
  return field.allowHalf === true;
}

/**
 * Snap an arbitrary numeric input into the field's allowed step:
 * - `allowHalf` on → nearest 0.5 increment
 * - default       → nearest integer (preserves pre-half-rating behavior)
 */
function snapRatingValue(value: number, allowHalf: boolean): number {
  return allowHalf ? Math.round(value * 2) / 2 : Math.round(value);
}

function parseRatingDraft(value: string, max: number, allowHalf: boolean = false): number {
  const trimmed = value.trim();
  if (!trimmed) {
    return 0;
  }
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  const snapped = snapRatingValue(parsed, allowHalf);
  if (snapped <= 0) {
    return 0;
  }
  if (snapped > max) {
    return max;
  }
  return snapped;
}

function serializeRatingDraft(value: number, allowHalf: boolean = false): string {
  if (!Number.isFinite(value) || value <= 0) {
    return "";
  }
  return String(snapRatingValue(value, allowHalf));
}

type RatingCellDisplayProps = {
  field: Pick<ForgeStructuredField, "ratingMax" | "ratingIcon" | "allowHalf" | "name">;
  value: ForgeStructuredRecordValue | undefined;
};

export function RatingCellDisplay({ field, value }: RatingCellDisplayProps) {
  const max = ratingMaxFor(field);
  const iconKey = ratingIconFor(field);
  const allowHalf = ratingAllowHalfFor(field);
  const Icon = RATING_ICON_GLYPHS[iconKey];
  const palette = RATING_ICON_PALETTE[iconKey];
  const numeric =
    typeof value === "number" && Number.isFinite(value)
      ? Math.max(0, Math.min(max, snapRatingValue(value, allowHalf)))
      : typeof value === "string" && value.trim()
        ? Math.max(0, Math.min(max, snapRatingValue(Number(value) || 0, allowHalf)))
        : 0;
  const label = numeric === 0 ? `${field.name ?? "Rating"} unrated` : `${numeric} of ${max}`;
  return (
    <div
      className="flex items-center gap-0.5"
      data-testid="appforge-rating-cell"
      data-rating-value={numeric}
      data-rating-max={max}
      data-rating-allow-half={allowHalf ? "true" : undefined}
      aria-label={label}
      title={label}
    >
      {Array.from({ length: max }).map((_, index) => {
        const slot = index + 1;
        const full = slot <= numeric;
        const half = !full && allowHalf && slot - 0.5 <= numeric;
        if (half) {
          // Render a half-filled glyph by overlaying an active icon clipped to
          // the left 50% on top of the idle icon. No new asset required —
          // Lucide icons fill via `currentColor` + `fill-current`.
          return (
            <span
              key={index}
              className="relative inline-block h-3.5 w-3.5"
              data-rating-slot={slot}
              data-rating-slot-fill="half"
            >
              <Icon className={`absolute inset-0 h-3.5 w-3.5 ${palette.idle}`} />
              <span
                className="pointer-events-none absolute inset-y-0 left-0 w-1/2 overflow-hidden"
                aria-hidden="true"
              >
                <Icon className={`h-3.5 w-3.5 ${palette.active} fill-current`} />
              </span>
            </span>
          );
        }
        return (
          <Icon
            key={index}
            data-rating-slot={slot}
            data-rating-slot-fill={full ? "full" : "empty"}
            className={`h-3.5 w-3.5 ${full ? `${palette.active} fill-current` : palette.idle}`}
          />
        );
      })}
    </div>
  );
}

type RatingCellEditorProps = GridCellEditorProps;

export function RatingCellEditor({
  field,
  draft,
  onChange,
  onCommit,
  onCancel,
}: RatingCellEditorProps) {
  const max = ratingMaxFor(field);
  const iconKey = ratingIconFor(field);
  const allowHalf = ratingAllowHalfFor(field);
  const Icon = RATING_ICON_GLYPHS[iconKey];
  const palette = RATING_ICON_PALETTE[iconKey];
  const current = parseRatingDraft(draft.value, max, allowHalf);
  const step = allowHalf ? 0.5 : 1;
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    containerRef.current?.focus();
  }, []);

  const setValue = (next: number) => {
    onChange({ ...draft, value: serializeRatingDraft(next, allowHalf) });
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      onCommit();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
      return;
    }
    if (event.key === "ArrowRight" || event.key === "ArrowUp" || event.key === "+") {
      event.preventDefault();
      setValue(Math.min(max, current + step));
      return;
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowDown" || event.key === "-") {
      event.preventDefault();
      setValue(Math.max(0, current - step));
      return;
    }
    if (event.key === "Backspace" || event.key === "Delete" || event.key === "0") {
      event.preventDefault();
      setValue(0);
      return;
    }
    if (/^[1-9]$/.test(event.key)) {
      const numeric = Number(event.key);
      if (numeric <= max) {
        event.preventDefault();
        setValue(numeric);
      }
    }
  };

  const label = `${field.name ?? "Rating"} — ${current} of ${max}. Click a glyph, or use arrow keys / number keys.${
    allowHalf ? " Click the left half of a glyph for half-steps." : ""
  }`;

  return (
    <div
      ref={containerRef}
      data-testid="appforge-rating-editor"
      data-rating-allow-half={allowHalf ? "true" : undefined}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={current}
      aria-valuetext={`${current} of ${max}`}
      onKeyDown={handleKeyDown}
      onBlur={() => onCommit()}
      className="flex items-center gap-1 rounded-md border border-sky-400/40 bg-black/55 px-2 py-1 outline-none"
    >
      {Array.from({ length: max }).map((_, index) => {
        const slot = index + 1;
        const halfSlot = slot - 0.5;
        const full = slot <= current;
        const half = !full && allowHalf && halfSlot <= current;
        // Clicking the currently-active step clears the rating (AirTable
        // parity). For half-rating fields the "active" check looks at both
        // the half and the full step.
        const clickFull = () => {
          setValue(slot === current ? 0 : slot);
        };
        const clickHalf = () => {
          setValue(Math.abs(current - halfSlot) < 1e-6 ? 0 : halfSlot);
        };
        return (
          <span
            key={slot}
            data-testid="appforge-rating-editor-step"
            data-rating-step={slot}
            data-rating-step-fill={full ? "full" : half ? "half" : "empty"}
            className={`relative inline-flex h-5 w-5 items-center justify-center rounded transition-colors hover:bg-white/[0.08] ${
              full || half ? palette.active : palette.idle
            }`}
          >
            <Icon
              className={`pointer-events-none h-4 w-4 ${full || half ? "" : ""} ${
                full ? "fill-current" : ""
              }`}
            />
            {half && (
              <span
                className="pointer-events-none absolute inset-y-0 left-0 w-1/2 overflow-hidden"
                aria-hidden="true"
              >
                <Icon className={`h-4 w-4 ${palette.active} fill-current`} />
              </span>
            )}
            {allowHalf ? (
              <>
                <button
                  type="button"
                  data-rating-step-half={halfSlot}
                  aria-label={`Set rating to ${halfSlot}`}
                  onMouseDown={(event) => {
                    event.preventDefault();
                  }}
                  onClick={clickHalf}
                  className="absolute inset-y-0 left-0 w-1/2 cursor-pointer bg-transparent"
                />
                <button
                  type="button"
                  data-rating-step-full={slot}
                  aria-label={`Set rating to ${slot}`}
                  onMouseDown={(event) => {
                    event.preventDefault();
                  }}
                  onClick={clickFull}
                  className="absolute inset-y-0 right-0 w-1/2 cursor-pointer bg-transparent"
                />
              </>
            ) : (
              <button
                type="button"
                aria-label={`Set rating to ${slot}`}
                onMouseDown={(event) => {
                  event.preventDefault();
                }}
                onClick={clickFull}
                className="absolute inset-0 cursor-pointer bg-transparent"
              />
            )}
          </span>
        );
      })}
      <span className="ml-1 text-[11px] tabular-nums text-white/45">
        {current}/{max}
      </span>
    </div>
  );
}
