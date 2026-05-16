import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export function loadJsonFile(pathname: string): unknown {
  try {
    if (!fs.existsSync(pathname)) {
      return undefined;
    }
    const raw = fs.readFileSync(pathname, "utf8");
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * Write a JSON file atomically with mode 0o600.
 *
 * Uses `openSync(O_WRONLY|O_CREAT|O_EXCL, 0o600)` against a randomly suffixed
 * temp file in the same directory, then `renameSync` into place. This closes
 * the TOCTOU window where the previous `writeFileSync` + `chmodSync` sequence
 * briefly left the secret file at the default umask (often 0644). Pattern
 * ported from subctl's `atomicWriteAuthFile()` (codex-oauth.ts L150–L177).
 */
export function saveJsonFile(pathname: string, data: unknown) {
  const dir = path.dirname(pathname);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  const payload = `${JSON.stringify(data, null, 2)}\n`;
  const tempPath = `${pathname}.tmp.${process.pid}.${randomBytes(6).toString("hex")}`;
  let fd: number | undefined;
  try {
    fd = fs.openSync(
      tempPath,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL,
      0o600,
    );
    fs.writeSync(fd, payload);
    try {
      fs.fsyncSync(fd);
    } catch {
      // best-effort durability; not all filesystems support fsync
    }
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(tempPath, pathname);
  } catch (err) {
    if (typeof fd === "number") {
      try {
        fs.closeSync(fd);
      } catch {
        // ignore
      }
    }
    try {
      fs.unlinkSync(tempPath);
    } catch {
      // ignore — temp file may not exist on early failure
    }
    throw err;
  }
  // Belt-and-braces: ensure 0600 even if a different umask interfered with
  // the rename target on exotic filesystems.
  try {
    fs.chmodSync(pathname, 0o600);
  } catch {
    // ignore
  }
}
