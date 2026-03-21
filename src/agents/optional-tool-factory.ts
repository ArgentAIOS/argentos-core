import { createRequire } from "node:module";

const requireModule = createRequire(import.meta.url);

function isMissingModuleError(error: unknown, specifier: string): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const message = error.message || "";
  return (
    message.includes(`Cannot find module '${specifier}'`) ||
    message.includes(`Cannot find module "${specifier}"`) ||
    message.includes(`Cannot find package '${specifier}'`) ||
    message.includes(`Cannot find package "${specifier}"`) ||
    message.includes(specifier)
  );
}

function unwrapExportCandidate(candidate: unknown, exportName: string, depth = 0): unknown {
  if (depth > 4) {
    return null;
  }
  if (typeof candidate === "function") {
    return candidate;
  }
  if (!candidate || typeof candidate !== "object") {
    return null;
  }
  const record = candidate as Record<string, unknown>;
  const prioritized = [record[exportName], record.default];
  for (const value of prioritized) {
    const unwrapped = unwrapExportCandidate(value, exportName, depth + 1);
    if (unwrapped) {
      return unwrapped;
    }
  }
  for (const value of Object.values(record)) {
    const unwrapped = unwrapExportCandidate(value, exportName, depth + 1);
    if (unwrapped) {
      return unwrapped;
    }
  }
  return null;
}

export function loadOptionalToolFactory<T>(specifier: string, exportName: string): T | null {
  try {
    const mod = requireModule(specifier) as Record<string, unknown>;
    const candidate =
      unwrapExportCandidate(mod[exportName], exportName) ?? unwrapExportCandidate(mod, exportName);
    return candidate ? (candidate as T) : null;
  } catch (error) {
    if (isMissingModuleError(error, specifier)) {
      return null;
    }
    throw error;
  }
}
