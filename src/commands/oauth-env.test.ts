import { describe, expect, it } from "vitest";
import { isHeadlessSession } from "./oauth-env.js";

describe("isHeadlessSession", () => {
  it("returns true when SSH_CONNECTION is set", () => {
    expect(
      isHeadlessSession({
        env: { SSH_CONNECTION: "1.2.3.4 12345 5.6.7.8 22" },
        platform: "darwin",
      }),
    ).toBe(true);
  });

  it("returns true when SSH_CLIENT is set", () => {
    expect(
      isHeadlessSession({
        env: { SSH_CLIENT: "1.2.3.4 12345 22" },
        platform: "darwin",
      }),
    ).toBe(true);
  });

  it("returns false when SSH_CONNECTION and SSH_CLIENT are unset on macOS", () => {
    expect(
      isHeadlessSession({
        env: {},
        platform: "darwin",
      }),
    ).toBe(false);
  });

  it("returns true when ARGENT_CODEX_DEVICE_AUTH=1 forces the override", () => {
    expect(
      isHeadlessSession({
        env: { ARGENT_CODEX_DEVICE_AUTH: "1" },
        platform: "darwin",
      }),
    ).toBe(true);
  });

  it("does NOT trigger on ARGENT_CODEX_DEVICE_AUTH=0 or empty", () => {
    expect(
      isHeadlessSession({
        env: { ARGENT_CODEX_DEVICE_AUTH: "0" },
        platform: "darwin",
      }),
    ).toBe(false);
    expect(
      isHeadlessSession({
        env: { ARGENT_CODEX_DEVICE_AUTH: "" },
        platform: "darwin",
      }),
    ).toBe(false);
  });

  it("returns true on Linux with no DISPLAY and no WAYLAND_DISPLAY", () => {
    expect(
      isHeadlessSession({
        env: {},
        platform: "linux",
      }),
    ).toBe(true);
  });

  it("returns false on Linux when DISPLAY is set", () => {
    expect(
      isHeadlessSession({
        env: { DISPLAY: ":0" },
        platform: "linux",
      }),
    ).toBe(false);
  });

  it("returns false on Linux when WAYLAND_DISPLAY is set", () => {
    expect(
      isHeadlessSession({
        env: { WAYLAND_DISPLAY: "wayland-0" },
        platform: "linux",
      }),
    ).toBe(false);
  });

  it("returns false on macOS even when DISPLAY is unset (Macs always have a browser)", () => {
    expect(
      isHeadlessSession({
        env: {},
        platform: "darwin",
      }),
    ).toBe(false);
  });

  it("returns false on Windows even when DISPLAY is unset", () => {
    expect(
      isHeadlessSession({
        env: {},
        platform: "win32",
      }),
    ).toBe(false);
  });

  it("env override beats a GUI Linux host (forces device-auth)", () => {
    expect(
      isHeadlessSession({
        env: { DISPLAY: ":0", ARGENT_CODEX_DEVICE_AUTH: "1" },
        platform: "linux",
      }),
    ).toBe(true);
  });
});
