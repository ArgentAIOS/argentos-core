import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { themes, getThemeById, DEFAULT_THEME_ID, type Theme } from "./themes";

const STORAGE_KEY = "argent-theme";

interface ThemeContextValue {
  /** The currently active theme. */
  theme: Theme;
  /** Switch to a different built-in theme by id. */
  setTheme: (id: string) => void;
  /** All available themes. */
  themes: Theme[];
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * Applies the given theme's CSS variables to `document.documentElement` and
 * persists the selection to localStorage.
 */
function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  for (const [key, value] of Object.entries(theme.variables)) {
    root.style.setProperty(key, value);
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeId, setThemeId] = useState<string>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) || DEFAULT_THEME_ID;
    } catch {
      return DEFAULT_THEME_ID;
    }
  });

  const theme = getThemeById(themeId) ?? themes[0];

  // Apply CSS variables whenever the theme changes.
  useEffect(() => {
    applyTheme(theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme.id);
    } catch {
      // localStorage may be unavailable (e.g. private browsing quota exceeded)
    }
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme: setThemeId, themes }}>
      {children}
    </ThemeContext.Provider>
  );
}

/**
 * Hook to access the current theme and the theme-switching function.
 * Must be used within a `<ThemeProvider>`.
 */
export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used within a <ThemeProvider>");
  }
  return ctx;
}
