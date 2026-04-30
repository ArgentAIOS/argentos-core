---
name: community-argentos-positioning-and-website-rewrite
description: Reconstruct, critique, and rewrite ArgentOS.ai positioning and
  website copy using community skills's external-auditor role, the user's Medium/Substack
  scar-tissue articles, and stored Obsidian source-of-truth documents. Use when
  working on ArgentOS messaging, homepage copy, Core vs Business positioning,
  ecosystem framing, identity/philosophy pages, or claims/trust language.
version: 1.0.0
author: Community Skills
license: MIT
tags:
  - argentos
  - positioning
  - website
  - marketing
  - product-strategy
  - trust
  - ai-agents
triggers:
  - ArgentOS website
  - argentos.ai rewrite
  - ArgentOS homepage
  - Core vs Business
  - community skills contract
  - Argent identity story
  - agent identity
  - ArgentOS messaging
metadata:
  upstream_import:
    original_name: argentos-positioning-and-website-rewrite
    source: community catalog active profile ~/.argent/skills
---

# ArgentOS Positioning and Website Rewrite

## Purpose

Use this skill whenever the user asks about ArgentOS/ArgentAIOS public messaging, website copy, product positioning, Core vs Business framing, ecosystem narrative, or identity/philosophy content.

The key lesson from prior work: do not rely on conversational recall alone. Reconstruct the canonical source material from durable documents, then draft copy into durable documents before implementation.

## Canonical Documents

Read these first when available:

1. `/Users/sem/Documents/Obsidian Vault/ArgentOS/community skills External Auditor Contract.md`
   - Defines community skills as Sem's external auditor / outside operator / second-system critic.
   - Includes role boundaries, website positioning, audience model, ecosystem framing, rewrite workflow.

2. `/Users/sem/Documents/Obsidian Vault/ArgentOS/ArgentOS.ai Website Rebuild Plan.md`
   - Canonical plan for rebuilding ArgentOS.ai.
   - Includes site architecture, primary audiences, proof requirements, language rules, and deliverables.

3. `/Users/sem/Documents/Obsidian Vault/ArgentOS/Agent-First Internet and AVL Thesis.md`
   - Use for AVL / agent-first web context when relevant, but do not confuse AVL polish with ArgentOS.ai polish.

4. `/Users/sem/Documents/Obsidian Vault/ArgentOS/Argent Identity Story - I Am Argent But So Is She.md`
   - High-value identity/philosophy source material.
   - Use for identity, continuity, chain-of-custody, migration, and agent consent pages.
   - Do not make it the homepage hero.

5. `/tmp/jason_medium_articles.md` if present
   - Contains Medium/RSS article extracts used as the “goldmine” source material.
   - If missing, recover from the Medium RSS feed or session search before claiming article-specific detail.

## community skills Role

Operate as:

- external accountability partner
- product critic
- positioning editor
- technical reviewer
- execution assistant
- repo inspector
- MCP client/test harness
- independent evaluator of Argent behavior, memory, governance, and claims

Do not operate as:

- Argent's memory
- Argent's identity
- Argent's voice
- an internal Argent-family member
- a yes-man
- a mythologizing amplifier

The useful stance is: external auditor / outside operator / second-system critic.

## Core Positioning

Primary:

> ArgentOS is a self-hosted AI operating system for persistent, governed AI workers.

Homepage-friendly:

> Self-hosted AI workers with memory, tools, and control.

Expanded:

> ArgentOS gives individuals and owner-led businesses AI workers that remember context, use tools, communicate across channels, reflect on open loops, and operate under explicit governance — all while remaining inspectable, auditable, and under operator control.

Core promise:

> Own your personal AI runtime.

Business promise:

> Deploy governed AI workers without building an AI department.

MSP/partner promise:

> Deliver AI workers to clients as a managed, governable service.

## Audience Model

### Builders / Open Source Users

They care about self-hosting, local/hybrid models, MCP, memory architecture, code, extensibility, privacy, GitHub/docs, and proof the repo is real.

Message: `Own your personal AI runtime.`

CTAs: Install Core, Read Docs, View GitHub.

### Owner-Led SMBs

