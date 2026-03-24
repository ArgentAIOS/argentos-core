# CLAUDE.md

## Tracking and Documentation (Mandatory)

Linear is the operational source of truth for active work. Chat is not the source of truth.

Required defaults:

1. Before significant implementation, release, installer, CI, or incident work, locate the Linear issue or create one.
2. Record the active branch, target repo (`argentos` vs `argentos-core` vs website mirror), and acceptance criteria in Linear.
3. Update Linear as work progresses with the current blocker, the current commit/PR, and required review gates.
4. For release-facing work, explicitly track Blacksmith and CodeRabbit state in Linear until merge/release is complete.
5. If Linear is unavailable in the current session, say so immediately and do not pretend the work is documented there.

## Slice (Worktree) Management (Mandatory)

A "slice" is an isolated worktree or branch created for a specific task. Slices are temporary and must not accumulate.

**Rules:**

1. **Document every slice in Linear.** When creating a slice/worktree, add a comment to the relevant Linear issue with: slice name, branch name, purpose, and which files it touches.
2. **Track completion.** Update the Linear issue with a percentage estimate as work progresses (0%/25%/50%/75%/100%). This is mandatory, not optional.
3. **Never silently switch slices.** Before moving to a different slice or back to main, explicitly state what is being left behind, what state it is in, and whether it has uncommitted changes.
4. **Merge or discard — no zombies.** A slice must be merged into main within the same session or the next session. If it cannot be merged, document why in Linear and set a deadline.
5. **Clean up after merge.** Once a slice is merged, delete the worktree directory and the remote branch. Do not leave stale slice directories in the code folder.
6. **Never move main off a working state.** Do not checkout a different branch on the primary worktree if it will break the user's running services (gateway, agent, dashboard). Use a separate worktree instead.
7. **Dirty slice = blocker.** If a slice has uncommitted changes that conflict with main, that is a blocking issue. Create a Linear issue immediately, tag it as a blocker, and resolve before starting new work.
8. **Salvage before cleanup.** If a slice is being abandoned, create a salvage branch (`salvage/<slice-name>`) before deleting the worktree so no work is lost.
