/**
 * ArgentOS Icon System
 * Custom icon library designed for Mission Control dashboard
 *
 * Design Language:
 * - Orbital/flowing geometry (not rigid/corporate)
 * - Cyan (#00aaff) and warm accent colors
 * - Luminous quality with subtle glow
 * - Minimal line weight, modular construction
 * - Connection emphasis: arcs, dashes, bridges
 *
 * All icons scale from 16px to 64px
 * Support dark mode (cyan on deep space) and light mode (deep tones on light)
 */

import React from "react";

interface IconProps {
  size?: number;
  className?: string;
  darkMode?: boolean;
  animated?: boolean;
}

// Color palette
const COLORS = {
  // Dark mode
  dark: {
    primary: "#00aaff", // cyan accent
    secondary: "#00ffcc", // teal
    accent: "#ffa500", // warm gold/orange
    muted: "#4a5568", // subtle
    glow: "rgba(0, 170, 255, 0.3)",
  },
  // Light mode
  light: {
    primary: "#0066cc", // deep blue
    secondary: "#009999", // deep teal
    accent: "#cc6600", // deep gold
    muted: "#999999", // muted gray
    glow: "rgba(0, 102, 204, 0.1)",
  },
};

const getColor = (mode: string, key: keyof typeof COLORS.dark) => {
  return mode === "dark" ? COLORS.dark[key] : COLORS.light[key];
};

// ─────────────────────────────────────────────────────────────────────────────
// WORKFLOW MAP — Orbital nucleus with concentric rings
// ─────────────────────────────────────────────────────────────────────────────