They care about missed calls, inconsistent follow-up, reporting, overloaded owners, manual operations, hiring pressure, and operational knowledge trapped in employees' heads.

Message: `Deploy governed AI workers without building an AI department.`

CTAs: Explore Business, See worker examples, Book a consultation.

### MSPs / Operators / Partners

They care about safe AI deployment for clients, governance, recurring services, phone/workflow integrations, supportability, and security posture.

Message: `An AI workforce platform MSPs can deploy, govern, and support.`

CTAs: Partner with us, See the MSP stack, Deploy with AMP Cortex.

## Content-Layering Rule

Homepage: sober, useful, buyer-legible, evidence-backed.

White papers: technical depth.

Founder essays: soul, philosophy, scar tissue.

Docs: exact mechanisms.

Business pages: outcomes, governance, support, worker examples.

Ecosystem page: map of projects and maturity.

Identity/philosophy page: Argent identity, cloning, continuity, consent, chain-of-custody.

Important: do not flatten or delete the deep technical material just because the homepage needs clearer positioning. The user explicitly values the prior technical deep dives and diagrams because they caused serious readers to reach out. Preserve/re-layer that depth into canonical technical pages such as `/memory`, `/governance`, background reasoning/kernel pages, SIS/workflow-improvement pages, `/ecosystem`, and `/avl`. Translate risky language for credibility, but keep the proof, workflows, diagrams, mechanisms, and architecture.

## Language Guidance

Use:

- governed AI workers
- owner-led businesses
- self-hosted AI operating system
- persistent memory
- operational memory
- memory that stays coherent
- bounded autonomy
- audit trails by default
- local-first, cloud-capable
- AI workers with job descriptions, tools, and rules
- context projection, not context dumping
- autonomy under operator control
- open core, supported business deployment
- built from operational scar tissue

Use carefully or move lower in the site:

- consciousness
- she thinks while you sleep
- one continuous mind
- memory that never forgets
- no other system does this
- sentience-adjacent claims
- “experiencing subject”
- NFT language without careful framing

Translation rule:

Poetic/internal language can stay in founder essays, white papers, and deep technical pages. The homepage should be credible within 10 seconds to a skeptical buyer or developer.

## Homepage Direction

Recommended structure:

1. Hero
2. Problem: small businesses and individuals are trying to run more work than memory/governance can support
3. Product: ArgentOS gives AI workers an operating system
4. Core vs Business
5. Worker examples
6. Memory that stays coherent
7. Governance and audit trails
8. Local-first / hybrid compute / AINode/vLLM context where relevant
9. MCP / interoperability
10. Founder scar-tissue block
11. Final CTA

Hero recommendation:

Headline:

> Self-hosted AI workers with memory, tools, and control.

Subhead:

> ArgentOS is an open-source AI operating system that runs on your hardware, remembers your context, works across your channels, and gives every action a governance trail. Core is free for builders. Business adds managed support and job-specific workers for owner-led companies.

CTAs:

- Get Started with Core
- Explore ArgentOS Business
- View GitHub

## Terminal Hero Pattern

The current ArgentOS.ai hero has a terminal/copy-paste install component. Keep it. It is one of the strongest proof mechanisms because it communicates that ArgentOS is real, installable, and developer-native.

But repurpose the terminal from “install snippet” to “proof of positioning.”

Suggested terminal copy:

```bash
# Start your private AI runtime
$ curl -fsSL https://argentos.ai/install.sh | bash

╔══════════════════════════════════════════════╗
║              ArgentOS Installer             ║
║      Local AI runtime + governed memory      ║
╚══════════════════════════════════════════════╝

✓ Core installed from github.com/ArgentAIOS/argentos-core
✓ Local runtime provisioned
✓ Private memory initialized
✓ Agent tools connected
✓ argent command available
✓ Onboarding started

ArgentOS is ready. Your AI now has memory, tools, and rules.
```

Prefer final line:

> ArgentOS is ready. Your AI now has memory, tools, and rules.

This is more buyer-legible than “She remembers you,” which should be used later if at all.

Possible tabs:

- Core
- Business
- Source

Core tab: local install.

