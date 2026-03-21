import { motion, AnimatePresence } from "framer-motion";
import { X, Bell, AlertTriangle, Info, CheckCircle, Trash2, Check } from "lucide-react";
import { useState } from "react";

export type AlertPriority = "info" | "warning" | "urgent";

export interface Alert {
  id: string;
  message: string;
  priority: AlertPriority;
  timestamp: Date;
  read: boolean;
  source?: string; // e.g., 'email', 'silver', 'calendar'
  action?: {
    label: string;
    onClick: () => void;
  };
}

interface AlertsModalProps {
  isOpen: boolean;
  onClose: () => void;
  alerts: Alert[];
  onMarkRead: (id: string) => void;
  onMarkAllRead: () => void;
  onDelete: (id: string) => void;
  onClearAll: () => void;
}

const priorityConfig = {
  info: {
    icon: Info,
    color: "text-blue-400",
    bg: "bg-blue-500/10",
    border: "border-blue-500/30",
  },
  warning: {
    icon: AlertTriangle,
    color: "text-yellow-400",
    bg: "bg-yellow-500/10",
    border: "border-yellow-500/30",
  },
  urgent: {
    icon: Bell,
    color: "text-red-400",
    bg: "bg-red-500/10",
    border: "border-red-500/30",
  },
};

export function AlertsModal({
  isOpen,
  onClose,
  alerts,
  onMarkRead,
  onMarkAllRead,
  onDelete,
  onClearAll,
}: AlertsModalProps) {
  const unreadCount = alerts.filter((a) => !a.read).length;
  const sortedAlerts = [...alerts].sort((a, b) => {
    // Unread first, then by timestamp
    if (a.read !== b.read) return a.read ? 1 : -1;
    return b.timestamp.getTime() - a.timestamp.getTime();
  });

  const formatTime = (date: Date) => {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

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
            className="bg-gray-900 rounded-2xl p-6 w-[500px] max-w-[90vw] max-h-[85vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4 flex-shrink-0">
              <div className="flex items-center gap-3">
                <h3 className="text-white font-semibold text-lg">Alerts</h3>
                {unreadCount > 0 && (
                  <span className="px-2 py-0.5 bg-pink-500/20 text-pink-400 text-xs rounded-full">
                    {unreadCount} new
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {alerts.length > 0 && (
                  <>
                    <button
                      onClick={onMarkAllRead}
                      className="px-3 py-1.5 text-xs text-white/50 hover:text-white/70 hover:bg-white/5 rounded-lg transition-colors"
                    >
                      Mark all read
                    </button>
                    <button
                      onClick={onClearAll}
                      className="px-3 py-1.5 text-xs text-red-400/70 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                    >
                      Clear all
                    </button>
                  </>
                )}
                <button
                  onClick={onClose}
                  className="p-1.5 rounded-lg hover:bg-white/10 text-white/50"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto">
              {alerts.length === 0 ? (
                <div className="text-center py-12">
                  <CheckCircle className="w-12 h-12 mx-auto mb-3 text-green-400/30" />
                  <div className="text-white/50">All caught up!</div>
                  <div className="text-white/30 text-sm mt-1">No alerts right now</div>
                </div>
              ) : (
                <div className="space-y-2">
                  {sortedAlerts.map((alert) => {
                    const config = priorityConfig[alert.priority];
                    const Icon = config.icon;

                    return (
                      <motion.div
                        key={alert.id}
                        layout
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, x: -20 }}
                        className={`rounded-xl p-4 border transition-all ${config.bg} ${config.border} ${
                          alert.read ? "opacity-60" : ""
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <Icon className={`w-5 h-5 flex-shrink-0 mt-0.5 ${config.color}`} />
                          <div className="flex-1 min-w-0">
                            <p className={`text-sm ${alert.read ? "text-white/60" : "text-white"}`}>
                              {alert.message}
                            </p>
                            {alert.action && (
                              <button
                                onClick={() => {
                                  alert.action!.onClick();
                                  onMarkRead(alert.id);
                                }}
                                className="mt-2 px-3 py-1 bg-purple-500/30 hover:bg-purple-500/40 text-purple-300 rounded-lg text-xs font-medium transition-all"
                              >
                                {alert.action.label}
                              </button>
                            )}
                            <div className="flex items-center gap-3 mt-2">
                              <span className="text-xs text-white/40">
                                {formatTime(alert.timestamp)}
                              </span>
                              {alert.source && (
                                <span className="text-xs text-white/30 px-2 py-0.5 bg-white/5 rounded">
                                  {alert.source}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="flex gap-1 flex-shrink-0">
                            {!alert.read && (
                              <button
                                onClick={() => onMarkRead(alert.id)}
                                className="p-1.5 rounded-lg hover:bg-white/10 text-white/40 hover:text-white/70 transition-colors"
                                title="Mark as read"
                              >
                                <Check className="w-4 h-4" />
                              </button>
                            )}
                            <button
                              onClick={() => onDelete(alert.id)}
                              className="p-1.5 rounded-lg hover:bg-red-500/20 text-white/40 hover:text-red-400 transition-colors"
                              title="Delete"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// Storage key for persisting alerts
const STORAGE_KEY = "argent-alerts";

// Hook for managing alerts
export function useAlerts() {
  const [alerts, setAlerts] = useState<Alert[]>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        return parsed.map((a: any) => ({
          ...a,
          timestamp: new Date(a.timestamp),
        }));
      }
    } catch (e) {
      console.error("Failed to load alerts:", e);
    }
    return [];
  });

  // Persist to localStorage
  const saveAlerts = (newAlerts: Alert[]) => {
    setAlerts(newAlerts);
    try {
      // Strip non-serializable action callbacks before persisting
      const serializable = newAlerts.map(({ action, ...rest }) => rest);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(serializable));
    } catch (e) {
      console.error("Failed to save alerts:", e);
    }
  };

  const addAlert = (
    message: string,
    priority: AlertPriority = "info",
    source?: string,
    action?: { label: string; onClick: () => void },
  ) => {
    const newAlert: Alert = {
      id: `alert-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      message,
      priority,
      timestamp: new Date(),
      read: false,
      source,
      action,
    };
    saveAlerts([newAlert, ...alerts]);
    return newAlert.id;
  };

  const markRead = (id: string) => {
    saveAlerts(alerts.map((a) => (a.id === id ? { ...a, read: true } : a)));
  };

  const markAllRead = () => {
    saveAlerts(alerts.map((a) => ({ ...a, read: true })));
  };

  const deleteAlert = (id: string) => {
    saveAlerts(alerts.filter((a) => a.id !== id));
  };

  const clearAll = () => {
    saveAlerts([]);
  };

  const unreadCount = alerts.filter((a) => !a.read).length;

  return {
    alerts,
    unreadCount,
    addAlert,
    markRead,
    markAllRead,
    deleteAlert,
    clearAll,
  };
}
