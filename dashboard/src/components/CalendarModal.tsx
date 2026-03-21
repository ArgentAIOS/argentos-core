import { motion, AnimatePresence } from "framer-motion";
import { X, Calendar, Clock, MapPin, Users, ExternalLink } from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import { getStoredCalendarAccount, setStoredCalendarAccount } from "../hooks/useCalendar";

type MeetingPlatform = "zoom" | "meet" | "teams" | null;

interface CalendarEvent {
  id: string;
  summary: string;
  start: string;
  end: string;
  location?: string;
  description?: string;
  attendees?: string[];
  meetingPlatform?: MeetingPlatform;
  meetingLink?: string;
  hangoutLink?: string;
  conferenceData?: any;
  htmlLink?: string; // Direct link to Google Calendar event
  isVideoCall?: boolean;
}

// Logo URLs for meeting platforms
const platformLogos = {
  zoom: "https://img.freepik.com/premium-vector/zoom-icon-popular-messenger-app-communications-platform_277909-457.jpg",
  meet: "https://static.vecteezy.com/system/resources/previews/022/613/028/non_2x/google-meet-icon-logo-symbol-free-png.png",
  teams: "https://upload.wikimedia.org/wikipedia/commons/5/50/Microsoft_Teams.png",
};

const PlatformLogo = ({ platform }: { platform: MeetingPlatform }) => {
  if (!platform) return null;
  return (
    <img src={platformLogos[platform]} alt={platform} className="w-5 h-5 rounded object-contain" />
  );
};

