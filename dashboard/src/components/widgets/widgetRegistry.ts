import type { ComponentType } from "react";
import { ActiveWorkersWidget } from "./ActiveWorkersWidget";
import { ApprovalsWidget } from "./ApprovalsWidget";
import { CalendarAgendaWidget } from "./CalendarAgendaWidget";
import { ClockWidget } from "./ClockWidget";
import { CostBurnWidget } from "./CostBurnWidget";
import { EmptyWidget } from "./EmptyWidget";
import { ErrorsWidget } from "./ErrorsWidget";
import { FleetKillWidget } from "./FleetKillWidget";
import { QueueWidget } from "./QueueWidget";
import { ScheduleWidget } from "./ScheduleWidget";
import { SilverPriceWidget } from "./SilverPriceWidget";
import { StockNewsWidget } from "./StockNewsWidget";
import { TaskManagerWidget } from "./TaskManagerWidget";
import { ThroughputWidget } from "./ThroughputWidget";
import { TicketListWidget } from "./TicketListWidget";
import { WorkflowMapCanvas } from "./WorkflowMapCanvas";

// Built-in widget types
export type BuiltinWidgetType =
  | "empty"
  | "clock"
  | "calendar-agenda"
  | "tickets"
  | "tasks"
  | "silver-price"
  | "stock-news"
  // Operations (Think Tank spec)
  | "approvals"
  | "active-workers"
  | "queue"
  | "errors"
  | "throughput"
  | "cost-burn"
  | "fleet-kill"
  | "workflow-map"
  | "jobs-board"
  | "schedule"
  | "org-chart"
  | "task-manager";

// WidgetType can be a built-in type or a custom:<uuid> string
export type WidgetType = BuiltinWidgetType | `custom:${string}`;

export type WidgetTier = "core" | "business";

export interface WidgetDefinition {
  id: string;
  name: string;
  description: string;
  component?: ComponentType;
  icon: string;
  tier: WidgetTier;
}

export const widgetRegistry: Record<BuiltinWidgetType, WidgetDefinition> = {
  // ── Core widgets ──
  empty: {
    id: "empty",
    name: "Empty",
    description: "Placeholder widget",
    component: EmptyWidget,
    icon: "⬜",
    tier: "core",
  },
  clock: {
    id: "clock",
    name: "Clock",
    description: "Live time and date display",
    component: ClockWidget,
    icon: "🕐",
    tier: "core",
  },
  "calendar-agenda": {
    id: "calendar-agenda",
    name: "Calendar Agenda",
    description: "Next 5 upcoming events",
    component: CalendarAgendaWidget,
    icon: "📅",
    tier: "core",
  },
  tickets: {
    id: "tickets",
    name: "Ticket List",
    description: "Active support tickets",
    component: TicketListWidget,
    icon: "🎫",
    tier: "core",
  },
  tasks: {
    id: "tasks",
    name: "Tasks",
    description: "Project tasks overview",
    component: EmptyWidget,
    icon: "✓",
    tier: "core",
  },
  "silver-price": {
    id: "silver-price",
    name: "Silver Price",
    description: "Live silver spot prices & gold/silver ratio",
    component: SilverPriceWidget,
    icon: "🪙",
    tier: "core",
  },
  "stock-news": {
    id: "stock-news",
    name: "Stock News",
    description: "Latest market news from Silver Intel Report",
    component: StockNewsWidget,
    icon: "📰",
    tier: "core",
  },

  // ── Operations widgets (Think Tank spec) ──
  approvals: {
    id: "approvals",
    name: "Approvals",
    description: "Pending actions requiring human sign-off with undo risk",
    component: ApprovalsWidget,
    icon: "🛡️",
    tier: "business",
  },
  "active-workers": {
    id: "active-workers",
    name: "Active Workers",
    description: "Running agents with confidence and reversal cost indicators",
    component: ActiveWorkersWidget,
    icon: "👥",
    tier: "business",
  },
  queue: {
    id: "queue",
    name: "Queue + Scale Horizon",
    description: "Task queue depth, blocked, overdue, and time-to-capacity",
    component: QueueWidget,
    icon: "📊",
    tier: "business",
  },
  errors: {
    id: "errors",
    name: "Errors & Failures",
    description: "Agent errors and compute anomalies in one view",
    component: ErrorsWidget,
    icon: "🚨",
    tier: "business",
  },
  throughput: {
    id: "throughput",
    name: "Throughput",
    description: "Task completion trends, success rate, overdue count",
    component: ThroughputWidget,
    icon: "📈",
    tier: "business",
  },
  "cost-burn": {
    id: "cost-burn",
    name: "Cost Burn",
    description: "API spend by tier, token consumption tracking",
    component: CostBurnWidget,
    icon: "💰",
    tier: "business",
  },
  "fleet-kill": {
    id: "fleet-kill",
    name: "Fleet Kill",
    description: "Emergency stop all workers — always visible, never buried",
    component: FleetKillWidget,
    icon: "🛑",
    tier: "business",
  },
  "workflow-map": {
    id: "workflow-map",
    name: "Live Workflow Map",
    description:
      "Orbital fleet visualization — Argent at center, agents orbiting, providers pulsing",
    component: WorkflowMapCanvas,
    icon: "🌐",
    tier: "core",
  },
  "jobs-board": {
    id: "jobs-board",
    name: "Jobs Board",
    description: "Per-agent Kanban board — Scheduled, Running, Completed, Failed",
    component: EmptyWidget,
    icon: "📋",
    tier: "core",
  },
  schedule: {
    id: "schedule",
    name: "Schedule",
    description: "Cron job definitions — create, toggle, and trigger scheduled tasks",
    component: ScheduleWidget,
    icon: "🗓️",
    tier: "core",
  },
  "org-chart": {
    id: "org-chart",
    name: "Org Chart",
    description: "Hierarchical agent tree with department grouping and status badges",
    component: EmptyWidget,
    icon: "🏢",
    tier: "core",
  },
  "task-manager": {
    id: "task-manager",
    name: "Task Manager",
    description: "Fleet-wide aggregated task view with stats and multi-agent Kanban",
    component: TaskManagerWidget,
    icon: "⚡",
    tier: "core",
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

export function getWidgetComponent(type: WidgetType): ComponentType {
  if (isCustomWidgetType(type)) {
    return EmptyWidget;
  }
  return widgetRegistry[type as BuiltinWidgetType]?.component || EmptyWidget;
}

// Backward compat alias
export const getWidget = getWidgetComponent;
