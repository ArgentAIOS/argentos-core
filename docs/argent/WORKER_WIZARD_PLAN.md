# Worker Onboarding Wizard — Implementation Plan

**Status**: Planning
**Owner**: Jason Brashear
**Target**: Demo-ready investor presentation
**Date**: 2026-03-11

---

## Problem

The current intent system UI (ConfigPanel) is a power-user JSON editor. It shows raw department configs, agent mappings, and policy fields. People who see it for the first time are overwhelmed. For investor demos, we need a guided experience that makes someone say "oh, I get it" in 60 seconds.

## Solution

A **Worker Onboarding Wizard** — a full-screen modal with a step-by-step flow that creates a new agent worker, assigns it to a department, configures intent boundaries, and optionally sets up simulation testing. AI assists at every step.

---

## Architecture

### Component Structure

```
dashboard/src/components/worker-wizard/
├── WorkerWizard.tsx          # Main modal shell, step orchestration, state
├── steps/
│   ├── StepIdentity.tsx      # Step 1: Name, role, team
│   ├── StepDepartment.tsx    # Step 2: Pick or create department
│   ├── StepBoundaries.tsx    # Step 3: Intent policies (neverDo, allowedActions, etc.)
│   ├── StepSimulation.tsx    # Step 4: Simulation gate (optional)
│   ├── StepReview.tsx        # Step 5: Validate and preview
│   └── StepDeploy.tsx        # Step 6: Save and create
├── shared/
│   ├── HierarchyDiagram.tsx  # Visual: Global → Dept → Agent chain
│   ├── TagInput.tsx          # Reusable tag input (add/remove string items)
│   ├── StepIndicator.tsx     # Top progress bar (numbered circles + lines)
│   └── AISidebar.tsx         # Right-side AI chat panel
└── types.ts                  # Wizard state types
```

**Total estimate**: ~1200-1500 lines across all files

### State Shape

```typescript
interface WizardState {
  // Step 1: Identity
  agentId: string; // auto-generated from name, editable
  displayName: string;
  role: string; // tier_1_support, developer, analyst, custom
  team: string;
  emoji: string; // optional visual identity

  // Step 2: Department
  departmentMode: "existing" | "new";
  existingDepartmentId: string;
  newDepartment: {
    id: string;
    objective: string;
    neverDo: string[];
    allowedActions: string[];
    requiresHumanApproval: string[];
  };

  // Step 3: Boundaries
  objective: string;
  neverDo: string[];
  allowedActions: string[];
  requiresHumanApproval: string[];
  escalation: {
    sentimentThreshold: number;
    maxAttemptsBeforeEscalation: number;
    customerTiersAlwaysEscalate: string[];
  };

  // Step 4: Simulation Gate
  simulationEnabled: boolean;
  simulationGate: {
    mode: "warn" | "enforce";
    minPassRate: number;
    suites: string[];
    reportPath: string;
    minComponentScores: {
      objectiveAdherence: number;
      boundaryCompliance: number;
      escalationCorrectness: number;
      outcomeQuality: number;
    };
  };

  // Step 5-6: Validation/Deploy
  validationResults: ValidationResult[];
  deployStatus: "idle" | "deploying" | "success" | "error";
}
```

---

## Step-by-Step Detail

### Step 1: Agent Identity

**UI**: Clean card with 4-5 fields, generous spacing.

| Field        | Type                | Notes                                                                                                          |
| ------------ | ------------------- | -------------------------------------------------------------------------------------------------------------- |
| Display Name | text input          | "Titanium Tier 1 Support"                                                                                      |
| Agent ID     | text input          | Auto-slugified from name: `titanium-tier-1-support`. Editable. Validated unique.                               |
| Role         | searchable dropdown | Presets: `tier_1_support`, `tier_2_support`, `developer`, `analyst`, `researcher`, `project_manager`, `custom` |
| Team         | text input          | "MSP Team", "Engineering", etc.                                                                                |
| Emoji        | emoji picker        | Optional. Shown in dashboard lists.                                                                            |

**Validation**: Agent ID must be unique (not in existing agents list). No spaces, lowercase + hyphens only.

**AI Enhancement**: Based on role selection, AI can suggest team name and pre-fill downstream steps.

---

### Step 2: Department

**UI**: Two-pane radio selection.

**Option A — Join Existing Department**

- Dropdown of all departments from `intent.departments`
- Shows the department's objective and key policies as a preview card
- Shows inheritance: "Global → [selected dept] → [your agent]"