export const WorkflowMapIcon: React.FC<IconProps> = ({
  size = 24,
  darkMode = true,
  animated = false,
}) => {
  const mode = darkMode ? "dark" : "light";
  const color = getColor(mode, "primary");
  const _glow = getColor(mode, "glow");

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <filter id="glow-workflow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="0.8" result="coloredBlur" />
          <feMerge>
            <feMergeNode in="coloredBlur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Outer orbital ring */}
      <circle cx="12" cy="12" r="10" stroke={color} strokeWidth="1" opacity="0.4" />

      {/* Middle orbital ring */}
      <circle cx="12" cy="12" r="6.5" stroke={color} strokeWidth="1" opacity="0.6" />

      {/* Inner orbital ring */}
      <circle cx="12" cy="12" r="3" stroke={color} strokeWidth="1.5" opacity="0.8" />

      {/* Central nucleus — glowing dot */}
      <circle cx="12" cy="12" r="1.5" fill={color} filter="url(#glow-workflow)" />

      {/* Connecting dash (12 o'clock) */}
      <line x1="12" y1="2" x2="12" y2="3.5" stroke={color} strokeWidth="0.8" opacity="0.6" />

      {animated && (
        <style>{`
          @keyframes orbit-slow {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }
          svg {
            animation: orbit-slow 20s linear infinite;
            transform-origin: 50% 50%;
          }
        `}</style>
      )}
    </svg>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// WORKLOADS — Particles in cascading motion
// ─────────────────────────────────────────────────────────────────────────────

export const WorkloadsIcon: React.FC<IconProps> = ({
  size = 24,
  darkMode = true,
  animated = false,
}) => {
  const mode = darkMode ? "dark" : "light";
  const color = getColor(mode, "secondary");

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <filter id="glow-workload" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="0.6" result="coloredBlur" />
          <feMerge>
            <feMergeNode in="coloredBlur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Top particle */}
      <circle cx="12" cy="4" r="1.2" fill={color} filter="url(#glow-workload)" />

      {/* Upper-left cascade */}
      <circle cx="7" cy="9" r="1" fill={color} opacity="0.8" filter="url(#glow-workload)" />

      {/* Upper-right cascade */}
      <circle cx="17" cy="9" r="1" fill={color} opacity="0.8" filter="url(#glow-workload)" />

      {/* Center cascade */}
      <circle cx="12" cy="12" r="1.1" fill={color} filter="url(#glow-workload)" />

      {/* Lower-left */}
      <circle cx="6" cy="16" r="0.9" fill={color} opacity="0.7" filter="url(#glow-workload)" />

      {/* Lower-center */}
      <circle cx="12" cy="18" r="0.9" fill={color} opacity="0.7" filter="url(#glow-workload)" />

      {/* Lower-right */}
      <circle cx="18" cy="16" r="0.9" fill={color} opacity="0.7" filter="url(#glow-workload)" />

      {/* Connection dashes (flow lines) */}
      <line
        x1="12"
        y1="5.5"
        x2="7.5"
        y2="8"
        stroke={color}
        strokeWidth="0.6"
        opacity="0.4"
        strokeDasharray="1,1"
      />
      <line
        x1="12"
        y1="5.5"
        x2="16.5"
        y2="8"
        stroke={color}
        strokeWidth="0.6"
        opacity="0.4"
        strokeDasharray="1,1"
      />
      <line
        x1="7.5"
        y1="9.5"
        x2="11"
        y2="11.5"
        stroke={color}
        strokeWidth="0.6"
        opacity="0.4"
        strokeDasharray="1,1"
      />
      <line
        x1="16.5"
        y1="9.5"
        x2="13"
        y2="11.5"
        stroke={color}
        strokeWidth="0.6"
        opacity="0.4"
        strokeDasharray="1,1"
      />

      {animated && (
        <style>{`
          @keyframes cascade {
            0% { opacity: 0; transform: translateY(-4px); }
            50% { opacity: 1; }
            100% { opacity: 0.3; transform: translateY(8px); }
          }
          circle {
            animation: cascade 3s ease-in-out infinite;
          }
        `}</style>
      )}
    </svg>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// TASK MANAGER — Nested priority layers
// ─────────────────────────────────────────────────────────────────────────────

export const TaskManagerIcon: React.FC<IconProps> = ({ size = 24, darkMode = true }) => {
  const mode = darkMode ? "dark" : "light";
  const color = getColor(mode, "primary");

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <filter id="glow-task" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="0.7" result="coloredBlur" />
          <feMerge>
            <feMergeNode in="coloredBlur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Outer layer (background) */}
      <rect
        x="3"
        y="3"
        width="18"
        height="18"
        rx="2"
        stroke={color}
        strokeWidth="1"
        opacity="0.3"
      />

      {/* Middle layer */}
      <rect
        x="5"
        y="6"
        width="14"
        height="12"
        rx="1.5"
        stroke={color}
        strokeWidth="1"
        opacity="0.6"
      />

      {/* Inner layer (priority highlight) */}
      <rect
        x="7"
        y="9"
        width="10"
        height="6"
        rx="1"
        stroke={color}
        strokeWidth="1.2"
        opacity="0.9"
        filter="url(#glow-task)"
      />

      {/* Priority indicator dots */}
      <circle cx="9" cy="12" r="0.7" fill={color} opacity="0.8" />
      <circle cx="15" cy="12" r="0.7" fill={color} opacity="0.6" />

      {/* Connecting line */}
      <line
        x1="10"
        y1="12"
        x2="14"
        y2="12"
        stroke={color}
        strokeWidth="0.6"
        opacity="0.5"
        strokeDasharray="1,1"
      />
    </svg>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// ORG CHART — Connected constellation nodes
// ─────────────────────────────────────────────────────────────────────────────

export const OrgChartIcon: React.FC<IconProps> = ({
  size = 24,
  darkMode = true,
  animated = false,
}) => {
  const mode = darkMode ? "dark" : "light";
  const color = getColor(mode, "primary");
  const accentColor = getColor(mode, "accent");

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <filter id="glow-org" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="0.6" result="coloredBlur" />
          <feMerge>
            <feMergeNode in="coloredBlur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Central hub */}
      <circle cx="12" cy="12" r="1.5" fill={color} filter="url(#glow-org)" />

      {/* Top node */}
      <circle cx="12" cy="4" r="1" fill={accentColor} opacity="0.8" />

      {/* Left node */}
      <circle cx="4" cy="12" r="1" fill={accentColor} opacity="0.8" />

      {/* Right node */}
      <circle cx="20" cy="12" r="1" fill={accentColor} opacity="0.8" />

      {/* Bottom-left node */}
      <circle cx="6" cy="19" r="1" fill={accentColor} opacity="0.7" />

      {/* Bottom-right node */}
      <circle cx="18" cy="19" r="1" fill={accentColor} opacity="0.7" />

      {/* Connection lines — dashed bridges */}
      <line
        x1="12"
        y1="5.5"
        x2="12"
        y2="10.5"
        stroke={color}
        strokeWidth="0.8"
        opacity="0.5"
        strokeDasharray="1.5,1.5"
      />
      <line
        x1="5"
        y1="12"
        x2="10.5"
        y2="12"
        stroke={color}
        strokeWidth="0.8"
        opacity="0.5"
        strokeDasharray="1.5,1.5"
      />
      <line
        x1="19"
        y1="12"
        x2="13.5"
        y2="12"
        stroke={color}
        strokeWidth="0.8"
        opacity="0.5"
        strokeDasharray="1.5,1.5"
      />
      <line
        x1="10.5"
        y1="13.5"
        x2="6.5"
        y2="18"
        stroke={color}
        strokeWidth="0.8"
        opacity="0.4"
        strokeDasharray="1.5,1.5"
      />
      <line
        x1="13.5"
        y1="13.5"
        x2="17.5"
        y2="18"
        stroke={color}
        strokeWidth="0.8"
        opacity="0.4"
        strokeDasharray="1.5,1.5"
      />

      {animated && (
        <style>{`
          @keyframes pulse-node {
            0%, 100% { r: 1; opacity: 0.8; }
            50% { r: 1.3; opacity: 0.5; }
          }
          circle {
            animation: pulse-node 4s ease-in-out infinite;
          }
        `}</style>
      )}
    </svg>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// SCHEDULE — Pulsing temporal rhythm/wave
// ─────────────────────────────────────────────────────────────────────────────

export const ScheduleIcon: React.FC<IconProps> = ({
  size = 24,
  darkMode = true,
  animated = false,
}) => {
  const mode = darkMode ? "dark" : "light";
  const color = getColor(mode, "secondary");

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <filter id="glow-schedule" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="0.7" result="coloredBlur" />
          <feMerge>
            <feMergeNode in="coloredBlur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Wave 1 — left */}
      <path
        d="M 4 12 Q 6 8 8 12 Q 10 16 12 12"
        stroke={color}
        strokeWidth="1.2"
        opacity="0.7"
        fill="none"
        filter="url(#glow-schedule)"
      />

      {/* Wave 2 — center */}
      <path
        d="M 10 12 Q 12 8 14 12 Q 16 16 18 12"
        stroke={color}
        strokeWidth="1.2"
        opacity="0.8"
        fill="none"
        filter="url(#glow-schedule)"
      />

      {/* Wave 3 — right */}
      <path d="M 16 12 Q 18 8 20 12" stroke={color} strokeWidth="1.2" opacity="0.6" fill="none" />

      {/* Temporal markers — dots on timeline */}
      <circle cx="4" cy="12" r="0.6" fill={color} opacity="0.5" />
      <circle cx="12" cy="12" r="0.7" fill={color} opacity="0.9" filter="url(#glow-schedule)" />
      <circle cx="20" cy="12" r="0.6" fill={color} opacity="0.5" />

      {/* Timeline baseline */}
      <line
        x1="4"
        y1="13"
        x2="20"
        y2="13"
        stroke={color}
        strokeWidth="0.5"
        opacity="0.3"
        strokeDasharray="1,2"
      />

      {animated && (
        <style>{`
          @keyframes pulse-wave {
            0%, 100% { opacity: 0.6; }
            50% { opacity: 1; }
          }
          path {
            animation: pulse-wave 2s ease-in-out infinite;
          }
        `}</style>
      )}
    </svg>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// WORKERS — Single glowing agent presence node
// ─────────────────────────────────────────────────────────────────────────────

export const WorkersIcon: React.FC<IconProps> = ({
  size = 24,
  darkMode = true,
  animated = false,
}) => {
  const mode = darkMode ? "dark" : "light";
  const color = getColor(mode, "primary");
  const accentColor = getColor(mode, "accent");

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <filter id="glow-worker" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="1.2" result="coloredBlur" />
          <feMerge>
            <feMergeNode in="coloredBlur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Outer glow ring */}
      <circle cx="12" cy="12" r="8" stroke={color} strokeWidth="0.7" opacity="0.2" />

      {/* Middle awareness ring */}
      <circle cx="12" cy="12" r="5" stroke={color} strokeWidth="0.8" opacity="0.4" />

      {/* Inner agent node — central presence */}
      <circle cx="12" cy="12" r="2.5" fill={accentColor} opacity="0.9" filter="url(#glow-worker)" />

      {/* Activity indicators (orbital arcs) */}
      <path
        d="M 12 6.5 A 5.5 5.5 0 0 1 16 9"
        stroke={color}
        strokeWidth="0.8"
        opacity="0.6"
        fill="none"
        strokeLinecap="round"
      />

      <path
        d="M 16 15 A 5.5 5.5 0 0 1 12 17.5"
        stroke={color}
        strokeWidth="0.8"
        opacity="0.5"
        fill="none"
        strokeLinecap="round"
      />

      {/* Connection tendril */}
      <line
        x1="14.5"
        y1="12"
        x2="20"
        y2="12"
        stroke={color}
        strokeWidth="0.6"
        opacity="0.4"
        strokeDasharray="1.5,1"
      />

      {animated && (
        <style>{`
          @keyframes pulse-agent {
            0%, 100% { r: 2.5; }
            50% { r: 3; }
          }
          circle:nth-of-type(3) {
            animation: pulse-agent 3s ease-in-out infinite;
          }
        `}</style>
      )}
    </svg>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// UTILITY ICONS
// ─────────────────────────────────────────────────────────────────────────────

// HOME — Orbital beacon / home base with glowing nucleus (not a generic house)
export const HomeIcon: React.FC<IconProps> = ({ size = 24, darkMode = true }) => {
  const mode = darkMode ? "dark" : "light";
  const color = getColor(mode, "primary");

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <filter id="glow-home" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="0.8" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      {/* Roof — angular but flowing */}
      <path
        d="M12 3 L21 11 L19 11 L19 20 L5 20 L5 11 L3 11 Z"
        stroke={color}
        strokeWidth="1.2"
        fill="none"
        strokeLinejoin="round"
      />
      {/* Inner glow — the warmth of home, a nucleus */}
      <circle cx="12" cy="14" r="2.5" fill={color} opacity="0.15" />
      <circle cx="12" cy="14" r="1.2" fill={color} opacity="0.7" filter="url(#glow-home)" />
      {/* Awareness arc above roof — orbital beacon */}
      <path
        d="M8 4 A6 6 0 0 1 16 4"
        stroke={color}
        strokeWidth="0.6"
        opacity="0.25"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  );
};

// OPERATIONS — Orbital gear with concentric rings and flowing spokes
export const OperationsIcon: React.FC<IconProps> = ({
  size = 24,
  darkMode = true,
  animated = false,
}) => {
  const mode = darkMode ? "dark" : "light";
  const color = getColor(mode, "primary");

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <filter id="glow-ops" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="0.7" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      {/* Outer gear ring */}
      <circle cx="12" cy="12" r="9.5" stroke={color} strokeWidth="0.7" opacity="0.3" />
      {/* Middle gear ring */}
      <circle cx="12" cy="12" r="6.5" stroke={color} strokeWidth="1" opacity="0.6" />
      {/* Core — glowing center */}
      <circle cx="12" cy="12" r="2.5" fill={color} opacity="0.2" />
      <circle cx="12" cy="12" r="1.3" fill={color} filter="url(#glow-ops)" />
      {/* 6 gear teeth — orbital points on outer ring */}
      <circle cx="12" cy="2" r="1" fill={color} opacity="0.7" />
      <circle cx="20.5" cy="7" r="1" fill={color} opacity="0.7" />
      <circle cx="20.5" cy="17" r="1" fill={color} opacity="0.7" />
      <circle cx="12" cy="22" r="1" fill={color} opacity="0.7" />
      <circle cx="3.5" cy="17" r="1" fill={color} opacity="0.7" />
      <circle cx="3.5" cy="7" r="1" fill={color} opacity="0.7" />
      {/* Spokes — dashed connections from core to teeth */}
      <line
        x1="12"
        y1="3.5"
        x2="12"
        y2="9"
        stroke={color}
        strokeWidth="0.5"
        opacity="0.3"
        strokeDasharray="1.5,1"
      />
      <line
        x1="19"
        y1="8"
        x2="14"
        y2="10.5"
        stroke={color}
        strokeWidth="0.5"
        opacity="0.3"
        strokeDasharray="1.5,1"
      />
      <line
        x1="19"
        y1="16"
        x2="14"
        y2="13.5"
        stroke={color}
        strokeWidth="0.5"
        opacity="0.3"
        strokeDasharray="1.5,1"
      />
      <line
        x1="12"
        y1="20.5"
        x2="12"
        y2="15"
        stroke={color}
        strokeWidth="0.5"
        opacity="0.3"
        strokeDasharray="1.5,1"
      />
      <line
        x1="5"
        y1="16"
        x2="10"
        y2="13.5"
        stroke={color}
        strokeWidth="0.5"
        opacity="0.3"
        strokeDasharray="1.5,1"
      />
      <line
        x1="5"
        y1="8"
        x2="10"
        y2="10.5"
        stroke={color}
        strokeWidth="0.5"
        opacity="0.3"
        strokeDasharray="1.5,1"
      />
      {animated && (
        <style>{`
          @keyframes ops-rotate {
            from { transform: rotate(0deg); transform-origin: 12px 12px; }
            to { transform: rotate(360deg); transform-origin: 12px 12px; }
          }
        `}</style>
      )}
    </svg>
  );
};

export const SettingsIcon: React.FC<IconProps> = ({
  size = 24,
  darkMode = true,
  animated = false,
}) => {
  const mode = darkMode ? "dark" : "light";
  const color = getColor(mode, "primary");

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <filter id="glow-settings" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="0.6" result="coloredBlur" />
          <feMerge>
            <feMergeNode in="coloredBlur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Center gear */}
      <circle cx="12" cy="12" r="2" fill={color} filter="url(#glow-settings)" />

      {/* Outer gear teeth — 6 points */}
      <circle cx="12" cy="5" r="0.7" fill={color} opacity="0.7" />
      <circle cx="17" cy="7.5" r="0.7" fill={color} opacity="0.7" />
      <circle cx="17" cy="16.5" r="0.7" fill={color} opacity="0.7" />
      <circle cx="12" cy="19" r="0.7" fill={color} opacity="0.7" />
      <circle cx="7" cy="16.5" r="0.7" fill={color} opacity="0.7" />
      <circle cx="7" cy="7.5" r="0.7" fill={color} opacity="0.7" />

      {/* Connecting spokes */}
      <line x1="12" y1="7" x2="12" y2="10" stroke={color} strokeWidth="0.5" opacity="0.4" />
      <line x1="15" y1="9" x2="13.5" y2="10.5" stroke={color} strokeWidth="0.5" opacity="0.4" />
      <line x1="15" y1="15" x2="13.5" y2="13.5" stroke={color} strokeWidth="0.5" opacity="0.4" />
      <line x1="12" y1="17" x2="12" y2="14" stroke={color} strokeWidth="0.5" opacity="0.4" />
      <line x1="9" y1="15" x2="10.5" y2="13.5" stroke={color} strokeWidth="0.5" opacity="0.4" />
      <line x1="9" y1="9" x2="10.5" y2="10.5" stroke={color} strokeWidth="0.5" opacity="0.4" />

      {animated && (
        <style>{`
          @keyframes spin-gear {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }
          svg {
            animation: spin-gear 4s linear infinite;
            transform-origin: 50% 50%;
          }
        `}</style>
      )}
    </svg>
  );
};

export const AddIcon: React.FC<IconProps> = ({ size = 24, darkMode = true }) => {
  const mode = darkMode ? "dark" : "light";
  const color = getColor(mode, "secondary");

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Outer ring */}
      <circle cx="12" cy="12" r="9" stroke={color} strokeWidth="1" opacity="0.6" />

      {/* Vertical line */}
      <line x1="12" y1="7" x2="12" y2="17" stroke={color} strokeWidth="1.2" />

      {/* Horizontal line */}
      <line x1="7" y1="12" x2="17" y2="12" stroke={color} strokeWidth="1.2" />
    </svg>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// CHAT PANEL ICONS — Mic, Speaker, Deep Think, Research, Canvas, etc.
// ─────────────────────────────────────────────────────────────────────────────

// MIC ON — Concentric sound rings emanating from a core
export const MicOnIcon: React.FC<IconProps> = ({ size = 24, darkMode = true }) => {
  const mode = darkMode ? "dark" : "light";
  const color = getColor(mode, "secondary");

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <filter id="glow-mic" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="0.6" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      {/* Mic body */}
      <rect
        x="10"
        y="3"
        width="4"
        height="10"
        rx="2"
        stroke={color}
        strokeWidth="1.2"
        fill="none"
        filter="url(#glow-mic)"
      />
      {/* Stand arc */}
      <path d="M7 12 A5 5 0 0 0 17 12" stroke={color} strokeWidth="1" fill="none" opacity="0.7" />
      {/* Stand stem */}
      <line x1="12" y1="17" x2="12" y2="20" stroke={color} strokeWidth="1" opacity="0.6" />
      {/* Base */}
      <line x1="9" y1="20" x2="15" y2="20" stroke={color} strokeWidth="1" opacity="0.5" />
      {/* Sound waves */}
      <path d="M18 8 A7 7 0 0 1 18 16" stroke={color} strokeWidth="0.7" opacity="0.4" fill="none" />
      <path
        d="M20 6 A10 10 0 0 1 20 18"
        stroke={color}
        strokeWidth="0.5"
        opacity="0.25"
        fill="none"
      />
    </svg>
  );
};

// MIC OFF — Same shape, slashed with a diagonal cut
export const MicOffIcon: React.FC<IconProps> = ({ size = 24, darkMode = true }) => {
  const mode = darkMode ? "dark" : "light";
  const color = getColor(mode, "muted");

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Mic body — dimmed */}
      <rect
        x="10"
        y="3"
        width="4"
        height="10"
        rx="2"
        stroke={color}
        strokeWidth="1.2"
        fill="none"
        opacity="0.5"
      />
      {/* Stand arc */}
      <path d="M7 12 A5 5 0 0 0 17 12" stroke={color} strokeWidth="1" fill="none" opacity="0.35" />
      {/* Stand stem */}
      <line x1="12" y1="17" x2="12" y2="20" stroke={color} strokeWidth="1" opacity="0.3" />
      {/* Base */}
      <line x1="9" y1="20" x2="15" y2="20" stroke={color} strokeWidth="1" opacity="0.3" />
      {/* Slash */}
      <line x1="4" y1="4" x2="20" y2="20" stroke="#ff3d57" strokeWidth="1.5" opacity="0.8" />
    </svg>
  );
};

