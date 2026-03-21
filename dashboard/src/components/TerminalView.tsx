/**
 * TerminalView — xterm.js component for live PTY terminals.
 *
 * Renders inside the doc panel (CanvasPanel) as a terminal tab.
 * Streams I/O via gateway WebSocket events.
 *
 * On mount: subscribes to live events (queued), loads the existing buffer
 * via terminal.read, writes it to xterm, then flushes queued events using
 * offset-based dedup to avoid duplicates.
 */

import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useEffect, useRef, useCallback } from "react";
import "@xterm/xterm/css/xterm.css";

interface TerminalViewProps {
  terminalId: string;
  gateway: {
    request: <T = unknown>(method: string, params?: Record<string, unknown>) => Promise<T>;
    on: (event: string, handler: (payload: unknown) => void) => () => void;
    connected: boolean;
  };
  isActive: boolean;
}

interface TerminalEvent {
  id?: string;
  stream?: string;
  chunk?: string;
  offset?: number;
  code?: number;
}

export function TerminalView({ terminalId, gateway, isActive }: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const mountedRef = useRef(false);

  // Offset watermark: only write live chunks with offset >= this value
  const watermarkRef = useRef<number>(-1); // -1 = buffer not yet loaded (queue events)

  // Keep gateway in a ref so effects don't re-run when the object reference changes
  const gatewayRef = useRef(gateway);
  gatewayRef.current = gateway;

  // Queue for events that arrive before the initial buffer is loaded
  const eventQueueRef = useRef<TerminalEvent[]>([]);

  // Initialize terminal — only depends on terminalId (stable string)
  useEffect(() => {
    if (!containerRef.current || mountedRef.current) return;
    mountedRef.current = true;
    watermarkRef.current = -1;
    eventQueueRef.current = [];

    const terminal = new Terminal({
      cursorBlink: true,
      cursorStyle: "block",
      fontSize: 14,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, Monaco, monospace",
      lineHeight: 1.2,
      theme: {
        background: "#0f172a",
        foreground: "#e2e8f0",
        cursor: "#a855f7",
        cursorAccent: "#0f172a",
        selectionBackground: "#6366f180",
        black: "#1e293b",
        red: "#f87171",
        green: "#4ade80",
        yellow: "#fbbf24",
        blue: "#60a5fa",
        magenta: "#c084fc",
        cyan: "#22d3ee",
        white: "#e2e8f0",
        brightBlack: "#475569",
        brightRed: "#fca5a5",
        brightGreen: "#86efac",
        brightYellow: "#fde68a",
        brightBlue: "#93c5fd",
        brightMagenta: "#d8b4fe",
        brightCyan: "#67e8f9",
        brightWhite: "#f8fafc",
      },
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(containerRef.current);

    // Robust fit: retry until the container has real dimensions
    let fitAttempts = 0;
    const tryFit = () => {
      try {
        fitAddon.fit();
        fitAttempts++;
        if (fitAttempts < 5 && containerRef.current) {
          const rect = containerRef.current.getBoundingClientRect();
          if (rect.width < 10 || rect.height < 10) {
            setTimeout(tryFit, 100);
          }
        }
      } catch {
        if (fitAttempts < 5) setTimeout(tryFit, 100);
      }
    };
    requestAnimationFrame(tryFit);

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    // Load existing buffer, then flush queued events
    gatewayRef.current
      .request<{ buffer?: string; offset?: number; exited?: boolean; exitCode?: number }>(
        "terminal.read",
        { id: terminalId },
      )
      .then((res) => {
        if (!terminalRef.current) return;
        const bufferOffset = res?.offset ?? 0;
        // Write the full buffer (everything that happened before mount)
        if (res?.buffer) {
          terminalRef.current.write(res.buffer);
        }
        // Set watermark — live events at or after this offset get written
        watermarkRef.current = bufferOffset;
        // Flush queued events that are beyond the buffer
        for (const evt of eventQueueRef.current) {
          writeEvent(terminalRef.current, evt, watermarkRef);
        }
        eventQueueRef.current = [];
      })
      .catch((err) => {
        console.warn("[Terminal] Failed to load buffer, falling back to live-only:", err);
        // Fall back: accept all live events from now on
        watermarkRef.current = 0;
        if (terminalRef.current) {
          for (const evt of eventQueueRef.current) {
            writeEvent(terminalRef.current, evt, watermarkRef);
          }
        }
        eventQueueRef.current = [];
      });

    // User input → gateway
    terminal.onData((data) => {
      gatewayRef.current.request("terminal.write", { id: terminalId, data }).catch((err) => {
        console.warn("[Terminal] Write failed:", err);
      });
    });

    // Resize → gateway
    terminal.onResize(({ cols, rows }) => {
      gatewayRef.current.request("terminal.resize", { id: terminalId, cols, rows }).catch((err) => {
        console.warn("[Terminal] Resize failed:", err);
      });
    });

    return () => {
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
      mountedRef.current = false;
      watermarkRef.current = -1;
      eventQueueRef.current = [];
    };
  }, [terminalId]); // gateway intentionally excluded — accessed via ref

  // Subscribe to terminal events from gateway
  useEffect(() => {
    if (!gatewayRef.current.connected) return;

    const unsub = gatewayRef.current.on("terminal", (payload: unknown) => {
      const event = payload as TerminalEvent;
      if (event.id !== terminalId) return;

      // If buffer hasn't loaded yet, queue the event
      if (watermarkRef.current < 0) {
        eventQueueRef.current.push(event);
        return;
      }

      if (terminalRef.current) {
        writeEvent(terminalRef.current, event, watermarkRef);
      }
    });

    return () => {
      unsub();
    };
  }, [gateway.connected, terminalId]); // re-subscribe only on connect/disconnect

  // Re-fit when tab becomes active or window resizes
  const handleFit = useCallback(() => {
    if (fitAddonRef.current && isActive) {
      try {
        fitAddonRef.current.fit();
      } catch {
        // ignore if container isn't visible
      }
    }
  }, [isActive]);

  useEffect(() => {
    if (isActive) {
      const timer = setTimeout(handleFit, 50);
      return () => clearTimeout(timer);
    }
  }, [isActive, handleFit]);

  // ResizeObserver for container changes
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver(() => {
      handleFit();
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [handleFit]);

  // Focus terminal when tab becomes active
  useEffect(() => {
    if (isActive && terminalRef.current) {
      terminalRef.current.focus();
    }
  }, [isActive]);

  return (
    <div
      ref={containerRef}
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "#0f172a",
      }}
    />
  );
}

/** Write a terminal event to xterm, respecting the offset watermark to avoid duplicates. */
function writeEvent(
  terminal: Terminal,
  event: TerminalEvent,
  watermarkRef: React.MutableRefObject<number>,
): void {
  if (event.stream === "data" && event.chunk) {
    const chunkOffset = event.offset ?? 0;
    const chunkEnd = chunkOffset + event.chunk.length;
    // Skip chunks fully covered by the buffer we already loaded
    if (chunkEnd <= watermarkRef.current) return;
    // Partial overlap: trim the already-written prefix
    if (chunkOffset < watermarkRef.current) {
      const skip = watermarkRef.current - chunkOffset;
      terminal.write(event.chunk.slice(skip));
    } else {
      terminal.write(event.chunk);
    }
    watermarkRef.current = Math.max(watermarkRef.current, chunkEnd);
  }

  if (event.stream === "exit") {
    terminal.write(`\r\n\x1b[90m--- Process exited (code: ${event.code ?? "?"}) ---\x1b[0m\r\n`);
  }
}
