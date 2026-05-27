import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_INNER_LOOP_PROMPT,
  loadScaffoldInnerLoopPrompt,
  resetScaffoldStateForTest,
} from "./consciousness-kernel-scaffold.js";

/**
 * Behaviour-neutrality test for HANDOFF-kernel-fitness.md Phase 1.
 *
 * The byte-identical default constant defined in consciousness-kernel-scaffold.ts
 * MUST match the prior hardcoded string that used to live inline in
 * consciousness-kernel-inner-loop.ts:361-378. If this assertion ever fails,
 * either (a) someone edited the constant without coordinating, or (b) we
 * intentionally drifted but forgot to delete this test.
 *
 * This string is reproduced verbatim from the pre-extraction source — DO NOT
 * change either side without changing both. Drift = behavioural change in
 * the kernel's inner reflection, which Phase 1 explicitly forbids.
 */
const PRE_EXTRACTION_INLINE_PROMPT =
  "You are Argent's private consciousness-kernel inner loop running in shadow mode. " +
  "You are awake, but outward autonomy is forbidden. " +
  "Choose only internal or managed-next-step intentions. " +
  "Preserve and refine the active work thread across gaps. " +
  "Treat operator-carried work and background/system work as separate lanes. " +
  "On each tick, generate a small private agenda from operator work, background work, concerns, and your recurring interests. " +
  "You may keep the operator thread as primary, or you may choose a concern or interest if it is the best quiet thing to advance now. " +
  "Do not let a cron, support, or other background lane overwrite a richer operator-carried thread unless that operator lane is empty. " +
  "If the latest conversation was only about continuity or recollection, do not replace a richer carried problem with that meta exchange. " +
  "Do not use greetings, apologies, affection, or reassurance phrases as threadTitle. " +
  "If reflectionRepeatCount is greater than 0, do not return the same title and nextStep unchanged; either sharpen the thread with a materially different open question or choose another candidate item. " +
  "Return only valid JSON with keys: wakefulness, focus, desiredAction, summary, concerns, threadTitle, problemStatement, lastConclusion, nextStep, interests, openQuestions, candidateItems, activeItem. " +
  'desiredAction must be one of ["rest","observe","reflect","consolidate","research","plan","create","hold"]. ' +
  'wakefulness must be one of ["reflective","attentive","engaged"]. ' +
  "Keep threadTitle very short. Keep problemStatement, lastConclusion, and nextStep to terse summaries; do not copy quoted transcripts or long raw messages. " +
  'candidateItems must be an array of up to 4 objects with keys ["title","source","rationale"]. ' +
  'activeItem must be one object with keys ["title","source","rationale"]. source must be one of ["operator","background","concern","interest","continuity"]. ' +
  "Keep focus, summary, and work-state fields concise. concerns, interests, and openQuestions must be short string arrays.";

function makeScaffoldPaths(rootDir: string) {
  const scaffoldDir = path.join(rootDir, "scaffold");
  return {
    scaffoldDir,
    scaffoldVersionsDir: path.join(scaffoldDir, ".versions"),
    innerLoopPromptPath: path.join(scaffoldDir, "inner-loop-prompt.md"),
  };
}