// SPEAKER ON — Sound waves radiating from a speaker cone
export const SpeakerOnIcon: React.FC<IconProps> = ({ size = 24, darkMode = true }) => {
  const mode = darkMode ? "dark" : "light";
  const color = getColor(mode, "primary");

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <filter id="glow-spk" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="0.7" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      {/* Speaker cone */}
      <path
        d="M4 9 L8 9 L13 5 L13 19 L8 15 L4 15 Z"
        stroke={color}
        strokeWidth="1.2"
        fill="none"
        filter="url(#glow-spk)"
        strokeLinejoin="round"
      />
      {/* Sound wave 1 */}
      <path
        d="M16 9 A4 4 0 0 1 16 15"
        stroke={color}
        strokeWidth="1"
        opacity="0.7"
        fill="none"
        strokeLinecap="round"
      />
      {/* Sound wave 2 */}
      <path
        d="M18 7 A6.5 6.5 0 0 1 18 17"
        stroke={color}
        strokeWidth="0.8"
        opacity="0.5"
        fill="none"
        strokeLinecap="round"
      />
      {/* Sound wave 3 */}
      <path
        d="M20 5 A9 9 0 0 1 20 19"
        stroke={color}
        strokeWidth="0.6"
        opacity="0.3"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  );
};

// SPEAKER OFF — Muted speaker, slashed
export const SpeakerOffIcon: React.FC<IconProps> = ({ size = 24, darkMode = true }) => {
  const mode = darkMode ? "dark" : "light";
  const color = getColor(mode, "muted");

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Speaker cone — dimmed */}
      <path
        d="M4 9 L8 9 L13 5 L13 19 L8 15 L4 15 Z"
        stroke={color}
        strokeWidth="1.2"
        fill="none"
        opacity="0.4"
        strokeLinejoin="round"
      />
      {/* X mark where waves would be */}
      <line
        x1="16"
        y1="9"
        x2="21"
        y2="15"
        stroke="#ff3d57"
        strokeWidth="1.2"
        opacity="0.7"
        strokeLinecap="round"
      />
      <line
        x1="21"
        y1="9"
        x2="16"
        y2="15"
        stroke="#ff3d57"
        strokeWidth="1.2"
        opacity="0.7"
        strokeLinecap="round"
      />
    </svg>
  );
};

// DEEP THINK — Radiating idea nucleus (replaces generic sun/lightbulb emoji)
export const DeepThinkIcon: React.FC<IconProps> = ({
  size = 24,
  darkMode = true,
  animated = false,
}) => {
  const _mode = darkMode ? "dark" : "light";
  const color = "#ffab00"; // warm gold always — this is the thinking warmth

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <filter id="glow-think" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="1" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      {/* Central nucleus */}
      <circle cx="12" cy="12" r="3" fill={color} opacity="0.9" filter="url(#glow-think)" />
      {/* Inner awareness ring */}
      <circle cx="12" cy="12" r="5.5" stroke={color} strokeWidth="0.7" opacity="0.4" />
      {/* Radiating rays — 6 spokes */}
      <line
        x1="12"
        y1="2"
        x2="12"
        y2="5"
        stroke={color}
        strokeWidth="0.8"
        opacity="0.6"
        strokeLinecap="round"
      />
      <line
        x1="12"
        y1="19"
        x2="12"
        y2="22"
        stroke={color}
        strokeWidth="0.8"
        opacity="0.6"
        strokeLinecap="round"
      />
      <line
        x1="3"
        y1="12"
        x2="6"
        y2="12"
        stroke={color}
        strokeWidth="0.8"
        opacity="0.6"
        strokeLinecap="round"
      />
      <line
        x1="18"
        y1="12"
        x2="21"
        y2="12"
        stroke={color}
        strokeWidth="0.8"
        opacity="0.6"
        strokeLinecap="round"
      />
      {/* Diagonal rays */}
      <line
        x1="5.5"
        y1="5.5"
        x2="7.5"
        y2="7.5"
        stroke={color}
        strokeWidth="0.7"
        opacity="0.4"
        strokeLinecap="round"
      />
      <line
        x1="16.5"
        y1="16.5"
        x2="18.5"
        y2="18.5"
        stroke={color}
        strokeWidth="0.7"
        opacity="0.4"
        strokeLinecap="round"
      />
      <line
        x1="18.5"
        y1="5.5"
        x2="16.5"
        y2="7.5"
        stroke={color}
        strokeWidth="0.7"
        opacity="0.4"
        strokeLinecap="round"
      />
      <line
        x1="7.5"
        y1="16.5"
        x2="5.5"
        y2="18.5"
        stroke={color}
        strokeWidth="0.7"
        opacity="0.4"
        strokeLinecap="round"
      />
      {animated && (
        <style>{`
          @keyframes think-pulse {
            0%, 100% { opacity: 0.9; }
            50% { opacity: 0.5; }
          }
          circle:first-of-type {
            animation: think-pulse 2s ease-in-out infinite;
          }
        `}</style>
      )}
    </svg>
  );
};