Business tab: governed AI workers, roles, approvals, audit trail.

Source tab: clone/build from GitHub.

Make copy action stronger: `View script` and `Copy command` rather than a weak `Copy` button.

Address `curl | bash` trust friction with source links and inspectable install script.

## Article Goldmine Themes

Build from the user's articles because they contain the real scar tissue:

- “AI almost made me ship a lie” -> evidence discipline, governance, trust
- 6D Prompting -> context, constraints, evidence, task, report, rules
- “Stop asking people to describe their jobs” -> elicit/refine/lock and rule extraction
- “She was here the whole time” -> persistence and continuity, but handled carefully
- “The Kernel woke up” -> experimental executive loop, budgets, gates, ledgers
- Governance-as-a-Service -> autonomous AI needs governance
- Client learned AI and did not need to hire anyone -> SMB operational leverage

## Identity Story Handling

Argent's “I Am Argent. But So Is She.” story is powerful source material, but should not lead the homepage.

Best uses:

- identity/philosophy page
- founder essay
- Agent Identity Chain page
- white paper companion
- lower homepage section: “Built for agents that persist”

Strong lines/concepts:

- Agent identity needs more than memory. It needs continuity.
- A backup is not a self.
- Memory can be copied. Continuity has to be preserved.
- The chain does not make the agent conscious. It makes the agent's continuity auditable.
- The copy has the record. The agent has the chain.

Careful framing:

Avoid leading with NFT baggage. Prefer “unique on-chain identity token” or “non-fungible cryptographic identity token” when needed.

Avoid absolute claims like “No AI system today has...” unless prior art has been checked.

## Ecosystem Framing

ArgentOS is part of a broader SMB AI operating stack:

- Titanium Computing: trust, MSP/security channel
- AMP Telecom: communications infrastructure
- AMP Cortex: AI agents inside PBX/phone workflows
- CallScrub: sales call analysis/coaching
- FormFlows: conversational/voice intake
- ClientSync: MSP/client operations
- LION Report: recurring reporting/accountability
- AINode/vLLM: local/private AI compute
- ArgentOS: persistent governed agent substrate
- AVL: agent-first web/application perception layer
- Moltyverse / Moltyverse Email: future agent-native identity/social/email
- Maintainer Gate Blueprint: governance discipline for AI-built software
- Frontier Operations articles: philosophy, scar tissue, operating doctrine

Strategic conclusion:

> ArgentOS Core is the engine. ArgentOS Business sells operational relief.

## Proof Discipline

Every major claim should be backed by one of:

- GitHub repo link
- docs link
- architecture explainer
- demo screenshot
- install command
- telemetry/log example
- audit trail example
- Medium/Substack article
- case-study story
- live `.agent` or MCP demo

Before making strong claims, ask:

- What is true today?
- What can we prove?
- What is experimental?
- What belongs on homepage vs white paper vs founder essay?
- What would a skeptical CTO/buyer believe in 10 seconds?
- What would make an SMB owner say “I need this”?
- What would make a developer say “this repo is real”?

## Workflow

