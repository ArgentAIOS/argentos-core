/// <reference types="vite/client" />

// Build-time injected version string (from root package.json via vite.config.ts).
// Always defined; falls back to "unknown" if the lookup fails at build time.
declare const __APP_VERSION__: string;
