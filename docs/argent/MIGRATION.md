# ArgentOS Migration Guide

> **Bring Your Agent** — Import your existing ArgentOS agent into ArgentOS

## Overview

ArgentOS supports one-command migration from ArgentOS, preserving:

- Your agent's identity (SOUL.md, AGENTS.md)
- User profile (USER.md)
- Tool configurations (TOOLS.md)
- Memory and daily logs (MEMORY.md, memory/\*.md)
- Channel configurations
- Cron jobs and schedules

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        OPENCLAW → ARGENTOS MIGRATION                        │
│                                                                             │
│   ArgentOS Workspace              ArgentOS Workspace                        │
│   ~/.argentos/                    ~/.argentos/                              │
│                                                                             │
│   ├── workspace/          ───►    ├── workspace/                           │
│   │   ├── SOUL.md         ───►    │   ├── SOUL.md         (preserved)     │
│   │   ├── AGENTS.md       ───►    │   ├── AGENTS.md       (upgraded)      │
│   │   ├── USER.md         ───►    │   ├── USER.md         (preserved)     │
│   │   ├── TOOLS.md        ───►    │   ├── TOOLS.md        (preserved)     │
│   │   ├── MEMORY.md       ───►    │   ├── MEMORY.md       (preserved)     │
│   │   ├── HEARTBEAT.md    ───►    │   ├── HEARTBEAT.md    (upgraded)      │
│   │   └── memory/         ───►    │   └── memory/         (preserved)     │
│   │                                                                         │
│   ├── config.json         ───►    ├── config.json         (converted)     │
│   ├── sessions/           ───►    ├── sessions/           (preserved)     │
│   └── credentials/        ───►    └── credentials/        (preserved)     │
│                                                                             │
│   argent-mem database   ───►    Built-in memory system                   │
│   ~/.argent-mem/        ───►    ~/.argentos/data/memory.db               │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Quick Migration

```bash
# One-command migration
argent migrate from-argent

# Or with explicit path
argent migrate from-argent --workspace ~/.argentos/workspace

# Preview what will be migrated (dry run)
argent migrate from-argent --dry-run

# Migrate specific components only
argent migrate from-argent --only identity,memory
```

## What Gets Migrated

### 1. Identity Files (Your Agent's Soul)

| File          | Description                   | Migration                       |
| ------------- | ----------------------------- | ------------------------------- |
| `SOUL.md`     | Personality, values, behavior | Copied as-is                    |
| `AGENTS.md`   | Workspace conventions         | Upgraded with ArgentOS features |
| `USER.md`     | Owner profile                 | Copied as-is                    |
| `TOOLS.md`    | Tool notes, API keys          | Copied as-is                    |
| `IDENTITY.md` | Additional identity           | Copied if exists                |

### 2. Memory

| Source                    | Destination                  | Notes                      |
| ------------------------- | ---------------------------- | -------------------------- |
| `MEMORY.md`               | `MEMORY.md`                  | Preserved exactly          |
| `memory/*.md`             | `memory/*.md`                | All daily logs preserved   |
| `~/.argent-mem/memory.db` | `~/.argentos/data/memory.db` | SQLite migrated            |
| `~/.argent-mem/chroma/`   | `~/.argentos/data/vectors/`  | Vectors migrated if exists |

### 3. Configuration

```yaml
# ArgentOS config.json → ArgentOS config.json

# Channels preserved:
telegram:
  token: "..." → telegram.token

discord:
  token: "..." → discord.token

# Model settings converted:
model: "anthropic/claude-sonnet-4" → models.default: "balanced"

# New ArgentOS features added:
+ sis.enabled: true
+ tasks.enabled: true
+ models.routing.enabled: true
+ models.local.endpoint: "http://localhost:11434"
```

### 4. Channel Credentials

All channel credentials are migrated:

- Telegram bot tokens
- Discord bot tokens
- Slack app credentials
- Signal sessions
- WhatsApp sessions (Baileys auth)

### 5. Sessions & History

- Active sessions preserved
- Conversation history maintained
- Session keys unchanged (no disruption)

## Migration Process

### Step 1: Install ArgentOS

```bash
# Install ArgentOS globally
npm install -g argentos

# Or with Bun
bun install -g argentos
```

### Step 2: Run Migration

```bash
# Interactive migration wizard
argent migrate from-argent

# Wizard prompts:
# ✓ Found ArgentOS workspace at ~/.argentos/workspace
# ✓ Found identity files: SOUL.md, AGENTS.md, USER.md, TOOLS.md
# ✓ Found memory: MEMORY.md + 47 daily logs
# ✓ Found argent-mem database: 1,234 observations
# ✓ Found channels: telegram, discord, whatsapp
#
# Ready to migrate. This will:
# - Create new ArgentOS workspace at ~/.argentos/
# - Copy all identity and memory files
# - Convert configuration
# - Migrate memory database
#
# Continue? [Y/n]
```

