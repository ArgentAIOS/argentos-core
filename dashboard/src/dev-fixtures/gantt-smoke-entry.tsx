// Visual smoke harness for app-forge GanttView. Mounts the real
// component with mock structured-data records so the gantt rendering
// can be confirmed in a running dashboard without the auth / onboarding
// chain. Lives inside src/ so Tailwind 4's content scanner picks up
// the utility classes used by GanttView's render tree.
//
// Loaded from /public/dev-fixtures/gantt-smoke.html. Original purpose:
// closing gantt-related goal during 2026-05-18 shift-two session.

import React from "react";
import { createRoot } from "react-dom/client";
import "../index.css";
import type { ForgeStructuredField, ForgeStructuredRecord } from "../hooks/useForgeStructuredData";
import { GanttView } from "../components/app-forge/GanttView";
import { ThemeProvider } from "../lib/ThemeProvider";

const today = new Date("2026-05-18T00:00:00");

const fields: ForgeStructuredField[] = [
  { id: "f-title", name: "Task", type: "text" },
  { id: "f-start", name: "Start", type: "date" },
  { id: "f-end", name: "End", type: "date" },
  {
    id: "f-owner",
    name: "Owner",
    type: "single_select",
    options: ["Sem", "Richard", "Unassigned"],
  },
];

const day = (offset: number) => {
  const d = new Date(today);
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
};

const records: ForgeStructuredRecord[] = [
  {
    id: "r1",
    values: { "f-title": "Spec gantt", "f-start": day(-4), "f-end": day(-1), "f-owner": "Sem" },
  },
  {
    id: "r2",
    values: { "f-title": "Build bars", "f-start": day(-2), "f-end": day(3), "f-owner": "Sem" },
  },
  {
    id: "r3",
    values: {
      "f-title": "Hierarchy lift",
      "f-start": day(1),
      "f-end": day(6),
      "f-owner": "Richard",
    },
  },
  {
    id: "r4",
    values: { "f-title": "Dep arrows", "f-start": day(5), "f-end": day(9), "f-owner": "Richard" },
  },
  {
    id: "r5",
    values: {
      "f-title": "Smoke verify",
      "f-start": day(7),
      "f-end": day(7),
      "f-owner": "Unassigned",
    },
  },
];

function App() {
  return (
    <div className="min-h-screen bg-background p-6 text-foreground">
      <div className="mb-3 text-xs text-white/45">
        gantt-smoke fixture · records: {records.length} · fields: {fields.length} · today:{" "}
        {today.toISOString().slice(0, 10)} · lane: Owner
      </div>
      <div className="rounded-xl border border-white/8 bg-card p-4">
        <GanttView
          records={records}
          fields={fields}
          preferredLaneFieldId="f-owner"
          getRecordTitle={(r) => String(r.values["f-title"] ?? r.id)}
          onSelectRecord={(id) => {
            // eslint-disable-next-line no-console
            console.log("[gantt-smoke] selected", id);
          }}
          today={today}
        />
      </div>
    </div>
  );
}

const status = document.getElementById("status");
if (status) {
  status.textContent = "mounted";
}
const root = createRoot(document.getElementById("root")!);
root.render(
  <React.StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </React.StrictMode>,
);
