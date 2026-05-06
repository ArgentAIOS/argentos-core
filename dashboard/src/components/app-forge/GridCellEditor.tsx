import { ExternalLink, X } from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import type {
  ForgeStructuredField,
  ForgeStructuredRecordValue,
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
