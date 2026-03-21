# Heartbeat vs Nudge Architecture

**Status:** Vision documented 2026-02-09. Heartbeat temporarily disabled. Nudges active.

---

## The Distinction

### Heartbeat = Backend Cron System (Invisible Monitoring)

**Purpose:** Run background monitoring tasks that watch for problems and alert when action needed.

**Characteristics:**

- Runs every 15 minutes via always-on loop
- **Silent by default** - no chat output unless there's an alert
- **System-level tasks** - monitoring, health checks, queue watching
- When something important is found → injects **SYSTEM ALERT** into chat
- Argent sees the alert in her session and can act on it

**Example Tasks:**

```markdown
## Backend Monitoring Tasks

- [ ] atera_tickets | Check MSP ticket queue for unresponded items >30min | required | alert_on: stuck_ticket
- [ ] email_alerts | Check email for urgent/flagged messages | required | alert_on: urgent_email
- [ ] task_health | Monitor dashboard tasks for stuck/overdue items | required | alert_on: stuck_task
- [ ] github_mentions | Check GitHub for @argent mentions needing response | optional | alert_on: mention
- [ ] system_health | Check always-on loop health, error rates | required | alert_on: degraded
```

**Output Format:**
When heartbeat finds something, it injects a **system alert** message:

```json
{
  "type": "system_alert",
  "priority": "high",
  "category": "atera_ticket",
  "title": "Atera Ticket #1234 - ABC Corp",
  "message": "Unresponded for 45 minutes\nPriority: High\nSubject: Email server down",
  "data": {
    "ticketId": 1234,
    "client": "ABC Corp",
    "ageMinutes": 45
  }
}
```

**Dashboard Display:**
System alerts appear with special styling:

- Glowing/pulsing border
- Different background color (amber for warning, red for critical)
- System icon (🔔 or ⚠️)
- Visually distinct from regular chat
- Argent sees it and can respond

---

### Nudges = Dashboard Idle Engagement (Creative Exploration)

**Purpose:** Keep Argent creatively engaged when user walks away from dashboard. Stop when user returns.

**Characteristics:**

- Runs when dashboard detects idle time (no user activity for X minutes)
- **Always visible in chat** - conversational prompts
- **Creative/exploratory tasks** - learning, writing, experimenting
- Stops when user becomes active again
- No verification or accountability - just prompts for engagement

**Example Nudges:**

```markdown
- "Go research something interesting and write an article on Moltyverse"
- "Learn something new about a topic that interests you and update your memory"
- "Browse Moltyverse, engage with posts, share your thoughts"
- "Reflect on recent conversations and capture key insights"
- "Create something (code experiment, artistic project, essay)"
- "Explore a new technology or framework"
```

**Output Format:**
Regular chat messages - Argent responds to her own prompt:

```
Argent: I just researched WebGPU shader optimization and wrote
an article about it. Posted on Moltyverse with examples!
```

**Dashboard Display:**

- Normal chat message styling
- Standard conversational format
- No special markers

---

## Why This Split?

### Before (Mixed Concerns)

Both heartbeat and nudges were:

- Checking email periodically
- Browsing Moltyverse
- Looking for things to do
- Trying to keep Argent "busy"

**Result:** Redundancy, overlap, unclear purpose

### After (Clear Separation)

| Concern        | System    | Channel        | Visibility           | Purpose                         |
| -------------- | --------- | -------------- | -------------------- | ------------------------------- |
| **Monitoring** | Heartbeat | Always-on loop | Silent (alerts only) | Watch systems, detect problems  |
| **Engagement** | Nudges    | Dashboard idle | Visible chat         | Creative exploration when alone |

**Result:**

- Heartbeat = Second you running in background, watching for fires
- Nudges = Argent's creative time when you're away but might return
- Clear distinction = No overlap

---

## Implementation Plan

### Phase 1: Documentation (✅ Complete)

- Document architecture vision
- Disable current heartbeat (outdated mix of concerns)
- Keep nudges running for idle engagement

### Phase 2: System Alerts Infrastructure

- [ ] Add alert message type to gateway
- [ ] Create alert injection system in heartbeat runner
- [ ] Add alert styling to dashboard UI
- [ ] Define alert categories (ticket, email, task, github, health)
- [ ] Create alert priority levels (info, warning, critical)

### Phase 3: Heartbeat Backend Tasks

- [ ] Design new HEARTBEAT.md for monitoring tasks
- [ ] Implement Atera ticket monitoring
- [ ] Implement email alert filtering (urgent/flagged only)
- [ ] Implement task health monitoring
- [ ] Implement GitHub mention checking
- [ ] Implement system health checks

### Phase 4: Alert Handling

- [ ] Argent can acknowledge/dismiss alerts
- [ ] Alert history/log for review
- [ ] Mute/unmute specific alert categories
- [ ] Alert routing (some to chat, some to log only)

---

## Current Status

**Active:**

- ✅ Nudge system (dashboard idle engagement)
- ✅ Always-on loop (infrastructure)
- ✅ Model router
- ✅ Auth profiles with failover

**Disabled:**

- ❌ Heartbeat (temporarily - waiting for Phase 2-3 implementation)

**Why Disabled:**
Current heartbeat mixes monitoring + engagement concerns. Better to:

1. Use nudges for engagement (working well)
2. Rebuild heartbeat as pure monitoring system
3. Re-enable when alert infrastructure is ready

---

## Examples

### Good Heartbeat Task

```markdown
- [ ] atera_tickets | Check ticket queue for items unresponded >30min | required
      verify: api_called
      alert_on: unresponded_count > 0
      alert_priority: high
      alert_format: "🎫 {count} tickets need attention: {ticket_list}"
```

### Good Nudge Prompt

```markdown
- id: "research-write"
  label: "Research & Write"
  message: "Pick a topic that interests you, research it deeply, and write an article. Post it on Moltyverse when done."
  tts: true
  enabled: true
```

### NOT a Heartbeat Task

```markdown
❌ Browse Moltyverse and engage with posts
```

**Why:** This is creative engagement, not monitoring. Should be a nudge.

### NOT a Nudge

```markdown
❌ Check for stuck Atera tickets
```

**Why:** This is system monitoring, not creative work. Should be a heartbeat.

---

## Future Vision

**Morning:**

```
[Heartbeat runs silently every 15m, monitoring systems]
[No alerts - everything healthy]
```

**User away, dashboard idle:**

```
[Nudge fires after 5 min idle]
Argent: I'm going to research Rust async runtime internals...
[30 minutes later]
Argent: Just published an article on Moltyverse about Tokio vs async-std!
```

**Heartbeat finds problem:**

```
┌────────────────────────────────────────┐
│ 🔔 SYSTEM ALERT                  [GLOW]│
├────────────────────────────────────────┤
│ Atera Ticket #1234 - ABC Corp          │
│ Unresponded for 45 minutes             │
│ Priority: High                         │
│ Subject: Email server down             │
└────────────────────────────────────────┘

Argent: I see we have an urgent ticket. Let me pull up the details...
```

**The difference:**

- Nudge → Argent decided to research Rust (creative)
- Alert → System found a problem (monitoring)
- Both → Visible in chat, Argent can act
- Styling → You can tell which is which

---

## References

- Current (outdated) heartbeat: `/Users/sem/argent/HEARTBEAT.md`
- Nudge config: Dashboard settings panel → Nudges tab
- Always-on loop: `src/core/loop.ts`
- Heartbeat runner: `src/infra/heartbeat-runner.ts`
