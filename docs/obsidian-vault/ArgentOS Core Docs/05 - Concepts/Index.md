# Concepts

Core architecture, sessions, memory, routing, OAuth, models, and product boundaries.

- [Agent Loop](<90 - Public Docs Mirror/docs/concepts/agent-loop.md>) - Agent loop lifecycle, streams, and wait semantics
- [Agent Workspace](<90 - Public Docs Mirror/docs/concepts/agent-workspace.md>) - Agent workspace: location, layout, and backup strategy
- [Agent Runtime](<90 - Public Docs Mirror/docs/concepts/agent.md>) - Agent runtime (embedded pi-mono), workspace contract, and session bootstrap
- [Gateway Architecture](<90 - Public Docs Mirror/docs/concepts/architecture.md>) - WebSocket gateway architecture, components, and client flows
- [Channel Routing](<90 - Public Docs Mirror/docs/concepts/channel-routing.md>) - Routing rules per channel (WhatsApp, Telegram, Discord, Slack) and shared context
- [Compaction](<90 - Public Docs Mirror/docs/concepts/compaction.md>) - Context window + compaction: how ArgentOS keeps sessions under model limits
- [Context](<90 - Public Docs Mirror/docs/concepts/context.md>) - Context: what the model sees, how it is built, and how to inspect it
- [Core and Business Boundary](<90 - Public Docs Mirror/docs/concepts/core-business-boundary.md>) - ArgentOS Core versus Business boundary and licensing overlay model
- [Features](<90 - Public Docs Mirror/docs/concepts/features.md>) - ArgentOS capabilities across channels, routing, media, and UX.
- [Group Messages](<90 - Public Docs Mirror/docs/concepts/group-messages.md>) - Behavior and config for WhatsApp group message handling (mentionPatterns are shared across surfaces)
- [Groups](<90 - Public Docs Mirror/docs/concepts/groups.md>) - Group chat behavior across surfaces (WhatsApp/Telegram/Discord/Slack/Signal/iMessage/Microsoft Teams)
- [Markdown Formatting](<90 - Public Docs Mirror/docs/concepts/markdown-formatting.md>) - Markdown formatting pipeline for outbound channels
- [Memory](<90 - Public Docs Mirror/docs/concepts/memory.md>) - How ArgentOS memory works (workspace files + automatic memory flush)
- [Messages](<90 - Public Docs Mirror/docs/concepts/messages.md>) - Message flow, sessions, queueing, and reasoning visibility
- [Model Failover](<90 - Public Docs Mirror/docs/concepts/model-failover.md>) - How ArgentOS rotates auth profiles and falls back across models
- [Model Providers](<90 - Public Docs Mirror/docs/concepts/model-providers.md>) - Model provider overview with example configs + CLI flows
- [Models CLI](<90 - Public Docs Mirror/docs/concepts/models.md>) - Models CLI: list, set, aliases, fallbacks, scan, status
- [Multi-Agent Routing](<90 - Public Docs Mirror/docs/concepts/multi-agent.md>) - Multi-agent routing: isolated agents, channel accounts, and bindings
- [OAuth](<90 - Public Docs Mirror/docs/concepts/oauth.md>) - OAuth in ArgentOS: token exchange, storage, and multi-account patterns
- [Presence](<90 - Public Docs Mirror/docs/concepts/presence.md>) - How ArgentOS presence entries are produced, merged, and displayed
- [Command Queue](<90 - Public Docs Mirror/docs/concepts/queue.md>) - Command queue design that serializes inbound auto-reply runs
- [Retry Policy](<90 - Public Docs Mirror/docs/concepts/retry.md>) - Retry policy for outbound provider calls
- [Session Pruning](<90 - Public Docs Mirror/docs/concepts/session-pruning.md>) - Session pruning: tool-result trimming to reduce context bloat
- [Session Tools](<90 - Public Docs Mirror/docs/concepts/session-tool.md>) - Agent session tools for listing sessions, fetching history, and sending cross-session messages
- [Session Management](<90 - Public Docs Mirror/docs/concepts/session.md>) - Session management rules, keys, and persistence for chats
- [Sessions](<90 - Public Docs Mirror/docs/concepts/sessions.md>) - Alias for session management docs
- [Streaming and Chunking](<90 - Public Docs Mirror/docs/concepts/streaming.md>) - Streaming + chunking behavior (block replies, draft streaming, limits)
- [System Prompt](<90 - Public Docs Mirror/docs/concepts/system-prompt.md>) - What the ArgentOS system prompt contains and how it is assembled
- [Timezones](<90 - Public Docs Mirror/docs/concepts/timezone.md>) - Timezone handling for agents, envelopes, and prompts
- [TypeBox](<90 - Public Docs Mirror/docs/concepts/typebox.md>) - TypeBox schemas as the single source of truth for the gateway protocol
- [Typing Indicators](<90 - Public Docs Mirror/docs/concepts/typing-indicators.md>) - When ArgentOS shows typing indicators and how to tune them
- [Usage Tracking](<90 - Public Docs Mirror/docs/concepts/usage-tracking.md>) - Usage tracking surfaces and credential requirements
