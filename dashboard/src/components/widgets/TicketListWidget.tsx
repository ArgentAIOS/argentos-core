import { WidgetContainer } from "./WidgetContainer";

// Placeholder - ready for real ticketing system integration
interface Ticket {
  id: string;
  title: string;
  priority: "low" | "medium" | "high" | "urgent";
  status: "open" | "in-progress" | "waiting";
  customer?: string;
}

// Mock data - replace with API call later
const mockTickets: Ticket[] = [
  {
    id: "T-1234",
    title: "Server backup failing",
    priority: "urgent",
    status: "open",
    customer: "Acme Corp",
  },
  {
    id: "T-1235",
    title: "Email sync issue",
    priority: "high",
    status: "in-progress",
    customer: "TechStart",
  },
  {
    id: "T-1236",
    title: "Password reset request",
    priority: "medium",
    status: "waiting",
    customer: "BuildCo",
  },
  {
    id: "T-1237",
    title: "Printer offline",
    priority: "low",
    status: "open",
    customer: "Local Shop",
  },
];

const priorityColors = {
  urgent: "text-red-400 bg-red-500/20",
  high: "text-orange-400 bg-orange-500/20",
  medium: "text-yellow-400 bg-yellow-500/20",
  low: "text-blue-400 bg-blue-500/20",
};

const statusIcons = {
  open: "🔴",
  "in-progress": "🟡",
  waiting: "🔵",
};

export function TicketListWidget() {
  // TODO: Replace with real API call
  // const { tickets, loading } = useTickets()
  const tickets = mockTickets;
  const loading = false;

  if (loading) {
    return (
      <WidgetContainer title="My Tickets" className="h-full">
        <div className="flex items-center justify-center h-full text-white/30 text-sm">
          Loading tickets...
        </div>
      </WidgetContainer>
    );
  }

  return (
    <WidgetContainer title="My Tickets" className="h-full">
      {tickets.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-full text-white/30 text-sm">
          <svg className="w-8 h-8 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
          <span>No open tickets</span>
        </div>
      ) : (
        <div className="space-y-2 overflow-y-auto max-h-full">
          {tickets.map((ticket) => (
            <div
              key={ticket.id}
              className="p-2 rounded bg-white/5 hover:bg-white/10 transition-colors border border-white/10 cursor-pointer"
            >
              <div className="flex items-start gap-2">
                <span className="text-xs mt-0.5">{statusIcons[ticket.status]}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-white/50 text-xs font-mono">{ticket.id}</span>
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase ${priorityColors[ticket.priority]}`}
                    >
                      {ticket.priority}
                    </span>
                  </div>
                  <div className="text-white text-sm font-medium truncate">{ticket.title}</div>
                  {ticket.customer && (
                    <div className="text-white/50 text-xs mt-0.5 truncate">{ticket.customer}</div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </WidgetContainer>
  );
}
