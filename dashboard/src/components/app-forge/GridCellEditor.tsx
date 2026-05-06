import { ExternalLink, Search, X } from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import type {
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

  const selectedIds = useMemo(
    () => parseLinkedRecordIds(draft.value),
    [draft.value],
  );

  const candidates = useMemo<RelationPickerCandidate[]>(
    () =>
      targetTable
        ? buildRelationPickerCandidates(targetTable.fields, targetTable.records)
        : [],
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
            placeholder={
              selectedIds.length === 0
                ? `Search ${fallbackTableName}…`
                : "Add another…"
            }
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
