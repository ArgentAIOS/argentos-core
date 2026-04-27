---
name: specforge-project
description: Use when the user wants to build, create, plan, architect, scope, or spec a software project, app, platform, agent, API, tool, SaaS product, or major development feature. This skill requires routing development-project requests through the SpecForge tool before implementation.
---

# SpecForge Project Intake

Use SpecForge for development-project intake before implementation.

## Trigger

Use this skill when the user says things like:

- "I want to build a project"
- "I need to build an app/tool/platform/API"
- "Let's create a new software project"
- "Plan/spec/architect this feature"
- "Use SpecForge" or "spec forge this"

## Required Flow

1. Call the `specforge` tool with `action="handle"` and the exact latest user message.
2. Follow the returned `guidance`.
3. Keep the conversation in the current SpecForge stage until the tool advances it.
4. Do not implement, scaffold, assign tasks, or create execution work until SpecForge reaches approval/execution handoff.

## Stage Discipline

- `project_type_gate`: ask only whether the project is GREENFIELD or BROWNFIELD.
- `intake_interview`: ask one focused intake question at a time.
- `draft_review`: draft/update the PRD or implementation spec and request feedback.
- `awaiting_approval`: wait for explicit `APPROVE` or `REQUEST CHANGES`.
- `approved_execution`: implementation handoff is allowed.

## Commands

- Continue intake: call `specforge` with `{"action":"handle","message":"<latest user message>"}`.
- Inspect status: call `specforge` with `{"action":"status"}`.
- Exit: call `specforge` with `{"action":"exit"}` only when the user cancels SpecForge.