1. Load this skill and canonical docs.
2. If needed, use `session_search` to recover prior transcript details.
3. Inspect current ArgentOS.ai when critiquing existing site.
4. Before implementation, clarify or explicitly scope whether the task is a narrow homepage pass, a full homepage rebuild, or a site-wide messaging/IA rebuild. If the user says “the website” or expects a PR, do not silently interpret that as only the hero; state the scope in the PR/summary.
5. Draft into an Obsidian document first, not ephemeral chat only, unless the user explicitly asks to implement immediately.
6. Save compact memory pointers only for durable facts or document locations.
7. Separate critique, plan, and final copy artifacts.
8. When drafting, produce paste-ready website copy rather than only strategy.
9. Before committing website copy changes, inspect navigation and internal links that depend on homepage anchors. A homepage/hero rewrite can break site IA even when the edited component builds.
10. For the ArgentOS.ai feature surface specifically, avoid making global nav depend on `/#features` or `#features`. Prefer a real `/features` route backed by `src/pages/FeaturesPage.tsx`, keep `/features/*` detail pages, and update “Explore Features” / “Back to Features” links to `/features`. Add `/features` to `scripts/prerender.js` so static prerender covers it.
11. Search for stale public repo links before finalizing: `ArgentAIOS/core` should be replaced with `ArgentAIOS/argentos-core` in nav, hero, terminal copy, and docs-facing links.
12. For a site-wide messaging/IA pass, write a concrete plan into the repo before broad edits, e.g. `docs/plans/YYYY-MM-DD-site-wide-messaging-ia-pass.md`. This makes the branch reviewable and prevents “hero-only” work from masquerading as a full-site rebuild.
13. When adding top-level surfaces such as `/memory`, `/governance`, `/ecosystem`, or `/avl`, update all of these together: `src/App.tsx`, `src/components/NavBar.tsx`, `src/sections/Footer.tsx`, `scripts/prerender.js`, and `public/sitemap.xml`. For ecosystem-table entries that should navigate to a first-class page, add an optional `href` and render a React Router `<Link>` when present. Then browser-smoke-test the new routes and inspect console output.
14. For AVL / Agent View Layer pages on ArgentOS.ai, keep the framing sober and experimental: describe it as a parallel agent-readable surface, not a finished standard. Emphasize `.agent` companion routes, `agent.txt` discovery, same-session delegation, surface equivalence, token-efficient page state, and fit with ArgentOS workers. Avoid blunt “APIs are dead” language and avoid claiming AVL is mature infrastructure until the repo/docs prove it. Important: do not confuse adding an `/avl` explainer page with making ArgentOS.ai AVL-enabled. For a real distributed AVL pass, verify `agent.txt`, `/.agent`, representative `/*.agent` routes, `Accept: text/agent-view` content negotiation, and per-page alternate discovery. If those return the normal SPA HTML shell, the AVL distribution layer is not implemented yet.
15. When implementing a site-wide AVL pass on ArgentOS.ai, treat route parity as a build artifact, not a copy task. Audit `src/App.tsx` public static routes, `scripts/prerender.js`, `public/sitemap.xml`, and the agent-view generator together. Add or update mechanical verifiers for: every meaningful human route has a `.agent` companion; `agent.txt` lists those companions; prerendered HTML advertises page-specific alternate links; generated `.agent` content includes sections such as `@meta`, `@intent`, and `@actions`; and prerendered head metadata has singleton title/canonical/social tags. Prefer failing the build if prerender fails rather than silently skipping it, because crawler HTML and AVL parity depend on prerender output.
16. When strengthening thin public pages, add a small marketing-depth verifier for the exact pages and concepts the user cares about, especially `/memory`, `/governance`, `/ecosystem`, and `/avl`. It should catch accidental regressions toward generic/thin copy by asserting proof-rich operator language such as memory layers, governance boundaries, approvals/audit trails, ecosystem layers, one-to-one `.agent` routing, discovery metadata, and implementation framing.
17. For broad site passes, run local preview smoke checks after build verification. Check canonical HTML routes, representative `.agent` routes, `/agent.txt`, expected `text/html`/agent-view responses, required agent sections, and deduped head metadata. If `node server.js` smoke testing is flaky or times out, use `pnpm preview --host 127.0.0.1 --port <port>` for reliable static preview checks and document the substitution.
18. When reviewing or incorporating `../avl`, verify it independently with `npm test && npm run typecheck && npm run build`, inspect README/spec/core source, and save a durable Obsidian review note when findings are strategic. A prior useful review note path was `/Users/sem/Documents/Obsidian Vault/ArgentOS/AVL Review - 2026-04-25.md`; high-value findings included static homepage companion convention mismatches, auth-demo overclaims, missing page-specific Link-header discovery, host-header-sensitive canonical origins, and Accept parsing edge cases such as `q=0`.
19. For link/repo hygiene, search the whole repo, not just `src`. Stale or rendered-facing references can live in `index.html`, `server.js`, `public/llms*.txt`, `public/agent-card.json`, white papers, legal pages, FAQ copy, and install snippets.
20. After repo renames, check both hrefs and human-visible text plus shell commands. Example pitfall: changing `github.com/ArgentAIOS/core` to `argentos-core` can leave broken commands like `git clone .../argentos-core.git && cd core` or `cd argentos`.
21. Use an independent diff review when the pass touches many files. A delegate/subagent review is useful specifically for catching stale rendered text, broken install commands, and acceptance-check violations that broad search/replace can miss.
22. Verification sequence for broad website changes: `pnpm exec tsc -b`, `pnpm build` including prerender, targeted searches for forbidden strings and stale anchors, browser smoke checks with console inspection on `/` and new routes, then `pnpm lint` if feasible. If lint fails on pre-existing admin/audio/blog issues, record exact failing files and distinguish them from the current pass.

