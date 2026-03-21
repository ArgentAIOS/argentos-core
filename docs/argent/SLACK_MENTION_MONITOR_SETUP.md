# Slack Mention Monitor — Setup Guide

This guide walks through every step needed to set up the Slack Mention Monitor plugin so ArgentOS can detect when someone @mentions the operator in Slack and alert them via the dashboard.

## Prerequisites

- ArgentOS gateway running
- Access to a Slack workspace where you have admin permissions (or can request a bot be added)
- The operator's Slack user ID

---

## Step 1: Create a Slack App & Bot

1. Go to **https://api.slack.com/apps**
2. Click **Create New App** → **From scratch**
3. Name it (e.g., `ArgentOS` or `argentos`) and select your workspace
4. Click **Create App**

### Add Bot Scopes

5. In the left sidebar, go to **OAuth & Permissions**
6. Scroll to **Bot Token Scopes** and add these scopes:
   - `channels:history` — Read messages in public channels
   - `channels:read` — View basic channel info
   - `groups:history` — Read messages in private channels (optional)
   - `groups:read` — View basic private channel info (optional)
   - `users:read` — View user presence/status

> **Note:** The `groups:*` scopes are only needed if you want to monitor private channels. Skip them if public channels are sufficient.

### Install to Workspace

7. Scroll up to **OAuth Tokens** and click **Install to Workspace**
8. Review the permissions and click **Allow**
9. Copy the **Bot User OAuth Token** — it starts with `xoxb-`

> **IMPORTANT:** Never paste this token into chat, config files, or code. It goes into the service-keys store (Step 2).

---

## Step 2: Store the Bot Token in Service Keys

The token must be stored securely via the ArgentOS dashboard or service-keys file.

### Option A: Via Dashboard (Recommended)

1. Open the ArgentOS dashboard
2. Go to **Settings** → **API Keys**
3. Click **Add Key**
4. Set:
   - **Name:** `Slack Bot Token`
   - **Variable:** `SLACK_BOT_TOKEN`
   - **Value:** _(paste the xoxb- token)_
   - **Service:** `Slack`
5. Save

### Option B: Via Agent Tool

Ask Argent:

> "Store my Slack bot token in service keys with variable name SLACK_BOT_TOKEN"

The agent will use the `service_keys` tool to store it securely.

### Option C: Via CLI (Manual)

Edit `~/.argentos/service-keys.json` and add an entry:

```json
{
  "id": "sk-slack-bot",
  "name": "Slack Bot Token",
  "variable": "SLACK_BOT_TOKEN",
  "value": "xoxb-YOUR-TOKEN-HERE",
  "service": "Slack",
  "enabled": true
}
```

> File permissions should be `600` (owner read/write only).

---

## Step 3: Find Your Slack User ID

The plugin needs the operator's Slack user ID (not username) to detect @mentions.

### How to Find It

1. In Slack, click on your **profile picture** → **Profile**
2. Click the **three dots** (⋯) menu
3. Click **Copy member ID**
4. It looks like `U05S8H4F69X`

### Alternative: Ask the Bot

After the bot is installed, you can test with:

```
curl -s -H "Authorization: Bearer xoxb-YOUR-TOKEN" \
  "https://slack.com/api/users.list?limit=50" | python3 -c "
import sys, json
data = json.load(sys.stdin)
for u in data.get('members', []):
    if not u.get('is_bot') and not u.get('deleted'):
        print(f\"{u['id']}: {u.get('real_name', u.get('name'))}\")"
```

---

## Step 4: Configure the Plugin

Add the operator's Slack user ID to the plugin config in `~/.argentos/argent.json`:

```json
{
  "plugins": {
    "entries": {
      "slack-mention-monitor": {
        "enabled": true,
        "config": {
          "operatorUserId": "U05S8H4F69X"
        }
      }
    }
  }
}
```

### Optional Config Fields

| Field             | Type     | Default  | Description                                                   |
| ----------------- | -------- | -------- | ------------------------------------------------------------- |
| `operatorUserId`  | string   | —        | **Required.** Slack user ID to monitor mentions for           |
| `botToken`        | string   | —        | Override token (bypasses service-keys lookup)                 |
| `pollIntervalMs`  | number   | `180000` | Polling interval in ms (default: 3 minutes)                   |
| `monitorChannels` | string[] | `[]`     | Channel names to monitor (empty = all channels the bot is in) |

---

## Step 5: Invite the Bot to Channels

**This is the step most people miss.** The bot can only read messages in channels where it's a member.

In each Slack channel you want monitored, type:

```
/invite @argentos
```

(Replace `@argentos` with whatever you named your Slack app.)

### Recommended Channels

- `#general` — catch all-hands mentions
- `#support` or `#helpdesk` — client-facing mentions
- Any project channels where team members might @mention you

### Verify Bot Membership

After inviting, you can verify the bot can see the channel:

