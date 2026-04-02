/**
 * TabNavigation — Mission Control tab switcher
 * Uses ArgentOS icon system for cohesive visual identity
 */

import React from "react";
import {
  WorkflowMapIcon,
  WorkloadsIcon,
  TaskManagerIcon,
  OrgChartIcon,
  ScheduleIcon,
  WorkersIcon,
} from "../icons/ArgentOS";

export type TabName = "workflow" | "workloads" | "tasks" | "org" | "schedule" | "workers";

interface TabNavProps {
  activeTab: TabName;
  onTabChange: (tab: TabName) => void;
  darkMode?: boolean;
}

const TABS: { name: TabName; label: string; icon: React.ComponentType<any> }[] = [
  { name: "workflow", label: "Workflow Map", icon: WorkflowMapIcon },
  { name: "workloads", label: "Workloads", icon: WorkloadsIcon },
  { name: "tasks", label: "Task Manager", icon: TaskManagerIcon },
  { name: "org", label: "Org Chart", icon: OrgChartIcon },
  { name: "schedule", label: "Schedule", icon: ScheduleIcon },
  { name: "workers", label: "Workers", icon: WorkersIcon },
];

export const TabNavigation: React.FC<TabNavProps> = ({
  activeTab,
  onTabChange,
  darkMode = true,
}) => {
  return (
    <nav className="tab-navigation" data-theme={darkMode ? "dark" : "light"}>
      <div className="tab-bar">
        {TABS.map(({ name, label, icon: IconComponent }) => (
          <button
            key={name}
            className={`tab-button ${activeTab === name ? "active" : ""}`}
            onClick={() => onTabChange(name)}
            title={label}
            aria-label={label}
            aria-current={activeTab === name ? "page" : undefined}
          >
            <IconComponent size={20} darkMode={darkMode} />
            <span className="tab-label">{label}</span>
          </button>
        ))}
      </div>

      <style>{`
        .tab-navigation {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.75rem 1rem;
          background: rgba(6, 10, 16, 0.4);
          border-bottom: 1px solid rgba(0, 170, 255, 0.1);
          backdrop-filter: blur(8px);
        }

        .tab-bar {
          display: flex;
          gap: 0.25rem;
          flex-wrap: wrap;
        }

        .tab-button {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.5rem 1rem;
          background: transparent;
          border: 1px solid transparent;
          border-radius: 0.5rem;
          color: rgba(255, 255, 255, 0.6);
          font-size: 0.875rem;
          cursor: pointer;
          transition: all 0.2s ease;
          white-space: nowrap;
        }

        .tab-button:hover {
          background: rgba(0, 170, 255, 0.1);
          color: rgba(255, 255, 255, 0.9);
          border-color: rgba(0, 170, 255, 0.2);
        }

        .tab-button.active {
          background: rgba(0, 170, 255, 0.15);
          border-color: rgba(0, 170, 255, 0.4);
          color: #00aaff;
          box-shadow: 0 0 12px rgba(0, 170, 255, 0.2);
        }

        .tab-label {
          font-weight: 500;
          letter-spacing: 0.5px;
        }

        @media (max-width: 768px) {
          .tab-label {
            display: none;
          }

          .tab-button {
            padding: 0.5rem;
          }
        }

        /* Light mode */
        [data-theme="light"] .tab-navigation {
          background: rgba(255, 255, 255, 0.8);
          border-bottom-color: rgba(0, 102, 204, 0.1);
        }

        [data-theme="light"] .tab-button {
          color: rgba(0, 0, 0, 0.6);
        }

        [data-theme="light"] .tab-button:hover {
          background: rgba(0, 102, 204, 0.1);
          color: rgba(0, 0, 0, 0.9);
          border-color: rgba(0, 102, 204, 0.2);
        }

        [data-theme="light"] .tab-button.active {
          background: rgba(0, 102, 204, 0.15);
          border-color: rgba(0, 102, 204, 0.4);
          color: #0066cc;
          box-shadow: 0 0 12px rgba(0, 102, 204, 0.2);
        }
      `}</style>
    </nav>
  );
};

export default TabNavigation;
