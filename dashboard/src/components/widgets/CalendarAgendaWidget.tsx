import { X, Video, MapPin, Clock, Users, ExternalLink, Mic } from "lucide-react";
import { useState, useCallback } from "react";
import { useCalendar, type CalendarEvent } from "../../hooks/useCalendar";
import { WidgetContainer } from "./WidgetContainer";

export function CalendarAgendaWidget() {
  const { events, loading, unavailable, error, account } = useCalendar(60000); // Refresh every minute
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [recordingEventId, setRecordingEventId] = useState<string | null>(null);
  const [recordingBusy, setRecordingBusy] = useState(false);
  const [recordingError, setRecordingError] = useState<string | null>(null);

  const invokeRecorder = useCallback(async (action: string, args: Record<string, unknown> = {}) => {
    const resp = await fetch("/api/gateway/tools/invoke", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tool: "meeting_record", action, args }),
    });
    const data = await resp.json();
    const text = data?.result?.content?.[0]?.text ?? data?.error?.message ?? "";
    return { ok: resp.ok && data.ok, text };
  }, []);

  const startMeetingRecording = useCallback(
    async (event: CalendarEvent, e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      if (recordingBusy) return;
      setRecordingBusy(true);
      setRecordingError(null);
      try {
        const { ok, text } = await invokeRecorder("start", {
          title: event.summary || "Meeting Recording",
          systemAudio: true,
          mic: true,
          liveTranscript: true,
        });
        if (ok && !text.toLowerCase().includes("failed")) {
          setRecordingEventId(event.summary || null);
        } else {
          const short = text.includes("declined TCCs")
            ? "Screen Recording permission required — grant in System Settings > Privacy & Security > Screen Recording"
            : text.split("\n")[0] || "Recording failed to start";
          setRecordingError(short);
          console.error("[MeetingRecord] start failed:", text);
        }
      } catch (err) {
        setRecordingError("Could not reach gateway");
        console.error("[MeetingRecord] start error:", err);
      } finally {
        setRecordingBusy(false);
      }
    },
    [recordingBusy, invokeRecorder],
  );

  const stopMeetingRecording = useCallback(async () => {
    if (recordingBusy) return;
    setRecordingBusy(true);
    try {
      await invokeRecorder("stop");
      setRecordingEventId(null);
    } catch (err) {
      console.error("[MeetingRecord] stop error:", err);
    } finally {
      setRecordingBusy(false);
    }
  }, [recordingBusy, invokeRecorder]);

  if (loading && !events.length) {
    return (
      <WidgetContainer title="Upcoming Events" className="h-full">
        <div className="flex items-center justify-center h-full text-white/30 text-sm">
          Loading...
        </div>
      </WidgetContainer>
    );
  }

  if (unavailable) {
    return (
      <WidgetContainer title="Upcoming Events" className="h-full">
        <div className="flex flex-col items-center justify-center h-full text-center px-3">
          <div className="text-amber-300/90 text-sm">Calendar account unavailable</div>
          {account && <div className="text-white/45 text-xs mt-1">{account}</div>}
          <div className="text-white/35 text-xs mt-2">
            Settings -&gt; Gateway -&gt; GOG Calendar
          </div>
          {error && <div className="text-white/30 text-[11px] mt-2 max-w-[230px]">{error}</div>}
        </div>
      </WidgetContainer>
    );
  }

  // Get next 5 upcoming events
  const upcomingEvents = events
    .filter((event) => {
      const eventDate = new Date(event.start);
      return eventDate >= new Date(); // Future events only
    })
    .slice(0, 5);

  // Extract meeting link from various sources
  const getMeetingLink = (event: CalendarEvent): string | null => {
    // Direct hangout link (Google Meet)
    if (event.hangoutLink) return event.hangoutLink;

    // Conference data entry points
    if (event.conferenceData?.entryPoints) {
      const videoEntry = event.conferenceData.entryPoints.find(
        (ep) => ep.entryPointType === "video",
      );
      if (videoEntry) return videoEntry.uri;
    }

    // Parse from description
    if (event.description) {
      // Google Meet
      const meetMatch = event.description.match(/https:\/\/meet\.google\.com\/[a-z-]+/i);
      if (meetMatch) return meetMatch[0];

      // Zoom
      const zoomMatch = event.description.match(/https:\/\/[a-z0-9-]+\.zoom\.us\/j\/\d+[^\s]*/i);
      if (zoomMatch) return zoomMatch[0];

      // Microsoft Teams
      const teamsMatch = event.description.match(/https:\/\/teams\.microsoft\.com\/[^\s]+/i);
      if (teamsMatch) return teamsMatch[0];
    }

    // Parse from location
    if (event.location) {
      if (event.location.startsWith("http")) return event.location;
    }

    return null;
  };

  // Detect meeting platform from link
  const getMeetingPlatform = (link: string): string | null => {
    if (link.includes("meet.google.com")) return "Google Meet";
    if (link.includes("zoom.us")) return "Zoom";
    if (link.includes("teams.microsoft.com")) return "Teams";
    return null;
  };

  return (
    <>
      <WidgetContainer title="Upcoming Events" className="h-full">
        {upcomingEvents.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-white/30 text-sm">
            <svg className="w-8 h-8 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
              />
            </svg>
            <span>No upcoming events</span>
          </div>
        ) : (
          <div className="space-y-2 overflow-y-auto max-h-[400px]">
            {recordingEventId && (
              <div className="flex items-center justify-between px-2 py-1.5 rounded bg-red-500/15 border border-red-500/30">
                <div className="flex items-center gap-1.5 text-red-400 text-xs font-medium">
                  <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                  Recording: {recordingEventId}
                </div>
                <button
                  onClick={stopMeetingRecording}
                  disabled={recordingBusy}
                  className="text-[10px] px-2 py-0.5 rounded bg-red-500/20 text-red-300 hover:bg-red-500/40 transition-colors disabled:opacity-50"
                >
                  Stop
                </button>
              </div>
            )}
            {recordingError && (
              <div
                className="px-2 py-1.5 rounded bg-amber-500/10 border border-amber-500/20 text-amber-300 text-[11px] cursor-pointer"
                onClick={() => setRecordingError(null)}
                title="Click to dismiss"
              >
                {recordingError}
              </div>
            )}
            {upcomingEvents.map((event, idx) => {
              const startTime = new Date(event.start).toLocaleTimeString("en-US", {
                hour: "numeric",
                minute: "2-digit",
                hour12: true,
              });

              // Determine if event is today or tomorrow
              const eventDate = new Date(event.start);
              const today = new Date();
              const tomorrow = new Date(today);
              tomorrow.setDate(today.getDate() + 1);

              const isToday =
                eventDate.getDate() === today.getDate() &&
                eventDate.getMonth() === today.getMonth() &&
                eventDate.getFullYear() === today.getFullYear();

              const isTomorrow =
                eventDate.getDate() === tomorrow.getDate() &&
                eventDate.getMonth() === tomorrow.getMonth() &&
                eventDate.getFullYear() === tomorrow.getFullYear();

              const meetingLink = getMeetingLink(event);

              return (
                <div
                  key={idx}
                  onClick={() => setSelectedEvent(event)}
                  className="w-full p-2 rounded bg-white/5 hover:bg-white/10 transition-colors border border-white/10 text-left cursor-pointer"
                >
                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0 w-[72px] mt-0.5">
                      <div className="text-purple-400 text-xs font-medium whitespace-nowrap">
                        {startTime}
                      </div>
                      {(isToday || isTomorrow) && (
                        <div
                          className={`text-xs whitespace-nowrap ${isToday ? "text-amber-400/70" : "text-blue-400/70"}`}
                        >
                          ({isToday ? "today" : "tomorrow"})
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-white text-sm font-medium truncate">
                        {event.summary || "Untitled Event"}
                      </div>
                      {event.location && !meetingLink && (
                        <div className="text-white/50 text-xs mt-0.5 truncate">
                          📍 {event.location}
                        </div>
                      )}
                      {meetingLink && (
                        <div className="text-green-400 text-xs mt-0 flex items-center justify-between">
                          <div className="flex items-center gap-0.5">
                            <Video className="w-3 h-3" />
                            <span>Video meeting</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            {getMeetingPlatform(meetingLink) && (
                              <span className="text-white/40 text-[10px]">
                                {getMeetingPlatform(meetingLink)}
                              </span>
                            )}
                            {recordingEventId === event.summary ? (
                              <span className="flex items-center gap-0.5 text-red-400 text-[10px] font-medium">
                                <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                                REC
                              </span>
                            ) : (
                              <button
                                onClick={(e) => startMeetingRecording(event, e)}
                                disabled={recordingBusy || recordingEventId !== null}
                                className="flex items-center gap-0.5 text-[10px] text-white/50 hover:text-red-400 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                                title="Start meeting recording"
                              >
                                <Mic className="w-2.5 h-2.5" />
                                <span>Record</span>
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </WidgetContainer>

      {/* Event Details Modal */}
      {selectedEvent && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[100]"
          onClick={() => setSelectedEvent(null)}
        >
          <div
            className="bg-gray-900 rounded-2xl p-6 w-[600px] max-w-[90vw] max-h-[80vh] overflow-y-auto border border-white/10"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-start justify-between mb-4">
              <h3 className="text-white font-semibold text-xl pr-8">
                {selectedEvent.summary || "Untitled Event"}
              </h3>
              <button
                onClick={() => setSelectedEvent(null)}
                className="p-1 rounded-lg hover:bg-white/10 text-white/50 flex-shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              {/* Time */}
              <div className="flex items-start gap-3">
                <Clock className="w-5 h-5 text-purple-400 flex-shrink-0 mt-0.5" />
                <div>
                  <div className="text-white text-sm">
                    {new Date(selectedEvent.start).toLocaleString("en-US", {
                      weekday: "long",
                      month: "long",
                      day: "numeric",
                      year: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                      hour12: true,
                    })}
                  </div>
                  <div className="text-white/50 text-xs mt-0.5">
                    to{" "}
                    {new Date(selectedEvent.end).toLocaleTimeString("en-US", {
                      hour: "numeric",
                      minute: "2-digit",
                      hour12: true,
                    })}
                  </div>
                </div>
              </div>

              {/* Meeting Link */}
              {(() => {
                const meetingLink = getMeetingLink(selectedEvent);
                if (meetingLink) {
                  return (
                    <div className="flex items-start gap-3">
                      <Video className="w-5 h-5 text-green-400 flex-shrink-0 mt-0.5" />
                      <div className="flex-1">
                        <a
                          href={meetingLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-green-400 text-sm hover:text-green-300 underline flex items-center gap-1.5 group"
                        >
                          <span>Join Video Meeting</span>
                          <ExternalLink className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity" />
                        </a>
                        <div className="text-white/30 text-xs mt-0.5 font-mono truncate">
                          {meetingLink}
                        </div>
                      </div>
                    </div>
                  );
                }
                return null;
              })()}

              {/* Location */}
              {selectedEvent.location && !getMeetingLink(selectedEvent) && (
                <div className="flex items-start gap-3">
                  <MapPin className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
                  <div className="text-white text-sm">{selectedEvent.location}</div>
                </div>
              )}

              {/* Organizer */}
              {selectedEvent.organizer && (
                <div className="flex items-start gap-3">
                  <div className="w-5 h-5 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <span className="text-purple-400 text-xs">👤</span>
                  </div>
                  <div>
                    <div className="text-white/70 text-xs font-medium mb-0.5">Organizer</div>
                    <div className="text-white text-sm">
                      {selectedEvent.organizer.displayName || selectedEvent.organizer.email}
                    </div>
                  </div>
                </div>
              )}

              {/* Attendees */}
              {selectedEvent.attendees && selectedEvent.attendees.length > 0 && (
                <div className="flex items-start gap-3">
                  <Users className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <div className="text-white/70 text-xs font-medium mb-1.5">
                      {selectedEvent.attendees.length} Attendee
                      {selectedEvent.attendees.length !== 1 ? "s" : ""}
                    </div>
                    <div className="space-y-1 max-h-[200px] overflow-y-auto">
                      {selectedEvent.attendees.map((attendee, idx) => (
                        <div key={idx} className="flex items-center gap-2">
                          <div
                            className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                              attendee.responseStatus === "accepted"
                                ? "bg-green-400"
                                : attendee.responseStatus === "declined"
                                  ? "bg-red-400"
                                  : attendee.responseStatus === "tentative"
                                    ? "bg-yellow-400"
                                    : "bg-gray-400"
                            }`}
                          />
                          <span className="text-white/60 text-xs">
                            {attendee.displayName || attendee.email}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Description */}
              {selectedEvent.description && (
                <div className="pt-3 border-t border-white/10">
                  <div className="text-white/70 text-xs font-medium mb-2">Description</div>
                  <div
                    className="text-white/60 text-sm whitespace-pre-wrap max-h-[200px] overflow-y-auto"
                    style={{ wordBreak: "break-word" }}
                  >
                    {selectedEvent.description}
                  </div>
                </div>
              )}

              {/* Calendar Link */}
              {selectedEvent.htmlLink && (
                <div className="pt-3 border-t border-white/10">
                  <a
                    href={selectedEvent.htmlLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-purple-400 text-sm hover:text-purple-300 underline flex items-center gap-1.5"
                  >
                    <span>View in Google Calendar</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
