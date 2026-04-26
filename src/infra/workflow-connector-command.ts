export function connectorCommandToCliArgs(command: string): string[] {
  const trimmed = command.trim();
  if (!trimmed) {
    throw new Error("command must be a non-empty string");
  }
  if (trimmed.includes(" ")) {
    return trimmed.split(/\s+/).filter(Boolean);
  }
  return trimmed.split(".").filter(Boolean);
}

export function connectorCommandExtraArgToCliArg(arg: unknown): string | undefined {
  if (arg === null || arg === undefined) {
    return undefined;
  }
  if (typeof arg === "string") {
    return arg;
  }
  if (typeof arg === "number" || typeof arg === "boolean" || typeof arg === "bigint") {
    return String(arg);
  }
  return JSON.stringify(arg);
}
