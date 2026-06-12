import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { rotateLogFileIfNeeded } from "./gateway-log-rotation.js";

describe("gateway log rotation (the 755MB incident)", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "argent-log-rotation-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("leaves small files alone", () => {
    const file = path.join(dir, "gateway.log");
    fs.writeFileSync(file, "small\n");
    const result = rotateLogFileIfNeeded(file, { maxBytes: 1024 });
    expect(result.rotated).toBe(false);
    expect(fs.readFileSync(file, "utf8")).toBe("small\n");
  });

  it("truncates in place (never renames) and preserves the tail in .1", () => {
    const file = path.join(dir, "gateway.log");
    const filler = "x".repeat(1024);
    const tailMarker = "RECENT-LINES-THE-OPERATOR-NEEDS\n";
    fs.writeFileSync(file, filler.repeat(64) + tailMarker);
    const before = fs.statSync(file).ino;

    const result = rotateLogFileIfNeeded(file, { maxBytes: 4096, tailBytes: 2048 });
    expect(result.rotated).toBe(true);

    // Same inode (launchd's O_APPEND fd keeps working), now empty.
    expect(fs.statSync(file).ino).toBe(before);
    expect(fs.statSync(file).size).toBe(0);

    const archived = fs.readFileSync(`${file}.1`, "utf8");
    expect(archived.length).toBe(2048);
    expect(archived).toContain("RECENT-LINES-THE-OPERATOR-NEEDS");
  });

  it("missing file is a no-op", () => {
    const result = rotateLogFileIfNeeded(path.join(dir, "absent.log"));
    expect(result).toEqual({ rotated: false, sizeBytes: 0 });
  });
});
