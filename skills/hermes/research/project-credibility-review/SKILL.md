---
name: hermes-project-credibility-review
description: Evaluate a startup/open-source project or AI product by
  cross-checking the website narrative against repositories, docs, demos,
  activity, and implementation evidence. Use when the user asks what you think
  of a product/project URL, especially if it has GitHub links or open-source
  claims.
version: 1.0.0
author: Hermes Agent
license: MIT
tags:
  - research
  - github
  - product-review
  - startup
  - open-source
  - due-diligence
triggers:
  - what do you think about this website
  - review this project
  - is this legit
  - evaluate this startup
  - assess this GitHub repo
  - look at this AI product
metadata:
  hermes_import:
    original_name: project-credibility-review
    source: NousResearch/hermes-agent active profile ~/.hermes/skills
---

# Project Credibility Review

Use this workflow to review a project/product credibly instead of judging only from marketing copy.

## Workflow

1. Open the website first.
   - Capture the positioning, target user, primary claims, CTAs, trust signals, and conversion path.
   - If visual/design quality matters, use browser_vision for a founder/product critique.

2. Follow and verify external proof links.
   - Check GitHub, docs, demos, marketplace, Discord/community, blog, changelog, or install links.
   - Do not assume the first repository found is the canonical one. Websites may link to placeholder repos, moved repos, or alternate branch names.
   - If the user provides a second repo/link, treat it as potentially more authoritative and re-evaluate rather than defending the first conclusion.

3. For GitHub repos, inspect evidence of real implementation.
   - Stars, forks, issues, default branch, active branch, branch/tag counts, latest commit, commit count, CI status, license, language, repo size.
   - Directory structure: src, tests, docs, apps, packages, scripts, configs, installers, workflows.
   - README, package.json/pyproject/Cargo.toml/etc., changelog, contributing guide, architecture docs.
   - Branch divergence: a dev branch far ahead of main often means momentum but possible instability.

4. Compare claims against artifacts.
   - If the site says open source, confirm source is actually public, not only a holder repo.
   - If it claims local/private/security, look for architecture, secrets handling, auth, install docs, and threat model/security docs.
   - If it claims integrations/connectors, verify code directories or manifests exist.
   - If it claims maturity, look for releases, tests, CI, docs, and install path.

5. Separate conclusions by confidence.
   - "What is clearly true from public evidence"
   - "What looks promising"
   - "What remains unproven"
   - "Main risks/concerns"
   - "What I would test next"

6. Be willing to revise.
   - If new evidence appears, explicitly update the assessment.
   - Example: a placeholder repo may make a product look vaporous, but a separate real repo with active commits and substantial source should materially improve the evaluation.

## Pitfalls

- Do not over-index on polished landing pages; inspect implementation evidence.
- Do not dismiss a project solely because one linked repo is a placeholder; search or use user-provided canonical repo links.
- Avoid absolute claims like "vaporware" or "production-ready" without running the software or inspecting enough artifacts.
- Marketing language such as "consciousness," "presence," or "self-directed mind" may be brand positioning; judge it separately from implementation depth.

## Output Template

Short verdict:

- One sentence summary.

Evidence checked:

- Website: ...
- Repo/docs: ...
- Activity: ...

Strengths:

- ...

Concerns:

- ...

What changed my view, if applicable:

- ...

Next due-diligence steps:

1. Inspect install scripts.
2. Check CI/release status.
3. Run locally in a clean environment.
4. Test one end-to-end workflow.
5. Review security posture around secrets, local services, permissions, and autonomous actions.
