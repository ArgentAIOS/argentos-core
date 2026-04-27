LANE LOCK:
Repo: ArgentAIOS/argentos-core
Local path: /Users/sem/code/argent-core
Target branch: dev
Forbidden repo for this task: ArgentAIOS/argentos
Reason: pure core foundation work

# Hermes Skills Integration Slice

## Branch

- Branch: `codex/hermes-skills-integration`
- Scope: agent skill discovery, bundled skill catalog, and prompt presentation
- Non-goal: replacing Pi. The previous Pi-removal direction is deprecated; this slice keeps the current runtime and improves the skill catalog plus prompt contract on top of it.

## Intent

Hermes appears to get a high skill-hit rate from two behaviors worth copying:

- A broad, categorized local skill catalog that covers many ordinary user intents.
- A prompt contract that makes the agent select and load one skill on partial relevance instead of waiting for a perfect match.

This slice imports the active Hermes skill catalog under a namespaced `skills/hermes/**` tree and renders workspace skills grouped by category with category descriptions. It also adjusts the agent system prompt so an agent should load one skill when a category or skill partially overlaps with the user's request.

## Plan

1. Preserve the current Pi-backed skill runtime and loader behavior.
2. Import the active Hermes profile skills into Argent as bundled, namespaced skills.
3. Avoid collisions with existing Argent bundled skills by prefixing imported skill names with `hermes-`.
4. Present skills by category in `<available_skills>` so agents can scan intent areas before choosing a skill.
5. Update mandatory skill-selection guidance to prefer one specific partially relevant skill over no skill.
6. Add focused tests around categorized prompt rendering and updated system-prompt guidance.

## Changes

- Imported 77 active Hermes profile skills into `skills/hermes/**`.
- Preserved Hermes category `DESCRIPTION.md` files and supporting references/assets/scripts where present.
- Added category-aware skill prompt formatting in `src/agents/skills/workspace.ts`.
- Updated `src/agents/system-prompt.ts` so skill selection triggers on matching, overlapping, or partial relevance.
- Added focused tests in `src/agents/skills.test.ts` and updated `src/agents/system-prompt.test.ts`.

## Threadmaster Notes

- This is a core agent-foundation slice, not AppForge, AOS connector, Workflows runtime, or commercial packaging work.
- The import is additive and namespaced. Existing flat bundled Argent skills retain their existing names and precedence.
- The Hermes skills are broad. Threadmaster should expect future follow-up cleanup to tune descriptions, remove unsafe or low-value imported skills, and normalize any skills that assume Hermes-only CLI surfaces.
- No workflow, connector, AppForge, dashboard, schema, installer, or update-path contracts were intentionally changed.

## Verification

Passed:

```sh
pnpm vitest run src/agents/skills.test.ts src/agents/skills.resolveskillspromptforrun.test.ts src/agents/system-prompt.test.ts
pnpm exec oxlint --type-aware src/agents/skills/workspace.ts src/agents/system-prompt.ts src/agents/skills.test.ts src/agents/system-prompt.test.ts src/agents/skills.resolveskillspromptforrun.test.ts
git diff --check
pnpm check:repo-lane
```

Known blocked verification:

```sh
pnpm exec tsc --noEmit --pretty false
```

The full repo typecheck remains blocked by existing repo-wide type errors outside this slice. Focused tests and type-aware lint on touched code passed.

## Remaining Risks

- Some imported Hermes skills may reference Hermes-specific commands, assumptions, or optional local tools. They are intentionally progressive-disclosure instructions, so this is acceptable for the first import, but they should be audited over time.
- Broad partial-match guidance can increase skill-loading frequency. That is the desired Hermes-like behavior, but prompt noise and false-positive skill selection should be watched in live agent traces.
- The category renderer reads `DESCRIPTION.md` frontmatter synchronously during prompt construction. The catalog is local and small enough for this slice; cache invalidation is process-lifetime only.
