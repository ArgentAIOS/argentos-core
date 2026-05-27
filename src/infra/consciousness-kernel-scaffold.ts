/**
 * Consciousness kernel — scaffold loader.
 *
 * Phase 1 of the kernel-fitness work (see HANDOFF-kernel-fitness.md).
 *
 * Today the inner-loop system prompt is extracted from `consciousness-kernel-inner-loop.ts`
 * (the hardcoded string in `buildInnerLoopPrompt`) into a file at
 * `{agentDir}/kernel/scaffold/inner-loop-prompt.md`. That file becomes the
 * refiner-editable scaffolding surface for Phase 4.
 *
 * Behaviour:
 *   - On first call: if the prompt file doesn't exist, write `DEFAULT_INNER_LOOP_PROMPT`
 *     to disk (and seed `scaffold/README.md` with the maintenance contract).
 *   - Read the prompt content from disk on every call. Synchronous I/O is
 *     intentional: the prompt is read once per inner-loop tick (every 2 min),
 *     the file is < 4KB, and re-reading keeps the "edit and the next tick
 *     picks it up" contract simple.
 *   - Compare the just-read content to the in-memory cache from the previous
 *     load. If they differ, snapshot the *prior* (cached) content to
 *     `scaffold/.versions/inner-loop-prompt.{ISO-timestamp}.md` BEFORE
 *     accepting the new content. This catches both refiner writes (Phase 4)
 *     and direct `vi`-style operator edits — the snapshot policy is
 *     who-wrote-agnostic.
 *
 * Why compare-on-load instead of fs.watch:
 *   - fs.watch is flaky cross-platform (event ordering on macOS for atomic
 *     saves, missed events on some Linux filesystems, no-op on networked
 *     filesystems).
 *   - The kernel reads every tick (~2 min), so snapshots are at most one
 *     tick late — acceptable for a rollback artifact.
 *   - Edge case: two writes between two loads → only the most recent prior
 *     content gets snapshotted; intermediate revisions are lost. In Phase 1
 *     there's no refiner, so this only happens if the operator manually
 *     edits twice without a kernel tick in between. Acceptable for v0.
 *   - Phase 4 (when the refiner lands) may want fs.watch back for tighter
 *     snapshot fidelity around refiner writes; the snapshot logic here can
 *     be extended at that point.
 *
 * The byte-identical default constant is exported so a behaviour-neutrality test
 * can assert it matches the old hardcoded string.
 */

import fs from "node:fs";
import path from "node:path";
import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("gateway/consciousness-kernel/scaffold");

/**
 * The exact inner-loop system prompt that used to live inline at
 * `consciousness-kernel-inner-loop.ts:361-379`. Byte-for-byte equality is a
 * behaviour-neutrality test — if this string drifts from what the in-source
 * version was at extraction time, Phase 1's intent (a refactor with no
 * behaviour change beyond DEFAULT_TICK_MS) is violated.
 */
export const DEFAULT_INNER_LOOP_PROMPT =
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

const SCAFFOLD_README_TEMPLATE = `# kernel/scaffold/

This directory holds the consciousness kernel's editable scaffolding —
prompts, antipattern flags, and similar refinement surfaces.

## Files

- \`inner-loop-prompt.md\` — the system prompt the kernel uses for each
  inner reflection tick. Edit this file with \`vi\` (or any editor) to
  experiment with prompt changes; the next tick will pick up the new
  content. The kernel does NOT need a restart.

- \`.versions/\` — snapshot history. Every change to a scaffold file
  causes the prior content to be written here as
  \`<name>.{ISO-timestamp}.md\` BEFORE the new content takes effect.
  This lets you (or the Phase 4 refiner) roll back a regression.

## Manual-edit policy

The snapshot rule is who-wrote-agnostic. Whether the refiner or you wrote
the change, the prior content is preserved. That means:

  - You can hand-edit \`inner-loop-prompt.md\` at any time and the kernel
    will pick it up.
  - If the Phase 4 refiner later writes a worse version, its rollback
    will restore the LAST snapshot — which may be your manual edit,
    not the original default. That's intended: your edit is signal
    too, and the refiner shouldn't clobber it without an explicit
    fitness comparison.

## How to reset to default

Delete \`inner-loop-prompt.md\`. The next kernel tick will lazy-write
the byte-identical \`DEFAULT_INNER_LOOP_PROMPT\` constant from the
binary back to disk.
`;

