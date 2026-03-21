import { motion, AnimatePresence } from "framer-motion";
import { Minus, Maximize2, Minimize2, X, GripVertical } from "lucide-react";
import { useState, useCallback, useRef, useMemo } from "react";
import type { ForgeApp } from "../hooks/useApps";
import type { AppWindowState } from "../hooks/useAppWindows";
import { buildSandboxSrcDoc } from "../utils/sandboxSrcDoc";

interface AppWindowProps {
  app: ForgeApp;
  windowState: AppWindowState;
  onClose: (appId: string) => void;
  onMinimize: (appId: string) => void;
  onMaximize: (appId: string) => void;
  onFocus: (appId: string) => void;
  onMove: (appId: string, x: number, y: number) => void;
  onResize: (appId: string, width: number, height: number) => void;
}

const MIN_WIDTH = 320;
const MIN_HEIGHT = 240;

export function AppWindow({
  app,
  windowState,
  onClose,
  onMinimize,
  onMaximize,
  onFocus,
  onMove,
  onResize,
}: AppWindowProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  const resizeStart = useRef({ x: 0, y: 0, width: 0, height: 0 });
  const appSrcDoc = useMemo(() => buildSandboxSrcDoc(app.code, app.name), [app.code, app.name]);

  // Drag handlers
  const handleDragStart = useCallback(
    (e: React.PointerEvent) => {
      if ((e.target as HTMLElement).closest("button")) return;
      e.preventDefault();
      setIsDragging(true);
      dragOffset.current = {
        x: e.clientX - windowState.x,
        y: e.clientY - windowState.y,
      };
      onFocus(windowState.appId);
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [windowState.x, windowState.y, windowState.appId, onFocus],
  );

  const handleDragMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isDragging) return;
      const newX = e.clientX - dragOffset.current.x;
      const newY = Math.max(0, e.clientY - dragOffset.current.y);
      onMove(windowState.appId, newX, newY);
    },
    [isDragging, windowState.appId, onMove],
  );

  const handleDragEnd = useCallback(() => {
    setIsDragging(false);
  }, []);

  // Resize handlers
  const handleResizeStart = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsResizing(true);
      resizeStart.current = {
        x: e.clientX,
        y: e.clientY,
        width: windowState.width,
        height: windowState.height,
      };
      onFocus(windowState.appId);
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [windowState.width, windowState.height, windowState.appId, onFocus],
  );

  const handleResizeMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isResizing) return;
      const dx = e.clientX - resizeStart.current.x;
      const dy = e.clientY - resizeStart.current.y;
      const newWidth = Math.max(MIN_WIDTH, resizeStart.current.width + dx);
      const newHeight = Math.max(MIN_HEIGHT, resizeStart.current.height + dy);
      onResize(windowState.appId, newWidth, newHeight);
    },
    [isResizing, windowState.appId, onResize],
  );

  const handleResizeEnd = useCallback(() => {
    setIsResizing(false);
  }, []);

  // Maximized state
  const style = windowState.maximized
    ? { left: 0, top: 0, width: "100vw", height: "100vh", zIndex: windowState.zIndex }
    : {
        left: windowState.x,
        top: windowState.y,
        width: windowState.width,
        height: windowState.height,
        zIndex: windowState.zIndex,
      };

  if (windowState.minimized) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.8, opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="fixed rounded-xl overflow-hidden shadow-2xl border border-white/10 flex flex-col"
        style={style}
        onPointerDown={() => onFocus(windowState.appId)}
      >
        {/* Title Bar */}
        <div
          className="glass-panel h-10 flex items-center justify-between px-3 cursor-move select-none shrink-0"
          onPointerDown={handleDragStart}
          onPointerMove={handleDragMove}
          onPointerUp={handleDragEnd}
        >
          <div className="flex items-center gap-2 min-w-0">
            {app.icon ? (
              <div
                className="w-5 h-5 flex-shrink-0"
                dangerouslySetInnerHTML={{ __html: sanitizeSvg(app.icon) }}
              />
            ) : (
              <div className="w-5 h-5 rounded bg-purple-500/30 flex items-center justify-center flex-shrink-0">
                <span className="text-[10px] text-purple-300">{app.name[0]}</span>
              </div>
            )}
            <span className="text-sm text-white/80 truncate">{app.name}</span>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={() => onMinimize(windowState.appId)}
              className="p-1 rounded hover:bg-white/10 text-white/50 hover:text-white transition-colors"
              title="Minimize"
            >
              <Minus className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => onMaximize(windowState.appId)}
              className="p-1 rounded hover:bg-white/10 text-white/50 hover:text-white transition-colors"
              title={windowState.maximized ? "Restore" : "Maximize"}
            >
              {windowState.maximized ? (
                <Minimize2 className="w-3.5 h-3.5" />
              ) : (
                <Maximize2 className="w-3.5 h-3.5" />
              )}
            </button>
            <button
              onClick={() => onClose(windowState.appId)}
              className="p-1 rounded hover:bg-red-500/30 text-white/50 hover:text-red-400 transition-colors"
              title="Close"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Content - sandboxed iframe */}
        <div className="flex-1 bg-white relative">
          <iframe
            srcDoc={appSrcDoc}
            sandbox="allow-scripts allow-forms allow-same-origin"
            className="w-full h-full border-0"
            title={app.name}
            style={{
              pointerEvents: isDragging || isResizing ? "none" : "auto",
            }}
          />
        </div>

        {/* Resize grip (bottom-right) */}
        {!windowState.maximized && (
          <div
            className="absolute bottom-0 right-0 w-5 h-5 cursor-nwse-resize z-10"
            onPointerDown={handleResizeStart}
            onPointerMove={handleResizeMove}
            onPointerUp={handleResizeEnd}
          >
            <GripVertical className="w-4 h-4 text-white/20 rotate-[-45deg] absolute bottom-0.5 right-0.5" />
          </div>
        )}
      </motion.div>
    </AnimatePresence>
  );
}

// SVG sanitizer - strips dangerous attributes and elements
function sanitizeSvg(svg: string): string {
  return svg
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/on\w+\s*=\s*"[^"]*"/gi, "")
    .replace(/on\w+\s*=\s*'[^']*'/gi, "")
    .replace(/javascript\s*:/gi, "")
    .replace(/data\s*:/gi, "");
}
