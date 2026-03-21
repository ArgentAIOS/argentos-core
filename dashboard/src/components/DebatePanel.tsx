import { useEffect, useReducer, useRef } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

type PanelistStatus = "waiting" | "thinking" | "streaming" | "done" | "speaking";

interface PanelistState {
  id: string;
  name: string;
  emoji: string;
  model: string;
  status: PanelistStatus;
  currentText: string;
  responses: Array<{ round: number; content: string }>;
}

export interface DebateState {
  active: boolean;
  debateId: string;
  challenge: string;
  currentRound: number;
  totalRounds: number;
  panelists: PanelistState[];
  consensusReached: boolean | null;
  consensusSummary: string;
}

type TankEvent =
  | {
      type: "debate_start";
      data: {
        debateId: string;
        challenge: string;
        panelists: Array<{ id: string; name: string; emoji: string; model: string }>;
        rounds: number;
      };
    }
  | { type: "round_start"; data: { debateId: string; round: number; totalRounds: number } }
  | {
      type: "panelist_thinking";
      data: { debateId: string; name: string; emoji: string; round: number };
    }
  | {
      type: "panelist_delta";
      data: { debateId: string; name: string; emoji: string; round: number; text: string };
    }
  | {
      type: "panelist_done";
      data: {
        debateId: string;
        name: string;
        emoji: string;
        round: number;
        content: string;
        model: string;
      };
    }
  | { type: "panelist_speaking"; data: { debateId: string; name: string; emoji: string } }
  | { type: "debate_complete"; data: { debateId: string; reached: boolean; summary: string } };

// ─── Reducer ──────────────────────────────────────────────────────────────────

const INITIAL_STATE: DebateState = {
  active: false,
  debateId: "",
  challenge: "",
  currentRound: 0,
  totalRounds: 0,
  panelists: [],
  consensusReached: null,
  consensusSummary: "",
};

function debateReducer(state: DebateState, event: TankEvent): DebateState {
  switch (event.type) {
    case "debate_start":
      return {
        ...INITIAL_STATE,
        active: true,
        debateId: event.data.debateId,
        challenge: event.data.challenge,
        totalRounds: event.data.rounds,
        panelists: event.data.panelists.map((p) => ({
          id: p.id ?? p.name.toLowerCase().split(" ")[0],
          name: p.name,
          emoji: p.emoji,
          model: p.model,
          status: "waiting",
          currentText: "",
          responses: [],
        })),
      };

    case "round_start":
      return {
        ...state,
        currentRound: event.data.round,
        panelists: state.panelists.map((p) => ({
          ...p,
          status: "waiting" as PanelistStatus,
          currentText: "",
        })),
      };

    case "panelist_thinking":
      return {
        ...state,
        panelists: state.panelists.map((p) =>
          p.name === event.data.name
            ? { ...p, status: "thinking" as PanelistStatus, currentText: "" }
            : p,
        ),
      };

    case "panelist_delta":
      return {
        ...state,
        panelists: state.panelists.map((p) =>
          p.name === event.data.name
            ? { ...p, status: "streaming" as PanelistStatus, currentText: event.data.text }
            : p,
        ),
      };

    case "panelist_done":
      return {
        ...state,
        panelists: state.panelists.map((p) =>
          p.name === event.data.name
            ? {
                ...p,
                status: "done" as PanelistStatus,
                currentText: event.data.content,
                model: event.data.model,
                responses: [
                  ...p.responses,
                  { round: event.data.round, content: event.data.content },
                ],
              }
            : p,
        ),
      };

    case "panelist_speaking":
      return {
        ...state,
        panelists: state.panelists.map((p) =>
          p.name === event.data.name ? { ...p, status: "speaking" as PanelistStatus } : p,
        ),
      };

    case "debate_complete":
      return {
        ...state,
        consensusReached: event.data.reached,
        consensusSummary: event.data.summary,
      };

    default:
      return state;
  }
}

// ─── Hook: useDebateState ────────────────────────────────────────────────────

export function useDebateState() {
  const [state, dispatch] = useReducer(debateReducer, INITIAL_STATE);

  useEffect(() => {
    const es = new EventSource("/api/think-tank/events");

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type && data.type !== "connected") {
          dispatch(data as TankEvent);
        }
      } catch {}
    };

    es.onerror = () => {
      // SSE will auto-reconnect
    };

    return () => es.close();
  }, []);

  return { state };
}

// ─── Panelist Card ──────────────────────────────────────────────────────────

const STATUS_COLORS: Record<PanelistStatus, string> = {
  waiting: "border-white/10 bg-white/[0.02]",
  thinking: "border-yellow-500/30 bg-yellow-500/[0.05]",
  streaming: "border-blue-500/30 bg-blue-500/[0.05]",
  done: "border-green-500/20 bg-green-500/[0.03]",
  speaking: "border-purple-500/30 bg-purple-500/[0.05]",
};

