/**
 * TweakCN CSS Parser — Extracts CSS custom properties from TweakCN exports.
 *
 * TweakCN (tweakcn.com) exports CSS in the shadcn/ui convention:
 *   :root { --background: 222 47% 6%; ... }
 *   .dark { --background: 222 47% 5%; ... }
 *
 * This parser extracts the variable map from either block.
 * Supports HSL values (space-separated), oklch(), and hex.
 */

/** Known theme variable names (shadcn/ui convention) */
const THEME_VARS = new Set([
  "--background",
  "--foreground",
  "--card",
  "--card-foreground",
  "--popover",
  "--popover-foreground",
  "--primary",
  "--primary-foreground",
  "--secondary",
  "--secondary-foreground",
  "--muted",
  "--muted-foreground",
  "--accent",
  "--accent-foreground",
  "--destructive",
  "--destructive-foreground",
  "--border",
  "--input",
  "--ring",
  "--chart-1",
  "--chart-2",
  "--chart-3",
  "--chart-4",
  "--chart-5",
  "--sidebar",
  "--sidebar-foreground",
  "--sidebar-primary",
  "--sidebar-primary-foreground",
  "--sidebar-accent",
  "--sidebar-accent-foreground",
  "--sidebar-border",
  "--sidebar-ring",
  "--radius",
]);

/**
 * Parse a CSS block like `:root { ... }` or `.dark { ... }`
 * and extract CSS custom properties.
 */
function parseBlock(block: string): Record<string, string> {
  const vars: Record<string, string> = {};
  // Match lines like: --background: 222 47% 6%;
  const lineRe = /(--[\w-]+)\s*:\s*([^;]+);/g;
  let match: RegExpExecArray | null;
  while ((match = lineRe.exec(block)) !== null) {
    const [, name, value] = match;
    if (THEME_VARS.has(name)) {
      vars[name] = value.trim();
    }
  }
  return vars;
}

/**
 * Parse TweakCN exported CSS and extract theme variables.
 * Prefers .dark block if present, falls back to :root.
 *
 * @returns Record of CSS variable name → value, or null if no vars found
 */
export function parseTweakCNCSS(raw: string): Record<string, string> | null {
  // Extract .dark { ... } block
  const darkMatch = raw.match(/\.dark\s*\{([^}]+)\}/s);
  const darkVars = darkMatch ? parseBlock(darkMatch[1]) : {};

  // Extract :root { ... } block
  const rootMatch = raw.match(/:root\s*\{([^}]+)\}/s);
  const rootVars = rootMatch ? parseBlock(rootMatch[1]) : {};

  // Merge: dark overrides root
  const merged = { ...rootVars, ...darkVars };

  if (Object.keys(merged).length === 0) return null;
  return merged;
}

/**
 * Validate that a parsed theme has the minimum required variables.
 */
export function isValidTheme(vars: Record<string, string>): boolean {
  const required = ["--background", "--foreground", "--primary", "--card", "--border"];
  return required.every((key) => key in vars);
}