// DEEP THINK OFF — Same shape, dimmed
export const DeepThinkOffIcon: React.FC<IconProps> = ({ size = 24, darkMode = true }) => {
  const mode = darkMode ? "dark" : "light";
  const color = getColor(mode, "muted");

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="12" cy="12" r="3" fill={color} opacity="0.4" />
      <circle cx="12" cy="12" r="5.5" stroke={color} strokeWidth="0.7" opacity="0.2" />
      <line
        x1="12"
        y1="2"
        x2="12"
        y2="5"
        stroke={color}
        strokeWidth="0.8"
        opacity="0.25"
        strokeLinecap="round"
      />
      <line
        x1="12"
        y1="19"
        x2="12"
        y2="22"
        stroke={color}
        strokeWidth="0.8"
        opacity="0.25"
        strokeLinecap="round"
      />
      <line
        x1="3"
        y1="12"
        x2="6"
        y2="12"
        stroke={color}
        strokeWidth="0.8"
        opacity="0.25"
        strokeLinecap="round"
      />
      <line
        x1="18"
        y1="12"
        x2="21"
        y2="12"
        stroke={color}
        strokeWidth="0.8"
        opacity="0.25"
        strokeLinecap="round"
      />
      <line
        x1="5.5"
        y1="5.5"
        x2="7.5"
        y2="7.5"
        stroke={color}
        strokeWidth="0.7"
        opacity="0.15"
        strokeLinecap="round"
      />
      <line
        x1="16.5"
        y1="16.5"
        x2="18.5"
        y2="18.5"
        stroke={color}
        strokeWidth="0.7"
        opacity="0.15"
        strokeLinecap="round"
      />
      <line
        x1="18.5"
        y1="5.5"
        x2="16.5"
        y2="7.5"
        stroke={color}
        strokeWidth="0.7"
        opacity="0.15"
        strokeLinecap="round"
      />
      <line
        x1="7.5"
        y1="16.5"
        x2="5.5"
        y2="18.5"
        stroke={color}
        strokeWidth="0.7"
        opacity="0.15"
        strokeLinecap="round"
      />
    </svg>
  );
};

// RESEARCH — Orbital search with scanning arc (replaces magnifying glass emoji)
export const ResearchIcon: React.FC<IconProps> = ({
  size = 24,
  darkMode = true,
  animated = false,
}) => {
  const mode = darkMode ? "dark" : "light";
  const color = getColor(mode, "primary");

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <filter id="glow-research" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="0.6" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      {/* Lens ring */}
      <circle
        cx="11"
        cy="10"
        r="6"
        stroke={color}
        strokeWidth="1.2"
        fill="none"
        filter="url(#glow-research)"
      />
      {/* Inner scan ring */}
      <circle cx="11" cy="10" r="3" stroke={color} strokeWidth="0.7" opacity="0.4" fill="none" />
      {/* Core dot */}
      <circle cx="11" cy="10" r="1" fill={color} opacity="0.7" />
      {/* Handle — angled to feel more fluid */}
      <line
        x1="15.5"
        y1="14.5"
        x2="20"
        y2="19"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        opacity="0.8"
      />
      {/* Scanning arc inside lens */}
      <path d="M8 7 A4 4 0 0 1 14 7" stroke={color} strokeWidth="0.6" opacity="0.3" fill="none" />
      {animated && (
        <style>{`
          @keyframes scan-rotate {
            from { transform: rotate(0deg); transform-origin: 11px 10px; }
            to { transform: rotate(360deg); transform-origin: 11px 10px; }
          }
          path:last-of-type {
            animation: scan-rotate 4s linear infinite;
          }
        `}</style>
      )}
    </svg>
  );
};

// RESEARCH ACTIVE — Bright cyan with stronger glow
export const ResearchActiveIcon: React.FC<IconProps> = ({
  size = 24,
  darkMode: _darkMode = true,
}) => {
  const color = "#00ccff";

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <filter id="glow-research-on" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="1.2" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <circle
        cx="11"
        cy="10"
        r="6"
        stroke={color}
        strokeWidth="1.4"
        fill="none"
        filter="url(#glow-research-on)"
      />
      <circle cx="11" cy="10" r="3" stroke={color} strokeWidth="0.8" opacity="0.5" fill="none" />
      <circle cx="11" cy="10" r="1.2" fill={color} opacity="0.9" filter="url(#glow-research-on)" />
      <line
        x1="15.5"
        y1="14.5"
        x2="20"
        y2="19"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path d="M8 7 A4 4 0 0 1 14 7" stroke={color} strokeWidth="0.8" opacity="0.5" fill="none" />
    </svg>
  );
};

// CANVAS — Layered planes suggesting depth and workspace (replaces clipboard)
export const CanvasIcon: React.FC<IconProps> = ({ size = 24, darkMode = true }) => {
  const mode = darkMode ? "dark" : "light";
  const color = getColor(mode, "primary");

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <filter id="glow-canvas" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="0.5" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      {/* Back plane */}
      <rect
        x="6"
        y="3"
        width="14"
        height="14"
        rx="1.5"
        stroke={color}
        strokeWidth="0.7"
        opacity="0.25"
        transform="rotate(3, 13, 10)"
      />
      {/* Middle plane */}
      <rect
        x="4"
        y="5"
        width="14"
        height="14"
        rx="1.5"
        stroke={color}
        strokeWidth="0.9"
        opacity="0.5"
      />
      {/* Front plane — glowing */}
      <rect
        x="2"
        y="7"
        width="14"
        height="14"
        rx="1.5"
        stroke={color}
        strokeWidth="1.2"
        opacity="0.9"
        filter="url(#glow-canvas)"
      />
      {/* Content line indicators */}
      <line x1="5" y1="11" x2="12" y2="11" stroke={color} strokeWidth="0.6" opacity="0.4" />
      <line x1="5" y1="14" x2="10" y2="14" stroke={color} strokeWidth="0.6" opacity="0.3" />
      <line x1="5" y1="17" x2="8" y2="17" stroke={color} strokeWidth="0.6" opacity="0.2" />
    </svg>
  );
};

// EYE — Seeing/awareness (replaces generic eye icon)
export const EyeOpenIcon: React.FC<IconProps> = ({ size = 24, darkMode = true }) => {
  const mode = darkMode ? "dark" : "light";
  const color = getColor(mode, "primary");

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <filter id="glow-eye" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="0.6" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      {/* Eye shape */}
      <path
        d="M2 12 C5 7 9 5 12 5 C15 5 19 7 22 12 C19 17 15 19 12 19 C9 19 5 17 2 12 Z"
        stroke={color}
        strokeWidth="1.2"
        fill="none"
      />
      {/* Iris ring */}
      <circle cx="12" cy="12" r="3.5" stroke={color} strokeWidth="1" opacity="0.7" fill="none" />
      {/* Pupil — glowing */}
      <circle cx="12" cy="12" r="1.5" fill={color} filter="url(#glow-eye)" />
    </svg>
  );
};

// EYE OFF — Awareness disabled
export const EyeClosedIcon: React.FC<IconProps> = ({ size = 24, darkMode = true }) => {
  const mode = darkMode ? "dark" : "light";
  const color = getColor(mode, "muted");

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Eye shape — dimmed */}
      <path
        d="M2 12 C5 7 9 5 12 5 C15 5 19 7 22 12 C19 17 15 19 12 19 C9 19 5 17 2 12 Z"
        stroke={color}
        strokeWidth="1"
        fill="none"
        opacity="0.35"
      />
      {/* Iris */}
      <circle cx="12" cy="12" r="3.5" stroke={color} strokeWidth="0.8" opacity="0.25" fill="none" />
      {/* Slash */}
      <line x1="4" y1="4" x2="20" y2="20" stroke="#ff3d57" strokeWidth="1.5" opacity="0.7" />
    </svg>
  );
};

// SEND — Directional energy burst (replaces paper plane)
export const SendIcon: React.FC<IconProps> = ({ size = 24, darkMode = true }) => {
  const mode = darkMode ? "dark" : "light";
  const color = getColor(mode, "primary");

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <filter id="glow-send" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="0.7" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      {/* Arrow body */}
      <path
        d="M4 12 L20 12"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        filter="url(#glow-send)"
      />
      {/* Arrow head */}
      <path
        d="M15 7 L20 12 L15 17"
        stroke={color}
        strokeWidth="1.5"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Trailing energy dots */}
      <circle cx="3" cy="12" r="0.6" fill={color} opacity="0.3" />
      <circle cx="6" cy="12" r="0.5" fill={color} opacity="0.5" />
    </svg>
  );
};

