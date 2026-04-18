# aos-callscrub

Agent-native CallScrub connector — first-party reference implementation.

CallScrub is a sales call analysis and coaching platform. This connector provides full read and write access to calls, transcripts, coaching recommendations, agent performance, and reporting.

- `call.list` and `call.get` browse recorded sales calls.
- `call.upload` ingests new call recordings for processing.
- `call.analyze` triggers AI analysis on a specific call.
- `transcript.get` retrieves the full transcript for a call.
- `transcript.search` performs full-text search across all transcripts.
- `coaching.generate` creates AI coaching recommendations from a call.
- `coaching.list` and `coaching.get` browse coaching reports.
- `agent.list`, `agent.stats`, and `agent.scorecard` provide sales agent performance data.
- `team.list` and `team.stats` provide team-level analytics.
- `report.generate` and `report.list` manage performance reports.

## Auth

The connector expects a CallScrub API key via `CALLSCRUB_API_KEY`.

Optional scope hints:

- `CALLSCRUB_TEAM_ID` to scope queries to a specific team.
- `CALLSCRUB_AGENT_NAME` to default agent filters.
- `CALLSCRUB_CALL_ID` to preselect a call scope.
- `CALLSCRUB_COACHING_ID` to preselect a coaching report scope.

## Live Reads + Writes

This is a first-party connector with full live read and write support. All commands hit the CallScrub API directly. If the API key is present but the backend rejects requests, `health` and `doctor` report the API failure.
