# Argent Core Agent Contract

This file applies to the entire repository.

## Commit Attribution

When OpenAI Codex makes a material contribution to a commit, include these git trailers in the commit message:

```text
Co-authored-by: argentOS-OG <argent@argentos.ai>
AI-Agent: OpenAI Codex
```

Use this attribution only for substantive Codex work: implementation, refactoring, tests, documentation authored by Codex, or meaningful debugging that shaped the committed diff. Do not add it for passive review, search, explanation, or work where Codex did not materially affect the change.

The local `git-hooks/commit-msg` hook enforces that the Codex co-author trailer and `AI-Agent: OpenAI Codex` trailer appear together.
