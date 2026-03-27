import { CommandLane } from "../../process/lanes.js";

export function resolveSessionLane(key: string) {
  const cleaned = key.trim() || CommandLane.Main;
  return cleaned.startsWith("session:") ? cleaned : `session:${cleaned}`;
}

export function resolveGlobalLane(
  lane?: string,
  opts?: {
    messageProvider?: string;
    messageChannel?: string;
  },
) {
  const cleaned = lane?.trim();
  if (cleaned) {
    return cleaned;
  }
  const messageSurface = opts?.messageChannel?.trim() || opts?.messageProvider?.trim();
  return messageSurface ? CommandLane.Interactive : CommandLane.Main;
}

export function resolveEmbeddedSessionLane(key: string) {
  return resolveSessionLane(key);
}
