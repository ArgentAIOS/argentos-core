# Argent Agent Handoff: Skills and Tooling Update

## Scope

This handoff summarizes the new capabilities added in this build cycle:

1. New skills (operator workflows)
2. New core tools (runtime-executable actions)
3. Gateway/runtime integration updates
4. Test coverage added
5. Copy-ready example payloads

## Sprint Inclusion

- Sprint: Current (2026-03-03 build cycle)
- Added item: `Issue #55335` — ArgentOS Update (2026-03-03 build cycle)
- Added item: MemU cost-control patch (2026-03-04) — pin MemU model selection + Ollama fallback
- Status: Added to sprint tracker scope in this handoff document for execution visibility
- Canonical sprint record: `docs/argent/BUILD_CYCLE_2026-03-03_ISSUE_55335.md`

## New Skills Added

| Skill                            | Purpose                                                                      | Primary Tooling                                                                                                                           |
| -------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `autonomous-unblock`             | Keep progress moving through blockers with safe defaults and fallback paths. | Process protocol (no single tool)                                                                                                         |
| `vip-email`                      | VIP Gmail monitoring, deduped alerts, cron monitor, pending queue.           | `vip_email`, `gog`                                                                                                                        |
| `slack-signal-monitor`           | Mention + keyword monitoring in Slack with alerts/tasks/cron.                | `slack_signal_monitor`                                                                                                                    |
| `podcast-production`             | Daily multi-persona podcast workflow from planning to publish pipeline.      | `podcast_plan`, `podcast_generate`, `podcast_publish_pipeline`, `heygen_video`, `youtube_metadata_generate`, `youtube_thumbnail_generate` |
| `notebooklm-research`            | YouTube-to-NotebookLM research and optional infographic generation.          | `youtube_notebooklm`                                                                                                                      |
| `argentinos-customer-onboarding` | Full customer onboarding discovery and artifact generation.                  | `onboarding_pack`                                                                                                                         |
| `argentinos-demo-call`           | Structured live sales/discovery call execution.                              | `onboarding_pack` (artifact generation), references                                                                                       |
| `coolify`                        | Deploy and manage projects on Coolify.                                       | `coolify_deploy`                                                                                                                          |
| `railway`                        | Railway API operations.                                                      | `railway_deploy`                                                                                                                          |
| `vercel`                         | Vercel project/domain/deploy operations.                                     | `vercel_deploy`                                                                                                                           |
| `namecheap`                      | Namecheap DNS/domain operations.                                             | `namecheap_dns`                                                                                                                           |
| `easydmarc`                      | EasyDMARC API operations.                                                    | `easydmarc`                                                                                                                               |
| `email-delivery`                 | Provider-based outbound email send/test.                                     | `email_delivery`                                                                                                                          |
| `twilio`                         | Twilio SMS/WhatsApp operations.                                              | `twilio_comm`                                                                                                                             |
| `send-payload`                   | Fan out one payload to multiple channels/surfaces.                           | `send_payload`                                                                                                                            |

## New Skills File Paths

1. `skills/autonomous-unblock/SKILL.md`
2. `skills/vip-email/SKILL.md`
3. `skills/slack-signal-monitor/SKILL.md`
4. `skills/podcast-production/SKILL.md`
5. `skills/notebooklm-research/SKILL.md`
6. `skills/argentinos-customer-onboarding/SKILL.md`
7. `skills/argentinos-demo-call/SKILL.md`
8. `skills/coolify/SKILL.md`
9. `skills/railway/SKILL.md`
10. `skills/vercel/SKILL.md`
11. `skills/namecheap/SKILL.md`
12. `skills/easydmarc/SKILL.md`
13. `skills/email-delivery/SKILL.md`
14. `skills/twilio/SKILL.md`
15. `skills/send-payload/SKILL.md`

## Skill Reference Packs Added

1. `skills/podcast-production/references/publish-targets.md`
2. `skills/podcast-production/references/youtube-style-creator-longform.json`
3. `skills/podcast-production/references/heygen-scenes-argent.json`
4. `skills/argentinos-customer-onboarding/references/*`
5. `skills/argentinos-demo-call/references/*`

## New Core Tools Added

