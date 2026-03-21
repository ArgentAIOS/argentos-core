#!/usr/bin/env node

// DEPRECATED: This entry point is kept for backwards compatibility.
// Use `argent` or `argentos` instead.
console.error("\x1b[33m⚠ The 'openclaw' command is deprecated. Use 'argent' instead.\x1b[0m");

await import("./argent.mjs");
