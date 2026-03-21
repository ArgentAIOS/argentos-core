/**
 * Argent AI — Google Shared Conversion Utilities
 *
 * Argent-native re-export of Google (Gemini) message and tool conversion
 * functions. These wrap the upstream Pi implementations for backward
 * compatibility with existing test suites.
 *
 * TODO: Replace with fully Argent-native implementations when
 * pi-ai dependency is removed entirely.
 *
 * @module argent-ai/google-shared
 */

// Re-export from Pi until fully Argent-native implementations exist.
// This isolates the pi-ai deep import to a single file in argent-ai.
export { convertMessages, convertTools } from "@mariozechner/pi-ai/dist/providers/google-shared.js";
