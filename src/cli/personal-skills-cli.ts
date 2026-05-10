import type { Command } from "commander";
import {
  purgeAudioTranscriptPersonalSkills,
  type PersonalSkillPurgeResult,
} from "../agents/skills/personal.js";
import { getMemoryAdapter } from "../data/storage-factory.js";
import { defaultRuntime } from "../runtime.js";

export type PersonalSkillsPurgeOptions = {
  kind?: string;
  dryRun?: boolean;
  json?: boolean;
};

/**
 * Format a purge result for human-readable CLI output.
 */
export function formatPersonalSkillsPurgeResult(
  result: PersonalSkillPurgeResult,
  opts: { kind: string; json?: boolean },
): string {
  if (opts.json) {
    return JSON.stringify({ kind: opts.kind, ...result }, null, 2);
  }

  const lines: string[] = [];
  const verb = result.dryRun ? "Would archive" : "Archived";
  lines.push(`Personal Skills purge (kind=${opts.kind}${result.dryRun ? ", dry-run" : ""})`);
  lines.push(`Scanned: ${result.scanned} candidate(s)`);
  lines.push(`Matched: ${result.matched.length} polluted row(s)`);

  if (result.matched.length === 0) {
    lines.push("");
    lines.push("Nothing to clean up. Run again with no --dry-run after new pollution appears.");
    return lines.join("\n");
  }

  lines.push("");
  lines.push("Matched rows:");
  for (const row of result.matched) {
    const truncatedTitle = row.title.length > 96 ? `${row.title.slice(0, 93)}…` : row.title;
    lines.push(
      `  - [${row.previousState}] ${row.id}  usage=${row.usageCount} success=${row.successCount} failure=${row.failureCount}`,
    );
    lines.push(`      ${truncatedTitle}`);
  }

  lines.push("");
  lines.push(`${verb} ${result.archived} row(s) (state -> deprecated, soft-delete is reversible).`);
  if (result.dryRun) {
    lines.push("Re-run without --dry-run to apply the changes.");
  } else {
    lines.push("");
    lines.push(
      "To restore any row: use the `personal_skill` agent tool with action='patch' and state='incubating' (or 'candidate'), or query review_events for the previousState.",
    );
  }
  return lines.join("\n");
}

/**
 * Register the personal-skills CLI commands.
 */
export function registerPersonalSkillsCli(program: Command) {
  const personalSkills = program
    .command("personal-skills")
    .alias("personal-skill")
    .description("Inspect and maintain DB-backed Personal Skills");

  personalSkills
    .command("purge")
    .description(
      "Soft-delete polluted Personal Skill candidates. Currently supported --kind: audio-transcript.",
    )
    .option(
      "--kind <kind>",
      "Pollution kind to purge (currently only 'audio-transcript')",
      "audio-transcript",
    )
    .option("--dry-run", "Show what would be archived without making changes", false)
    .option("--json", "Output result as JSON", false)
    .action(async (opts: PersonalSkillsPurgeOptions) => {
      try {
        const kind = (opts.kind ?? "audio-transcript").trim().toLowerCase();
        if (kind !== "audio-transcript") {
          defaultRuntime.error(
            `Unsupported --kind '${kind}'. Only 'audio-transcript' is implemented today.`,
          );
          defaultRuntime.exit(2);
          return;
        }
        const memory = await getMemoryAdapter();
        const result = await purgeAudioTranscriptPersonalSkills({
          memory,
          dryRun: opts.dryRun === true,
        });
        defaultRuntime.log(formatPersonalSkillsPurgeResult(result, { kind, json: opts.json }));
      } catch (err) {
        defaultRuntime.error(String(err));
        defaultRuntime.exit(1);
      }
    });
}
