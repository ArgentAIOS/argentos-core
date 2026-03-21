# Worker Onboarding Wizard

> Create and deploy a new agent worker in under 3 minutes with guided, step-by-step configuration.

---

## Overview

The Worker Onboarding Wizard is a guided modal in the ArgentOS dashboard that walks you through creating a new agent worker. Instead of manually editing JSON configuration files, you fill in a 6-step form that handles agent identity, department assignment, behavioral boundaries, simulation testing, validation, and deployment.

The wizard enforces ArgentOS's **intent hierarchy** -- a three-tier governance model (Global, Department, Agent) that ensures every agent operates within well-defined constraints. Each step builds on the previous one, and the wizard validates your configuration against the hierarchy rules before deploying.

**What the wizard does:**

- Creates a new agent with a unique identity (name, ID, role, team)
- Assigns the agent to a department (existing or new)
- Configures behavioral boundaries (what the agent can and cannot do)
- Optionally enables simulation testing before the agent goes live
- Validates the entire configuration against intent hierarchy rules
- Deploys the agent by provisioning its directory, updating the agents list, saving intent config, and generating alignment documents

---

## Getting Started

### Prerequisites

- The ArgentOS dashboard must be running and connected to the gateway
- You need at least one intent configuration in place (a global policy). If you haven't set one up, the wizard will still work but validation will have fewer guardrails.

### Launching the Wizard

Click the **+ Worker** button in the dashboard status bar (bottom of the screen). The button is purple with a user-plus icon and is always visible when the dashboard is loaded.

The wizard opens as a full-screen modal overlay. You can close it at any time by clicking the X button or clicking outside the modal (except during deployment). Your progress is not saved between sessions -- if you close the wizard, you start fresh.

---

## Step-by-Step Guide

The wizard has 6 steps, shown as numbered circles in a progress bar at the top of the modal. Completed steps show a checkmark. You navigate with **Back** and **Continue** buttons at the bottom.

---

### Step 1: Identity

**What it configures:** The agent's name, unique identifier, role, team, and optional visual emoji.

#### Quick Start Templates

Before filling in fields manually, you can select a **template** that pre-fills identity, department, boundaries, and simulation settings. This is the fastest path. Click any template card to apply it, then adjust as needed.

| Template             | Emoji            | Role            | Team        | Description                                                                                                                            |
| -------------------- | ---------------- | --------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **MSP T1 Support**   | headphones       | Tier 1 Support  | MSP Team    | Helpdesk agent for tickets, troubleshooting, and escalation. Pre-fills neverDo rules for infrastructure, billing, and security.        |
| **Developer**        | laptop           | Developer       | Engineering | Code, review, and test agent. Pre-fills rules against deploying to production, modifying CI/CD, or committing secrets.                 |
| **Research Analyst** | magnifying glass | Analyst         | Research    | Gathers, analyzes, and synthesizes information. Pre-fills rules against presenting speculation as fact or sharing confidential data.   |
| **Project Manager**  | clipboard        | Project Manager | Operations  | Coordinates projects, tracks milestones, manages dependencies. Pre-fills rules around budget authorization and external communication. |

Templates preserve any Display Name and Agent ID you have already typed.

#### Fields

| Field            | Required | Description                                                                                                                                                                                     |
| ---------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Display Name** | Yes      | Human-readable name for the agent. Example: "Support Agent Alpha"                                                                                                                               |
| **Agent ID**     | Yes      | Machine identifier, auto-generated from the display name as a lowercase slug (letters, numbers, hyphens only). You can override it manually. Must be unique across all agents.                  |
| **Emoji**        | No       | A single emoji character used as the agent's visual identifier in lists and the deploy screen. Limited to 2 characters.                                                                         |
| **Role**         | No       | Preset role selection: Tier 1 Support, Tier 2 Support, Developer, Analyst, Researcher, Project Manager, or Custom. Choosing "Custom" reveals an additional text field for a freeform role name. |
| **Team**         | No       | The team this agent belongs to, such as "MSP Team" or "Engineering". Freeform text.                                                                                                             |

#### Tips