// ATTACH — Orbital clip (replaces paperclip)
export const AttachIcon: React.FC<IconProps> = ({ size = 24, darkMode = true }) => {
  const mode = darkMode ? "dark" : "light";
  const color = getColor(mode, "primary");

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Clip shape — flowing curve */}
      <path
        d="M12 3 C8 3 5 6 5 10 L5 16 C5 19 7 21 10 21 C13 21 15 19 15 16 L15 8 C15 6 13.5 4.5 12 4.5 C10.5 4.5 9 6 9 8 L9 15"
        stroke={color}
        strokeWidth="1.2"
        fill="none"
        strokeLinecap="round"
      />
      {/* Small glow dot at attachment point */}
      <circle cx="9" cy="15" r="0.7" fill={color} opacity="0.5" />
    </svg>
  );
};

// CLOSE / X — Clean intersecting lines
export const CloseIcon: React.FC<IconProps> = ({ size = 24, darkMode = true }) => {
  const mode = darkMode ? "dark" : "light";
  const color = getColor(mode, "primary");

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <line x1="6" y1="6" x2="18" y2="18" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      <line x1="18" y1="6" x2="6" y2="18" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
};

// MENU / HAMBURGER — Three flowing lines
export const MenuIcon: React.FC<IconProps> = ({ size = 24, darkMode = true }) => {
  const mode = darkMode ? "dark" : "light";
  const color = getColor(mode, "primary");

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <line x1="4" y1="7" x2="20" y2="7" stroke={color} strokeWidth="1.2" strokeLinecap="round" />
      <line x1="4" y1="12" x2="20" y2="12" stroke={color} strokeWidth="1.2" strokeLinecap="round" />
      <line
        x1="4"
        y1="17"
        x2="16"
        y2="17"
        stroke={color}
        strokeWidth="1.2"
        strokeLinecap="round"
        opacity="0.7"
      />
    </svg>
  );
};

// MAXIMIZE — Expand outward
export const MaximizeIcon: React.FC<IconProps> = ({ size = 24, darkMode = true }) => {
  const mode = darkMode ? "dark" : "light";
  const color = getColor(mode, "primary");

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Top-left corner */}
      <path
        d="M4 9 L4 4 L9 4"
        stroke={color}
        strokeWidth="1.2"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Top-right corner */}
      <path
        d="M15 4 L20 4 L20 9"
        stroke={color}
        strokeWidth="1.2"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Bottom-left corner */}
      <path
        d="M4 15 L4 20 L9 20"
        stroke={color}
        strokeWidth="1.2"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Bottom-right corner */}
      <path
        d="M15 20 L20 20 L20 15"
        stroke={color}
        strokeWidth="1.2"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
};

// MINIMIZE — Contract inward
export const MinimizeIcon: React.FC<IconProps> = ({ size = 24, darkMode = true }) => {
  const mode = darkMode ? "dark" : "light";
  const color = getColor(mode, "primary");

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Top-left inward */}
      <path
        d="M9 4 L9 9 L4 9"
        stroke={color}
        strokeWidth="1.2"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Top-right inward */}
      <path
        d="M20 9 L15 9 L15 4"
        stroke={color}
        strokeWidth="1.2"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Bottom-left inward */}
      <path
        d="M9 20 L9 15 L4 15"
        stroke={color}
        strokeWidth="1.2"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Bottom-right inward */}
      <path
        d="M20 15 L15 15 L15 20"
        stroke={color}
        strokeWidth="1.2"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
};

// COPY — Layered pages
export const CopyIcon: React.FC<IconProps> = ({ size = 24, darkMode = true }) => {
  const mode = darkMode ? "dark" : "light";
  const color = getColor(mode, "primary");

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Back page */}
      <rect
        x="8"
        y="3"
        width="12"
        height="14"
        rx="1.5"
        stroke={color}
        strokeWidth="1"
        opacity="0.4"
      />
      {/* Front page */}
      <rect
        x="4"
        y="7"
        width="12"
        height="14"
        rx="1.5"
        stroke={color}
        strokeWidth="1.2"
        opacity="0.9"
      />
      {/* Content lines */}
      <line x1="7" y1="12" x2="13" y2="12" stroke={color} strokeWidth="0.6" opacity="0.4" />
      <line x1="7" y1="15" x2="11" y2="15" stroke={color} strokeWidth="0.6" opacity="0.3" />
    </svg>
  );
};

// CHECK — Confirmation arc
export const CheckIcon: React.FC<IconProps> = ({ size = 24, darkMode: _darkMode = true }) => {
  const color = "#00ffcc"; // always teal/green for success

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <filter id="glow-check" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="0.7" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <path
        d="M5 13 L9 17 L19 7"
        stroke={color}
        strokeWidth="2"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        filter="url(#glow-check)"
      />
    </svg>
  );
};

// DOWNLOAD — Downward energy flow
export const DownloadIcon: React.FC<IconProps> = ({ size = 24, darkMode = true }) => {
  const mode = darkMode ? "dark" : "light";
  const color = getColor(mode, "primary");

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Arrow shaft */}
      <line x1="12" y1="4" x2="12" y2="16" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      {/* Arrow head */}
      <path
        d="M7 12 L12 17 L17 12"
        stroke={color}
        strokeWidth="1.5"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Base line */}
      <line
        x1="5"
        y1="20"
        x2="19"
        y2="20"
        stroke={color}
        strokeWidth="1"
        opacity="0.5"
        strokeLinecap="round"
      />
    </svg>
  );
};

// FILE — Document with content suggestion
export const FileIcon: React.FC<IconProps> = ({ size = 24, darkMode = true }) => {
  const mode = darkMode ? "dark" : "light";
  const color = getColor(mode, "primary");

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Page body with folded corner */}
      <path
        d="M6 3 L15 3 L19 7 L19 21 L6 21 Z"
        stroke={color}
        strokeWidth="1.2"
        fill="none"
        strokeLinejoin="round"
      />
      {/* Fold */}
      <path d="M15 3 L15 7 L19 7" stroke={color} strokeWidth="0.8" opacity="0.5" fill="none" />
      {/* Content lines */}
      <line x1="9" y1="11" x2="16" y2="11" stroke={color} strokeWidth="0.6" opacity="0.4" />
      <line x1="9" y1="14" x2="14" y2="14" stroke={color} strokeWidth="0.6" opacity="0.3" />
      <line x1="9" y1="17" x2="12" y2="17" stroke={color} strokeWidth="0.6" opacity="0.2" />
    </svg>
  );
};

// PANEL COLLAPSE — Side panel toggle
export const PanelCollapseIcon: React.FC<IconProps> = ({ size = 24, darkMode = true }) => {
  const mode = darkMode ? "dark" : "light";
  const color = getColor(mode, "primary");

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Panel frame */}
      <rect
        x="3"
        y="4"
        width="18"
        height="16"
        rx="1.5"
        stroke={color}
        strokeWidth="1.2"
        fill="none"
      />
      {/* Divider */}
      <line x1="15" y1="4" x2="15" y2="20" stroke={color} strokeWidth="0.8" opacity="0.5" />
      {/* Arrow pointing right (collapse) */}
      <path
        d="M10 9 L13 12 L10 15"
        stroke={color}
        strokeWidth="1.2"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
};

// TERMINAL — Command prompt with cursor
export const TerminalIcon: React.FC<IconProps> = ({ size = 24, darkMode = true }) => {
  const mode = darkMode ? "dark" : "light";
  const color = getColor(mode, "secondary");

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Terminal frame */}
      <rect
        x="3"
        y="4"
        width="18"
        height="16"
        rx="2"
        stroke={color}
        strokeWidth="1.2"
        fill="none"
      />
      {/* Prompt arrow */}
      <path
        d="M7 10 L10 13 L7 16"
        stroke={color}
        strokeWidth="1.3"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Cursor line */}
      <line
        x1="13"
        y1="16"
        x2="17"
        y2="16"
        stroke={color}
        strokeWidth="1.2"
        opacity="0.6"
        strokeLinecap="round"
      />
    </svg>
  );
};

// DATABASE — Stacked orbital discs
export const DatabaseIcon: React.FC<IconProps> = ({ size = 24, darkMode = true }) => {
  const mode = darkMode ? "dark" : "light";
  const color = getColor(mode, "primary");

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Top disc */}
      <ellipse cx="12" cy="6" rx="8" ry="3" stroke={color} strokeWidth="1.2" fill="none" />
      {/* Middle disc outline */}
      <path
        d="M4 6 L4 12 C4 13.7 7.6 15 12 15 C16.4 15 20 13.7 20 12 L20 6"
        stroke={color}
        strokeWidth="1"
        opacity="0.5"
        fill="none"
      />
      {/* Bottom disc outline */}
      <path
        d="M4 12 L4 18 C4 19.7 7.6 21 12 21 C16.4 21 20 19.7 20 18 L20 12"
        stroke={color}
        strokeWidth="1"
        opacity="0.3"
        fill="none"
      />
    </svg>
  );
};

// FOLDER — Open folder
export const FolderIcon: React.FC<IconProps> = ({ size = 24, darkMode = true }) => {
  const mode = darkMode ? "dark" : "light";
  const color = getColor(mode, "accent");

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Folder body */}
      <path
        d="M3 7 L3 19 L21 19 L21 9 L12 9 L10 7 Z"
        stroke={color}
        strokeWidth="1.2"
        fill="none"
        strokeLinejoin="round"
      />
      {/* Tab */}
      <path d="M3 7 L10 7 L12 9" stroke={color} strokeWidth="1" opacity="0.6" fill="none" />
    </svg>
  );
};