| Tool Name                    | Label                    | Key Actions                                                                                                                                                                                                   |
| ---------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `onboarding_pack`            | Onboarding Pack          | `generate`                                                                                                                                                                                                    |
| `send_payload`               | Send Payload             | fan-out by route (`main-session`, `audio`, external channels)                                                                                                                                                 |
| `vip_email`                  | VIP Email                | `status`, `list_vips`, `add_vip`, `remove_vip`, `set_accounts`, `set_alerts`, `scan_now`, `check_pending`, `ensure_cron_monitor`, `disable_cron_monitor`, `clear_seen`                                        |
| `slack_signal_monitor`       | Slack Signal Monitor     | `status`, `set_config`, `scan_now`, `ensure_cron_monitor`, `disable_cron_monitor`, `clear_seen`                                                                                                               |
| `podcast_plan`               | Podcast Plan             | script/persona normalization output for generation                                                                                                                                                            |
| `podcast_generate`           | Podcast Generate         | one-shot dialogue render + optional FFmpeg post-mix                                                                                                                                                           |
| `podcast_publish_pipeline`   | Podcast Publish Pipeline | `mode: plan` and `mode: run` orchestrator                                                                                                                                                                     |
| `heygen_video`               | HeyGen Video             | `list_avatars`, `list_voices`, `build_payload`, `generate_video`, `video_status`, `download_video`                                                                                                            |
| `youtube_metadata_generate`  | YouTube Metadata         | title/description/chapters/brief generation                                                                                                                                                                   |
| `youtube_thumbnail_generate` | YouTube Thumbnail        | image generation with provider selection                                                                                                                                                                      |
| `youtube_notebooklm`         | YouTube + NotebookLM     | `setup_status`, `youtube_search`, `notebook_create`, `notebook_add_sources`, `notebook_ask`, `notebook_generate_infographic`, `youtube_to_notebook_workflow`                                                  |
| `coolify_deploy`             | Coolify Deploy           | `test_connection`, `list_servers`, `list_projects`, `create_project`, `create_database`, `create_application`, `trigger_deploy`, `deployment_status`, `deployment_logs`, `teardown_project`, `deploy_project` |
| `railway_deploy`             | Railway Deploy           | `test_connection`, `list_projects`, `graphql`                                                                                                                                                                 |
| `vercel_deploy`              | Vercel Deploy            | `test_connection`, `list_projects`, `create_project`, `add_domain`, `list_deployments`                                                                                                                        |
| `namecheap_dns`              | Namecheap DNS            | `test_connection`, `check_domain`, `get_hosts`, `set_hosts`, `raw`                                                                                                                                            |
| `easydmarc`                  | EasyDMARC                | `create_domain`, `request`                                                                                                                                                                                    |
| `email_delivery`             | Email Delivery           | `test_provider`, `send_resend`, `send_mailgun`, `send_sendgrid`                                                                                                                                               |
| `twilio_comm`                | Twilio Comm              | `test_connection`, `list_numbers`, `send_sms`, `send_whatsapp`                                                                                                                                                |

## Runtime/Gateway Integration Updates

1. New tools were wired into core registry in `src/agents/argent-tools.ts`.
2. New gateway method `tools.status` added via `src/gateway/server-methods/tools.ts`.
3. Gateway protocol schemas/types updated for tool status support.
4. AEVP classifier updated:
   - `send_payload` => `communicate`
   - `vip_email` => `communicate`
   - `onboarding_pack` => `analyze`
5. ACP MCP passthrough added:
   - session MCP normalization/storage
   - forwarded from ACP prompt -> `chat.send`
   - injected into CLI backend config per run

## Copy-Ready Action Examples

### 1) VIP Email Setup

```json
{
  "action": "set_alerts",
  "ttsEnabled": true,
  "mainSessionAudioAlert": true,
  "channelRoutes": [{ "channel": "discord", "target": "user:123", "bestEffort": true }]
}
```

```json
{
  "action": "ensure_cron_monitor",
  "intervalSeconds": 120
}
```

### 2) Slack Signal Monitor Setup

```json
{
  "action": "set_config",
  "watchedChannels": ["C07CHJ7D6F4"],
  "mentionNames": ["jason"],
  "keywordWatchlist": ["DNS", "DMARC", "domain transfer", "website", "urgent", "ASAP", "blocked"],
  "intervalSeconds": 300,
  "lookbackMinutes": 10,
  "taskCreationEnabled": true,
  "audioAlertEnabled": true,
  "mainSessionAudioAlert": true
}
```

### 3) Podcast Plan -> Generate

```json
{
  "title": "Bleeding Edge Episode",
  "personas": [
    { "id": "argent", "voice_id": "cgSgspJ2msm6clMCkdW9", "aliases": ["ARGENT", "HOST"] },
    { "id": "juniper", "voice_id": "aMSt68OGf4xUZAnLpTU8", "aliases": ["JUNIPER"] }
  ],
  "script": "ARGENT: Welcome.\nJUNIPER: Let's break it down.",
  "publish": { "spotify": true, "youtube": true, "heygen": true }
}
```

```json
{
  "title": "Bleeding Edge Episode",
  "dialogue": [
    { "text": "[energetic] Welcome to the show.", "voice_id": "cgSgspJ2msm6clMCkdW9" },
    { "text": "[warm] Juniper here.", "voice_id": "aMSt68OGf4xUZAnLpTU8" }
  ],
  "model_id": "eleven_v3",
  "output_format": "mp3_44100_192"
}
```

### 4) One-Call Publish Pipeline

```json
{
  "mode": "run",
  "podcast_generate": {
    "title": "Bleeding Edge Episode",
    "dialogue": [{ "text": "Welcome.", "voice_id": "cgSgspJ2msm6clMCkdW9" }]
  },
  "heygen": {
    "enabled": true,
    "wait_for_completion": true,
    "params": {
      "default_avatar_id": "885b0ad5cd61488b8a9828ff0e244e15",
      "scenes": [
        {
          "script": "Opening scene.",
          "voice_id": "REPLACE_HEYGEN_VOICE_ID",
          "background_type": "color",
          "background_value": "#0F172A"
        }
      ]
    }
  },
  "youtube_metadata": {
    "description_style": "creator_longform",
    "style_profile_path": "skills/podcast-production/references/youtube-style-creator-longform.json"
  },
  "youtube_upload": {
    "enabled": true,
    "privacy_status": "private",
    "notify_subscribers": false
  }
}
```