```
curl -s -H "Authorization: Bearer xoxb-YOUR-TOKEN" \
  "https://slack.com/api/conversations.list?types=public_channel&limit=200" | \
  python3 -c "import sys,json; [print(f'#{c[\"name\"]}') for c in json.load(sys.stdin).get('channels',[]) if c.get('is_member')]"
```

---

## Step 6: Restart the Gateway

The polling loop starts on `gateway_start`. After configuring everything:

```bash
argent gateway restart
```

Or via launchctl:

```bash
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/ai.argent.gateway.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/ai.argent.gateway.plist
```

---

## Step 7: Verify It Works

### Test 1: Check Plugin Status

Ask Argent or run:

```bash
argent plugins list
```

Look for `slack-mention-monitor` with status `loaded`.

### Test 2: Manual Mention Check

Ask Argent:

> "Check Slack for recent mentions"

The agent will use the `slack_mentions` tool. Expected response:

- If no mentions: `No @mentions of operator in the last 30 minutes`
- If mentions found: List of mentions with channel, sender, and text

### Test 3: Live Test

1. Have someone @mention you in a channel the bot is in
2. Wait up to 3 minutes (default poll interval)
3. The dashboard should show a `[SLACK ALERT]` notification if you're marked as "away" in Slack

### Test 4: Direct API Test

```bash
# Should return the bot's identity
curl -s -H "Authorization: Bearer xoxb-YOUR-TOKEN" \
  https://slack.com/api/auth.test | python3 -m json.tool
```

---

## How It Works

### Polling (Automatic)

- Every 3 minutes (configurable), the plugin:
  1. Lists all channels the bot is a member of
  2. Checks message history since last poll
  3. Filters for messages containing `<@OPERATOR_USER_ID>`
  4. If mentions found AND operator is "away" in Slack → injects a `[SLACK ALERT]` system event
  5. The dashboard displays the alert

### Manual Check (On-Demand)

The `slack_mentions` tool can be called anytime:

- `slack_mentions` — check all channels, last 30 minutes
- `slack_mentions channel_name=support` — filter to channels containing "support"
- `slack_mentions since_minutes=60` — look back 60 minutes

### Token Resolution

The bot token is resolved in this order:

1. Plugin config `botToken` field (if set)
2. `~/.argentos/service-keys.json` → entry with `variable: "SLACK_BOT_TOKEN"`
3. `process.env.SLACK_BOT_TOKEN` (environment variable fallback)

The polling loop re-resolves the token on every tick, so key rotations in the dashboard are picked up without a gateway restart.

---

## Troubleshooting

### "No Slack bot token configured"

- Verify `SLACK_BOT_TOKEN` exists in service-keys: `cat ~/.argentos/service-keys.json | grep SLACK`
- Or set it as an environment variable in the gateway plist

### "0 channels" / No mentions detected

- **Most common issue:** Bot hasn't been invited to any channels
- Run `/invite @argentos` in target channels
- Verify with `conversations.list` API call (see Step 5)

### Plugin shows "not in allowlist"

- Add `"slack-mention-monitor"` to `plugins.allow` array in `argent.json`
- Add entry with `"enabled": true` under `plugins.entries`

### Plugin shows "invalid config: required property"

- The manifest `configSchema` should NOT have `required` fields
- Update `~/.argentos/extensions/slack-mention-monitor/argent.plugin.json` — remove the `required` array

### Alerts not showing on dashboard

- Alerts only fire when operator presence is "away" in Slack
- Set your Slack status to away, have someone mention you, wait for poll
- Check gateway logs: `grep "SLACK ALERT" /tmp/argent/argent-$(date +%Y-%m-%d).log`

### Plugin not loading at all

- Check `argent plugins list` — is it `loaded`, `disabled`, or `error`?
- Check gateway error log: `grep slack-mention ~/.argentos/logs/gateway-error.log`
- Common causes: missing manifest, syntax errors in `index.ts`, module resolution failures

---

## Security Notes

- The bot token is stored in `service-keys.json` with file permissions `0600`
- **Never** write tokens directly into `argent.json` config fields
- **Never** paste tokens into Slack channels or chat messages
- The plugin uses `resolveKey()` which reads from the secure service-keys store
- Rotate tokens periodically via the Slack app settings page and update service-keys

---

## File Locations

| File                                                              | Purpose                            |
| ----------------------------------------------------------------- | ---------------------------------- |
| `~/.argentos/extensions/slack-mention-monitor/index.ts`           | Plugin code                        |
| `~/.argentos/extensions/slack-mention-monitor/argent.plugin.json` | Plugin manifest                    |
| `~/.argentos/service-keys.json`                                   | Secure token storage               |
| `~/.argentos/argent.json`                                         | Plugin config (entries, allowlist) |
| `/tmp/argent/argent-YYYY-MM-DD.log`                               | Gateway logs                       |
