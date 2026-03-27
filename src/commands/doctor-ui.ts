import fs from "node:fs/promises";
import path from "node:path";
import type { RuntimeEnv } from "../runtime.js";
import type { DoctorPrompter } from "./doctor-prompter.js";
import { resolveArgentPackageRoot } from "../infra/argent-root.js";
import { runCommandWithTimeout } from "../process/exec.js";
import { note } from "../terminal/note.js";

export async function maybeRepairUiProtocolFreshness(
  _runtime: RuntimeEnv,
  prompter: DoctorPrompter,
) {
  const root = await resolveArgentPackageRoot({
    moduleUrl: import.meta.url,
    argv1: process.argv[1],
    cwd: process.cwd(),
  });

  if (!root) {
    return;
  }

  const schemaPath = path.join(root, "src/gateway/protocol/schema.ts");
  const uiIndexPath = path.join(root, "dist/control-ui/index.html");

  try {
    const [schemaStats, uiStats] = await Promise.all([
      fs.stat(schemaPath).catch(() => null),
      fs.stat(uiIndexPath).catch(() => null),
    ]);

    if (schemaStats && !uiStats) {
      note(
        ["- Argent control surface assets are missing.", "- Run: pnpm ui:build"].join("\n"),
        "Argent UI",
      );

      // In slim/docker environments we may not have the UI source tree. Trying
      // to build would fail (and spam logs), so skip the interactive repair.
      const uiSourcesPath = path.join(root, "ui/package.json");
      const uiSourcesExist = await fs.stat(uiSourcesPath).catch(() => null);
      if (!uiSourcesExist) {
        note("Skipping UI build: ui/ sources are not present in this install.", "Argent UI");
        return;
      }

      const shouldRepair = await prompter.confirmRepair({
        message: "Build Argent control surface assets now?",
        initialValue: true,
      });

      if (shouldRepair) {
        note("Building Argent control surface assets... (this may take a moment)", "Argent UI");
        const uiScriptPath = path.join(root, "scripts/ui.js");
        const buildResult = await runCommandWithTimeout([process.execPath, uiScriptPath, "build"], {
          cwd: root,
          timeoutMs: 120_000,
          env: { ...process.env, FORCE_COLOR: "1" },
        });
        if (buildResult.code === 0) {
          note("Argent UI build complete.", "Argent UI");
        } else {
          const details = [
            `UI build failed (exit ${buildResult.code ?? "unknown"}).`,
            buildResult.stderr.trim() ? buildResult.stderr.trim() : null,
          ]
            .filter(Boolean)
            .join("\n");
          note(details, "Argent UI");
        }
      }
      return;
    }

    if (!schemaStats || !uiStats) {
      return;
    }

    if (schemaStats.mtime > uiStats.mtime) {
      const uiMtimeIso = uiStats.mtime.toISOString();
      // Find changes since the UI build
      const gitLog = await runCommandWithTimeout(
        [
          "git",
          "-C",
          root,
          "log",
          `--since=${uiMtimeIso}`,
          "--format=%h %s",
          "src/gateway/protocol/schema.ts",
        ],
        { timeoutMs: 5000 },
      ).catch(() => null);

      if (gitLog && gitLog.code === 0 && gitLog.stdout.trim()) {
        note(
          `UI assets are older than the protocol schema.\nFunctional changes since last build:\n${gitLog.stdout
            .trim()
            .split("\n")
            .map((l) => `- ${l}`)
            .join("\n")}`,
          "Argent UI freshness",
        );

        const shouldRepair = await prompter.confirmAggressive({
          message: "Rebuild Argent UI now? (Detected protocol mismatch requiring update)",
          initialValue: true,
        });

        if (shouldRepair) {
          const uiSourcesPath = path.join(root, "ui/package.json");
          const uiSourcesExist = await fs.stat(uiSourcesPath).catch(() => null);
          if (!uiSourcesExist) {
            note("Skipping UI rebuild: ui/ sources are not present in this install.", "Argent UI");
            return;
          }

          note("Rebuilding stale Argent UI assets... (this may take a moment)", "Argent UI");
          // Use scripts/ui.js to build, assuming node is available as we are running in it.
          // We use the same node executable to run the script.
          const uiScriptPath = path.join(root, "scripts/ui.js");
          const buildResult = await runCommandWithTimeout(
            [process.execPath, uiScriptPath, "build"],
            {
              cwd: root,
              timeoutMs: 120_000,
              env: { ...process.env, FORCE_COLOR: "1" },
            },
          );
          if (buildResult.code === 0) {
            note("Argent UI rebuild complete.", "Argent UI");
          } else {
            const details = [
              `UI rebuild failed (exit ${buildResult.code ?? "unknown"}).`,
              buildResult.stderr.trim() ? buildResult.stderr.trim() : null,
            ]
              .filter(Boolean)
              .join("\n");
            note(details, "Argent UI");
          }
        }
      }
    }
  } catch {
    // If files don't exist, we can't check.
    // If git fails, we silently skip.
    // runtime.debug(`UI freshness check failed: ${String(err)}`);
  }
}
