import { beforeEach, describe, expect, it, vi } from "vitest";

const execFileMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({
  execFile: execFileMock,
}));

import { isSystemdUserServiceAvailable } from "./systemd.js";

describe("systemd availability", () => {
  beforeEach(() => {
    execFileMock.mockReset();
  });

  it("returns true when systemctl --user succeeds", async () => {
    execFileMock.mockImplementation((_cmd, _args, _opts, cb) => {
      cb(null, "", "");
    });
    await expect(isSystemdUserServiceAvailable()).resolves.toBe(true);
  });

  it("returns false when systemd user bus is unavailable", async () => {
    execFileMock.mockImplementation((_cmd, _args, _opts, cb) => {
      const err = new Error("Failed to connect to bus") as Error & {
        stderr?: string;
        code?: number;
      };
      err.stderr = "Failed to connect to bus";
      err.code = 1;
      cb(err, "", "");
    });
    await expect(isSystemdUserServiceAvailable()).resolves.toBe(false);
  });

  it("uses machine user scope when SUDO_USER is provided", async () => {
    const calls: string[][] = [];
    execFileMock.mockImplementation((_cmd, args, _opts, cb) => {
      calls.push(args as string[]);
      cb(null, "", "");
    });
    await expect(isSystemdUserServiceAvailable({ SUDO_USER: "sem" })).resolves.toBe(true);
    expect(calls[0]).toEqual(["--machine", "sem@", "--user", "status"]);
  });

  it("falls back to machine scope when direct user scope bus is missing", async () => {
    const calls: string[][] = [];
    execFileMock.mockImplementation((_cmd, args, _opts, cb) => {
      calls.push(args as string[]);
      if (calls.length === 1) {
        const err = new Error("Failed to connect to bus") as Error & {
          stderr?: string;
          code?: number;
        };
        err.stderr = "Failed to connect to bus";
        err.code = 1;
        cb(err, "", "");
        return;
      }
      cb(null, "", "");
    });
    await expect(isSystemdUserServiceAvailable({ USER: "sem" })).resolves.toBe(true);
    expect(calls[0]).toEqual(["--user", "status"]);
    expect(calls[1]).toEqual(["--machine", "sem@", "--user", "status"]);
  });
});