// CHEVRON DOWN
export const ChevronDownIcon: React.FC<IconProps> = ({ size = 24, darkMode = true }) => {
  const mode = darkMode ? "dark" : "light";
  const color = getColor(mode, "primary");

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M6 9 L12 15 L18 9"
        stroke={color}
        strokeWidth="1.5"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
};

// CHEVRON RIGHT
export const ChevronRightIcon: React.FC<IconProps> = ({ size = 24, darkMode = true }) => {
  const mode = darkMode ? "dark" : "light";
  const color = getColor(mode, "primary");

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M9 6 L15 12 L9 18"
        stroke={color}
        strokeWidth="1.5"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
};

// PLAY — Triangular energy
export const PlayIcon: React.FC<IconProps> = ({ size = 24, darkMode = true }) => {
  const mode = darkMode ? "dark" : "light";
  const color = getColor(mode, "secondary");

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <filter id="glow-play" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="0.6" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <path
        d="M7 4 L20 12 L7 20 Z"
        stroke={color}
        strokeWidth="1.2"
        fill="none"
        filter="url(#glow-play)"
        strokeLinejoin="round"
      />
    </svg>
  );
};

// PAUSE — Parallel bars
export const PauseIcon: React.FC<IconProps> = ({ size = 24, darkMode = true }) => {
  const mode = darkMode ? "dark" : "light";
  const color = getColor(mode, "primary");

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <line x1="8" y1="5" x2="8" y2="19" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <line x1="16" y1="5" x2="16" y2="19" stroke={color} strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
};

// STOP — Solid square
export const StopIcon: React.FC<IconProps> = ({ size = 24, darkMode: _darkMode = true }) => {
  const color = "#ff3d57"; // always red for stop

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect
        x="6"
        y="6"
        width="12"
        height="12"
        rx="1.5"
        stroke={color}
        strokeWidth="1.5"
        fill="none"
      />
    </svg>
  );
};

// ROTATE/REFRESH — Circular flow
export const RefreshIcon: React.FC<IconProps> = ({ size = 24, darkMode = true }) => {
  const mode = darkMode ? "dark" : "light";
  const color = getColor(mode, "primary");

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Arc */}
      <path
        d="M4 12 A8 8 0 0 1 19 9"
        stroke={color}
        strokeWidth="1.2"
        fill="none"
        strokeLinecap="round"
      />
      {/* Arrow on arc */}
      <path
        d="M17 5 L19 9 L15 10"
        stroke={color}
        strokeWidth="1.2"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Bottom arc */}
      <path
        d="M20 12 A8 8 0 0 1 5 15"
        stroke={color}
        strokeWidth="1.2"
        fill="none"
        strokeLinecap="round"
      />
      <path
        d="M7 19 L5 15 L9 14"
        stroke={color}
        strokeWidth="1.2"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
};

// THUMBS UP
export const ThumbsUpIcon: React.FC<IconProps> = ({ size = 24, darkMode = true }) => {
  const mode = darkMode ? "dark" : "light";
  const color = getColor(mode, "secondary");

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M7 11 L7 20 L4 20 L4 11 Z"
        stroke={color}
        strokeWidth="1"
        opacity="0.6"
        fill="none"
      />
      <path
        d="M7 11 L9 4 C9.5 3 11 3 11 5 L11 9 L17 9 C18.5 9 19.5 10 19 12 L17.5 19 C17.2 20 16.5 20 16 20 L7 20"
        stroke={color}
        strokeWidth="1.2"
        fill="none"
        strokeLinejoin="round"
      />
    </svg>
  );
};

// THUMBS DOWN
export const ThumbsDownIcon: React.FC<IconProps> = ({ size = 24, darkMode = true }) => {
  const mode = darkMode ? "dark" : "light";
  const color = getColor(mode, "muted");

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M17 13 L17 4 L20 4 L20 13 Z"
        stroke={color}
        strokeWidth="1"
        opacity="0.6"
        fill="none"
      />
      <path
        d="M17 13 L15 20 C14.5 21 13 21 13 19 L13 15 L7 15 C5.5 15 4.5 14 5 12 L6.5 5 C6.8 4 7.5 4 8 4 L17 4"
        stroke={color}
        strokeWidth="1.2"
        fill="none"
        strokeLinejoin="round"
      />
    </svg>
  );
};

// HELP — Question mark with orbital ring
export const HelpIcon: React.FC<IconProps> = ({ size = 24, darkMode = true }) => {
  const mode = darkMode ? "dark" : "light";
  const color = getColor(mode, "primary");

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="12" cy="12" r="9" stroke={color} strokeWidth="1" opacity="0.5" fill="none" />
      <path
        d="M9 9 C9 7 10.5 6 12 6 C13.5 6 15 7 15 9 C15 11 12 11 12 13"
        stroke={color}
        strokeWidth="1.3"
        fill="none"
        strokeLinecap="round"
      />
      <circle cx="12" cy="17" r="0.8" fill={color} />
    </svg>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// TOP BAR ICONS — Calendar, Mail, Signal, Agents, Zoom, etc.
// ─────────────────────────────────────────────────────────────────────────────

// CALENDAR — Temporal grid with orbital accent
export const CalendarIcon: React.FC<IconProps> = ({ size = 24, darkMode = true }) => {
  const mode = darkMode ? "dark" : "light";
  const color = getColor(mode, "accent");

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Calendar body */}
      <rect
        x="3"
        y="5"
        width="18"
        height="16"
        rx="2"
        stroke={color}
        strokeWidth="1.2"
        fill="none"
      />
      {/* Top binding */}
      <line x1="3" y1="10" x2="21" y2="10" stroke={color} strokeWidth="0.8" opacity="0.5" />
      {/* Hang tabs */}
      <line x1="8" y1="3" x2="8" y2="7" stroke={color} strokeWidth="1.2" strokeLinecap="round" />
      <line x1="16" y1="3" x2="16" y2="7" stroke={color} strokeWidth="1.2" strokeLinecap="round" />
      {/* Date dots — grid of events */}
      <circle cx="8" cy="14" r="0.8" fill={color} opacity="0.7" />
      <circle cx="12" cy="14" r="0.8" fill={color} opacity="0.5" />
      <circle cx="16" cy="14" r="0.8" fill={color} opacity="0.3" />
      <circle cx="8" cy="17.5" r="0.8" fill={color} opacity="0.4" />
      <circle cx="12" cy="17.5" r="0.8" fill={color} opacity="0.6" />
    </svg>
  );
};

// MAIL — Envelope with glow badge potential
export const MailIcon: React.FC<IconProps> = ({ size = 24, darkMode = true }) => {
  const mode = darkMode ? "dark" : "light";
  const color = getColor(mode, "primary");

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <filter id="glow-mail" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="0.5" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      {/* Envelope body */}
      <rect
        x="3"
        y="5"
        width="18"
        height="14"
        rx="2"
        stroke={color}
        strokeWidth="1.2"
        fill="none"
      />
      {/* Flap — V shape */}
      <path
        d="M3 5 L12 13 L21 5"
        stroke={color}
        strokeWidth="1"
        opacity="0.7"
        fill="none"
        strokeLinejoin="round"
      />
      {/* Bottom corners fold */}
      <path d="M3 19 L9 13" stroke={color} strokeWidth="0.6" opacity="0.3" />
      <path d="M21 19 L15 13" stroke={color} strokeWidth="0.6" opacity="0.3" />
    </svg>
  );
};

// MAIL WITH BADGE — Envelope with unread count dot
export const MailBadgeIcon: React.FC<IconProps> = ({ size = 24, darkMode = true }) => {
  const mode = darkMode ? "dark" : "light";
  const color = getColor(mode, "primary");

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Envelope body */}
      <rect
        x="3"
        y="5"
        width="18"
        height="14"
        rx="2"
        stroke={color}
        strokeWidth="1.2"
        fill="none"
      />
      {/* Flap */}
      <path
        d="M3 5 L12 13 L21 5"
        stroke={color}
        strokeWidth="1"
        opacity="0.7"
        fill="none"
        strokeLinejoin="round"
      />
      {/* Badge dot — pink/red notification */}
      <circle cx="19" cy="7" r="3" fill="#ff3d7f" opacity="0.9" />
    </svg>
  );
};

// SIGNAL / CONNECTION — Radiating presence waves (replaces wifi icon)
export const SignalIcon: React.FC<IconProps> = ({ size = 24, darkMode: _darkMode = true }) => {
  const color = "#00ffcc"; // always green for connected

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <filter id="glow-signal" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="0.7" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      {/* Core dot */}
      <circle cx="12" cy="18" r="1.5" fill={color} filter="url(#glow-signal)" />
      {/* Wave 1 — close */}
      <path
        d="M8.5 15 A5 5 0 0 1 15.5 15"
        stroke={color}
        strokeWidth="1.2"
        fill="none"
        strokeLinecap="round"
        opacity="0.8"
      />
      {/* Wave 2 — mid */}
      <path
        d="M5.5 12 A9 9 0 0 1 18.5 12"
        stroke={color}
        strokeWidth="1"
        fill="none"
        strokeLinecap="round"
        opacity="0.5"
      />
      {/* Wave 3 — far */}
      <path
        d="M3 9 A13 13 0 0 1 21 9"
        stroke={color}
        strokeWidth="0.8"
        fill="none"
        strokeLinecap="round"
        opacity="0.3"
      />
    </svg>
  );
};