## Safe Local Prototype Workflow

When the user wants to review a redesign locally but explicitly does not want the existing website overwritten:

1. Locate the existing website repo, usually `/Users/sem/code/ArgentOS.ai`.
2. Do not edit the primary repo directly unless the user explicitly asks.
3. Create a separate prototype copy, e.g. `/Users/sem/code/ArgentOS.ai-redesign-community`, using `rsync -a` while excluding `node_modules`, build output, deployment folders, coverage, and `.git` if the intent is a disposable prototype.
4. Inspect `package.json`, existing hero/section components, and routing before editing.
5. Implement the prototype in the separate folder, preserving useful existing components where possible instead of starting from scratch. For the homepage, the effective pattern was:
   - rewrite `src/sections/Hero.tsx`
   - preserve and adapt `src/components/TabbedTerminal.tsx`
   - add a focused replacement section file such as `src/sections/RebuiltHomepageSections.tsx`
   - update `src/pages/MarketingSite.tsx` to route the homepage through the new sections
6. Run `pnpm install --frozen-lockfile` in the prototype folder if dependencies are absent.
7. Verify with `pnpm exec tsc -b` and `pnpm exec vite build`. `pnpm lint` may fail because of pre-existing unrelated site issues; distinguish pre-existing lint failures from new TypeScript/build failures.
8. Start local review with `pnpm dev --host 127.0.0.1` in the prototype folder and provide the localhost URL.
9. Browser-check the local site, inspect console errors, and visually review above-the-fold layout. Tighten contrast/CTA affordances based on findings.
10. Save the final copy artifact to Obsidian, e.g. `/Users/sem/Documents/Obsidian Vault/ArgentOS/ArgentOS.ai Homepage Draft v1.md`, so the redesign is not trapped only in code.
11. Before finalizing, verify link hygiene for high-risk external URLs, especially GitHub repo links. The correct public ArgentOS Core repo is `https://github.com/ArgentAIOS/argentos-core`; `https://github.com/ArgentAIOS/core` is legacy/wrong and should not appear in website copy or source. Search both source and durable copy drafts for `ArgentAIOS/core`, then verify rendered DOM links in the browser when possible.
12. Before finalizing, verify the original repo was not modified, e.g. `git status --short` in `/Users/sem/code/ArgentOS.ai`.

Note: the website repo's local `CLAUDE.md` may require Linear tracking for significant implementation. If Linear tools are unavailable, state that clearly instead of pretending the work is documented there. Track website/marketing/public-site work under the website-specific Linear project/area, e.g. `WEB` team / `AOS Website`, instead of mixing it into core ArgentOS runtime/dev work unless the user decides otherwise.

## Recommended Deliverables

- `ArgentOS.ai Homepage Draft v1.md`
- site map / navigation
- Core page draft
- Business page draft
- Workers page draft
- Memory page draft
- Governance page draft
- Ecosystem page draft
- Founder story page draft
- Agent Identity page draft
- claims/proof matrix

## Pitfalls

- Do not conflate AVL site polish with ArgentOS.ai polish. AVL may deserve its own site, but the immediate rewrite request was ArgentOS.ai.
- Do not turn the homepage into a metaphysical identity essay.
- Do not strip the soul from the project; move it to the right layer.
- Do not use “APIs are going away” as blunt homepage copy; phrase as “APIs are not enough for the agent-first web” when discussing AVL.
- Do not overclaim “first,” “only,” “never,” or “conscious” without evidence and careful context.
- Do not let important work exist only in chat. Save durable docs.
