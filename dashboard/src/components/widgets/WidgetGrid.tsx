/**
 * WidgetGrid — Draggable, resizable widget grid using react-grid-layout.
 *
 * Sits below the avatar center area in the Mission Control layout.
 * Layout persists to localStorage. Widgets are registered in widgetRegistry.
 */

import { GripVertical, X, Plus } from "lucide-react";
import { useState, useCallback, useRef, useEffect } from "react";
import ReactGridLayout, { useContainerWidth } from "react-grid-layout";
// CSS imports handled inline — react-grid-layout and react-resizable styles
// are minimal and we override everything with our own glassmorphic styling
import { CustomWidget } from "./CustomWidget";
import {
  widgetRegistry,
  type BuiltinWidgetType,
  type WidgetType,
  isCustomWidgetType,
} from "./widgetRegistry";

// ── Layout persistence ────────────────────────────────────────────

interface GridItem {
  i: string; // unique id
  type: WidgetType;
  x: number;
  y: number;
  w: number;
  h: number;
}

const STORAGE_KEY = "argent-widget-grid";
const ROW_HEIGHT = 120;
const COLS = 6;

const DEFAULT_ITEMS: GridItem[] = [
  { i: "w1", type: "clock", x: 0, y: 0, w: 2, h: 2 },
  { i: "w2", type: "calendar-agenda", x: 2, y: 0, w: 2, h: 2 },
  { i: "w3", type: "stock-news", x: 4, y: 0, w: 2, h: 2 },
];

function loadGridItems(): GridItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {}
  return DEFAULT_ITEMS;
}

function saveGridItems(items: GridItem[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {}
}

// ── Component ─────────────────────────────────────────────────────

interface WidgetGridProps {
  onPickerOpen: () => void;
  customWidgets?: Array<{ id: string; name: string; icon: string }>;
}

export function WidgetGrid({ onPickerOpen, customWidgets }: WidgetGridProps) {
  const { width, containerRef, mounted } = useContainerWidth();
  const [items, setItems] = useState<GridItem[]>(loadGridItems);

  // Sync to localStorage
  useEffect(() => {
    saveGridItems(items);
  }, [items]);

  const layout = items.map((item) => ({
    i: item.i,
    x: item.x,
    y: item.y,
    w: item.w,
    h: item.h,
    minW: 1,
    minH: 1,
  }));

  const handleLayoutChange = useCallback(
    (newLayout: Array<{ i: string; x: number; y: number; w: number; h: number }>) => {
      setItems((prev) =>
        prev.map((item) => {
          const updated = newLayout.find((l) => l.i === item.i);
          if (!updated) return item;
          return { ...item, x: updated.x, y: updated.y, w: updated.w, h: updated.h };
        }),
      );
    },
    [],
  );

  const removeWidget = useCallback((id: string) => {
    setItems((prev) => prev.filter((item) => item.i !== id));
  }, []);

  const renderWidget = (item: GridItem) => {
    if (isCustomWidgetType(item.type)) {
      const customId = item.type.slice(7);
      return <CustomWidget widgetId={customId} />;
    }
    const def = widgetRegistry[item.type as BuiltinWidgetType];
    if (!def?.component)
      return <div className="text-[hsl(var(--muted-foreground))] text-sm p-3">Unknown widget</div>;
    const Comp = def.component;
    return <Comp />;
  };

  return (
    <div ref={containerRef} className="w-full">
      {mounted && width > 0 && (
        <ReactGridLayout
          layout={layout}
          width={width}
          gridConfig={{ cols: COLS, rowHeight: ROW_HEIGHT, margin: [8, 8] }}
          dragConfig={{ enabled: true, handle: ".widget-drag-handle" }}
          resizeConfig={{ enabled: true, handles: ["se"] }}
          onLayoutChange={handleLayoutChange}
        >
          {items.map((item) => (
            <div
              key={item.i}
              className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] overflow-hidden group"
            >
              {/* Drag handle + remove button */}
              <div className="widget-drag-handle flex items-center justify-between px-2 py-1 border-b border-[hsl(var(--border))]/50 opacity-0 group-hover:opacity-100 transition-opacity cursor-grab active:cursor-grabbing">
                <div className="flex items-center gap-1">
                  <GripVertical className="w-3 h-3 text-[hsl(var(--muted-foreground))]" />
                  <span className="text-[10px] text-[hsl(var(--muted-foreground))]">
                    {widgetRegistry[item.type as BuiltinWidgetType]?.name || item.type}
                  </span>
                </div>
                <button
                  onClick={() => removeWidget(item.i)}
                  className="p-0.5 rounded hover:bg-[hsl(var(--destructive))]/20 transition-colors"
                >
                  <X className="w-3 h-3 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--destructive))]" />
                </button>
              </div>
              {/* Widget content */}
              <div className="p-2 h-[calc(100%-24px)] overflow-auto">{renderWidget(item)}</div>
            </div>
          ))}
        </ReactGridLayout>
      )}

      {/* Add widget button */}
      <button
        onClick={onPickerOpen}
        className="w-full mt-2 py-2 rounded-xl border border-dashed border-[hsl(var(--border))] hover:border-[hsl(var(--primary))]/40 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--primary))] transition-colors flex items-center justify-center gap-2 text-sm"
      >
        <Plus className="w-4 h-4" />
        Add Widget
      </button>
    </div>
  );
}

// ── addWidget helper (exported for use from parent) ───────────────

let nextId = Date.now();

export function createGridItem(type: WidgetType): GridItem {
  nextId++;
  return {
    i: `w${nextId}`,
    type,
    x: 0,
    y: Infinity, // react-grid-layout places at bottom
    w: 2,
    h: 2,
  };
}