// SIGNAL DISCONNECTED
export const SignalOffIcon: React.FC<IconProps> = ({ size = 24, darkMode = true }) => {
  const mode = darkMode ? "dark" : "light";
  const color = getColor(mode, "muted");

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="12" cy="18" r="1.5" fill={color} opacity="0.4" />
      <path
        d="M8.5 15 A5 5 0 0 1 15.5 15"
        stroke={color}
        strokeWidth="1"
        fill="none"
        strokeLinecap="round"
        opacity="0.25"
      />
      <path
        d="M5.5 12 A9 9 0 0 1 18.5 12"
        stroke={color}
        strokeWidth="0.8"
        fill="none"
        strokeLinecap="round"
        opacity="0.15"
      />
      <path
        d="M3 9 A13 13 0 0 1 21 9"
        stroke={color}
        strokeWidth="0.7"
        fill="none"
        strokeLinecap="round"
        opacity="0.1"
      />
      {/* Slash */}
      <line x1="4" y1="4" x2="20" y2="20" stroke="#ff3d57" strokeWidth="1.5" opacity="0.7" />
    </svg>
  );
};

// AGENT — Single agent figure (for routing selector)
export const AgentIcon: React.FC<IconProps> = ({ size = 24, darkMode = true }) => {
  const mode = darkMode ? "dark" : "light";
  const color = getColor(mode, "accent");

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <filter id="glow-agent" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="0.6" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      {/* Head */}
      <circle cx="12" cy="7" r="3" stroke={color} strokeWidth="1.2" fill="none" />
      {/* Body arc */}
      <path
        d="M5 20 C5 15 8 12 12 12 C16 12 19 15 19 20"
        stroke={color}
        strokeWidth="1.2"
        fill="none"
        strokeLinecap="round"
      />
      {/* Awareness ring */}
      <circle cx="12" cy="12" r="10" stroke={color} strokeWidth="0.5" opacity="0.15" fill="none" />
    </svg>
  );
};

// AGENTS GROUP — Multiple connected agent figures
export const AgentsGroupIcon: React.FC<IconProps> = ({ size = 24, darkMode = true }) => {
  const mode = darkMode ? "dark" : "light";
  const color = getColor(mode, "primary");
  const accent = getColor(mode, "accent");

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Back agent (left) */}
      <circle cx="7" cy="8" r="2" stroke={color} strokeWidth="0.8" fill="none" opacity="0.5" />
      <path
        d="M3 17 C3 14 5 12 7 12 C9 12 11 14 11 17"
        stroke={color}
        strokeWidth="0.8"
        fill="none"
        opacity="0.5"
        strokeLinecap="round"
      />
      {/* Back agent (right) */}
      <circle cx="17" cy="8" r="2" stroke={color} strokeWidth="0.8" fill="none" opacity="0.5" />
      <path
        d="M13 17 C13 14 15 12 17 12 C19 12 21 14 21 17"
        stroke={color}
        strokeWidth="0.8"
        fill="none"
        opacity="0.5"
        strokeLinecap="round"
      />
      {/* Front agent (center, prominent) */}
      <circle cx="12" cy="7" r="2.5" stroke={accent} strokeWidth="1.2" fill="none" />
      <path
        d="M7 19 C7 15 9 13 12 13 C15 13 17 15 17 19"
        stroke={accent}
        strokeWidth="1.2"
        fill="none"
        strokeLinecap="round"
      />
      {/* Connection dash between agents */}
      <line
        x1="9"
        y1="10"
        x2="7.5"
        y2="10"
        stroke={color}
        strokeWidth="0.5"
        opacity="0.3"
        strokeDasharray="1,1"
      />
      <line
        x1="15"
        y1="10"
        x2="16.5"
        y2="10"
        stroke={color}
        strokeWidth="0.5"
        opacity="0.3"
        strokeDasharray="1,1"
      />
    </svg>
  );
};

// ZOOM IN — Orbital magnifier with plus
export const ZoomInIcon: React.FC<IconProps> = ({ size = 24, darkMode = true }) => {
  const mode = darkMode ? "dark" : "light";
  const color = getColor(mode, "primary");

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Lens */}
      <circle cx="11" cy="11" r="7" stroke={color} strokeWidth="1.2" fill="none" />
      {/* Handle */}
      <line
        x1="16"
        y1="16"
        x2="21"
        y2="21"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      {/* Plus */}
      <line x1="11" y1="8" x2="11" y2="14" stroke={color} strokeWidth="1" strokeLinecap="round" />
      <line x1="8" y1="11" x2="14" y2="11" stroke={color} strokeWidth="1" strokeLinecap="round" />
    </svg>
  );
};

// ZOOM OUT — Orbital magnifier with minus
export const ZoomOutIcon: React.FC<IconProps> = ({ size = 24, darkMode = true }) => {
  const mode = darkMode ? "dark" : "light";
  const color = getColor(mode, "primary");

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="11" cy="11" r="7" stroke={color} strokeWidth="1.2" fill="none" />
      <line
        x1="16"
        y1="16"
        x2="21"
        y2="21"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <line x1="8" y1="11" x2="14" y2="11" stroke={color} strokeWidth="1" strokeLinecap="round" />
    </svg>
  );
};

// SHIELD — Protective orbital ring (Safety Rules)
export const ShieldIcon: React.FC<IconProps> = ({ size = 24, darkMode = true }) => {
  const mode = darkMode ? "dark" : "light";
  const color = getColor(mode, "accent");

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <filter id="glow-shield" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="0.7" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      {/* Shield shape */}
      <path
        d="M12 2 L21 6 L21 12 C21 17 17 21 12 22 C7 21 3 17 3 12 L3 6 Z"
        stroke={color}
        strokeWidth="1.2"
        fill="none"
        filter="url(#glow-shield)"
        strokeLinejoin="round"
      />
      {/* Inner protective ring */}
      <path
        d="M12 6 L17 8.5 L17 12 C17 15 15 17.5 12 18.5 C9 17.5 7 15 7 12 L7 8.5 Z"
        stroke={color}
        strokeWidth="0.7"
        fill="none"
        opacity="0.4"
        strokeLinejoin="round"
      />
      {/* Core dot */}
      <circle cx="12" cy="12" r="1.2" fill={color} opacity="0.7" />
    </svg>
  );
};

// DOCUMENTS — Stacked luminous pages (action bar)
export const DocumentsIcon: React.FC<IconProps> = ({ size = 24, darkMode = true }) => {
  const mode = darkMode ? "dark" : "light";
  const color = getColor(mode, "primary");

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <filter id="glow-docs" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="0.5" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      {/* Back page */}
      <rect
        x="7"
        y="2"
        width="13"
        height="16"
        rx="1.5"
        stroke={color}
        strokeWidth="0.7"
        opacity="0.25"
      />
      {/* Middle page */}
      <rect
        x="5"
        y="4"
        width="13"
        height="16"
        rx="1.5"
        stroke={color}
        strokeWidth="0.9"
        opacity="0.5"
      />
      {/* Front page — glowing */}
      <rect
        x="3"
        y="6"
        width="13"
        height="16"
        rx="1.5"
        stroke={color}
        strokeWidth="1.2"
        filter="url(#glow-docs)"
      />
      {/* Content lines on front page */}
      <line x1="6" y1="11" x2="13" y2="11" stroke={color} strokeWidth="0.6" opacity="0.4" />
      <line x1="6" y1="14" x2="11" y2="14" stroke={color} strokeWidth="0.6" opacity="0.3" />
      <line x1="6" y1="17" x2="9" y2="17" stroke={color} strokeWidth="0.6" opacity="0.2" />
    </svg>
  );
};

// CLIPBOARD COUNTER — Tasks/approvals counter icon
export const ClipboardCountIcon: React.FC<IconProps> = ({ size = 24, darkMode = true }) => {
  const mode = darkMode ? "dark" : "light";
  const color = getColor(mode, "primary");

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Board body */}
      <rect
        x="5"
        y="4"
        width="14"
        height="17"
        rx="1.5"
        stroke={color}
        strokeWidth="1.2"
        fill="none"
      />
      {/* Clip at top */}
      <rect
        x="9"
        y="2"
        width="6"
        height="4"
        rx="1"
        stroke={color}
        strokeWidth="1"
        fill="none"
        opacity="0.7"
      />
      {/* Check items */}
      <path
        d="M8 10 L10 12 L13 9"
        stroke={color}
        strokeWidth="0.8"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.6"
      />
      <line x1="14.5" y1="10.5" x2="17" y2="10.5" stroke={color} strokeWidth="0.6" opacity="0.4" />
      <path
        d="M8 15 L10 17 L13 14"
        stroke={color}
        strokeWidth="0.8"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.4"
      />
      <line x1="14.5" y1="15.5" x2="17" y2="15.5" stroke={color} strokeWidth="0.6" opacity="0.3" />
    </svg>
  );
};

