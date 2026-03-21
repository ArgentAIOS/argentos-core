import { motion, AnimatePresence } from "framer-motion";
import { Boxes } from "lucide-react";
import type { ForgeApp } from "../hooks/useApps";
import type { AppWindowState } from "../hooks/useAppWindows";

interface AppDockProps {
  windows: AppWindowState[];
  apps: ForgeApp[];
  onRestore: (appId: string) => void;
  onFocus: (appId: string) => void;
}

function sanitizeSvg(svg: string): string {
  return svg
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/on\w+\s*=\s*"[^"]*"/gi, "")
    .replace(/on\w+\s*=\s*'[^']*'/gi, "")
    .replace(/javascript\s*:/gi, "")
    .replace(/data\s*:/gi, "");
}

export function AppDock({ windows, apps, onRestore, onFocus }: AppDockProps) {
  if (windows.length === 0) return null;

  return (
    <div className="absolute bottom-0 left-0 right-0 h-12 glass-panel rounded-t-2xl flex items-center justify-center gap-3 px-4 z-[250]">
      <AnimatePresence>
        {windows.map((win) => {
          const app = apps.find((a) => a.id === win.appId);
          if (!app) return null;

          const isMinimized = win.minimized;
          const isActive = !win.minimized;

          return (
            <motion.button
              key={win.appId}
              layoutId={`dock-${win.appId}`}
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0, opacity: 0 }}
              onClick={() => (isMinimized ? onRestore(win.appId) : onFocus(win.appId))}
              className="relative flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-white/10 transition-colors"
              title={app.name}
            >
              {/* App icon */}
              {app.icon ? (
                <div
                  className="w-6 h-6 flex-shrink-0"
                  dangerouslySetInnerHTML={{ __html: sanitizeSvg(app.icon) }}
                />
              ) : (
                <div
                  className="w-6 h-6 rounded flex items-center justify-center flex-shrink-0"
                  style={{
                    backgroundColor: `hsl(${hashString(app.name) % 360}, 60%, 40%)`,
                  }}
                >
                  <Boxes className="w-3.5 h-3.5 text-white/80" />
                </div>
              )}

              <span className="text-xs text-white/70 max-w-[80px] truncate hidden sm:block">
                {app.name}
              </span>

              {/* Status dot */}
              <div
                className={`absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full ${
                  isActive ? "bg-green-400" : "bg-yellow-400"
                }`}
              />
            </motion.button>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}
