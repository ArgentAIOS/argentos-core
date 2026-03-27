/**
 * Built-in ArgentOS dashboard themes.
 *
 * Each theme maps shadcn-style CSS variable names to HSL values (without the
 * `hsl()` wrapper). Components can consume them as `hsl(var(--primary))` etc.
 * The ThemeProvider applies these to `document.documentElement` at runtime.
 */

export interface Theme {
  id: string;
  name: string;
  description: string;
  variables: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Midnight — the signature ArgentOS look (deep navy + cyan accents)
// ---------------------------------------------------------------------------
const midnight: Theme = {
  id: "midnight",
  name: "Midnight",
  description: "Deep navy with cyan accents — the signature ArgentOS look",
  variables: {
    "--background": "222 47% 6%",
    "--foreground": "210 40% 98%",
    "--card": "222 47% 8%",
    "--card-foreground": "210 40% 98%",
    "--popover": "222 47% 8%",
    "--popover-foreground": "210 40% 98%",
    "--primary": "180 70% 50%",
    "--primary-foreground": "222 47% 6%",
    "--secondary": "217 33% 17%",
    "--secondary-foreground": "210 40% 98%",
    "--muted": "217 33% 17%",
    "--muted-foreground": "215 20% 65%",
    "--accent": "180 70% 50%",
    "--accent-foreground": "222 47% 6%",
    "--destructive": "0 84% 60%",
    "--destructive-foreground": "210 40% 98%",
    "--border": "217 33% 17%",
    "--input": "217 33% 17%",
    "--ring": "180 70% 50%",
    "--radius": "0.75rem",
    // Body gradient stops (consumed by index.css)
    "--gradient-1": "#0a0a0f",
    "--gradient-2": "#1a1a2e",
    "--gradient-3": "#16213e",
    "--gradient-4": "#0f0f23",
  },
};

// ---------------------------------------------------------------------------
// Nebula — purple / violet with magenta accents, cosmic feel
// ---------------------------------------------------------------------------
const nebula: Theme = {
  id: "nebula",
  name: "Nebula",
  description: "Purple depths with magenta accents — a cosmic aesthetic",
  variables: {
    "--background": "270 40% 6%",
    "--foreground": "270 20% 96%",
    "--card": "270 40% 9%",
    "--card-foreground": "270 20% 96%",
    "--popover": "270 40% 9%",
    "--popover-foreground": "270 20% 96%",
    "--primary": "290 80% 65%",
    "--primary-foreground": "270 40% 6%",
    "--secondary": "260 30% 18%",
    "--secondary-foreground": "270 20% 96%",
    "--muted": "260 30% 18%",
    "--muted-foreground": "270 15% 60%",
    "--accent": "320 75% 60%",
    "--accent-foreground": "270 40% 6%",
    "--destructive": "0 80% 60%",
    "--destructive-foreground": "270 20% 96%",
    "--border": "260 30% 18%",
    "--input": "260 30% 18%",
    "--ring": "290 80% 65%",
    "--radius": "0.75rem",
    "--gradient-1": "#0d0618",
    "--gradient-2": "#1a0a2e",
    "--gradient-3": "#2d1045",
    "--gradient-4": "#120824",
  },
};

// ---------------------------------------------------------------------------
// Daylight — light mode, warm white background, slate text, blue accents
// ---------------------------------------------------------------------------
const daylight: Theme = {
  id: "daylight",
  name: "Daylight",
  description: "Clean light mode with warm whites and blue accents",
  variables: {
    "--background": "0 0% 98%",
    "--foreground": "222 47% 11%",
    "--card": "0 0% 100%",
    "--card-foreground": "222 47% 11%",
    "--popover": "0 0% 100%",
    "--popover-foreground": "222 47% 11%",
    "--primary": "221 83% 53%",
    "--primary-foreground": "0 0% 100%",
    "--secondary": "220 14% 92%",
    "--secondary-foreground": "222 47% 11%",
    "--muted": "220 14% 92%",
    "--muted-foreground": "220 9% 46%",
    "--accent": "221 83% 53%",
    "--accent-foreground": "0 0% 100%",
    "--destructive": "0 84% 60%",
    "--destructive-foreground": "0 0% 100%",
    "--border": "220 13% 87%",
    "--input": "220 13% 87%",
    "--ring": "221 83% 53%",
    "--radius": "0.75rem",
    "--gradient-1": "#f8f9fb",
    "--gradient-2": "#eef1f6",
    "--gradient-3": "#e4e8f0",
    "--gradient-4": "#f0f2f5",
  },
};

// ---------------------------------------------------------------------------
// Terminal — pure black, green-on-black, hacker aesthetic
// ---------------------------------------------------------------------------
const terminal: Theme = {
  id: "terminal",
  name: "Terminal",
  description: "Green on black — classic hacker terminal aesthetic",
  variables: {
    "--background": "0 0% 2%",
    "--foreground": "120 60% 70%",
    "--card": "0 0% 4%",
    "--card-foreground": "120 60% 70%",
    "--popover": "0 0% 4%",
    "--popover-foreground": "120 60% 70%",
    "--primary": "120 100% 45%",
    "--primary-foreground": "0 0% 2%",
    "--secondary": "120 10% 12%",
    "--secondary-foreground": "120 60% 70%",
    "--muted": "120 10% 12%",
    "--muted-foreground": "120 20% 45%",
    "--accent": "120 100% 45%",
    "--accent-foreground": "0 0% 2%",
    "--destructive": "0 100% 50%",
    "--destructive-foreground": "0 0% 98%",
    "--border": "120 10% 12%",
    "--input": "120 10% 12%",
    "--ring": "120 100% 45%",
    "--radius": "0.25rem",
    "--gradient-1": "#000000",
    "--gradient-2": "#020a02",
    "--gradient-3": "#040d04",
    "--gradient-4": "#010601",
  },
};

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export const themes: Theme[] = [midnight, nebula, daylight, terminal];

export const DEFAULT_THEME_ID = "midnight";

export function getThemeById(id: string): Theme | undefined {
  return themes.find((t) => t.id === id);
}
