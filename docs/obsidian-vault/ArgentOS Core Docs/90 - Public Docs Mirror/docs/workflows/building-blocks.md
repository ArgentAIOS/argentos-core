---
summary: "The 5 building blocks of every workflow"
title: "Building Blocks"
---

# Building Blocks

Every workflow is made from 5 types of blocks. Think of them like LEGO pieces -- simple on their own, powerful when combined.

## Trigger -- "When should this start?"

The trigger is always the first block. It decides WHEN your workflow runs.

| Type              | What it does                                     | Example                          |
| ----------------- | ------------------------------------------------ | -------------------------------- |
| **Schedule**      | Runs on a timer                                  | Every Monday at 9 AM             |
| **Manual**        | Runs when you click "Run"                        | Test it right now                |
| **Webhook**       | Runs when another app sends a signal             | When a form is submitted         |
| **Message**       | Runs when someone sends a message                | When a client DMs you on Discord |
| **Email**         | Runs when an email arrives matching your filter  | When a support request comes in  |
| **Task Done**     | Runs when a task in your task board is completed | When QA finishes review          |
| **Workflow Done** | Runs when another workflow finishes              | Chain automations together       |

**Tip:** Start with Manual while you're building. Switch to Schedule when it's ready.

## Agent Step -- "What should the AI do?"

This is your AI worker. Tell it what to do in plain English, and it figures out the rest.

**How to configure:**

- **Agent** -- Pick which team member does the work (e.g., Scout for research, Quill for writing)
- **Role Prompt** -- Describe the task in your own words. Be specific about what you want.
- **AI Enhance** -- Click this to have Argent improve your prompt
- **Model Tier** -- Optional. Pick how powerful the AI should be (local/fast/balanced/powerful). Leave blank and the router picks automatically.
- **Tools Allow / Deny** -- Control which tools the agent can use during this step
- **Timeout** -- How long the agent has to finish (default: 5 minutes)

**Presets** make it even easier. Instead of writing a prompt from scratch, pick a preset:

| Preset        | What it does                                  |
| ------------- | --------------------------------------------- |
| **Research**  | Web search, memory search, compile findings   |
| **Write**     | Content creation -- articles, emails, reports |
| **Analyze**   | Data analysis, produce insights               |
| **Review**    | QA check on the previous step's output        |
| **Code**      | Write or modify code                          |
| **Summarize** | Condense previous outputs into a brief        |
| **Custom**    | Blank slate -- you write the prompt           |

**Good prompts are specific.** Instead of "write something about marketing," try "write a 500-word LinkedIn post about why AI agents are changing how MSPs operate, using a conversational tone."

## Action -- "Do something specific"

Actions are instant operations -- no AI thinking required. They just DO things.

| Action                | What it does                                               |
| --------------------- | ---------------------------------------------------------- |
| **Send Message**      | Post to Slack, Discord, Telegram, or any connected channel |
| **Send Email**        | Send an email to anyone                                    |
| **Webhook Call**      | Call an external API or service                            |
| **API Call**          | Hit any REST API with full auth support                    |
| **Create Task**       | Add a task to your task board                              |
| **Save to Documents** | Store the result in your document panel                    |
| **Save to Memory**    | Remember something for future conversations                |
| **Save to Knowledge** | Add to a knowledge library collection                      |
| **Generate Image**    | Create an image from a text prompt                         |
| **Generate Audio**    | Convert text to speech                                     |
| **Run Script**        | Execute a command (sandboxed for safety)                   |

**Plus app connectors** -- Stripe, HubSpot, QuickBooks, and more. Drag any connector from the sidebar and it becomes an Action block. See [App Connectors](./connectors.md).

## Gate -- "Should we continue? Which path?"

Gates control the flow. They are the decision points in your workflow.

| Gate               | What it does                                 | When to use                                               |
| ------------------ | -------------------------------------------- | --------------------------------------------------------- |
| **If/Then**        | Takes one path if true, another if false     | "If the sentiment is positive, send a thank you"          |
| **Switch**         | Multiple paths based on different conditions | "Route support tickets by category"                       |
| **Parallel**       | Does multiple things at the same time        | "Create social posts AND email newsletter simultaneously" |
| **Join**           | Waits for parallel branches to finish        | "Proceed once all translations are done"                  |
| **Wait**           | Pauses for a set amount of time              | "Wait 3 days before sending the follow-up"                |
| **Wait for Event** | Pauses until something happens               | "Wait until the client responds"                          |
| **Loop**           | Repeats a section                            | "Do this for each item in the list"                       |
| **Error Handler**  | Catches failures and recovers                | "If the email fails, create a task to follow up manually" |
| **Sub-Workflow**   | Runs another workflow as a step              | "Reuse my onboarding workflow here"                       |
| **Approval**       | Pauses and asks you to review                | "Let me check this email before it sends"                 |

**The Approval gate is your safety net.** Put one before any step that sends something to a client or posts publicly. You will get a notification, see what the AI produced, and approve or deny with one click. See [Approval Gates](./approval-gates.md).

**AI-powered conditions.** Most workflow tools force you to write rigid rules like "if score > 80." ArgentOS can also have an AI agent evaluate the condition. For example: "Does this email sound professional?" The agent reads the content and makes a judgment call. Use this for nuanced decisions that are hard to express as simple rules.

## Output -- "Where does the result go?"

The output is the last block. It delivers the final result.

| Output                | What it does                                          |
| --------------------- | ----------------------------------------------------- |
| **Document Panel**    | Saves to your dashboard documents                     |
| **Email**             | Sends the result via email                            |
| **Channel**           | Posts to Slack, Discord, Telegram, etc.               |
| **Webhook**           | Sends to an external system                           |
| **Knowledge Library** | Stores in a knowledge collection for future retrieval |
| **Task Update**       | Updates an existing task with results                 |
| **Next Workflow**     | Starts another workflow (chaining)                    |

**Tip:** A workflow can have multiple outputs. Send the result to your documents AND post it to Slack AND email it to your team -- all from the same workflow.

## Chaining Workflows

You can connect workflows together so one triggers the next:

### Push Chain (Output to Next Workflow)

Set your Output block to "Next Workflow" and pick which workflow to start. The result from this workflow becomes the input for the next one.

### Event Chain (Trigger on Workflow Completed)

Set a Trigger to "When Workflow Completes" and pick which workflow to watch. When that workflow finishes, this one starts automatically.

### Example: Lead Generation into Nurture Campaign

- **Workflow 1: Lead Gen** -- Finds prospects, qualifies them, adds to database
- **Workflow 2: Drip Campaign** -- Triggered when Lead Gen completes, sends personalized email sequence

This keeps your workflows focused and reusable. The Lead Gen workflow can feed into different campaigns depending on the lead type.
