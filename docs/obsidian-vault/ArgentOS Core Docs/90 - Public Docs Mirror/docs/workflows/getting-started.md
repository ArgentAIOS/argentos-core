---
summary: "Build your first AI workflow in 5 minutes"
title: "Getting Started"
---

# Your First Workflow

Let's build a simple workflow: AI researches a topic and sends you a summary email.

## Step 1: Create a New Workflow

1. Open your dashboard
2. Click **Operations** in the top bar
3. Click the **Workflows** tab
4. Click **+ New** in the left sidebar
5. Name it "Daily Research Summary"

## Step 2: Add a Trigger

Every workflow starts with a trigger -- the thing that kicks it off.

1. Drag **Trigger** from the left panel onto the canvas
2. Click on it -- the right panel slides out
3. Set **Trigger Type** to "Cron Schedule"
4. Set the schedule:
   - Click **Weekly**
   - Select **Monday** through **Friday**
   - Set time to **8:00 AM**
   - Choose your timezone
5. You will see: "Every Mon, Tue, Wed, Thu, Fri at 8:00 AM Central"

## Step 3: Add an AI Agent

This is where the magic happens. An AI agent will do research for you.

1. Drag **Agent Step** onto the canvas below the trigger
2. Connect them: drag from the trigger's bottom dot to the agent's top dot
3. Click the agent block -- right panel opens
4. Set **Agent** to your research agent (e.g., Scout)
5. In **Role Prompt**, write what you want:

```
Research the latest news about AI and automation for small businesses.
Find 3-5 important stories from the past 24 hours.
Write a brief, easy-to-read summary of each.
```

6. Want help writing the prompt? Click **AI Enhance** -- Argent will improve it for you

## Step 4: Add an Output

Send the research summary somewhere useful.

1. Drag **Output** onto the canvas below the agent
2. Connect the agent to the output
3. Click the output block
4. Set **Output Type** to "Email"
5. Enter your email address

## Step 5: Run It

1. Click **Run** in the top toolbar
2. Watch the blocks light up as each step executes:
   - Trigger glows cyan
   - Agent pulses while thinking
   - Output turns green when done
3. Check your email -- your AI-generated research summary is there

## Step 6: Save

Click **Save**. Your workflow will now run automatically every weekday at 8 AM.

## What's Next?

- [Add an approval step](./approval-gates.md) so you can review before it sends
- [Add more agents](./building-blocks.md#agent-step) for different tasks
- [Use templates](./templates.md) to start with pre-built workflows
- [Connect your apps](./connectors.md) -- Slack, email, CRM, and 60+ more
