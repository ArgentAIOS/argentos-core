---
summary: "Room Reader recognizes conversation trajectories and offers the right skill or workflow before the user has to name it."
read_when:
  - Changing implicit skill or workflow routing
  - Debugging why a conversation did or did not offer a skill
  - Adding new opportunity patterns for project, research, article, podcast, data, or workflow requests
title: "Room Reader"
---

# Room Reader

Room Reader is ArgentOS Core's lightweight opportunity router. It reads the
current user turn, compares it with the available skill catalog, and decides
whether the conversation is becoming a recognizable work pattern.

The first Core slice is intentionally conservative:

- `observe`: no prompt text is added.
- `offer`: the agent may briefly offer a relevant skill or workflow.
- `activate`: the agent should use the recommended skill or workflow as the
  primary path when it fits the request.

Supported initial patterns are podcast, article, data collection, research,
workflow automation, and project build. Project-build requests can recommend the
Core `specforge` workflow, while non-project work such as articles, podcasts,
research, or spreadsheet/data collection must not trigger SpecForge.

Room Reader emits lifecycle telemetry with the selected mode, detected patterns,
recommended skill or workflow, confidence, and concise reasons. It injects a
compact Opportunity Router prompt block only for `offer` and `activate`.
