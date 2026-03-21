import { motion } from "framer-motion";
import { Activity, Mail, Calendar, MessageSquare, Zap, Check } from "lucide-react";

export type LogEntryType = "info" | "email" | "calendar" | "message" | "task" | "success";

export interface LogEntry {
  id: string;
  type: LogEntryType;
  message: string;
  timestamp: Date;
  details?: string;
}

interface ActivityLogProps {
  entries: LogEntry[];
}

const typeIcons = {
  info: Activity,
  email: Mail,
  calendar: Calendar,
  message: MessageSquare,
  task: Zap,
  success: Check,
};

const typeColors = {
  info: "text-blue-400 bg-blue-400/10",
  email: "text-pink-400 bg-pink-400/10",
  calendar: "text-orange-400 bg-orange-400/10",
  message: "text-green-400 bg-green-400/10",
  task: "text-purple-400 bg-purple-400/10",
  success: "text-emerald-400 bg-emerald-400/10",
};

function formatTime(date: Date): string {
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export function ActivityLog({ entries }: ActivityLogProps) {
  return (
    <div className="glass-panel rounded-2xl p-4 h-full flex flex-col">
      <h2 className="text-white/90 font-semibold text-lg mb-4 flex items-center gap-2">
        <Activity className="w-5 h-5 text-blue-400" />
        Activity
      </h2>

      <div className="flex-1 overflow-y-auto space-y-2">
        {entries.map((entry, index) => {
          const Icon = typeIcons[entry.type];
          const colorClass = typeColors[entry.type];

          return (
            <motion.div
              key={entry.id}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.05 }}
              className="flex gap-3 p-2"
            >
              <div className={`p-2 rounded-lg ${colorClass} shrink-0`}>
                <Icon className="w-4 h-4" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-white/80 text-sm">{entry.message}</p>
                {entry.details && (
                  <p className="text-white/40 text-xs mt-0.5 truncate">{entry.details}</p>
                )}
              </div>
              <span className="text-white/30 text-xs shrink-0">{formatTime(entry.timestamp)}</span>
            </motion.div>
          );
        })}

        {entries.length === 0 && (
          <div className="text-white/40 text-sm text-center py-8">No activity yet</div>
        )}
      </div>
    </div>
  );
}
