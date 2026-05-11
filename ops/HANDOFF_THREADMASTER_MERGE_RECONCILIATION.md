# Threadmaster Merge Reconciliation Handoff

## Summary

This slice reconciles ready branches that were still outside `origin/dev` after
the Threadmaster freeze audit.

## Applied To Dev

- `c125f2c3` / source `8d170703`: persisted TableForge/AppForge saved views.
- `a8618458` / source `90a01c69`: Airtable service-key hardening.
- `79b460dc` / source `406c2d54`: Buffer service-key hardening.
- `bb7ba529` / source `a000a0b9`: Hootsuite service-key hardening.
- `723aeab2` / source `117ab231`: Slack service-key hardening.
- `9c82505e`: root changelog and coordination formatting reconciliation.

## Equivalent Or Already Contained

- `a579eb73` AppForge native editing: empty on current `dev`.
- `b291447e` Workflows visible-canvas run state: empty on current `dev`.
- `6c12fed4` Discord Workflow service-key hardening: empty after preserving
  existing coordination-board content.
- `origin/codex/openclaw-realtime-fake-provider`: `git cherry` marked all 8
  commits patch-equivalent to current `dev`; current `dev` already has the
  realtime voice files and handoff packet.
- `origin/codex/openclaw-audio-process`: code/runbook/changelog packet already
  present on current `dev`; cherry-picks for the remaining handoff/changelog
  commits were empty after keeping the richer current packet.

## Verification

- `pnpm exec vitest run src/infra/app-forge-structured-data.test.ts`: 11 passed.
- `uvx --python 3.12 --with click --with requests --with pytest pytest tools/aos/aos-airtable/agent-harness/tests/test_cli.py`: 28 passed.
- `uvx --python 3.12 --with click --with requests --with pytest pytest tools/aos/aos-buffer/agent-harness/tests/test_cli.py`: 17 passed.
- `uvx --python 3.12 --with click --with requests --with pytest pytest tools/aos/aos-hootsuite/agent-harness/tests/test_cli.py`: 18 passed.
- `python3 -m pytest tools/aos/aos-slack/agent-harness/tests/test_cli.py`: 20 passed.
- Connector manifests validated with `python3 -m json.tool`.
- Changed AOS Python packages compile with Python 3.12 `compileall`.
- `pnpm exec oxfmt --check` on touched changelog/AppForge/coordination files.
- `pnpm exec oxlint` on touched AppForge TypeScript files.
- `git diff --check`.
- `pnpm check:repo-lane`.
- Conflict-marker scan for real Git markers passed.

## Notes

- The fresh worktree did not have local `node_modules`; temporary symlinks to
  the dependency-ready Codex auth worktree were used for Node verification.
- macOS system Python is 3.9 and cannot collect the newer AOS harnesses because
  they use `dataclass(slots=True)`. Python 3.12 verification was run with `uvx`.
