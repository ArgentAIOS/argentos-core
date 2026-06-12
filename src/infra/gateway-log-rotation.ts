/**
 * In-process rotation for the launchd stdout/stderr logs.
 *
 * launchd appends the gateway's stdout/stderr to <stateDir>/logs/gateway.log
 * forever — there is no system rotation, which is how the live box grew a
 * 755MB gateway.log (2026-06 incident). launchd holds an O_APPEND file
 * descriptor, so the only safe in-process rotation is: preserve a bounded
 * tail to `<file>.1`, then truncate the file in place to zero — a rename
 * would NOT rotate anything (launchd's fd follows the inode and the "new"
 * file would never be created until restart).
 */

import fs from "node:fs";
import { resolveGatewayLogPaths } from "../daemon/launchd.js";
import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("gateway/log-rotation");

export const DEFAULT_LOG_ROTATION_MAX_BYTES = 64 * 1024 * 1024;
/** How much recent history survives a rotation (tail copied to <file>.1). */
export const LOG_ROTATION_TAIL_BYTES = 8 * 1024 * 1024;
const CHECK_INTERVAL_MS = 10 * 60_000;

export function rotateLogFileIfNeeded(
  filePath: string,
  opts?: { maxBytes?: number; tailBytes?: number },
): { rotated: boolean; sizeBytes: number } {
  const maxBytes = opts?.maxBytes ?? DEFAULT_LOG_ROTATION_MAX_BYTES;
  const tailBytes = opts?.tailBytes ?? LOG_ROTATION_TAIL_BYTES;
  let size = 0;
  try {
    size = fs.statSync(filePath).size;
  } catch {
    return { rotated: false, sizeBytes: 0 };
  }
  if (size <= maxBytes) {
    return { rotated: false, sizeBytes: size };
  }
  try {
    const keep = Math.min(tailBytes, size);
    const buffer = Buffer.alloc(keep);
    const fd = fs.openSync(filePath, "r");
    try {
      fs.readSync(fd, buffer, 0, keep, size - keep);
    } finally {
      fs.closeSync(fd);
    }
    fs.writeFileSync(`${filePath}.1`, buffer);
    fs.truncateSync(filePath, 0);
    log.info(
      `rotated ${filePath}: ${(size / 1024 / 1024).toFixed(1)}MB → 0 (last ${(keep / 1024 / 1024).toFixed(1)}MB preserved in .1)`,
    );
    return { rotated: true, sizeBytes: size };
  } catch (err) {
    log.warn(`rotation failed for ${filePath}: ${String(err)}`);
    return { rotated: false, sizeBytes: size };
  }
}

/**
 * Start the periodic size check for the gateway's launchd stdout/stderr
 * files. Cheap (two statSync every 10 min); rotation itself is rare.
 */
export function startGatewayLogRotation(
  env: Record<string, string | undefined> = process.env,
  opts?: { maxBytes?: number; intervalMs?: number },
): { stop: () => void } {
  const { stdoutPath, stderrPath } = resolveGatewayLogPaths(env);
  const check = () => {
    rotateLogFileIfNeeded(stdoutPath, opts);
    rotateLogFileIfNeeded(stderrPath, opts);
  };
  check();
  const timer = setInterval(check, opts?.intervalMs ?? CHECK_INTERVAL_MS);
  timer.unref?.();
  return {
    stop: () => {
      clearInterval(timer);
    },
  };
}