### 5) HeyGen Scene Build Only

```json
{
  "action": "build_payload",
  "default_avatar_id": "885b0ad5cd61488b8a9828ff0e244e15",
  "scenes": [
    {
      "script": "Intro scene",
      "voice_id": "voice_1",
      "background_type": "color",
      "background_value": "#101820"
    },
    {
      "script": "B-roll scene",
      "voice_id": "voice_1",
      "background_type": "video",
      "background_value": "https://cdn.example.com/broll.mp4",
      "background_play_style": "fit_to_scene"
    }
  ]
}
```

### 6) YouTube Metadata + Thumbnail

```json
{
  "episode_title": "The Great Model Convergence",
  "description_style": "creator_longform",
  "key_points": ["Model capability gaps are shrinking", "Inference cost keeps dropping"],
  "hashtags": ["AI", "AGI", "Agents"]
}
```

```json
{
  "headline": "AI Crossed a Line",
  "subheadline": "What changed this week",
  "provider": "gemini",
  "aspect_ratio": "16:9"
}
```

### 7) NotebookLM End-to-End

```json
{
  "action": "youtube_to_notebook_workflow",
  "query": "frontier model convergence march 2026",
  "count": 10,
  "months": 6,
  "question": "What are the strongest recurring GTM and infrastructure patterns?",
  "generate_infographic": true
}
```

### 8) Customer Onboarding Pack

```json
{
  "action": "generate",
  "intake": {
    "company": { "name": "CTSA", "industry": "MSP", "headcount": 42 },
    "contacts": [{ "name": "Jason", "role": "Owner", "email": "jason@example.com" }],
    "painPoints": [{ "statement": "Incident alerts are noisy and ignored." }],
    "outcomes": { "dayOneAnchor": "Auto-triage critical alerts." },
    "integrations": ["Slack", "Coolify"]
  },
  "saveToDocPanel": true,
  "knowledgeCollection": "onboarding"
}
```

### 9) Deploy Targets

```json
{
  "action": "deploy_project",
  "project_name": "invoicer",
  "repo_org": "webdevtodayjason",
  "repo_name": "invoicer",
  "domain": "invoicer.semfreak.dev",
  "deploy_now": true
}
```

```json
{ "action": "create_project", "project_name": "my-app" }
```

```json
{
  "action": "set_hosts",
  "domain": "example.com",
  "hosts": [{ "type": "A", "name": "@", "address": "1.2.3.4", "ttl": 1800 }]
}
```

### 10) Multi-Channel Fan-Out

```json
{
  "message": "VIP email detected from Dustin.",
  "routes": [
    { "channel": "discord", "target": "user:123" },
    { "channel": "main-session" },
    { "channel": "audio", "bestEffort": true }
  ]
}
```

## ACP MCP Bridge Notes (New)

1. ACP now advertises MCP transport capability (`http` + `sse`).
2. ACP normalizes `mcpServers` and stores diagnostics.
3. Diagnostics are returned in ACP response `_meta`.
4. Session MCP map is forwarded into `chat.send`.
5. CLI run config is patched per run so MCP reaches CLI backends.

Key files:

1. `src/acp/mcp.ts`
2. `src/acp/translator.ts`
3. `src/gateway/protocol/schema/logs-chat.ts`
4. `src/gateway/server-methods/chat.ts`
5. `src/auto-reply/reply/agent-runner-execution.ts`

## Tests Added

1. `src/agents/tools/heygen-video-tool.test.ts`
2. `src/agents/tools/onboarding-pack-tool.test.ts`
3. `src/agents/tools/podcast-plan-tool.test.ts`
4. `src/agents/tools/podcast-publish-pipeline-tool.test.ts`
5. `src/agents/tools/send-payload-tool.test.ts`
6. `src/agents/tools/slack-signal-monitor-tool.test.ts`
7. `src/agents/tools/vip-email-tool.test.ts`
8. `src/agents/tools/youtube-metadata-tool.test.ts`
9. `src/agents/tools/youtube-notebooklm-tool.test.ts`
10. `src/gateway/aevp-tool-classify.test.ts`
11. `src/acp/mcp.test.ts`

## Short Operator Brief

Argent now has a coherent growth stack:

1. Intake and onboarding (`onboarding_pack`, demo/onboarding skills)
2. Signal monitoring (`vip_email`, `slack_signal_monitor`)
3. Multi-channel execution (`send_payload`, Twilio/email providers)
4. Media pipeline (`podcast_*`, `heygen_video`, YouTube metadata/thumbnail/upload path)
5. Deploy pipeline (`coolify_deploy`, `railway_deploy`, `vercel_deploy`, `namecheap_dns`, `easydmarc`)
6. Better autonomy scaffolding (`autonomous-unblock`)