### Step 3: Verify Migration

```bash
# Check migration status
argent doctor

# Output:
# ✓ Identity files: OK
# ✓ Memory system: OK (1,234 observations imported)
# ✓ Channels: telegram (OK), discord (OK), whatsapp (OK)
# ✓ Configuration: OK
#
# ArgentOS is ready!
```

### Step 4: Start ArgentOS

```bash
# Start all services
argent start

# Or start gateway only
argent gateway start
```

## AGENTS.md Upgrade

The migration automatically upgrades `AGENTS.md` with ArgentOS features:

```markdown
# AGENTS.md - Your Workspace (ArgentOS)

[Your existing content preserved...]

## ArgentOS Features

### Task System

You now have persistent task tracking. Use these tools:

- `tasks_list` - See pending tasks
- `tasks_add` - Create new task
- `tasks_complete` - Mark task done
- `tasks_block` - Mark task blocked

### Self-Improving System

Your lessons learned are automatically captured. When you make a mistake
or discover something useful, it's stored and retrieved for future reference.

### Model Routing

Requests are automatically routed to the most cost-effective model:

- Simple queries → Local Llama (free)
- Standard tasks → Claude Haiku ($)
- Complex work → Claude Sonnet ($$)
- Critical tasks → Claude Opus ($$$)

[Rest of your original AGENTS.md...]
```

## HEARTBEAT.md Upgrade

```markdown
# HEARTBEAT.md (ArgentOS)

[Your existing tasks preserved...]

## ArgentOS Enhancements

When processing heartbeat:

1. Check task queue first (tasks_list)
2. Address each pending task or explain why blocked
3. Only reply HEARTBEAT_OK if task queue is empty
4. Lessons from past heartbeats are automatically applied

[Your original HEARTBEAT.md content...]
```

## Rollback

If needed, you can rollback to ArgentOS:

```bash
# ArgentOS keeps ArgentOS workspace untouched
# Your original ~/.argentos/ is preserved

# To switch back to ArgentOS:
argent gateway start

# To remove ArgentOS completely:
argent uninstall --keep-data  # Keeps your data
argent uninstall --all        # Removes everything
```

## Migration FAQ

### Q: Will my agent's personality change?

**A:** No. Your `SOUL.md` and identity files are copied exactly as-is. Your agent will behave the same way, just with new capabilities.

### Q: Will I lose my memories?

**A:** No. All memory files and the argent-mem database are fully migrated. Your agent remembers everything.

### Q: Can I run both ArgentOS and ArgentOS?

**A:** Yes, but not simultaneously (they use the same default ports). You can switch between them.

### Q: What about my channel connections?

**A:** All credentials are migrated. Your Telegram, Discord, Slack, Signal, and WhatsApp connections will work immediately.

### Q: Is migration reversible?

**A:** Yes. ArgentOS doesn't modify your ArgentOS workspace. You can always switch back.

### Q: What's the minimum ArgentOS version for migration?

**A:** ArgentOS 2025.1.0 or later. Run `argent --version` to check.

## Manual Migration

If you prefer manual migration:

```bash
# 1. Create ArgentOS workspace
mkdir -p ~/.argentos/workspace

# 2. Copy identity files
cp ~/.argentos/workspace/SOUL.md ~/.argentos/workspace/
cp ~/.argentos/workspace/AGENTS.md ~/.argentos/workspace/
cp ~/.argentos/workspace/USER.md ~/.argentos/workspace/
cp ~/.argentos/workspace/TOOLS.md ~/.argentos/workspace/
cp ~/.argentos/workspace/MEMORY.md ~/.argentos/workspace/
cp -r ~/.argentos/workspace/memory ~/.argentos/workspace/

# 3. Copy credentials
cp -r ~/.argentos/credentials ~/.argentos/

# 4. Migrate memory database
mkdir -p ~/.argentos/data
cp ~/.argent-mem/memory.db ~/.argentos/data/

# 5. Convert config (use migration tool)
argent migrate convert-config ~/.argentos/config.json
```

## Support

Need help with migration?

- Documentation: https://argentos.ai/docs/migration
- Discord: https://discord.gg/argentos
- GitHub Issues: https://github.com/ArgentAIOS/argentos/issues

---

_Bring your agent. Keep your memories. Gain superpowers._
