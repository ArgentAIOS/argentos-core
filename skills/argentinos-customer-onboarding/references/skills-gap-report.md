# Skills Gap Report Method

## Goal

Show exactly what is ready now vs what must be built.

## Gap Scoring

Score each capability on:

- Impact (1-5)
- Build complexity (1-5)
- Dependency risk (1-5)
- Time sensitivity (1-5)

Priority heuristic:

- High priority if impact >= 4 and (time sensitivity >= 4 or dependency risk >= 4)

## Gap Table Format

For each capability include:

- Capability name
- Current state (ready/partial/missing)
- Why it matters
- Complexity estimate
- Dependencies
- Recommended phase (1/2/3)
- Owner (platform/agent/integration)

## Output Rules

- Keep phase 1 to high-impact and low-to-medium integration risk.
- Push speculative features to phase 2+.
- Mark assumptions explicitly.