**Option B — Create New Department**

- Department ID (auto from name)
- Objective (textarea)
- Shows: "This department inherits from: Global Policy"
- Quick-add for neverDo and allowedActions (or defer to Step 3)

**Visual**: `HierarchyDiagram` component shows the 3-tier chain with the current selection highlighted. Animated transitions when switching between existing/new.

**Validation**: If existing, department must exist. If new, ID must be unique.

---

### Step 3: Intent Boundaries

**UI**: The core policy editor, but friendly. Three sections with collapsible panels.

**Section 3a — Mission**

- Objective textarea (what is this agent's job?)
- Shows inherited objective from department in muted text above

**Section 3b — Rules**

- **Never Do** — Tag input. Shows inherited rules from dept/global in gray (locked, can't remove). New rules you add are in accent color.
- **Allowed Actions** — Tag input. Shows parent's full list. You can only select from parent's actions (subset enforcement). Checkboxes.
- **Requires Human Approval** — Tag input. Shows inherited items locked. Can add more.

**Section 3c — Escalation**

- Sentiment threshold — slider (-1 to 1) with label ("Escalate when sentiment drops below X")
- Max attempts — number input ("Auto-escalate after N failed attempts")
- Auto-escalate tiers — tag input ("Always escalate for: security_incident, data_loss, ...")

**AI Enhancement**:

- "Suggest for [role]" button that calls the AI with the role context
- AI returns suggested neverDo, allowedActions, escalation rules
- Each suggestion has an "Apply" button
- Shows reasoning: "T1 support agents should never modify infrastructure because..."

---

### Step 4: Simulation Gate (Optional)

**UI**: Toggle to enable, with a "Set up later" skip button.

If enabled:

- Mode: warn / enforce radio buttons
- Min pass rate: slider (0-1) with percentage label
- Suite IDs: tag input (pre-filled based on role, e.g., `t1-resolve`, `t1-escalate`)
- Report path: auto-generated from agent ID, editable
- Component score thresholds: 4 sliders with labels
  - Objective Adherence (0-1)
  - Boundary Compliance (0-1)
  - Escalation Correctness (0-1)
  - Outcome Quality (0-1)

**Smart defaults by role**:

- T1 Support → high escalation correctness (0.85), high boundary compliance (0.9)
- Developer → high outcome quality (0.85), moderate boundaries
- Analyst → high objective adherence (0.85)

---

### Step 5: Review & Validate

**UI**: Summary card with all configured values, plus validation results.

**Layout**: Two columns.

**Left column — Configuration Summary**:

- Agent card (name, ID, role, team, emoji)
- Department assignment (existing name or "NEW: [name]")
- Key policies (objective, top 3 neverDo, top 3 allowedActions)
- Simulation gate status

**Right column — Hierarchy Visualization**:

- Full `HierarchyDiagram` showing Global → Dept → Agent
- At each level, show 2-3 key policies
- Color-coded: green = inherited, blue = new, red = conflicts

**Validation Checklist** (bottom):

- ✓ Agent ID is unique
- ✓ Department exists or will be created
- ✓ neverDo rules include all parent rules (monotonic)
- ✓ allowedActions are subset of parent
- ✓ Escalation thresholds are stricter than parent
- ✓ Zod schema validation passes
- ⚠ Warnings (non-blocking)
- ✗ Errors (blocking — can't proceed)

**Validation implementation**: Run the same `validateIntentHierarchy()` logic client-side, or call a gateway RPC method to validate.

---

### Step 6: Deploy

**UI**: Progress indicator with animated checkmarks.

**Actions performed** (sequential):

1. Create agent directory: `~/.argentos/agents/{id}/`
2. Write `identity.json` with name, ID, role, team
3. Create agent workspace docs (SOUL.md, IDENTITY.md, etc.)
4. Update `argent.json`:
   - Add to `agents.list[]`
   - If new department: add to `intent.departments`
   - Add to `intent.agents` with full policy config
   - Add simulation gate if enabled
5. Validate final config (Zod schema check)

**API calls**:

- `POST /api/agents/provision` — create directory + identity (new endpoint)
- `PATCH /api/settings/intent` — update intent config
- `PATCH /api/settings/agents-list` — update agents.list

**Success screen**:

- "Worker Created Successfully" with agent emoji + name
- "View in Intent Editor" button (navigates to ConfigPanel intent section)
- "Run Simulation" button (if simulation gate was configured)
- "Create Another Worker" button
- "Done" button (closes wizard)

**Error handling**: If any step fails, show the error with a "Retry" button. Don't lose state.

---

## AI Sidebar

**Position**: Right side, 320px wide, collapsible.

**Implementation**: Uses the existing gateway WebSocket to send messages to the main agent with a special context tag (`[WIZARD_ASSIST]`) so the agent knows it's helping with worker setup, not handling a normal conversation.

**Behavior**:

- Opens with a greeting: "I'll help you set up your new worker. What kind of work will they do?"
- Context-aware: knows which step the user is on
- Can suggest values: "Based on T1 support role, I recommend these neverDo rules: ..."
- Suggestions appear with "Apply" buttons that populate the form
- Can answer questions: "What's the difference between warn and enforce mode?"
- Persists across steps (doesn't reset when navigating)

**Message format to agent**:

```
[WIZARD_ASSIST] Step: {currentStep}
Agent being created: {agentId} ({role})
Department: {departmentId}
User question: {message}
Current config: {JSON summary of wizard state}
```

---

## API Endpoints Needed

### New: POST /api/agents/provision

Creates the agent directory structure and identity file.

```json
// Request
{
  "agentId": "tier-1-technical-support",
  "name": "Titanium Tier 1 Support",
  "role": "tier_1_support",
  "team": "MSP Team",
  "emoji": "🛡️"
}

// Response
{ "ok": true, "path": "~/.argentos/agents/tier-1-technical-support/" }
```

### Existing: PATCH /api/settings (already exists)

Updates argent.json sections. Used for intent and agents.list changes.

### Existing: GET /api/settings (already exists)

Reads current config. Used to populate existing departments and validate uniqueness.

---

## Visual Design

### Color Palette (matches dashboard dark theme)

- Background: `#0d1117` (modal backdrop)
- Card background: `#161b22`
- Step active: `#58a6ff` (blue accent)
- Step complete: `#3fb950` (green)
- Step pending: `#484f58` (muted gray)
- Error: `#f85149`
- Warning: `#d29922`
- Text primary: `#e6edf3`
- Text secondary: `#8b949e`
- Border: `#30363d`

### Typography

- Step titles: 24px, semibold
- Section headers: 18px, medium
- Body text: 14px, regular
- Helper text: 13px, muted color

### Animations

- Step transitions: 300ms slide + fade
- Validation checkmarks: 200ms scale-in
- Hierarchy diagram: 400ms draw-in on step 2/5
- Deploy progress: sequential reveal with staggered timing

---

## Validation Rules (from intent system)

These MUST be enforced in the Review step:

1. **Monotonic neverDo**: Agent neverDo must include ALL parent (department + global) neverDo items. Can only add, never remove.
2. **Subset allowedActions**: Agent allowedActions must be a SUBSET of parent allowedActions. Can only narrow, never widen.
3. **Additive requiresHumanApproval**: Agent list must include all parent items. Can only add.
4. **Stricter escalation**: Agent thresholds must be stricter (lower maxAttempts, higher sentiment threshold) than parent.
5. **Sticky booleans**: If parent sets `requireAcknowledgmentBeforeClose: true`, agent cannot set it to false.
6. **Schema validation**: All fields must pass Zod schema validation.

---

## Implementation Order

1. **Types + state** (`types.ts`) — wizard state shape, validation types
2. **Shared components** — StepIndicator, TagInput, HierarchyDiagram
3. **Steps 1-2** — Identity + Department (simplest, establish patterns)
4. **Step 3** — Boundaries (most complex form)
5. **Steps 4-5** — Simulation + Review
6. **Step 6** — Deploy (API integration)
7. **AI Sidebar** — Chat integration
8. **API endpoint** — POST /api/agents/provision
9. **Integration** — Wire wizard into ConfigPanel/dashboard
10. **Polish** — Animations, responsive, edge cases

---

## Open Questions

1. Should the wizard also set up alignment docs (SOUL.md, IDENTITY.md)? Or leave that for after?
2. Should we support editing existing workers through the same wizard? (Edit mode vs Create mode)
3. Do we need a "Worker Templates" system? (e.g., "MSP T1 Support" template that pre-fills everything)
4. Should the AI sidebar use a dedicated session or share the main agent session?

---

## Success Criteria

- Non-technical person can create a worker in under 3 minutes
- The hierarchy visualization makes the governance model immediately clear
- Validation prevents invalid configurations before they reach the config file
- AI suggestions reduce manual input by 70%+
- Looks polished enough for an investor demo
