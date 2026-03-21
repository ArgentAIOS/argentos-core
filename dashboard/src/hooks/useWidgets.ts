import { useState, useEffect, useCallback, useRef } from "react";
import type { WidgetType } from "../components/widgets/widgetRegistry";

export interface WidgetSlot {
  position: number; // 1-7 (1-3 left, 4-6 right, 7 bottom)
  type: WidgetType;
}

export interface CustomWidgetInfo {
  id: string;
  name: string;
  description?: string;
  icon: string;
  version: number;
}

const DEFAULT_WIDGETS: WidgetSlot[] = [
  { position: 1, type: "calendar-agenda" },
  { position: 2, type: "tickets" },
  { position: 3, type: "empty" },
  { position: 4, type: "clock" },
  { position: 5, type: "empty" },
  { position: 6, type: "empty" },
  { position: 7, type: "empty" }, // Bottom-left (bubble position)
];

const STORAGE_KEY = "argent-widget-config";

// Widget API is now registered in the gateway.
// Custom widgets will be fetched and displayed in the dropdown.
const WIDGET_API_ENABLED = true;

export function useWidgets() {
  const [widgets, setWidgets] = useState<WidgetSlot[]>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? JSON.parse(stored) : DEFAULT_WIDGETS;
    } catch {
      return DEFAULT_WIDGETS;
    }
  });

  const [customWidgets, setCustomWidgets] = useState<CustomWidgetInfo[]>([]);
  const esRef = useRef<EventSource | null>(null);

  // Fetch custom widgets from API
  const fetchCustomWidgets = useCallback(async () => {
    if (!WIDGET_API_ENABLED) return;
    try {
      const res = await fetch("/api/widgets", { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setCustomWidgets(data.widgets || []);
      }
    } catch {
      // Widget API not available
    }
  }, []);

  // Load custom widgets on mount
  useEffect(() => {
    fetchCustomWidgets();
  }, [fetchCustomWidgets]);

  // SSE for real-time widget updates
  useEffect(() => {
    if (!WIDGET_API_ENABLED) return;

    const es = new EventSource("/api/widgets/events");
    esRef.current = es;

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (
          data.type === "widget_created" ||
          data.type === "widget_updated" ||
          data.type === "widget_deleted"
        ) {
          fetchCustomWidgets();
        }
        if (data.type === "widget_assigned") {
          const widgetId = data.widgetId as string;
          const position = data.position as number;
          const type: WidgetType = widgetId.startsWith("custom:")
            ? (widgetId as WidgetType)
            : (`custom:${widgetId}` as WidgetType);
          const builtinIds = [
            "empty",
            "clock",
            "calendar-agenda",
            "tickets",
            "tasks",
            "silver-price",
            "stock-news",
          ];
          const finalType: WidgetType = builtinIds.includes(widgetId)
            ? (widgetId as WidgetType)
            : type;
          setWidgets((prev) =>
            prev.map((w) => (w.position === position ? { ...w, type: finalType } : w)),
          );
        }
      } catch {
        // ignore parse errors
      }
    };

    return () => es.close();
  }, [fetchCustomWidgets]);

  // Persist to localStorage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(widgets));
  }, [widgets]);

  const updateWidget = (position: number, type: WidgetType) => {
    setWidgets((prev) => prev.map((w) => (w.position === position ? { ...w, type } : w)));
  };

  const getWidget = (position: number): WidgetType => {
    return widgets.find((w) => w.position === position)?.type || "empty";
  };

  const resetToDefaults = () => {
    setWidgets(DEFAULT_WIDGETS);
  };

  return {
    widgets,
    customWidgets,
    updateWidget,
    getWidget,
    resetToDefaults,
  };
}