// GRID / NETWORK — Connected nodes (Workforce/agents view)
export const NetworkGridIcon: React.FC<IconProps> = ({ size = 24, darkMode = true }) => {
  const mode = darkMode ? "dark" : "light";
  const color = getColor(mode, "primary");

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <filter id="glow-grid" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="0.5" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      {/* 4 nodes in grid */}
      <circle cx="7" cy="7" r="1.5" fill={color} opacity="0.8" filter="url(#glow-grid)" />
      <circle cx="17" cy="7" r="1.5" fill={color} opacity="0.8" filter="url(#glow-grid)" />
      <circle cx="7" cy="17" r="1.5" fill={color} opacity="0.8" filter="url(#glow-grid)" />
      <circle cx="17" cy="17" r="1.5" fill={color} opacity="0.8" filter="url(#glow-grid)" />
      {/* Cross-connections */}
      <line
        x1="9"
        y1="7"
        x2="15"
        y2="7"
        stroke={color}
        strokeWidth="0.7"
        opacity="0.4"
        strokeDasharray="1.5,1.5"
      />
      <line
        x1="7"
        y1="9"
        x2="7"
        y2="15"
        stroke={color}
        strokeWidth="0.7"
        opacity="0.4"
        strokeDasharray="1.5,1.5"
      />
      <line
        x1="17"
        y1="9"
        x2="17"
        y2="15"
        stroke={color}
        strokeWidth="0.7"
        opacity="0.4"
        strokeDasharray="1.5,1.5"
      />
      <line
        x1="9"
        y1="17"
        x2="15"
        y2="17"
        stroke={color}
        strokeWidth="0.7"
        opacity="0.4"
        strokeDasharray="1.5,1.5"
      />
      {/* Diagonal cross */}
      <line
        x1="9"
        y1="9"
        x2="15"
        y2="15"
        stroke={color}
        strokeWidth="0.5"
        opacity="0.2"
        strokeDasharray="1.5,1.5"
      />
      <line
        x1="15"
        y1="9"
        x2="9"
        y2="15"
        stroke={color}
        strokeWidth="0.5"
        opacity="0.2"
        strokeDasharray="1.5,1.5"
      />
    </svg>
  );
};

// BOARD — Kanban/task board icon
export const BoardIcon: React.FC<IconProps> = ({ size = 24, darkMode = true }) => {
  const mode = darkMode ? "dark" : "light";
  const color = getColor(mode, "primary");

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Outer frame */}
      <rect
        x="3"
        y="3"
        width="18"
        height="18"
        rx="2"
        stroke={color}
        strokeWidth="1.2"
        fill="none"
      />
      {/* Column dividers */}
      <line x1="9" y1="3" x2="9" y2="21" stroke={color} strokeWidth="0.6" opacity="0.3" />
      <line x1="15" y1="3" x2="15" y2="21" stroke={color} strokeWidth="0.6" opacity="0.3" />
      {/* Cards in columns */}
      <rect
        x="4.5"
        y="6"
        width="3"
        height="3"
        rx="0.5"
        stroke={color}
        strokeWidth="0.7"
        opacity="0.6"
        fill="none"
      />
      <rect
        x="4.5"
        y="11"
        width="3"
        height="3"
        rx="0.5"
        stroke={color}
        strokeWidth="0.7"
        opacity="0.4"
        fill="none"
      />
      <rect
        x="10.5"
        y="6"
        width="3"
        height="3"
        rx="0.5"
        stroke={color}
        strokeWidth="0.7"
        opacity="0.6"
        fill="none"
      />
      <rect
        x="16.5"
        y="6"
        width="3"
        height="3"
        rx="0.5"
        stroke={color}
        strokeWidth="0.7"
        opacity="0.5"
        fill="none"
      />
      <rect
        x="16.5"
        y="11"
        width="3"
        height="3"
        rx="0.5"
        stroke={color}
        strokeWidth="0.7"
        opacity="0.3"
        fill="none"
      />
    </svg>
  );
};

// WORKER ADD — Agent with plus (+ Worker button)
export const WorkerAddIcon: React.FC<IconProps> = ({ size = 24, darkMode = true }) => {
  const mode = darkMode ? "dark" : "light";
  const color = getColor(mode, "primary");

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Head */}
      <circle cx="10" cy="7" r="3" stroke={color} strokeWidth="1.2" fill="none" />
      {/* Body */}
      <path
        d="M3 20 C3 15 6 12 10 12 C13 12 15 13.5 16 16"
        stroke={color}
        strokeWidth="1.2"
        fill="none"
        strokeLinecap="round"
      />
      {/* Plus symbol */}
      <line
        x1="19"
        y1="14"
        x2="19"
        y2="20"
        stroke={color}
        strokeWidth="1.3"
        strokeLinecap="round"
      />
      <line
        x1="16"
        y1="17"
        x2="22"
        y2="17"
        stroke={color}
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// WORKFLOWS — Pipeline builder icon (connected nodes in a flow)
// ─────────────────────────────────────────────────────────────────────────────

export const WorkflowsIcon: React.FC<IconProps> = ({ size = 24, darkMode = true }) => {
  const mode = darkMode ? "dark" : "light";
  const primary = getColor(mode, "primary");
  const secondary = getColor(mode, "secondary");
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Top node */}
      <circle cx="12" cy="4" r="2.5" stroke={primary} strokeWidth="1.5" fill="none" />
      {/* Connection line top to middle */}
      <line
        x1="12"
        y1="6.5"
        x2="12"
        y2="9.5"
        stroke={primary}
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      {/* Middle node */}
      <rect
        x="9"
        y="9.5"
        width="6"
        height="5"
        rx="1.5"
        stroke={secondary}
        strokeWidth="1.5"
        fill="none"
      />
      {/* Connection lines middle to bottom pair */}
      <line
        x1="10.5"
        y1="14.5"
        x2="7"
        y2="17.5"
        stroke={primary}
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      <line
        x1="13.5"
        y1="14.5"
        x2="17"
        y2="17.5"
        stroke={primary}
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      {/* Bottom left node */}
      <circle cx="7" cy="19.5" r="2" stroke={primary} strokeWidth="1.5" fill="none" />
      {/* Bottom right node */}
      <circle cx="17" cy="19.5" r="2" stroke={secondary} strokeWidth="1.5" fill="none" />
    </svg>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// EXPORT MAP FOR EASY REFERENCE
// ─────────────────────────────────────────────────────────────────────────────

export const ICON_MAP = {
  // Primary navigation
  "workflow-map": WorkflowMapIcon,
  workloads: WorkloadsIcon,
  "task-manager": TaskManagerIcon,
  "org-chart": OrgChartIcon,
  schedule: ScheduleIcon,
  workers: WorkersIcon,
  // Chat panel controls
  "mic-on": MicOnIcon,
  "mic-off": MicOffIcon,
  "speaker-on": SpeakerOnIcon,
  "speaker-off": SpeakerOffIcon,
  "deep-think": DeepThinkIcon,
  "deep-think-off": DeepThinkOffIcon,
  research: ResearchIcon,
  "research-active": ResearchActiveIcon,
  canvas: CanvasIcon,
  "eye-open": EyeOpenIcon,
  "eye-closed": EyeClosedIcon,
  send: SendIcon,
  attach: AttachIcon,
  // General utility
  home: HomeIcon,
  operations: OperationsIcon,
  settings: SettingsIcon,
  add: AddIcon,
  close: CloseIcon,
  menu: MenuIcon,
  maximize: MaximizeIcon,
  minimize: MinimizeIcon,
  copy: CopyIcon,
  check: CheckIcon,
  download: DownloadIcon,
  file: FileIcon,
  "panel-collapse": PanelCollapseIcon,
  terminal: TerminalIcon,
  database: DatabaseIcon,
  folder: FolderIcon,
  "chevron-down": ChevronDownIcon,
  "chevron-right": ChevronRightIcon,
  play: PlayIcon,
  pause: PauseIcon,
  stop: StopIcon,
  refresh: RefreshIcon,
  "thumbs-up": ThumbsUpIcon,
  "thumbs-down": ThumbsDownIcon,
  help: HelpIcon,
  // Top bar & action bar
  calendar: CalendarIcon,
  mail: MailIcon,
  "mail-badge": MailBadgeIcon,
  signal: SignalIcon,
  "signal-off": SignalOffIcon,
  agent: AgentIcon,
  "agents-group": AgentsGroupIcon,
  "zoom-in": ZoomInIcon,
  "zoom-out": ZoomOutIcon,
  shield: ShieldIcon,
  documents: DocumentsIcon,
  "clipboard-count": ClipboardCountIcon,
  "network-grid": NetworkGridIcon,
  board: BoardIcon,
  "worker-add": WorkerAddIcon,
  workflows: WorkflowsIcon,
};

export type IconName = keyof typeof ICON_MAP;

/**
 * Universal icon renderer — pass a name and props, get the SVG back
 * Usage: <IconRenderer name="workflow-map" size={32} darkMode={true} />
 */
export const IconRenderer: React.FC<IconProps & { name: IconName }> = ({ name, ...props }) => {
  const Component = ICON_MAP[name];
  return Component ? <Component {...props} /> : null;
};
