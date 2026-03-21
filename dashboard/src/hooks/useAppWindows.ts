import { useState, useCallback, useRef } from "react";

export interface AppWindowState {
  appId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  minimized: boolean;
  maximized: boolean;
}

interface UseAppWindowsReturn {
  windows: AppWindowState[];
  openApp: (appId: string) => void;
  closeApp: (appId: string) => void;
  minimizeApp: (appId: string) => void;
  restoreApp: (appId: string) => void;
  maximizeApp: (appId: string) => void;
  focusApp: (appId: string) => void;
  moveApp: (appId: string, x: number, y: number) => void;
  resizeApp: (appId: string, width: number, height: number) => void;
  closeAll: () => void;
}

const DEFAULT_WIDTH = 800;
const DEFAULT_HEIGHT = 600;
const CASCADE_OFFSET = 30;
const BASE_Z = 100;

export function useAppWindows(): UseAppWindowsReturn {
  const [windows, setWindows] = useState<AppWindowState[]>([]);
  const zCounter = useRef(BASE_Z);

  const getNextZ = useCallback(() => {
    zCounter.current += 1;
    return zCounter.current;
  }, []);

  const openApp = useCallback(
    (appId: string) => {
      setWindows((prev) => {
        // If already open, just focus it
        const existing = prev.find((w) => w.appId === appId);
        if (existing) {
          const newZ = zCounter.current + 1;
          zCounter.current = newZ;
          return prev.map((w) =>
            w.appId === appId ? { ...w, zIndex: newZ, minimized: false } : w,
          );
        }

        // Calculate cascade position
        const offset = prev.length * CASCADE_OFFSET;
        const x = 100 + (offset % 300);
        const y = 80 + (offset % 200);

        const newZ = getNextZ();

        return [
          ...prev,
          {
            appId,
            x,
            y,
            width: DEFAULT_WIDTH,
            height: DEFAULT_HEIGHT,
            zIndex: newZ,
            minimized: false,
            maximized: false,
          },
        ];
      });
    },
    [getNextZ],
  );

  const closeApp = useCallback((appId: string) => {
    setWindows((prev) => prev.filter((w) => w.appId !== appId));
  }, []);

  const minimizeApp = useCallback((appId: string) => {
    setWindows((prev) => prev.map((w) => (w.appId === appId ? { ...w, minimized: true } : w)));
  }, []);

  const restoreApp = useCallback(
    (appId: string) => {
      const newZ = getNextZ();
      setWindows((prev) =>
        prev.map((w) => (w.appId === appId ? { ...w, minimized: false, zIndex: newZ } : w)),
      );
    },
    [getNextZ],
  );

  const maximizeApp = useCallback(
    (appId: string) => {
      const newZ = getNextZ();
      setWindows((prev) =>
        prev.map((w) =>
          w.appId === appId ? { ...w, maximized: !w.maximized, zIndex: newZ, minimized: false } : w,
        ),
      );
    },
    [getNextZ],
  );

  const focusApp = useCallback(
    (appId: string) => {
      const newZ = getNextZ();
      setWindows((prev) => prev.map((w) => (w.appId === appId ? { ...w, zIndex: newZ } : w)));
    },
    [getNextZ],
  );

  const moveApp = useCallback((appId: string, x: number, y: number) => {
    setWindows((prev) => prev.map((w) => (w.appId === appId ? { ...w, x, y } : w)));
  }, []);

  const resizeApp = useCallback((appId: string, width: number, height: number) => {
    setWindows((prev) => prev.map((w) => (w.appId === appId ? { ...w, width, height } : w)));
  }, []);

  const closeAll = useCallback(() => {
    setWindows([]);
  }, []);

  return {
    windows,
    openApp,
    closeApp,
    minimizeApp,
    restoreApp,
    maximizeApp,
    focusApp,
    moveApp,
    resizeApp,
    closeAll,
  };
}
