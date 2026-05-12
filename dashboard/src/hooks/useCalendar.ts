import { useState, useEffect, useCallback, useRef } from "react";
import { fetchLocalApi } from "../utils/localApiFetch";

const CALENDAR_ACCOUNT_STORAGE_KEY = "argent-calendar-account";

export function getStoredCalendarAccount(): string | null {
  const raw = localStorage.getItem(CALENDAR_ACCOUNT_STORAGE_KEY);
  const normalized = raw?.trim();
  return normalized ? normalized : null;
}

export function setStoredCalendarAccount(account: string | null) {
  const normalized = account?.trim();
  if (normalized) {
    localStorage.setItem(CALENDAR_ACCOUNT_STORAGE_KEY, normalized);
    return;
  }
  localStorage.removeItem(CALENDAR_ACCOUNT_STORAGE_KEY);
}

function calendarEndpoint(path: string): string {
  const preferredAccount = getStoredCalendarAccount();
  if (!preferredAccount) return path;
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}account=${encodeURIComponent(preferredAccount)}`;
}

export interface CalendarEvent {
  summary: string;
  start: string;
  end: string;
  location?: string;
  description?: string;
  htmlLink?: string;
  hangoutLink?: string;
  conferenceData?: {
    entryPoints?: Array<{
      entryPointType: string;
      uri: string;
      label?: string;
    }>;
  };
  attendees?: Array<{
    email: string;
    displayName?: string;
    responseStatus?: string;
  }>;
  organizer?: {
    email: string;
    displayName?: string;
  };
}

export function useCalendar(refreshInterval = 60000, enabled = true) {
  const [nextEvent, setNextEvent] = useState<string | null>(null);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [activeAccount, setActiveAccount] = useState<string | null>(getStoredCalendarAccount());
  const fetchInFlightRef = useRef(false);
  const fetchAbortRef = useRef<AbortController | null>(null);

  const fetchEvents = useCallback(async () => {
    if (fetchInFlightRef.current) {
      return;
    }
    fetchInFlightRef.current = true;
    const controller = new AbortController();
    fetchAbortRef.current = controller;
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      // Fetch upcoming events list (new endpoint)
      const response = await fetchLocalApi(calendarEndpoint("/api/calendar/upcoming"), {
        signal: controller.signal,
      });
      if (!response.ok) {
        // Fallback to old endpoint
        const nextResponse = await fetchLocalApi(calendarEndpoint("/api/calendar/next"), {
          signal: controller.signal,
        });
        if (!nextResponse.ok) throw new Error("Failed to fetch calendar");

        const data = await nextResponse.json();
        setActiveAccount(
          typeof data?.account === "string" ? data.account : getStoredCalendarAccount(),
        );
        const isUnavailable = Boolean(data?.unavailable);
        setUnavailable(isUnavailable);
        if (isUnavailable) {
          setError(
            `Calendar unavailable${typeof data?.account === "string" && data.account ? ` for ${data.account}` : ""}`,
          );
        } else {
          setError(null);
        }
        if (data.event) {
          const startTime = new Date(data.event.start);
          const timeStr = startTime.toLocaleTimeString("en-US", {
            hour: "numeric",
            minute: "2-digit",
            hour12: true,
          });
          setNextEvent(`${data.event.summary} @ ${timeStr}`);
          setEvents([data.event]);
        } else {
          setNextEvent(null);
          setEvents([]);
        }
        return;
      }

      const data = await response.json();
      setActiveAccount(
        typeof data?.account === "string" ? data.account : getStoredCalendarAccount(),
      );
      const isUnavailable = Boolean(data?.unavailable);
      setUnavailable(isUnavailable);
      if (isUnavailable) {
        setError(
          `Calendar unavailable${typeof data?.account === "string" && data.account ? ` for ${data.account}` : ""}`,
        );
      } else {
        setError(null);
      }
      setEvents(data.events || []);

      // Set next event string for status bar
      if (data.events && data.events.length > 0) {
        const firstEvent = data.events[0];
        const startTime = new Date(firstEvent.start);
        const timeStr = startTime.toLocaleTimeString("en-US", {
          hour: "numeric",
          minute: "2-digit",
          hour12: true,
        });
        setNextEvent(`${firstEvent.summary} @ ${timeStr}`);
      } else {
        setNextEvent(null);
      }
    } catch (err) {
      if (!(err instanceof Error && err.name === "AbortError")) {
        console.error("[Calendar] Error:", err);
        setError(err instanceof Error ? err.message : "Failed to fetch");
        setUnavailable(false);
        // Keep showing last known events on error
      }
    } finally {
      clearTimeout(timeout);
      if (fetchAbortRef.current === controller) {
        fetchAbortRef.current = null;
      }
      fetchInFlightRef.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      fetchAbortRef.current?.abort();
      fetchAbortRef.current = null;
      fetchInFlightRef.current = false;
      setLoading(false);
      return;
    }
    fetchEvents();
    const interval = setInterval(fetchEvents, refreshInterval);
    return () => {
      clearInterval(interval);
      fetchAbortRef.current?.abort();
      fetchAbortRef.current = null;
      fetchInFlightRef.current = false;
    };
  }, [enabled, fetchEvents, refreshInterval]);

  return {
    nextEvent,
    events,
    loading,
    error,
    unavailable,
    account: activeAccount,
    refresh: fetchEvents,
  };
}