// Detect meeting platform and extract link
function detectMeetingInfo(event: CalendarEvent): {
  platform: MeetingPlatform;
  link: string | null;
} {
  const text =
    `${event.location || ""} ${event.description || ""} ${event.summary || ""}`.toLowerCase();
  const fullText = `${event.location || ""} ${event.description || ""}`;

  // Check for Google hangoutLink first (most reliable for Meet)
  if (event.hangoutLink) {
    return { platform: "meet", link: event.hangoutLink };
  }

  // Zoom detection
  const zoomMatch = fullText.match(/https?:\/\/[\w.-]*zoom\.us\/[^\s<>"'\]]+/i);
  if (zoomMatch || text.includes("zoom.us")) {
    return { platform: "zoom", link: zoomMatch?.[0]?.replace(/[\]>]$/, "") || null };
  }

  // Google Meet detection
  const meetMatch = fullText.match(/https?:\/\/meet\.google\.com\/[^\s<>"'\]]+/i);
  if (meetMatch || text.includes("meet.google.com")) {
    return { platform: "meet", link: meetMatch?.[0]?.replace(/[\]>]$/, "") || null };
  }

  // Teams detection
  const teamsMatch = fullText.match(/https?:\/\/teams\.microsoft\.com\/[^\s<>"'\]]+/i);
  if (teamsMatch || text.includes("teams.microsoft.com") || text.includes("teams meeting")) {
    return { platform: "teams", link: teamsMatch?.[0]?.replace(/[\]>]$/, "") || null };
  }

  return { platform: null, link: null };
}

interface CalendarModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface CalendarAccountOption {
  email: string;
  client?: string;
}

export function CalendarModal({ isOpen, onClose }: CalendarModalProps) {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<CalendarAccountOption[]>([]);
  const [accountLoading, setAccountLoading] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState<string>(
    () => getStoredCalendarAccount() || "",
  );

  const withAccountQuery = useCallback(
    (path: string, accountOverride?: string | null) => {
      const candidate = (accountOverride ?? selectedAccount).trim();
      if (!candidate) return path;
      const join = path.includes("?") ? "&" : "?";
      return `${path}${join}account=${encodeURIComponent(candidate)}`;
    },
    [selectedAccount],
  );

  const fetchAccounts = useCallback(async () => {
    setAccountLoading(true);
    try {
      const response = await fetch("/api/calendar/accounts");
      if (!response.ok) return selectedAccount || getStoredCalendarAccount() || "";

      const data = await response.json();
      const options: CalendarAccountOption[] = Array.isArray(data?.accounts)
        ? data.accounts
            .filter((entry: any) => entry && typeof entry.email === "string")
            .map((entry: any) => ({
              email: entry.email,
              client: entry.client || "default",
            }))
        : [];
      setAccounts(options);

      const validEmails = new Set(options.map((entry) => entry.email));
      const apiSelected =
        typeof data?.selectedAccount === "string" && validEmails.has(data.selectedAccount)
          ? data.selectedAccount
          : "";
      const stored = getStoredCalendarAccount();
      const storedSelected = stored && validEmails.has(stored) ? stored : "";
      const fallback = options[0]?.email || "";
      const resolved = apiSelected || storedSelected || fallback || "";

      setSelectedAccount(resolved);
      setStoredCalendarAccount(resolved || null);
      return resolved;
    } catch (err) {
      console.warn("[Calendar] Failed to load account list:", err);
      return selectedAccount || getStoredCalendarAccount() || "";
    } finally {
      setAccountLoading(false);
    }
  }, [selectedAccount]);

  const fetchEvents = useCallback(
    async (accountOverride?: string | null) => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(withAccountQuery("/api/calendar/today", accountOverride));
        if (!response.ok) {
          // Fallback to next event endpoint
          const nextResponse = await fetch(withAccountQuery("/api/calendar/next", accountOverride));
          if (nextResponse.ok) {
            const data = await nextResponse.json();
            if (data.event) {
              setEvents([
                {
                  id: "1",
                  summary: data.event.summary,
                  start: data.event.start,
                  end: data.event.end,
                  location: data.event.location,
                  isVideoCall:
                    data.event.summary?.toLowerCase().includes("zoom") ||
                    data.event.summary?.toLowerCase().includes("meet") ||
                    data.event.location?.includes("zoom") ||
                    data.event.location?.includes("meet"),
                },
              ]);
            } else {
              setEvents([]);
            }
          } else {
            throw new Error("Failed to fetch calendar");
          }
        } else {
          const data = await response.json();
          setEvents(data.events || []);
        }
      } catch (err) {
        setError("Failed to load calendar");
        console.error("[Calendar] Error:", err);
      }
      setLoading(false);
    },
    [withAccountQuery],
  );

  useEffect(() => {
    if (isOpen) {
      const initialize = async () => {
        const resolved = await fetchAccounts();
        await fetchEvents(resolved);
      };
      void initialize();
    }
  }, [isOpen, fetchAccounts, fetchEvents]);

  const handleAccountChange = async (nextAccount: string) => {
    const normalized = nextAccount.trim();
    setSelectedAccount(normalized);
    setStoredCalendarAccount(normalized || null);
    setAccountLoading(true);
    try {
      const response = await fetch("/api/calendar/account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account: normalized || null }),
      });
      if (!response.ok) {
        throw new Error(`Failed to set calendar account (${response.status})`);
      }
      await fetchEvents(normalized || null);
    } catch (err) {
      console.error("[Calendar] Failed to switch account:", err);
      setError("Failed to switch calendar account");
    } finally {
      setAccountLoading(false);
    }
  };

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  };

  const formatDuration = (start: string, end: string) => {
    const startDate = new Date(start);
    const endDate = new Date(end);
    const diffMs = endDate.getTime() - startDate.getTime();
    const diffMins = Math.round(diffMs / 60000);

    if (diffMins < 60) return `${diffMins}m`;
    const hours = Math.floor(diffMins / 60);
    const mins = diffMins % 60;
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  };

  const isNow = (start: string, end: string) => {
    const now = new Date();
    return new Date(start) <= now && now <= new Date(end);
  };

  const isUpcoming = (start: string) => {
    const now = new Date();
    const eventStart = new Date(start);
    const diffMs = eventStart.getTime() - now.getTime();
    return diffMs > 0 && diffMs < 3600000; // Within next hour
  };

  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            className="bg-gray-900 rounded-2xl p-6 w-[500px] max-w-[90vw] max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-white font-semibold text-lg">Today's Schedule</h3>
              <button
                onClick={onClose}
                className="p-1.5 rounded-lg hover:bg-white/10 text-white/50"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="text-white/50 text-sm mb-6">{today}</div>

            <div className="mb-6">
              <label className="text-white/60 text-xs block mb-1">Calendar account</label>
              <select
                value={selectedAccount}
                onChange={(e) => void handleAccountChange(e.target.value)}
                disabled={accountLoading || accounts.length === 0}
                className="w-full bg-white/5 border border-white/10 text-white rounded-lg px-3 py-2 text-sm disabled:opacity-50"
              >
                {accounts.length === 0 ? (
                  <option value="">No calendar accounts detected</option>
                ) : (
                  accounts.map((entry) => (
                    <option key={entry.email} value={entry.email}>
                      {entry.email}
                      {entry.client ? ` (${entry.client})` : ""}
                    </option>
                  ))
                )}
              </select>
            </div>

            {loading && <div className="text-center py-8 text-white/50">Loading calendar...</div>}

            {error && <div className="text-center py-8 text-red-400">{error}</div>}

            {!loading && !error && events.length === 0 && (
              <div className="text-center py-12">
                <Calendar className="w-12 h-12 mx-auto mb-3 text-white/20" />
                <div className="text-white/50">No events today</div>
                <div className="text-white/30 text-sm mt-1">Enjoy your free day!</div>
              </div>
            )}

            {!loading && events.length > 0 && (
              <div className="space-y-3 overflow-y-auto max-h-[60vh] pr-1">
                {events.map((event) => {
                  const happening = isNow(event.start, event.end);
                  const upcoming = isUpcoming(event.start);
                  const { platform, link } = detectMeetingInfo(event);

                  const platformColors = {
                    zoom: "bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 border border-blue-500/30",
                    meet: "bg-green-500/20 text-green-400 hover:bg-green-500/30 border border-green-500/30",
                    teams:
                      "bg-purple-500/20 text-purple-400 hover:bg-purple-500/30 border border-purple-500/30",
                  };

                  // Build Google Calendar event URL
                  const eventDate = new Date(event.start);
                  const calendarUrl = `https://calendar.google.com/calendar/r/day/${eventDate.getFullYear()}/${eventDate.getMonth() + 1}/${eventDate.getDate()}`;

                  return (
                    <div
                      key={event.id}
                      className={`rounded-xl p-4 border transition-all ${
                        happening
                          ? "bg-green-500/20 border-green-500/50"
                          : upcoming
                            ? "bg-yellow-500/10 border-yellow-500/30"
                            : "bg-white/5 border-white/10"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <h4 className="text-white font-medium truncate">{event.summary}</h4>
                          </div>

                          <div className="flex items-center gap-4 mt-2 text-sm text-white/60">
                            <div className="flex items-center gap-1.5">
                              <Clock className="w-3.5 h-3.5" />
                              <span>
                                {formatTime(event.start)} - {formatTime(event.end)}
                              </span>
                            </div>
                            <span className="text-white/40">
                              ({formatDuration(event.start, event.end)})
                            </span>
                          </div>

                          {event.location && !platform && (
                            <div className="flex items-center gap-1.5 mt-2 text-sm text-white/50">
                              <MapPin className="w-3.5 h-3.5" />
                              <span className="truncate">{event.location}</span>
                            </div>
                          )}

                          {event.attendees && event.attendees.length > 0 && (
                            <div className="flex items-center gap-1.5 mt-2 text-sm text-white/50">
                              <Users className="w-3.5 h-3.5" />
                              <span>
                                {event.attendees.length} attendee
                                {event.attendees.length > 1 ? "s" : ""}
                              </span>
                            </div>
                          )}

                          {/* View in Calendar link */}
                          <a
                            href={event.htmlLink || calendarUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 mt-2 text-xs text-white/40 hover:text-white/60 transition-colors"
                          >
                            <Calendar className="w-3 h-3" />
                            <span>View in Calendar</span>
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        </div>

                        <div className="flex flex-col items-end gap-2 flex-shrink-0">
                          {/* Status badges */}
                          {happening && (
                            <span className="px-2 py-1 bg-green-500/30 text-green-300 text-xs rounded-full">
                              Now
                            </span>
                          )}
                          {upcoming && !happening && (
                            <span className="px-2 py-1 bg-yellow-500/20 text-yellow-300 text-xs rounded-full">
                              Soon
                            </span>
                          )}

                          {/* Meeting join button */}
                          {platform && (
                            <a
                              href={link || "#"}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => !link && e.preventDefault()}
                              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                                platformColors[platform]
                              } ${!link ? "opacity-50 cursor-not-allowed" : ""}`}
                            >
                              <PlatformLogo platform={platform} />
                              <span>Join</span>
                              {link && <ExternalLink className="w-3 h-3" />}
                            </a>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
