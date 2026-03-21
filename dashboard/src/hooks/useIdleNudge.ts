/**
 * useIdleNudge — Detect user inactivity and nudge the agent to do something
 *
 * Tracks mouse, keyboard, scroll, and touch events. After `idleThresholdMs`
 * of inactivity, picks a random activity and fires the `onNudge` callback.
 * Respects a minimum gap between nudges so the agent isn't spammed.
 */

import { useEffect, useRef, useCallback } from "react";
import { pickNudgeActivity, type NudgeActivity } from "../lib/nudgeActivities";

interface UseIdleNudgeOptions {
  /** How long (ms) before user is considered idle. Default: 2 minutes */
  idleThresholdMs?: number;
  /** Minimum gap (ms) between nudges. Default: 5 minutes */
  nudgeCooldownMs?: number;
  /** Whether the nudge system is enabled */
  enabled?: boolean;
  /** Custom nudges list (fetched from API) */
  nudges?: NudgeActivity[];
  /** Called when a nudge should fire */
  onNudge: (activity: NudgeActivity) => void;
}

export function useIdleNudge({
  idleThresholdMs = 2 * 60 * 1000,
  nudgeCooldownMs = 5 * 60 * 1000,
  enabled = true,
  nudges,
  onNudge,
}: UseIdleNudgeOptions) {
  const lastActivityRef = useRef(Date.now());
  const lastNudgeRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recentActivitiesRef = useRef(new Map<string, number>());
  const onNudgeRef = useRef(onNudge);
  onNudgeRef.current = onNudge;
  const nudgesRef = useRef(nudges);
  nudgesRef.current = nudges;
  // Keep a ref so scheduled callbacks always see the latest enabled state
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const resetTimer = useCallback(() => {
    lastActivityRef.current = Date.now();

    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    if (!enabled) return;

    timerRef.current = setTimeout(() => {
      if (!enabledRef.current) return;

      const now = Date.now();
      const timeSinceLastNudge = now - lastNudgeRef.current;

      // Don't nudge too frequently
      if (timeSinceLastNudge < nudgeCooldownMs) {
        // Schedule next check for when cooldown expires
        const remaining = nudgeCooldownMs - timeSinceLastNudge;
        timerRef.current = setTimeout(() => {
          // Re-check idle state and enabled state
          if (enabledRef.current && Date.now() - lastActivityRef.current >= idleThresholdMs) {
            fireNudge();
          }
        }, remaining);
        return;
      }

      fireNudge();
    }, idleThresholdMs);
  }, [enabled, idleThresholdMs, nudgeCooldownMs]);

  const fireNudge = useCallback(() => {
    // Always check latest enabled state — user may have toggled off
    // after the timer was scheduled
    if (!enabledRef.current) return;

    const activity = pickNudgeActivity(recentActivitiesRef.current, nudgesRef.current);
    if (!activity) return;

    lastNudgeRef.current = Date.now();
    recentActivitiesRef.current.set(activity.id, Date.now());

    onNudgeRef.current(activity);

    // Schedule recurring nudges while still idle
    // Each subsequent nudge uses the nudge cooldown as interval
    timerRef.current = setTimeout(() => {
      if (enabledRef.current && Date.now() - lastActivityRef.current >= idleThresholdMs) {
        fireNudge();
      }
    }, nudgeCooldownMs);
  }, [idleThresholdMs, nudgeCooldownMs]);

  useEffect(() => {
    if (!enabled) {
      if (timerRef.current) clearTimeout(timerRef.current);
      return;
    }

    const events = ["mousemove", "mousedown", "keydown", "scroll", "touchstart", "wheel"];

    const handleActivity = () => resetTimer();

    events.forEach((event) => window.addEventListener(event, handleActivity, { passive: true }));

    // Start the initial timer
    resetTimer();

    return () => {
      events.forEach((event) => window.removeEventListener(event, handleActivity));
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [enabled, resetTimer]);
}
