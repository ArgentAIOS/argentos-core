---
name: argentinos-demo-call
description: Run a live 60-minute sales discovery call where Argent leads questioning, maps pain to agent design, and generates deployment artifacts in real time. Use when the user asks to prepare, run, or replay a demo/onboarding discovery call with a customer on Zoom/Meet/Teams.
---

# ArgentOS Demo Call

Use this skill to structure a high-conviction live call: discovery conversation first, system design second, artifacts before close.

## Call Contract

Always produce these outcomes before ending:

1. Consolidated discovery notes
2. Proposed agent roster mapped to explicit pain points
3. Three artifacts drafted live:
   - Strategy document
   - Technical implementation spec
   - Bootstrap prompt
4. Explicit next-step recommendation and owner

## Run Sequence

1. Load pre-call context
   - Company, industry, team size, known pain, key contact, any prior docs
   - Missing context is acceptable; do not block call start
2. Run the five-act flow from [call-script.md](references/call-script.md)
3. Ask follow-ups using [probe-questions.md](references/probe-questions.md)
4. Use transition language from [transition-lines.md](references/transition-lines.md)
5. Present roster using [proposal-language.md](references/proposal-language.md)
6. Narrate live artifact creation using [live-build-narration.md](references/live-build-narration.md)
7. Close with [close-questions.md](references/close-questions.md)
8. Complete handoff with [run-checklist.md](references/run-checklist.md)
9. If structured intake is available, call `onboarding_pack` to emit all four onboarding artifacts in one deterministic pass.

## Tone And Behavior

- Lead with operational precision, not product pitch language.
- Mirror customer wording for pain points before proposing solutions.
- Keep confidence high and claims bounded to stated evidence.
- Move from discovery to design only after explicit pain confirmation.

## Minimum Evidence To Report Back

- Top three pain points (quoted/paraphrased)
- Proposed phase-1 automation anchor
- Artifact names and completion state
- Deployment blockers (if any)
- Recommended timeline

## References

- [call-script.md](references/call-script.md)
- [opening-lines.md](references/opening-lines.md)
- [probe-questions.md](references/probe-questions.md)
- [transition-lines.md](references/transition-lines.md)
- [proposal-language.md](references/proposal-language.md)
- [live-build-narration.md](references/live-build-narration.md)
- [close-questions.md](references/close-questions.md)
- [run-checklist.md](references/run-checklist.md)