function PanelistCard({ panelist, round }: { panelist: PanelistState; round: number }) {
  const cardRef = useRef<HTMLDivElement>(null);

  // Auto-scroll card content as text streams in
  useEffect(() => {
    if (panelist.status === "streaming" && cardRef.current) {
      const el = cardRef.current.querySelector(".panelist-text");
      if (el) el.scrollTop = el.scrollHeight;
    }
  }, [panelist.currentText, panelist.status]);

  return (
    <div
      className={`rounded-xl border p-3 transition-all duration-300 flex flex-col min-h-0 h-full ${STATUS_COLORS[panelist.status]}`}
      ref={cardRef}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-2 flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-lg">{panelist.emoji}</span>
          <span className="text-white font-semibold text-sm">{panelist.name}</span>
          <span className="text-white/30 text-[10px] font-mono">{panelist.model}</span>
        </div>
        <div className="flex items-center gap-2">
          {panelist.status === "thinking" && <ThinkingDots />}
          {panelist.status === "speaking" && <SpeakerPulse />}
          {panelist.status === "done" && <span className="text-green-400/70 text-xs">done</span>}
          {panelist.status === "streaming" && (
            <span className="text-blue-400/70 text-xs animate-pulse">streaming</span>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {panelist.status === "waiting" && (
          <p className="text-white/30 text-sm italic">Waiting for turn...</p>
        )}

        {panelist.status === "thinking" && (
          <div className="flex items-center gap-1.5 text-white/40 text-sm">
            <span>Thinking</span>
            <ThinkingDots />
          </div>
        )}

        {(panelist.status === "streaming" ||
          panelist.status === "done" ||
          panelist.status === "speaking") &&
          panelist.currentText && (
            <div className="panelist-text text-white/80 text-sm leading-relaxed whitespace-pre-wrap">
              {panelist.currentText}
            </div>
          )}

        {/* Previous rounds (collapsed) */}
        {panelist.responses.length > 0 &&
          panelist.responses[panelist.responses.length - 1]?.round !== round && (
            <details className="mt-2">
              <summary className="text-white/30 text-xs cursor-pointer hover:text-white/50">
                {panelist.responses.length} previous response
                {panelist.responses.length > 1 ? "s" : ""}
              </summary>
              <div className="mt-2 space-y-2">
                {panelist.responses
                  .filter((r) => r.round !== round)
                  .map((r) => (
                    <div
                      key={r.round}
                      className="text-white/40 text-xs border-l-2 border-white/10 pl-3 max-h-[100px] overflow-y-auto"
                    >
                      <span className="text-white/50 font-mono">R{r.round}:</span>{" "}
                      {r.content.slice(0, 200)}
                      {r.content.length > 200 ? "..." : ""}
                    </div>
                  ))}
              </div>
            </details>
          )}
      </div>
    </div>
  );
}

// ─── Animated Indicators ──────────────────────────────────────────────────────

function ThinkingDots() {
  return (
    <span className="inline-flex gap-0.5">
      <span
        className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-bounce"
        style={{ animationDelay: "0ms" }}
      />
      <span
        className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-bounce"
        style={{ animationDelay: "150ms" }}
      />
      <span
        className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-bounce"
        style={{ animationDelay: "300ms" }}
      />
    </span>
  );
}

function SpeakerPulse() {
  return (
    <span className="inline-flex items-center gap-1 text-purple-400">
      <svg className="w-4 h-4 animate-pulse" fill="currentColor" viewBox="0 0 24 24">
        <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
      </svg>
    </span>
  );
}

// ─── Main DebatePanel (pure render — receives state as props) ────────────────

export function DebatePanel({ state }: { state: DebateState }) {
  if (!state.active) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-white/40">
        <span className="text-4xl mb-3">🧠</span>
        <p className="text-sm">Waiting for debate to start...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header: Challenge + Round progress */}
      <div className="flex-shrink-0 border-b border-white/10 p-4">
        <div className="p-3 rounded-lg bg-white/[0.03] border border-white/5">
          <p className="text-white/60 text-xs font-medium mb-1">Challenge</p>
          <p className="text-white/90 text-sm leading-relaxed line-clamp-3">{state.challenge}</p>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <span className="text-white/40 text-xs">
            Round {state.currentRound}/{state.totalRounds}
          </span>
          <div className="flex-1 flex gap-1">
            {Array.from({ length: state.totalRounds }, (_, i) => i + 1).map((r) => (
              <div
                key={r}
                className={`h-1 flex-1 rounded-full transition-all ${
                  r < state.currentRound
                    ? "bg-green-500/60"
                    : r === state.currentRound
                      ? "bg-blue-500/60 animate-pulse"
                      : "bg-white/10"
                }`}
              />
            ))}
          </div>
          {state.consensusReached !== null && (
            <span
              className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                state.consensusReached
                  ? "bg-green-500/20 text-green-300 border border-green-500/30"
                  : "bg-yellow-500/20 text-yellow-300 border border-yellow-500/30"
              }`}
            >
              {state.consensusReached ? "Consensus" : "Partial"}
            </span>
          )}
        </div>
      </div>

      {/* 2x2 Panelist Grid */}
      <div className="flex-1 min-h-0 grid grid-cols-2 grid-rows-2 gap-3 p-4">
        {state.panelists[0] && (
          <PanelistCard panelist={state.panelists[0]} round={state.currentRound} />
        )}
        {state.panelists[1] && (
          <PanelistCard panelist={state.panelists[1]} round={state.currentRound} />
        )}
        {state.panelists[2] && (
          <PanelistCard panelist={state.panelists[2]} round={state.currentRound} />
        )}
        {state.panelists[3] && (
          <PanelistCard panelist={state.panelists[3]} round={state.currentRound} />
        )}
      </div>

      {/* Consensus Footer */}
      {state.consensusReached !== null && state.consensusSummary && (
        <div className="flex-shrink-0 border-t border-white/10 px-5 py-3 bg-gray-800/30">
          <p className="text-white/60 text-xs font-medium mb-1">
            {state.consensusReached ? "Consensus Reached" : "Partial Agreement"}
          </p>
          <p className="text-white/80 text-sm">{state.consensusSummary}</p>
        </div>
      )}
    </div>
  );
}
