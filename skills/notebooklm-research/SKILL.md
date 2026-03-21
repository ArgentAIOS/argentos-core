---
name: notebooklm-research
description: "Run YouTube-driven research in ArgentOS by searching videos and sending links into NotebookLM for synthesis and infographic outputs via youtube_notebooklm."
metadata:
  {
    "argent":
      {
        "emoji": "book",
        "skillKey": "notebooklm-research",
        "requires": { "bins": ["yt-dlp", "notebooklm"] },
      },
  }
---

# NotebookLM Research

Use `youtube_notebooklm` when the user wants market research, trend mapping, competitor scans, or synthesis from YouTube sources through NotebookLM.

## Primary Action

Use `youtube_to_notebook_workflow` for end-to-end execution:

1. Search YouTube
2. Create NotebookLM notebook
3. Add videos as sources
4. Ask NotebookLM for analysis
5. Optionally generate/download infographic

First-run check:

- Call `setup_status` first. If `setupRequired: true`, run the returned
  `next_steps` commands before continuing.

## Fast Start

```json
{
  "action": "youtube_to_notebook_workflow",
  "query": "Claude Code skills marketing",
  "count": 10,
  "months": 6,
  "question": "What are the strongest recurring GTM patterns and differentiators across these videos?",
  "generate_infographic": true,
  "infographic_prompt": "Create a handwritten blueprint style infographic with GTM patterns, risks, and opportunities.",
  "infographic_orientation": "portrait",
  "infographic_detail": "detailed"
}
```

## Granular Actions

- `youtube_search`
- `setup_status`
- `notebook_create`
- `notebook_add_sources`
- `notebook_ask`
- `notebook_generate_infographic`

Use granular actions if the user wants custom sequencing or to reuse an existing notebook.

## Prerequisites

Install dependencies once:

```bash
pip install yt-dlp
pip install "notebooklm-py[browser]"
playwright install chromium
notebooklm login
```

If commands fail, report missing prerequisites and suggest the exact install/login command.

## Operating Notes

- Default recency filter is last 6 months (`months: 6`).
- Set `no_date_filter: true` to include all upload dates.
- Keep `wait_for_sources: true` for reliable downstream analysis.
- For stakeholder-ready output, enable `generate_infographic` and keep the prompt specific.
