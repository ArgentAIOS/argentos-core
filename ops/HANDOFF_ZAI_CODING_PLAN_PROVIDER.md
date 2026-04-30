# Z.AI Coding Plan Provider Handoff

LANE LOCK:
Repo: ArgentAIOS/argentos-core
Local path: /Users/sem/code/argent-core
Target branch: dev
Forbidden repo for this task: ArgentAIOS/argentos
Reason: pure core foundation work

## Slice

- Branch: `codex/openai-codex-device-flow`
- Worktree: `/Users/sem/code/worktrees/argent-core-codex-device-flow`
- Intent: separate Z.AI direct API keys from Z.AI Coding Plan/Coder subscription keys without maintaining a second GLM model catalog.

## Behavior

- `zai` remains the Z.AI direct API provider and uses the general endpoint.
- `zai-coding` is now an Argent-local auth/provider identity for Z.AI Coding Plan keys.
- `zai-coding` model resolution borrows the existing `zai` model catalog row from Pi first, then Argent's fallback ZAI catalog, and rewrites only:
  - `provider: "zai-coding"`
  - `api: "openai-completions"`
  - base URL to `https://api.z.ai/api/coding/paas/v4/chat/completions`
- Dashboard auth profile creation now shows separate choices for `Z.AI API Direct` and `Z.AI Coding Plan`.
- Interactive and non-interactive onboarding can create `zai-coding:default`.
- `ZAI_CODING_API_KEY` and `ZAI_CODER_API_KEY` are recognized for coding-plan auth. `ZAI_API_KEY` intentionally remains direct API only.

## Verification

- `pnpm test -- src/agents/model-compat.test.ts src/agents/pi-embedded-runner/model.test.ts src/agents/model-auth.test.ts src/agents/model-selection.test.ts src/commands/auth-choice-options.test.ts src/commands/auth-choice.test.ts src/cli/program.smoke.test.ts`
- `pnpm exec oxlint src/agents/model-selection.ts src/agents/model-compat.ts src/agents/pi-embedded-runner/model.ts src/agents/model-auth.ts src/argent-ai/env-api-keys.ts src/commands/onboard-types.ts src/commands/onboard-auth.credentials.ts src/commands/onboard-auth.config-core.ts src/commands/onboard-auth.ts src/commands/auth-choice.apply.api-providers.ts src/commands/auth-choice-options.ts src/commands/onboard-non-interactive/local/auth-choice-inference.ts src/commands/onboard-non-interactive/local/auth-choice.ts src/cli/program/register.onboard.ts src/agents/live-model-filter.ts src/auto-reply/thinking.ts src/agents/pi-embedded-runner/run/attempt.ts`
- `node -c dashboard/api-server.cjs`
- `git remote get-url origin && pwd && git rev-parse --abbrev-ref HEAD && pnpm check:repo-lane`

## Known Gaps

- No live Z.AI Coding Plan request was made in this session.
- Dashboard visual/manual validation is still recommended: add one `zai` profile and one `zai-coding` profile, then confirm model dropdowns expose the same GLM IDs while runtime requests use different auth profiles/endpoints.
