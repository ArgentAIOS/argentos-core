---
summary: "Set up schedules and triggers for your workflows"
title: "Schedules & Triggers"
---

# Schedules and Triggers

A trigger decides WHEN your workflow runs. There are four main types.

## Schedule (most common)

Run your workflow on a timer. Use the visual schedule builder -- no technical knowledge needed.

### Set Up a Schedule

1. Click your Trigger block
2. Select **Cron Schedule** as the trigger type
3. Choose a frequency:
   - **Daily** -- pick a time
   - **Weekly** -- pick days and a time
   - **Monthly** -- pick a day of the month and time
   - **Custom** -- for advanced users (cron expression)
4. Choose your timezone
5. You will see a plain-English summary: "Every Mon, Wed, Fri at 9:00 AM Central"

### Common Schedules

| What you want            | How to set it                      |
| ------------------------ | ---------------------------------- |
| Every morning at 9 AM    | Daily, 9:00 AM                     |
| Every Monday             | Weekly, Monday, 9:00 AM            |
| Twice a week (Mon + Thu) | Weekly, Monday + Thursday, 9:00 AM |
| Every weekday            | Weekly, Mon through Fri, 9:00 AM   |
| First of every month     | Monthly, Day 1, 9:00 AM            |
| Every 2 hours            | Custom cron: `0 */2 * * *`         |

### Deduplication

If a trigger fires faster than your workflow can finish, ArgentOS will not start a second run on top of the first. By default, there is a 60-second deduplication window. You can increase this in the trigger settings.

## Manual

Run your workflow whenever you want by clicking the **Run** button. Good for testing or one-off tasks.

Every workflow supports manual runs, even if it also has a schedule. Use this while you are building to test each step before going live.

## Webhook

Run your workflow when another app sends a signal. This is how you connect external tools that are not in the connector library.

### How Webhooks Work

1. Set your trigger to **Webhook**
2. ArgentOS gives you a unique URL (like `https://your-gateway/hooks/wf-abc123`)
3. Give that URL to the other app (form builder, Stripe, GitHub, etc.)
4. When the app sends data to that URL, your workflow starts
5. The incoming data is available to every step in the workflow as `trigger.payload`

### Webhook Security

ArgentOS generates an HMAC secret for each webhook. If you want to verify that incoming requests are legitimate (recommended for production), share the secret with the sending app and enable signature verification in the trigger settings.

### Common Webhook Sources

- Form submissions (Typeform, Google Forms, Tally)
- Payment events (Stripe "payment completed")
- Code events (GitHub "pull request opened")
- CRM events (HubSpot "new contact created")
- Monitoring alerts (PagerDuty, Datadog, Uptime Robot)

## Event-Based Triggers

These triggers respond to things happening inside ArgentOS itself.

| Trigger            | What it does                                                             | Example                                   |
| ------------------ | ------------------------------------------------------------------------ | ----------------------------------------- |
| **Message**        | Fires when a message arrives on a connected channel matching your filter | "When someone says 'help' in Discord"     |
| **Email Received** | Fires when an inbound email matches your sender or subject filter        | "When support@ gets a new email"          |
| **Task Completed** | Fires when a task on your board is marked done                           | "When QA signs off, deploy automatically" |
| **Workflow Done**  | Fires when another workflow finishes                                     | Chain workflows together end-to-end       |

### Chaining Workflows

The **Workflow Done** trigger is how you build complex multi-stage automations without making any single workflow too large.

Example: Your "Research" workflow finishes and triggers your "Write Report" workflow, which finishes and triggers your "Distribute" workflow. Each one is simple on its own, but together they form a powerful pipeline.

The finishing workflow's output is automatically passed as the trigger payload to the next workflow. No extra configuration needed.
