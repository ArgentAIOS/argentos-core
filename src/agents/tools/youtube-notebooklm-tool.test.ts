import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { __testing } from "./youtube-notebooklm-tool.js";

const {
  cutoffDateForMonths,
  evaluateSetupSnapshot,
  formatDuration,
  formatUploadDate,
  isAuthCheckUnsupported,
  normalizeYoutubeResult,
  parseJsonOutput,
  requirementsForAction,
  sanitizeNotebookTitle,
  resolveInfographicOutputPath,
} = __testing;

describe("youtube_notebooklm helpers", () => {
  it("computes cutoff dates from months", () => {
    const fixedNow = new Date("2026-03-04T12:00:00Z");
    expect(cutoffDateForMonths(6, fixedNow)).toBe("20250905");
    expect(cutoffDateForMonths(0, fixedNow)).toBeNull();
  });

  it("formats duration from either string or seconds", () => {
    expect(formatDuration({ duration_string: "12:34" })).toBe("12:34");
    expect(formatDuration({ duration: 65 })).toBe("1:05");
    expect(formatDuration({ duration: 3661 })).toBe("1:01:01");
    expect(formatDuration({})).toBe("N/A");
  });

  it("formats upload dates", () => {
    expect(formatUploadDate("20260301")).toBe("2026-03-01");
    expect(formatUploadDate("bad")).toBeNull();
  });

  it("normalizes youtube results and computes ratios", () => {
    const result = normalizeYoutubeResult({
      id: "abc123",
      title: "My Video",
      channel: "My Channel",
      channel_follower_count: 1000,
      view_count: 5500,
      duration: 91,
      upload_date: "20260228",
    });

    expect(result.url).toBe("https://youtube.com/watch?v=abc123");
    expect(result.views_per_subscriber).toBe(5.5);
    expect(result.duration).toBe("1:31");
    expect(result.upload_date).toBe("2026-02-28");
  });

  it("parses json from multiline output", () => {
    const parsed = parseJsonOutput('info line\n{"ok":true,"count":2}\n', "test") as {
      ok: boolean;
      count: number;
    };
    expect(parsed.ok).toBe(true);
    expect(parsed.count).toBe(2);
  });

  it("sanitizes notebook titles", () => {
    expect(sanitizeNotebookTitle("   ")).toBe("YouTube Research");
    expect(sanitizeNotebookTitle("  Hello   world  ")).toBe("Hello world");
  });

  it("resolves infographic path from requested value", () => {
    const abs = resolveInfographicOutputPath({ requested: "/tmp/demo.png" });
    expect(abs).toBe(path.resolve("/tmp/demo.png"));

    const home = resolveInfographicOutputPath({ requested: "~/demo.png" });
    expect(home).toBe(path.join(os.homedir(), "demo.png"));
  });

  it("maps setup requirements per action", () => {
    expect(requirementsForAction("youtube_search")).toEqual({
      yt_dlp: true,
      notebooklm: false,
      notebooklm_auth: false,
    });
    expect(requirementsForAction("notebook_ask")).toEqual({
      yt_dlp: false,
      notebooklm: true,
      notebooklm_auth: true,
    });
    expect(requirementsForAction("youtube_to_notebook_workflow")).toEqual({
      yt_dlp: true,
      notebooklm: true,
      notebooklm_auth: true,
    });
  });

  it("evaluates setup snapshot and returns first-run commands", () => {
    const snapshot = evaluateSetupSnapshot({
      requirements: {
        yt_dlp: true,
        notebooklm: true,
        notebooklm_auth: true,
      },
      ytDlp: { installed: false, error: "missing" },
      notebooklm: { installed: false, error: "missing" },
      notebookAuth: { authenticated: null },
    });

    expect(snapshot.ready).toBe(false);
    expect(snapshot.missing).toEqual(["yt_dlp", "notebooklm"]);
    expect(snapshot.next_steps).toEqual([
      "python3 -m pip install --user yt-dlp",
      'python3 -m pip install --user "notebooklm-py[browser]"',
      "python3 -m playwright install chromium",
    ]);
  });

  it("treats unsupported auth-check output as unsupported", () => {
    expect(isAuthCheckUnsupported("unknown command: auth")).toBe(true);
    expect(isAuthCheckUnsupported("invalid choice 'auth'")).toBe(true);
    expect(isAuthCheckUnsupported("not authenticated")).toBe(false);
  });
});
