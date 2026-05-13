/**
 * Transport — drift-absorbing alias for pi's stream transport union.
 *
 * Tracking issue: GH #306. Origin breakage: GH #182.
 *
 * # Why this re-export exists
 *
 * Pi 0.73+ tightened the `Transport` union to `"sse" | "websocket" | "auto"`,
 * dropping the legacy `"websocket-cached"` variant. Argent's #182 breakage
 * catalog flagged one call site that referenced `"websocket-cached"` — that
 * literal has since been removed from the codebase (audited 2026-05-13:
 * no `"websocket-cached"` occurrences remain under `src/`).
 *
 * Exposing the `Transport` type through pi-bridge means:
 * 1. New code referencing the transport type uses ONE canonical name.
 * 2. If pi changes the union again, argent updates the alias here once
 *    rather than chasing every call site.
 *
 * Pi 0.70.2 (argent's current pin) already matches the post-0.73 shape, so
 * this is a structural forward — no compat shim needed today.
 *
 * @module argent-agent/pi-bridge/transport
 */

import type { Transport as PiTransport } from "@mariozechner/pi-ai";

/**
 * Stream transport variants supported by pi providers.
 *
 * Currently `"sse" | "websocket" | "auto"`. The legacy `"websocket-cached"`
 * variant referenced by #182 has been removed both upstream and in argent.
 */
export type Transport = PiTransport;