// In-memory cache, keyed by the prompt file path so multiple agents
// don't accidentally share state. Set to the most-recently-read content.
const promptCache = new Map<string, string>();

/**
 * Read the inner-loop system prompt from disk, lazy-writing the default
 * if the file doesn't exist. Snapshots the prior content to `.versions/`
 * whenever the on-disk content differs from the in-memory cache (= what
 * the kernel last read).
 *
 * Synchronous I/O is intentional: the prompt is read once per inner-loop tick
 * (every 2 minutes), the file is < 4KB, and reading inside the tick keeps the
 * "edit-and-the-next-tick-picks-it-up" contract simple.
 */
export function loadScaffoldInnerLoopPrompt(paths: {
  scaffoldDir: string;
  scaffoldVersionsDir: string;
  innerLoopPromptPath: string;
}): string {
  ensureScaffoldDir(paths);

  if (!fs.existsSync(paths.innerLoopPromptPath)) {
    // Lazy first-write: byte-identical default.
    fs.writeFileSync(paths.innerLoopPromptPath, DEFAULT_INNER_LOOP_PROMPT, "utf-8");
    promptCache.set(paths.innerLoopPromptPath, DEFAULT_INNER_LOOP_PROMPT);
    log.info("scaffold: seeded default inner-loop-prompt.md", {
      path: paths.innerLoopPromptPath,
      bytes: DEFAULT_INNER_LOOP_PROMPT.length,
    });
    return DEFAULT_INNER_LOOP_PROMPT;
  }

  const onDisk = fs.readFileSync(paths.innerLoopPromptPath, "utf-8");
  const cached = promptCache.get(paths.innerLoopPromptPath);

  if (cached !== undefined && cached !== onDisk) {
    // Content changed between loads — snapshot the PRIOR content (the cached
    // value) before accepting the new content as the working version. This
    // captures both manual operator edits and (future Phase 4) refiner writes.
    snapshotPriorContent(paths.scaffoldVersionsDir, cached);
  }

  promptCache.set(paths.innerLoopPromptPath, onDisk);
  return onDisk;
}

function ensureScaffoldDir(paths: { scaffoldDir: string; scaffoldVersionsDir: string }): void {
  fs.mkdirSync(paths.scaffoldDir, { recursive: true });
  fs.mkdirSync(paths.scaffoldVersionsDir, { recursive: true });
  const readmePath = path.join(paths.scaffoldDir, "README.md");
  if (!fs.existsSync(readmePath)) {
    fs.writeFileSync(readmePath, SCAFFOLD_README_TEMPLATE, "utf-8");
  }
}

function snapshotPriorContent(scaffoldVersionsDir: string, priorContent: string): void {
  // ISO timestamp resolution is 1ms; multiple snapshots within the same ms
  // would collide. Walk a counter suffix to find an unused filename.
  const stamp = new Date().toISOString().replace(/[:]/g, "-");
  let snapshotPath = path.join(scaffoldVersionsDir, `inner-loop-prompt.${stamp}.md`);
  let counter = 1;
  while (fs.existsSync(snapshotPath)) {
    snapshotPath = path.join(scaffoldVersionsDir, `inner-loop-prompt.${stamp}.${counter}.md`);
    counter++;
    if (counter > 1000) {
      // Defensive: pathological case where 1000+ snapshots land in the same
      // millisecond. Bail rather than spin forever.
      log.warn(`scaffold: > 1000 snapshot collisions at ${stamp}, giving up`);
      return;
    }
  }
  try {
    fs.writeFileSync(snapshotPath, priorContent, "utf-8");
    log.info("scaffold: snapshotted prior inner-loop-prompt before accepting change", {
      snapshotPath,
      priorBytes: priorContent.length,
    });
  } catch (err) {
    // A missing snapshot is worse than failing the new read, but not
    // catastrophic. The new content still takes effect.
    log.warn(`scaffold: failed to write snapshot ${snapshotPath}: ${String(err)}`);
  }
}

/**
 * Reset internal state. Tests only — production code never calls this.
 */
export function resetScaffoldStateForTest(): void {
  promptCache.clear();
}
