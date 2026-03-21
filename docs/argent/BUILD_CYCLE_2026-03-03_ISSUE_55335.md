# ArgentOS Update — 2026-03-03 Build Cycle (Issue #55335)

## Time Window

- Local (CST): March 3, 2026, ~8:50 PM-9:15 PM
- UTC: March 4, 2026, 02:50-03:15

## Verification Notes

- No local commits in this window (`git log --since='8 hours ago'` was empty).
- Work landed as uncommitted workspace changes + GitHub issue activity.

## Closed / Delivered in Window

1. Issue #49 closed at `2026-03-04T02:51:07Z` (8:51 PM CST)
   - VIP email native main-session audio alert path delivered.
2. Issue #51 closed at `2026-03-04T02:51:25Z` (8:51 PM CST)
   - Shared `send_payload` multi-channel fan-out delivered.
3. Issue #46 closed at `2026-03-04T03:04:34Z` (9:04 PM CST)
   - Customer onboarding flow delivered, including executable `onboarding_pack` tool.
4. Issue #47 closed at `2026-03-04T03:04:54Z` (9:04 PM CST)
   - Live demo onboarding skill package + call checklist/handoff contract delivered.

## Working Tree Summary: New Skills + Tooling Stack

### New Skills Added (14)

- `$autonomous-unblock` - keep going when blocked execution protocol
- `$vip-email` - VIP Gmail monitoring + alert routing + cron monitor
- `$podcast-production` - daily podcast workflow (research -> audio -> publish)
- `$coolify` - GitHub-to-Coolify deploy workflow
- `$railway` - Railway API operations
- `$vercel` - Vercel project/domain/deploy operations
- `$namecheap` - Namecheap DNS/domain operations
- `$easydmarc` - EasyDMARC API operations
- `$email-delivery` - Resend/Mailgun/SendGrid send/test
- `$twilio` - SMS/WhatsApp operations via Twilio
- `$send-payload` - one-payload fan-out to multiple channels
- `$notebooklm-research` - YouTube -> NotebookLM research pipeline
- `$argentinos-customer-onboarding` - full onboarding/discovery artifact workflow
- `$argentinos-demo-call` - structured live discovery/demo call workflow

### New/Updated Agent Tools

- `onboarding_pack` - generates strategy/spec/bootstrap/skills-gap artifacts from intake
- `send_payload` - fan-out routing to main-session + audio
- `vip_email` - expanded actions for VIP list, alerts config, scan, pending queue, cron monitor
- `slack_signal_monitor` - mention + keyword signal monitoring with alert/task automation
- `podcast_plan` - script/persona normalization + runbook
- `podcast_generate` - ElevenLabs text-to-dialogue + optional FFmpeg music mix
- `podcast_publish_pipeline` - orchestrates audio -> HeyGen -> metadata -> thumbnail -> optional YouTube upload
- `heygen_video` - avatar/voice list, payload build, generate, status, download
- `youtube_metadata_generate` - title/description/chapters/thumbnail brief
- `youtube_thumbnail_generate` - thumbnail image generation (Gemini/OpenAI/FAL)
- `youtube_notebooklm` - setup checks + YouTube search + NotebookLM workflow
- `coolify_deploy` - end-to-end Coolify provisioning/deploy
- `railway_deploy` - Railway test/list/graphql
- `vercel_deploy` - Vercel test/list/create/add-domain/list-deployments
- `namecheap_dns` - domain + DNS host management
- `easydmarc` - domain create + arbitrary API requests
- `email_delivery` - provider test + send flows
- `twilio_comm` - Twilio account + SMS/WhatsApp operations

### Gateway/Platform Work Added

- `tools.status` gateway method: enumerate core/plugin tools per agent
- AEVP classifier updates for new tools (`send_payload`, `vip_email`, `onboarding_pack`) in `aevp-tool-classify.ts`
- ACP MCP bridge enhancements:
  - `mcp.ts`
  - `translator.ts`
  - `logs-chat.ts`
  - `agent-runner-execution.ts`
- New tooling wired through central tool factory in `argent-tools.ts`

### Reference Packs Added

- Customer onboarding references
- Demo-call references
- Podcast references (publish targets, style profile, HeyGen scenes)

### Tests Added

- `heygen-video-tool.test.ts`
- `onboarding-pack-tool.test.ts`
- `podcast-plan-tool.test.ts`
- `podcast-publish-pipeline-tool.test.ts`
- `send-payload-tool.test.ts`
- `vip-email-tool.test.ts`
- `youtube-metadata-tool.test.ts`
- `youtube-notebooklm-tool.test.ts`
- `aevp-tool-classify.test.ts`
- `acp/mcp.test.ts`

## Workspace Scope Snapshot

- 216 changed/untracked files total
- Top-level concentration: `src` (147), `dashboard` (17), `skills` (15), `apps` (14), plus docs/scripts/assets

## Open Priority Issues

- #55 OpenAI codec/tool-call reliability regression
- #54 Slack signal monitor cron + signal extraction
- #53 Coolify deploy pipeline
- #52 Claude 4.6 adaptive thinking
- #50 Ollama embeddings for memory

## Known Operator-Reported Regressions Pending

- Calendar auth/path reliability after cutover
- Audio device enumeration in Swift dashboard container
- Session/menu simplification ("only show main chat session")
- Dashboard window usability/resizing/presence positioning

## Interpretation

This is a broad capability expansion across deployment, comms, onboarding, AI media production, and platform plumbing, with confirmed issue closures during the window and remaining reliability/UX tasks clearly queued.

## Sprint Addendum (2026-03-04)

- MemU background LLM runs now respect `memory.memu.llm` provider/model as an explicit selection to prevent model-router reroutes into unintended higher-cost providers.
- Added MemU automatic fallback to local Ollama when the configured primary MemU model fails.
- Covered by targeted unit tests (`src/memory/llm-config.test.ts`) and runner regression checks (`runEmbeddedPiAgent` auth/profile rotation suite).
