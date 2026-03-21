import type { ComponentType } from "react";
import { CalendarAgendaWidget } from "./CalendarAgendaWidget";
import { ClockWidget } from "./ClockWidget";
import { EmptyWidget } from "./EmptyWidget";
import { SilverPriceWidget } from "./SilverPriceWidget";
import { StockNewsWidget } from "./StockNewsWidget";
import { TicketListWidget } from "./TicketListWidget";

// Built-in widget types
export type BuiltinWidgetType =
  | "empty"
  | "clock"
  | "calendar-agenda"
  | "tickets"
  | "tasks"
  | "silver-price"
  | "stock-news";

// WidgetType can be a built-in type or a custom:<uuid> string
export type WidgetType = BuiltinWidgetType | `custom:${string}`;

export interface WidgetDefinition {
  id: string;
  name: string;
  description: string;
  component?: ComponentType;
  icon: string;
}

export const widgetRegistry: Record<BuiltinWidgetType, WidgetDefinition> = {
  empty: {
    id: "empty",
    name: "Empty",
    description: "Placeholder widget",
    component: EmptyWidget,
    icon: "⬜",
  },
  clock: {
    id: "clock",
    name: "Clock",
    description: "Live time and date display",
    component: ClockWidget,
    icon: "🕐",
  },
  "calendar-agenda": {
    id: "calendar-agenda",
    name: "Calendar Agenda",
    description: "Next 5 upcoming events",
    component: CalendarAgendaWidget,
    icon: "📅",
  },
  tickets: {
    id: "tickets",
    name: "Ticket List",
    description: "Active support tickets",
    component: TicketListWidget,
    icon: "🎫",
  },
  tasks: {
    id: "tasks",
    name: "Tasks",
    description: "Asana/project tasks (coming soon)",
    component: EmptyWidget,
    icon: "✓",
  },
  "silver-price": {
    id: "silver-price",
    name: "Silver Price",
    description: "Live silver spot prices & gold/silver ratio",
    component: SilverPriceWidget,
    icon: "🪙",
  },
  "stock-news": {
    id: "stock-news",
    name: "Stock News",
    description: "Latest market news from Silver Intel Report",
    component: StockNewsWidget,
    icon: "📰",
  },
};

export function isCustomWidgetType(type: string): type is `custom:${string}` {
  return type.startsWith("custom:");
}

export function getCustomWidgetId(type: WidgetType): string | null {
  if (isCustomWidgetType(type)) {
    return type.slice(7); // Remove "custom:" prefix
  }
  return null;
}

export function getWidget(type: WidgetType): ComponentType {
  if (isCustomWidgetType(type)) {
    // Custom widgets are handled by CustomWidget component in App.tsx
    return EmptyWidget;
  }
  return widgetRegistry[type as BuiltinWidgetType]?.component || EmptyWidget;
}
