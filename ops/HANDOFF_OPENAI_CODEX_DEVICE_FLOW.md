# OpenAI Codex Device OAuth Handoff

## Slice

- Branch: `codex/openai-codex-device-flow`
- Clean worktree: `/Users/sem/code/worktrees/argent-core-codex-device-flow`
- Base: `origin/dev` at `4a110c8717a18d122d47642a617ef7156bf3be05`
- Intent: make Argent's OpenAI Codex reconnect/login use the smoother Hermes-style device-code flow instead of requiring a localhost PKCE callback.

## Behavior

- CLI model auth now starts an OpenAI Codex device-code login, opens the verification URL, displays the user code, and writes the existing OAuth auth profile shape.
- Onboarding auth-choice flow uses the same device-code login path and keeps the existing default-model/profile updates.
- Dashboard reconnect endpoint keeps the same route, but starts an OpenAI Codex device-code session, returns `authUrl` plus `userCode`, and polls/exchanges in the API process.
- Dashboard Config Panel surfaces the user code after opening the OpenAI device login page.
- OpenAI Codex OAuth refresh now uses the Codex token endpoint directly, including rotated refresh tokens and explicit reauth guidance for reused/invalid refresh tokens.
- External CLI sync now attempts Codex CLI credential import alongside Claude/Qwen/Minimax-style external credential refresh.

## Changed Files

- `src/agents/openai-codex-auth.ts`
- `src/agents/openai-codex-auth.test.ts`
- `src/commands/models/auth.ts`
- `src/commands/auth-choice.apply.openai.ts`
- `src/agents/auth-profiles/oauth.ts`
- `src/agents/auth-profiles/external-cli-sync.ts`
- `dashboard/api-server.cjs`
- `dashboard/src/components/ConfigPanel.tsx`
- `ops/THREADMASTER_COORDINATION.md`

## Verification

- `pnpm install --frozen-lockfile --prefer-offline`
- `pnpm test -- src/agents/openai-codex-auth.test.ts src/agents/auth-profiles.chutes.test.ts src/agents/cli-credentials.test.ts src/commands/openai-codex-model-default.test.ts`
- `pnpm exec oxlint src/agents/openai-codex-auth.ts src/agents/openai-codex-auth.test.ts src/commands/models/auth.ts src/commands/auth-choice.apply.openai.ts src/agents/auth-profiles/oauth.ts src/agents/auth-profiles/external-cli-sync.ts`
- `node -c dashboard/api-server.cjs`
- `git remote get-url origin && pwd && git rev-parse --abbrev-ref HEAD && pnpm check:repo-lane`

## Known Gaps

- Live OpenAI Codex OAuth was not completed against a real account in this agent session.
- Full `pnpm tsgo` still fails on unrelated baseline errors from `origin/dev`; the new `openai-codex-auth.ts` issue that `tsgo` found was fixed.
- Full `oxlint` on `dashboard/src/components/ConfigPanel.tsx` and `dashboard/api-server.cjs` is noisy with pre-existing lint findings, so lint verification was scoped to the new/shared TypeScript auth files and dashboard API syntax.
- The dashboard PKCE callback route remains in place for compatibility, but the reconnect start route no longer depends on it.

## Threadmaster Ask

Please review the dashboard reconnect UX manually with a live OpenAI Codex account:

1. Open Settings -> Models -> OpenAI Codex.
2. Trigger `Reconnect Codex`.
3. Confirm the OpenAI device page opens and the code shown in the Config Panel matches the device code.
4. Complete login in the browser and confirm the auth profile flips to connected without needing localhost callback plumbing.
