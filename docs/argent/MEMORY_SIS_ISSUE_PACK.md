# Memory + SIS Sprint Issue Pack (7 Issues)

Last updated: 2026-03-05

## 1) Memory Health Surface (Dashboard + Swift)

Title:
`Memory health dashboard: MemU/Contemplation/SIS/RAG status with red/yellow/green indicators`

Acceptance:

- Show last successful MemU extraction, contemplation cycle, SIS consolidation, RAG ingestion.
- Show failure counters (24h) for MemU/SIS parse failures.
- Show active provider/model for MemU + embeddings.

Backend API contract note:

- Memory health is exposed on gateway `health` payload as `memoryHealth`.
- Contract shape:

```json
{
  "memoryHealth": {
    "generatedAt": "2026-03-05T12:00:00.000Z",
    "lanes": {
      "memuExtraction": {
        "status": "green",
        "lastSuccessAt": "2026-03-05T11:10:00.000Z",
        "staleHours": 0.83,
        "failureCount24h": 0
      },
      "contemplation": {
        "status": "green",
        "lastSuccessAt": "2026-03-05T11:35:00.000Z",
        "staleHours": 0.42,
        "failureCount24h": 0
      },
      "sisConsolidation": {
        "status": "yellow",
        "lastSuccessAt": "2026-03-04T21:00:00.000Z",
        "staleHours": 15,
        "failureCount24h": 1
      },
      "ragIngestion": {
        "status": "green",
        "lastSuccessAt": "2026-03-04T14:00:00.000Z",
        "staleHours": 22,
        "failureCount24h": 0
      }
    },
    "failures24h": {
      "memuParse": 0,
      "sisParse": 1
    },
    "activeModels": {
      "memu": { "provider": "ollama", "model": "qwen3:14b" },
      "embeddings": { "provider": "ollama", "model": "nomic-embed-text" }
    }
  }
}
```

## 2) MemU Configuration Guardrails

Title:
`Prevent invalid MemU LLM model selection (block embedding-only models in LLM selector)`

Acceptance:

- `nomic-embed-text` cannot be saved as MemU LLM model.
- UI shows actionable validation error and recommended replacement.
- Existing invalid configs are flagged on load.

## 3) SIS JSON Reliability Hardening

Title:
`SIS consolidation parser hardening: structured output contract + fallback parser`

Acceptance:

- Parse success >= 95% in regression tests.
- Failures produce typed error reason and metrics increments.
- No silent consolidation drops.

## 4) Contemplation Episode Quality + Fallback Policy

Title:
`Contemplation output quality controls and explicit fallback policy`

Acceptance:

- Episode parser failure recorded with reason + sample metadata.
- Fallback episode storage path audited and visible in health page.
- Operator can distinguish parse-failed fallback from fully structured episode.

## 5) Memory Operator Docs Publication (Live docs site)

Title:
`Publish operator memory docs to docs.argentos.ai (architecture, runbook, SIS reliability)`

Acceptance:

- Docs pages live under `/docs/memory/` on production docs site.
- Linked from memory index and operator onboarding paths.
- Includes command-level runbook and escalation thresholds.

## 6) End-to-End Memory Self-Test Command

Title:
`Add operator self-test for memory lanes (MemU + RAG + SIS signals)`

Acceptance:

- One command performs: store fact, recall fact, doc retrieval check, SIS status check.
- Returns pass/fail plus failed stage details.
- Integrated into dashboard Developer tools.

## 7) Cron/Background Lane Isolation for Interactive Continuity

Title:
`Separate background memory jobs from interactive chat lane to prevent turn-lag/context bleed`

Acceptance:

- Interactive session lane not blocked by MemU/SIS/contemplation jobs.
- No "one turn behind" behavior under normal load.
- Diagnostic logs label background vs interactive runs clearly.
