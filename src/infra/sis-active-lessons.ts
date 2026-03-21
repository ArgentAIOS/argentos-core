/**
 * Track which SIS lessons were injected into each session's most recent prompt.
 * Used by the feedback loop: when a user gives thumbs up/down, we look up
 * which lessons were active and reinforce/decay their confidence accordingly.
 */

const EXPIRY_MS = 30 * 60 * 1000; // 30 minutes

interface ActiveLessonsEntry {
  lessonIds: string[];
  timestamp: number;
}

const activeLessons = new Map<string, ActiveLessonsEntry>();

/** Record which lesson IDs were injected for a session's latest response. */
export function setActiveLessons(sessionKey: string, lessonIds: string[]): void {
  activeLessons.set(sessionKey, { lessonIds, timestamp: Date.now() });
}

/** Get active lesson IDs for a session. Returns [] if expired or absent. */
export function getActiveLessons(sessionKey: string): string[] {
  const entry = activeLessons.get(sessionKey);
  if (!entry) {
    return [];
  }
  if (Date.now() - entry.timestamp > EXPIRY_MS) {
    activeLessons.delete(sessionKey);
    return [];
  }
  return entry.lessonIds;
}

/** Clear active lessons for a session. */
export function clearActiveLessons(sessionKey: string): void {
  activeLessons.delete(sessionKey);
}
