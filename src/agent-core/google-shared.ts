/**
 * Dedicated seam for Google shared conversion helpers used by compatibility tests.
 *
 * SEAM SWAP: Now delegates through argent-ai/google-shared instead of
 * importing @mariozechner/pi-ai directly. The pi dependency is isolated
 * behind the argent-ai boundary.
 */
export { convertMessages, convertTools } from "../argent-ai/google-shared.js";
