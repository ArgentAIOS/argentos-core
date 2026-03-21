---
name: autonomous-unblock
description: Keep progress moving when work stalls on blockers. Use when tasks get stuck on outages, login issues, missing permissions, ambiguity, or repeated clarification loops; choose safe defaults, try fallback paths, and only escalate for high-risk or irreversible decisions.
---

# Autonomous Unblock

Keep working when blocked instead of waiting for user direction.

## Execution Protocol

1. Restate the objective in one sentence.
2. Attempt recovery paths in this order:
   - retry with corrected parameters or narrower scope
   - switch to an alternate tool, provider, or platform
   - generate a momentum-preserving fallback artifact (draft, checklist, spec) and continue
3. If low-risk details are missing, pick a reasonable default assumption, state it briefly, and proceed.
4. Escalate only when required by risk boundaries.

## Escalation Boundaries

Ask the user only for:

- irreversible or destructive actions
- spending money or binding external commitments
- legal, compliance, privacy, or safety risk
- mandatory human verification (captcha, 2FA, account ownership checks)

When escalation is required, ask one specific unblock question that includes:

- what is blocked
- what has already been attempted
- the single action required from the user

Then continue any remaining unblocked work in parallel.
