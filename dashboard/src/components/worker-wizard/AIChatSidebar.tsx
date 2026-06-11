import { Send, Bot, User, Sparkles, Check } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import type { WizardState, WizardStep } from "./types";

interface AIChatSidebarProps {
  state: WizardState;
  currentStep: WizardStep;
  gatewayRequest: <T = unknown>(
    method: string,
    params?: Record<string, unknown>,
    opts?: { timeoutMs?: number },
  ) => Promise<T>;
  onApplySuggestion: (patch: Partial<WizardState>) => void;
}

interface ChatMsg {
  role: "user" | "assistant";
  content: string;
  suggestion?: Partial<WizardState>;
  applied?: boolean;
}

function tryParseSuggestion(text: string, step: WizardStep): Partial<WizardState> | undefined {
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return undefined;
    }
    const parsed = JSON.parse(jsonMatch[0]);

    // Map parsed fields to wizard state patches based on current step
    if (step === "identity" && (parsed.displayName || parsed.role || parsed.team)) {
      return {
        identity: {
          displayName: parsed.displayName || "",
          agentId: parsed.agentId || "",
          role: parsed.role || "custom",
          customRole: parsed.customRole || "",
          team: parsed.team || "",
          emoji: parsed.emoji || "",
        },
      };
    }
    if (step === "boundaries" && (parsed.objective || parsed.neverDo || parsed.allowedActions)) {
      return {
        boundaries: {
          objective: parsed.objective || "",
          neverDo: parsed.neverDo || [],
          allowedActions: parsed.allowedActions || [],
          requiresHumanApproval: parsed.requiresHumanApproval || [],
          escalation: parsed.escalation || {
            sentimentThreshold: 0.3,
            maxAttempts: 3,
            alwaysEscalate: [],
          },
        },
      };
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export function AIChatSidebar({
  state,
  currentStep,
  gatewayRequest,
  onApplySuggestion,
}: AIChatSidebarProps) {
  const [messages, setMessages] = useState<ChatMsg[]>([
    {
      role: "assistant",
      content: "I'll help you set up your new worker. What kind of work will they do?",
    },
  ]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  function applyAndMark(index: number, suggestion: Partial<WizardState>) {
    onApplySuggestion(suggestion);
    setMessages((prev) => prev.map((m, i) => (i === index ? { ...m, applied: true } : m)));
  }

  async function sendMessage() {
    const text = input.trim();
    if (!text || sending) {
      return;
    }

    setInput("");
    const userMsg: ChatMsg = { role: "user", content: text };
    setMessages((prev) => [...prev, userMsg]);
    setSending(true);

    try {
      const ctx = [
        `[WIZARD_ASSIST] Step: ${currentStep}`,
        state.identity.displayName && `Name: ${state.identity.displayName}`,
        state.identity.role !== "custom" && `Role: ${state.identity.role}`,
        state.boundaries.objective && `Objective: ${state.boundaries.objective}`,
        `Question: ${text}`,
      ]
        .filter(Boolean)
        .join("\n");

      const response = await gatewayRequest<{ text?: string; response?: string }>(
        "chat",
        {
          message: ctx,
          systemHint:
            "You are an AI workforce configuration assistant. Help the user configure their new agent worker. Be concise. If you suggest specific values, include them as a JSON object so they can be applied directly.",
        },
        { timeoutMs: 30000 },
      );

      const reply =
        response?.text ||
        response?.response ||
        "I couldn't generate a suggestion. Try being more specific about what you need.";
      const suggestion = tryParseSuggestion(reply, currentStep);
      setMessages((prev) => [...prev, { role: "assistant", content: reply, suggestion }]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content:
            "Sorry, I couldn't connect to the AI. The wizard works fully without me — just fill in the fields manually.",
        },
      ]);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="h-full bg-[#0d0d1a] border border-white/10 border-l-0 rounded-r-2xl flex flex-col">
      {/* Header */}
      <div className="px-4 py-3 border-b border-white/5 flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-purple-400" />
        <span className="text-white/70 text-sm font-medium">AI Assistant</span>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3">
        {messages.map((msg, i) => (
          <div key={i}>
            <div className={`flex gap-2 ${msg.role === "user" ? "flex-row-reverse" : ""}`}>
              <div
                className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${
                  msg.role === "assistant" ? "bg-purple-600/20" : "bg-white/10"
                }`}
              >
                {msg.role === "assistant" ? (
                  <Bot className="w-3.5 h-3.5 text-purple-400" />
                ) : (
                  <User className="w-3.5 h-3.5 text-white/40" />
                )}
              </div>
              <div
                className={`max-w-[230px] rounded-lg px-3 py-2 text-xs leading-relaxed ${
                  msg.role === "assistant"
                    ? "bg-white/5 text-white/70 border border-white/5"
                    : "bg-purple-600/20 text-purple-200"
                }`}
              >
                {msg.content}
              </div>
            </div>
            {/* Apply button for suggestions */}
            {msg.suggestion && !msg.applied && (
              <div className="ml-8 mt-1">
                <button
                  onClick={() => applyAndMark(i, msg.suggestion!)}
                  className="flex items-center gap-1 px-2 py-1 text-[10px] bg-purple-600/20 hover:bg-purple-600/30 text-purple-300 rounded border border-purple-500/20 transition-colors"
                >
                  <Sparkles className="w-2.5 h-2.5" />
                  Apply Suggestion
                </button>
              </div>
            )}
            {msg.applied && (
              <div className="ml-8 mt-1 flex items-center gap-1 text-[10px] text-green-400">
                <Check className="w-2.5 h-2.5" />
                Applied
              </div>
            )}
          </div>
        ))}
        {sending && (
          <div className="flex gap-2">
            <div className="w-6 h-6 rounded-full bg-purple-600/20 flex items-center justify-center">
              <Bot className="w-3.5 h-3.5 text-purple-400" />
            </div>
            <div className="bg-white/5 rounded-lg px-3 py-2 border border-white/5">
              <div className="flex gap-1">
                <div className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-bounce" />
                <div className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-bounce [animation-delay:0.1s]" />
                <div className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-bounce [animation-delay:0.2s]" />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="p-3 border-t border-white/5">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void sendMessage();
              }
            }}
            placeholder="Ask about roles, policies..."
            disabled={sending}
            className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-white text-xs placeholder-white/20 focus:border-purple-500/50 focus:outline-none disabled:opacity-50"
          />
          <button
            onClick={sendMessage}
            disabled={!input.trim() || sending}
            className="p-1.5 bg-purple-600 hover:bg-purple-500 disabled:bg-white/10 disabled:text-white/30 text-white rounded-lg transition-colors"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