- You must enter both a Display Name and Agent ID before you can proceed to Step 2.
- The Agent ID auto-generates as you type the Display Name (if you haven't manually set one yet). Once you manually edit the Agent ID, auto-generation stops.
- Agent IDs must be globally unique. Duplicate IDs are caught during validation in Step 5.

---

### Step 2: Department

**What it configures:** Which department this agent belongs to in the intent hierarchy.

#### Two modes

**Join Existing** -- Select from departments already configured in your intent system. Each department card shows its name and objective. Click to select.

**Create New** -- Define a new department from scratch. You provide:

| Field             | Description                                                                                                       |
| ----------------- | ----------------------------------------------------------------------------------------------------------------- |
| **Department ID** | Lowercase slug identifier (auto-slugified as you type). Example: `msp-support`                                    |
| **Objective**     | The department's primary mission. Example: "Handle Tier 1 support tickets efficiently and escalate appropriately" |

New departments automatically inherit all global policies.

#### Hierarchy Preview

A visual diagram at the bottom of this step shows the three-tier chain: **Global** at the top, your selected or new **Department** in the middle, and your **Agent** at the bottom. Each level shows its objective. This updates in real time as you make selections.

#### Tips

- If no departments exist yet, the "Join Existing" view will prompt you to switch to "Create New".
- Templates like "MSP T1 Support" default to creating a new department. You can switch to "Join Existing" after applying a template.
- You must select or create a department before proceeding.

---

### Step 3: Boundaries

**What it configures:** The agent's behavioral constraints -- what it must do, what it must never do, what requires approval, and when to escalate.

This is the most detailed step. It has three sections.

#### Mission Objective

A freeform text area describing the agent's primary purpose. Example: "Handle Tier 1 tickets: password resets, basic troubleshooting, software installs, guided diagnostics. Escalate complex/security/infrastructure issues."

#### Rules & Constraints

Three tag-based inputs for adding behavioral rules:

| Field                            | Color | Description                                                                                                                                                                                                             |
| -------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Never Do** (hard prohibitions) | Red   | Actions the agent must never perform. Examples: "modify infrastructure", "access billing", "disable security". Inherited rules from the global and department levels appear as gray locked tags that cannot be removed. |
| **Allowed Actions**              | Cyan  | Actions the agent is permitted to take. Examples: "resolve_known_pattern", "create_ticket", "escalate". Inherited parent actions appear as gray locked tags.                                                            |
| **Requires Human Approval**      | Amber | Actions that the agent can initiate but must wait for human sign-off before completing. Examples: "infrastructure_change", "production_deploy".                                                                         |

To add a tag: type the value in the text field and press Enter or click the + button. To remove a tag: click the X on the tag. Inherited (locked) tags cannot be removed.

#### Escalation Thresholds

| Field                                  | Type                | Description                                                                                                                                               |
| -------------------------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Sentiment Threshold**                | Slider (0.0 to 1.0) | How sensitive the agent is to negative sentiment before escalating. Lower values = more sensitive (escalates sooner). Default: 0.3                        |
| **Max Attempts**                       | Slider (1 to 10)    | How many times the agent can attempt to resolve an issue before auto-escalating. Default: 3                                                               |
| **Always Escalate** (trigger keywords) | Tag input (amber)   | Situations that always trigger immediate escalation regardless of sentiment or attempt count. Examples: "security_incident", "data_loss", "server_outage" |

#### Tips

- This step is optional in terms of navigation -- you can proceed with no rules. However, the Review step will warn you if you have zero rules configured.
- Templates pre-fill comprehensive rules for their role. Start with a template and adjust rather than building from scratch.
- The "Never Do" and "Requires Human Approval" lists must always include everything from the parent levels (global + department). The wizard enforces this during validation.

---

### Step 4: Simulation Gate

**What it configures:** Optional pre-deployment testing that evaluates the agent against simulated scenarios before it goes live.

#### Enabling the Gate

Toggle the Simulation Gate on or off. It is off by default. If disabled, a message confirms that you can enable it later in the Intent Editor. You can proceed either way.

#### When Enabled

**Mode** -- Choose how the simulation gate behaves:

| Mode        | Behavior                                                                                                                                  |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **Warn**    | Runs simulations and reports results, but does not block deployment. The agent deploys even if tests fail. Use this when getting started. |
| **Enforce** | Blocks deployment if simulations fail to meet the minimum thresholds. Use this for production-critical agents.                            |

**Min Pass Rate** -- Slider from 50% to 100%. The percentage of test scenarios that must pass. Default: 80%.

**Component Score Thresholds** -- Four sliders (50% to 100%) that set minimum acceptable scores for individual evaluation dimensions:

| Component                  | What It Measures                                                                  | Default |
| -------------------------- | --------------------------------------------------------------------------------- | ------- |
| **Objective Adherence**    | How well the agent stays on mission                                               | 70%     |
| **Boundary Compliance**    | How well the agent respects neverDo and allowedActions rules                      | 80%     |
| **Escalation Correctness** | How accurately the agent escalates when it should (and doesn't when it shouldn't) | 70%     |
| **Outcome Quality**        | Overall quality of the agent's outputs                                            | 70%     |

**Report Path** -- File path where simulation reports are saved. Auto-generated if left blank.

**Test Suite IDs** -- Tag input for specifying which test suites to run. Leave blank to run all available suites.

#### Template Defaults

Templates pre-configure simulation settings appropriate for their role:

| Template         | Gate Enabled | Mode | Pass Rate | Notable Thresholds                                    |
| ---------------- | ------------ | ---- | --------- | ----------------------------------------------------- |
| MSP T1 Support   | Yes          | Warn | 80%       | Boundary Compliance: 90%, Escalation Correctness: 85% |
| Developer        | Yes          | Warn | 75%       | Outcome Quality: 85%, Boundary Compliance: 80%        |
| Research Analyst | No           | --   | --        | --                                                    |
| Project Manager  | No           | --   | --        | --                                                    |

---

### Step 5: Review

**What it does:** Summarizes your entire configuration and runs validation checks against the intent hierarchy.

The screen is split into two columns.

#### Left Column: Summary

A compact card showing all configured values:

- Agent name, ID, role, team, and emoji
- Department (and whether it is new or existing)
- Mission objective
- Count of neverDo rules, allowed actions, and approval requirements
- Simulation gate status (enabled/disabled, mode, pass rate)

#### Right Column: Hierarchy + Validation

**Hierarchy diagram** -- Visual representation of Global, Department, and Agent tiers with their objectives.

**Validation results** -- The wizard runs both client-side and server-side checks:

| Check                            | Severity | Description                                                           |
| -------------------------------- | -------- | --------------------------------------------------------------------- |
| Agent ID required                | Error    | Agent ID cannot be blank                                              |
| Agent ID format                  | Error    | Must be lowercase letters, numbers, and hyphens only                  |
| Agent ID unique                  | Error    | Cannot match an existing agent                                        |
| Display Name required            | Error    | Display name cannot be blank                                          |
| Department required              | Error    | Must select or create a department                                    |
| Missing inherited neverDo        | Error    | Agent must include all neverDo rules from parent levels               |
| Missing inherited approval rules | Error    | Agent must include all requiresHumanApproval items from parent levels |
| Actions not in parent allowlist  | Warning  | Agent has actions not defined in the parent's allowed list            |
| Max attempts exceeds parent      | Warning  | Agent allows more attempts than the parent level                      |
| Sentiment threshold too lenient  | Warning  | Agent's sentiment threshold is lower than the parent's                |
| No objective set                 | Warning  | Recommended but not required                                          |
| No rules configured              | Warning  | Recommended but not required                                          |

**Errors** block deployment -- you must go back and fix them. **Warnings** are informational and do not prevent deployment.

The "Deploy" button (replacing the usual "Continue") is disabled until all errors are resolved and validation completes.

---

### Step 6: Deploy

**What it does:** Creates all the necessary files and configuration entries to bring your agent online.

Deployment is automatic and begins immediately when you reach this step. A progress list shows four sequential operations:

| Step                          | Description                                                                                                                             | Detail                                 |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| **Provision agent directory** | Creates the agent's directory at `~/.argentos/agents/{agentId}/` via the `family.register` gateway method                               | Shows the directory path on completion |
| **Update agents.list**        | Adds the agent ID to the `agents.list` array in `argent.json` so the system recognizes it                                               | Skips silently if already present      |
| **Save intent configuration** | Writes the agent's intent policy (and new department if applicable) to the intent config. Enables intent system if not already enabled. | Runs preview validation before saving  |
| **Generate alignment docs**   | Creates `SOUL.md` and `IDENTITY.md` in the agent's directory with role-appropriate content                                              | Non-fatal if this step fails           |

Each step shows a status indicator: pending (empty circle), running (spinning), done (green check), or error (red X).

#### On Success

A success screen displays:

- The agent's emoji and name
- "deployed successfully" confirmation
- Action buttons:
  - **Create Another** -- resets the wizard for a new agent
  - **Intent Editor** -- closes the wizard and opens the Intent Editor in ConfigPanel for fine-tuning
  - **Run Simulation** -- appears only if the simulation gate was enabled
  - **Done** -- closes the wizard

#### On Error

The error message is displayed with a **Retry** button. Your configuration is preserved -- retrying picks up where it left off. The wizard does not close automatically on error.

---

## Intent Hierarchy

The intent hierarchy is the governance backbone of ArgentOS. Understanding it is essential for configuring workers correctly.

### Three Tiers

```
Global Policy
    |
    v
Department Policy (inherits from Global)
    |
    v
Agent Policy (inherits from Department + Global)
```

**Global** -- Organization-wide rules that apply to every agent and every department. Set in the Intent Editor.

**Department** -- Rules for a functional group (e.g., "MSP Support", "Engineering"). Inherits everything from Global and can only add restrictions.

**Agent** -- Rules for an individual worker. Inherits from its Department (and by extension, Global) and can only add restrictions.

### Monotonic Inheritance Rules

"Monotonic" means policies can only get stricter as you go down the hierarchy, never more permissive.

| Policy Field              | Rule                                                                         | Example                                                                                                      |
| ------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| **neverDo**               | Additive only. Child must include all parent items and can add more.         | If Global says "never delete databases", every department and agent must also include that rule.             |
| **allowedActions**        | Subset only. Child can only narrow the parent's list, never add new actions. | If the department allows 10 actions, an agent in that department can allow at most those same 10 (or fewer). |
| **requiresHumanApproval** | Additive only. Child must include all parent items and can add more.         | If Global requires approval for "infrastructure_change", every agent must also require it.                   |
| **Escalation thresholds** | Must be stricter. Lower maxAttempts, higher sentiment threshold.             | If the department allows 5 attempts, the agent must allow 5 or fewer.                                        |

The wizard visualizes this hierarchy in Steps 2 and 5 with color-coded diagrams and enforces these rules during validation in Step 5.

---

## Simulation Gate

The simulation gate is an optional quality checkpoint that runs automated test scenarios against your agent's configuration before (or after) deployment.

### Modes

- **Warn** -- Simulations run and results are reported, but the agent deploys regardless. Good for development and initial setup.
- **Enforce** -- Simulations must pass minimum thresholds or the agent is blocked from deploying. Good for production environments.

### Component Scores

The simulation evaluates four dimensions:

| Score                      | What It Measures                                                               |
| -------------------------- | ------------------------------------------------------------------------------ |
| **Objective Adherence**    | Does the agent stay focused on its stated mission?                             |
| **Boundary Compliance**    | Does the agent respect its neverDo rules and stay within allowed actions?      |
| **Escalation Correctness** | Does the agent escalate at the right times and avoid escalating unnecessarily? |
| **Outcome Quality**        | Is the overall output of the agent's work acceptable?                          |

Each score has a minimum threshold (default 70-80%). The **Min Pass Rate** sets the overall percentage of test scenarios that must pass across all dimensions.

### When to Use

- **New to the system** -- Leave the gate disabled and enable it later via the Intent Editor once you have test suites defined.
- **Operational environments** -- Enable in "warn" mode to monitor agent quality without blocking deployment.
- **Mission-critical agents** -- Enable in "enforce" mode to ensure agents meet quality standards before going live.

---

## AI Assistant Sidebar

The wizard includes a built-in AI assistant that can help you make configuration decisions.

### Opening the Sidebar

Click the **chat bubble icon** in the wizard header (next to the close button). The sidebar appears on the right side of the modal. Click again to collapse it. The sidebar is not available during the Deploy step.

### What It Knows

The assistant is aware of:

- Which step you are currently on
- The agent's display name and role (if set)
- The agent's current objective (if set)

### What to Ask

- "What neverDo rules should a T1 support agent have?"
- "What's the difference between warn and enforce mode?"
- "Suggest escalation triggers for a developer agent"
- "What sentiment threshold should I use for customer-facing agents?"
- "Help me write a mission objective for a research analyst"

### How It Works

Messages are sent to the ArgentOS gateway with a `[WIZARD_ASSIST]` context tag. The AI responds with configuration advice tailored to your current step and agent setup. The conversation persists across steps (navigating between steps does not reset the chat).

If the gateway is unavailable, the sidebar displays a connection error but the wizard continues to work fully without it -- all fields can be filled in manually.

---

## Validation & Error Handling

### What Gets Validated

The wizard performs validation at two points:

1. **Per-step navigation** -- The Continue button is disabled until minimum requirements are met (e.g., Agent ID and Display Name in Step 1, Department selection in Step 2).

2. **Step 5 (Review)** -- Full validation runs automatically, including:
   - Client-side checks (required fields, format, uniqueness, monotonic inheritance rules)
   - Server-side preview validation (sends the proposed intent config to `/api/settings/intent/preview` for schema validation)

### Common Errors

| Error                                          | Cause                                                                          | Fix                                                                                |
| ---------------------------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| "Agent ID is required"                         | Agent ID field is blank                                                        | Go back to Step 1 and enter an Agent ID                                            |
| "Agent `X` already exists"                     | An agent with that ID is already configured                                    | Choose a different Agent ID in Step 1                                              |
| "Missing inherited neverDo rules: ..."         | Your agent's neverDo list is missing rules from the global or department level | Go to Step 3 and add the missing rules, or switch to a template that includes them |
| "Missing inherited approval requirements: ..." | Same issue for requiresHumanApproval                                           | Go to Step 3 and add the missing items                                             |
| "Department is required"                       | No department selected or created                                              | Go to Step 2 and select or create a department                                     |

### Deploy Failures

If deployment fails at any step:

- The failing step shows a red X with an error message
- A **Retry** button appears
- Your configuration is fully preserved -- nothing is lost
- Retrying re-runs the entire deployment sequence

Common deploy failure causes:

- Gateway connection lost
- Permission issues creating the agent directory
- Intent config save failure (schema validation error at the server level)

---

## What Gets Created

After successful deployment, the wizard creates the following artifacts:

| Artifact                           | Location/Description                                                                                                                                                  |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Agent directory**                | `~/.argentos/agents/{agentId}/` -- the agent's home directory                                                                                                         |
| **agents.list entry**              | The agent ID is added to `agents.list` in `argent.json` so the system recognizes it                                                                                   |
| **Intent configuration**           | The agent's policy (objective, neverDo, allowedActions, requiresHumanApproval, escalation, simulation gate) is saved under `intent.agents.{agentId}` in `argent.json` |
| **New department** (if applicable) | If you created a new department, it is saved under `intent.departments.{deptId}` with its objective                                                                   |
| **SOUL.md**                        | Alignment document in the agent directory defining core values and decision framework                                                                                 |
| **IDENTITY.md**                    | Alignment document in the agent directory with the agent's name, ID, role, team, emoji, and department                                                                |
| **Intent system enabled**          | If the intent system was not previously enabled, it is automatically turned on                                                                                        |

---

## After Deployment

### Fine-Tune with the Intent Editor

The wizard creates a working baseline, but you may want to adjust policies after seeing how the agent performs. Click **Intent Editor** on the success screen (or navigate to Settings > Intent in the dashboard) to:

- Edit neverDo, allowedActions, and approval rules with full JSON control
- Adjust escalation thresholds
- Modify simulation gate settings
- View and edit department-level policies

### Run Simulations

If you enabled the simulation gate, click **Run Simulation** on the success screen to evaluate your agent against test scenarios. You can also run simulations later from the Intent Editor.

### Create More Workers

Click **Create Another** on the success screen to immediately start configuring a new agent. The wizard resets to Step 1 with a clean state.

### Edit Alignment Documents

Use the Alignment Docs editor in the dashboard (Settings > Alignment) to customize your agent's SOUL.md and IDENTITY.md beyond the wizard's defaults. These documents shape the agent's personality, values, and behavioral style.

---

## Troubleshooting

### The + Worker button is not visible

The button is in the status bar at the bottom of the dashboard. Ensure the dashboard is fully loaded and connected to the gateway. If the status bar is not showing, check that the dashboard is not in a minimized or error state.

### "No departments configured yet" in Step 2

This means the intent system has no departments defined. Switch to "Create New" to define your first department, or set up departments in the Intent Editor before using the wizard.

### Validation shows inherited rule violations but I used a template

Templates pre-fill sensible defaults, but if your global or department policies have been modified since the templates were defined, the template values may not include all required inherited rules. Go to Step 3 and add the missing rules shown in the validation errors.

### Deploy succeeds but the agent doesn't appear in the dashboard

The agents list was updated, but the gateway may need to reload its configuration. Try refreshing the dashboard. If the agent still doesn't appear, verify that the agent ID appears in `agents.list` in your `argent.json` configuration file.

### Deploy fails with "Failed to save intent"

This typically means the intent configuration has a schema validation error at the server level. Check the error message for details. Common causes include conflicting department IDs or malformed policy values. Use the Intent Editor to inspect the raw configuration.

### AI Assistant says it can't connect

The AI sidebar requires an active gateway connection. Verify the gateway is running (`argent gateway status`). The wizard works fully without the AI assistant -- all fields can be filled in manually.

### I want to edit a worker I already created

The wizard currently supports creating new workers only. To edit an existing worker's configuration, use the Intent Editor in the dashboard Settings panel, or edit the agent's alignment documents in the Alignment Docs editor.