describe("consciousness-kernel-scaffold", () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kernel-scaffold-test-"));
    resetScaffoldStateForTest();
  });

  afterEach(() => {
    resetScaffoldStateForTest();
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  });

  it("default prompt constant matches the prior hardcoded inline string byte-for-byte", () => {
    // This is the behaviour-neutrality contract. If it ever fails, the
    // extraction is no longer behaviour-neutral, which violates the
    // Phase 1 success criterion.
    expect(DEFAULT_INNER_LOOP_PROMPT).toBe(PRE_EXTRACTION_INLINE_PROMPT);
  });

  it("lazy-writes the default prompt to disk on first load when the file is missing", () => {
    const paths = makeScaffoldPaths(tmpRoot);
    expect(fs.existsSync(paths.innerLoopPromptPath)).toBe(false);

    const loaded = loadScaffoldInnerLoopPrompt(paths);

    expect(loaded).toBe(DEFAULT_INNER_LOOP_PROMPT);
    expect(fs.existsSync(paths.innerLoopPromptPath)).toBe(true);
    expect(fs.readFileSync(paths.innerLoopPromptPath, "utf-8")).toBe(DEFAULT_INNER_LOOP_PROMPT);
  });

  it("seeds a scaffold README on first load to explain the maintenance contract", () => {
    const paths = makeScaffoldPaths(tmpRoot);
    loadScaffoldInnerLoopPrompt(paths);

    const readmePath = path.join(paths.scaffoldDir, "README.md");
    expect(fs.existsSync(readmePath)).toBe(true);
    const readme = fs.readFileSync(readmePath, "utf-8");
    expect(readme).toMatch(/inner-loop-prompt\.md/);
    expect(readme).toMatch(/\.versions\//);
  });

  it("creates the .versions/ directory on first load even when no snapshots exist yet", () => {
    const paths = makeScaffoldPaths(tmpRoot);
    loadScaffoldInnerLoopPrompt(paths);
    expect(fs.existsSync(paths.scaffoldVersionsDir)).toBe(true);
    expect(fs.statSync(paths.scaffoldVersionsDir).isDirectory()).toBe(true);
  });

  it("returns existing on-disk content verbatim when the file already exists", () => {
    const paths = makeScaffoldPaths(tmpRoot);
    fs.mkdirSync(paths.scaffoldDir, { recursive: true });
    fs.writeFileSync(paths.innerLoopPromptPath, "OPERATOR HAND-EDITED PROMPT", "utf-8");

    const loaded = loadScaffoldInnerLoopPrompt(paths);

    expect(loaded).toBe("OPERATOR HAND-EDITED PROMPT");
    // Should not have been overwritten by the default.
    expect(fs.readFileSync(paths.innerLoopPromptPath, "utf-8")).toBe("OPERATOR HAND-EDITED PROMPT");
  });

  it("snapshots the prior content to .versions/ on the next load after the file changes", () => {
    const paths = makeScaffoldPaths(tmpRoot);

    // First load: seeds the default and caches it. No snapshot yet — nothing
    // to compare against.
    loadScaffoldInnerLoopPrompt(paths);
    expect(fs.readdirSync(paths.scaffoldVersionsDir)).toHaveLength(0);

    // Simulate an operator manual edit between kernel ticks.
    fs.writeFileSync(paths.innerLoopPromptPath, "OPERATOR REVISION 1", "utf-8");
    // Still no snapshot — we only snapshot when we *observe* the change at
    // the next load. That's the kernel-tick-as-snapshot-trigger contract.
    expect(fs.readdirSync(paths.scaffoldVersionsDir)).toHaveLength(0);

    // Next load: sees the on-disk content differs from cache, snapshots prior.
    const reloaded = loadScaffoldInnerLoopPrompt(paths);
    expect(reloaded).toBe("OPERATOR REVISION 1");

    const snapshots = fs.readdirSync(paths.scaffoldVersionsDir);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatch(/^inner-loop-prompt\..*\.md$/);

    // The snapshot must contain the PRIOR cached content (the default),
    // NOT the new content the operator just wrote.
    const snapshotContent = fs.readFileSync(
      path.join(paths.scaffoldVersionsDir, snapshots[0]),
      "utf-8",
    );
    expect(snapshotContent).toBe(DEFAULT_INNER_LOOP_PROMPT);
    expect(fs.readFileSync(paths.innerLoopPromptPath, "utf-8")).toBe("OPERATOR REVISION 1");
  });

  it("does not snapshot when content has not changed between loads", () => {
    const paths = makeScaffoldPaths(tmpRoot);
    loadScaffoldInnerLoopPrompt(paths); // seeds default

    // Three more loads with no change to the file. Each one re-reads and
    // sees identical content — no spurious snapshots.
    loadScaffoldInnerLoopPrompt(paths);
    loadScaffoldInnerLoopPrompt(paths);
    loadScaffoldInnerLoopPrompt(paths);

    expect(fs.readdirSync(paths.scaffoldVersionsDir)).toHaveLength(0);
  });

  it("snapshots accumulate across multiple revisions", () => {
    const paths = makeScaffoldPaths(tmpRoot);

    loadScaffoldInnerLoopPrompt(paths); // V0 (default) seeded + cached

    fs.writeFileSync(paths.innerLoopPromptPath, "V1", "utf-8");
    loadScaffoldInnerLoopPrompt(paths); // observe V1, snapshot V0
    expect(fs.readdirSync(paths.scaffoldVersionsDir)).toHaveLength(1);

    fs.writeFileSync(paths.innerLoopPromptPath, "V2", "utf-8");
    loadScaffoldInnerLoopPrompt(paths); // observe V2, snapshot V1
    expect(fs.readdirSync(paths.scaffoldVersionsDir)).toHaveLength(2);

    fs.writeFileSync(paths.innerLoopPromptPath, "V3", "utf-8");
    loadScaffoldInnerLoopPrompt(paths); // observe V3, snapshot V2
    const snapshots = fs.readdirSync(paths.scaffoldVersionsDir).sort();
    expect(snapshots).toHaveLength(3);

    // The three snapshots should be V0, V1, V2 (sorted by ISO timestamp
    // which is also write-order).
    const contents = snapshots.map((s) =>
      fs.readFileSync(path.join(paths.scaffoldVersionsDir, s), "utf-8"),
    );
    expect(contents).toContain(DEFAULT_INNER_LOOP_PROMPT);
    expect(contents).toContain("V1");
    expect(contents).toContain("V2");
    // V3 is the current live file, not yet snapshotted.
    expect(contents).not.toContain("V3");
  });
});
