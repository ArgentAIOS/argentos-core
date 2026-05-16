import { useMemo, useState } from "react";
import {
  type ForgeStructuredField,
  type ForgeStructuredRecord,
  type ForgeStructuredRecordValue,
} from "../../hooks/useForgeStructuredData";
import {
  GALLERY_DEFAULT_BODY_FIELD_LIMIT,
  pickThumbnailUrl,
  resolveThumbnailField,
  selectGalleryBodyFields,
} from "./gallery-card";

/**
 * AppForge Gallery view (v1, read-only).
 *
 * Renders records as a responsive grid of cards. Each card shows an
 * optional thumbnail from an `attachment` field, the record title, and
 * up to four short fields below. v1 has no drag-to-reorder and no
 * inline edit — clicking a card pops the record open via the parent's
 * editor path (mirrors how Form/Calendar views select records).
 *
 * Thumbnail-field selection precedence (per spec):
 *   1. `preferredThumbnailFieldId` (the saved view's `groupFieldId`) if
 *      it points to a real attachment field on the table.
 *   2. The first `type === "attachment"` field on the table.
 *   3. None — cards render text-only with a neutral placeholder.
 *
 * Pure logic (attachment URL parsing, body-field selection) lives in
 * `./gallery-card.ts` and is unit-tested in `./gallery-card.test.ts`.
 */

export type GalleryViewProps = {
  records: readonly ForgeStructuredRecord[];
  fields: readonly ForgeStructuredField[];
  /**
   * Field id the operator picked on the saved view. The kanban/calendar
   * `groupFieldId` slot is reused for the thumbnail field. When undefined
   * or pointing to a non-attachment field, the component falls back to
   * the first attachment field on the table.
   */
  preferredThumbnailFieldId?: string;
  /**
   * Lookup for the user-visible title of a record. Passed in so the
   * caller controls how name/title is resolved (matches Kanban/Calendar).
   */
  getRecordTitle: (record: ForgeStructuredRecord) => string;
  /**
   * Open the record-editor surface for `recordId`. v1 just hands this
   * off to the parent which already routes form-style record edits.
   */
  onSelectRecord?: (recordId: string) => void;
};

const BODY_FIELD_LIMIT = GALLERY_DEFAULT_BODY_FIELD_LIMIT;

/**
 * Render a single non-thumbnail body field value to a short, card-safe
 * string. Long values are truncated by CSS at render time; here we only
 * normalize arrays / nullish / boolean shapes.
 */
function bodyFieldValue(value: ForgeStructuredRecordValue | undefined): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (Array.isArray(value)) {
    return value.filter((entry) => entry.trim().length > 0).join(", ");
  }
  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }
  return String(value);
}

export function GalleryView({
  records,
  fields,
  preferredThumbnailFieldId,
  getRecordTitle,
  onSelectRecord,
}: GalleryViewProps) {
  const thumbnailField = useMemo(
    () => resolveThumbnailField(fields, preferredThumbnailFieldId),
    [fields, preferredThumbnailFieldId],
  );

  const bodyFields = useMemo(
    () =>
      selectGalleryBodyFields(fields, {
        thumbnailFieldId: thumbnailField?.id ?? null,
        limit: BODY_FIELD_LIMIT,
      }),
    [fields, thumbnailField],
  );

  const [imageErrorByRecord, setImageErrorByRecord] = useState<Record<string, true>>({});

  if (records.length === 0) {
    return (
      <div className="flex min-h-72 flex-col items-center justify-center gap-2 p-8 text-center">
        <div className="text-sm font-medium text-white/72">No records to display in this view.</div>
        <div className="max-w-md text-xs leading-5 text-white/45">
          Add a record to this table — or adjust this view&apos;s filter — and the gallery will
          populate automatically.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/18 px-3 py-2 text-xs text-white/40">
        <div>
          {records.length} {records.length === 1 ? "record" : "records"}
        </div>
        <div className="flex items-center gap-2">
          {thumbnailField ? (
            <span>
              Thumbnails from
              <span className="ml-1 rounded-md bg-white/[0.06] px-2 py-0.5 text-white/65">
                {thumbnailField.name}
              </span>
            </span>
          ) : (
            <span className="text-white/35">
              Add an attachment field to show thumbnails on cards.
            </span>
          )}
        </div>
      </div>

      <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(220px,1fr))]">
        {records.map((record) => {
          const title = getRecordTitle(record);
          const thumbnailUrl = thumbnailField
            ? pickThumbnailUrl(record.values[thumbnailField.id])
            : null;
          const imageFailed = imageErrorByRecord[record.id] === true;
          const showImage = thumbnailUrl && !imageFailed;
          return (
            <button
              key={record.id}
              type="button"
              onClick={() => onSelectRecord?.(record.id)}
              title={title}
              className="group flex flex-col gap-2 overflow-hidden rounded-xl border border-white/10 bg-black/40 p-3 text-left transition-colors hover:border-white/25 hover:bg-black/55 focus:outline-none focus-visible:border-sky-400/60"
            >
              <div className="-mx-3 -mt-3 flex aspect-[4/3] items-center justify-center overflow-hidden border-b border-white/5 bg-gradient-to-br from-white/[0.03] to-white/[0.01]">
                {showImage ? (
                  <img
                    src={thumbnailUrl ?? undefined}
                    alt={title}
                    loading="lazy"
                    onError={() =>
                      setImageErrorByRecord((current) =>
                        current[record.id] ? current : { ...current, [record.id]: true },
                      )
                    }
                    className="h-full w-full object-cover transition-transform group-hover:scale-[1.02]"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-[10px] uppercase tracking-[0.18em] text-white/25">
                    {thumbnailField ? "No image" : "No attachment field"}
                  </div>
                )}
              </div>
              <div className="truncate text-sm font-medium text-white/80">{title}</div>
              {bodyFields.length > 0 && (
                <dl className="flex flex-col gap-1 text-[11px] text-white/55">
                  {bodyFields.map((field) => {
                    const value = bodyFieldValue(record.values[field.id]);
                    if (!value) {
                      return null;
                    }
                    return (
                      <div key={field.id} className="flex min-w-0 items-baseline gap-2">
                        <dt className="shrink-0 text-[10px] uppercase tracking-[0.14em] text-white/30">
                          {field.name}
                        </dt>
                        <dd className="min-w-0 flex-1 truncate text-white/70">{value}</dd>
                      </div>
                    );
                  })}
                </dl>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
