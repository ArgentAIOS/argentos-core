---
name: community-skills-first-web-avl-review
description: "Review, position, and polish Agent View Layer (AVL) / agent-first
  web projects: .agent pages, agent.txt manifests, AI-native rendering, MCP/API
  positioning, and marketing/category narrative."
version: 1.0.0
author: Community Skills
license: MIT
tags:
  - agent-first-web
  - avl
  - ai-agents
  - product-positioning
  - web-standards
  - mcp
  - marketing
triggers:
  - review AVL
  - agent-first website
  - AI-first website
  - .agent endpoint
  - agent.txt manifest
  - agents as first-class internet citizens
  - APIs are going away
  - MCP is the hands AVL is the eyes
metadata:
  upstream_import:
    original_name: agent-first-web-avl-review
    source: community catalog active profile ~/.argent/skills
---

# Agent-First Web / AVL Review

Use this skill when reviewing or polishing projects that claim to make websites/applications agent-native, especially `frontier-infra/avl`, `.agent` endpoints, `agent.txt`, MCP-adjacent tools, AI-first websites, and agent commerce surfaces.

## Core Thesis to Preserve

The user’s thesis:

- AI agents are first-class internet citizens.
- Agent traffic and business commerce may exceed human web usage.
- The internet is still primarily built for humans: HTML/CSS/JS, screens, DOM, mice, forms, pixels.
- Browser-use agents are impressive but fragile because they reverse-engineer human interfaces.
- New applications should become agent-first / AI-first, analogous to mobile-first design.
- APIs are necessary now, but many user-facing machine workflows may move toward agent-native web surfaces rather than bespoke API integrations.

Preferred framing nuance:

Do not bluntly claim “APIs will disappear” in public-facing copy unless the user specifically wants the provocative version. A more defensible framing is:

- APIs are not enough for the agent-first web.
- APIs expose functions; AVL exposes what matters on the current page.
- OpenAPI describes your backend; AVL describes the user’s current surface.
- APIs remain infrastructure, but they may stop being the primary user-facing machine interface for many workflows.

## AVL Category Framing

AVL = Agent View Layer.

Best category phrase:

Agent-native rendering.

Avoid reducing AVL to “metadata for AI.” Metadata sounds optional, SEO-ish, and decorative. “Rendering target” sounds infrastructural.

Core analogy:

- HTML is for humans.
- AVL is for agents.
- Like i18n, but the target locale is `agent`.
- Like mobile-first, but for AI agents.

Strong one-liners:

- Make every web page agent-readable.
- The web was built for people. AVL makes it legible to agents.
- Stop making agents scrape meaning from pixels.
- Your app already knows what each page means. AVL ships that meaning directly.
- Every page your app serves to humans gets a parallel agent view.
- The page already knows what it means. We just don’t ship that knowledge.

## Conceptual Distinctions

Use these distinctions when explaining AVL:

- Scraping: consumer-side recovery of meaning from pixels/DOM.
- AVL: producer-side rendering of meaning for agents.
- APIs/OpenAPI: backend function/catalog surfaces.
- AVL: page-level, situated, intent-rich user-surface rendering.
- MCP: tool/action protocol; “hands.”
- AVL: page/application perception and context; “eyes.”
- llms.txt: site-level guidance/discovery.
- AVL: route/page-level state, intent, actions, context, and navigation.

Important line:

MCP is the hands. AVL is the eyes.

## Review Workflow

0. Distinguish AVL copy from AVL implementation.
   - A marketing/explainer page about AVL is not the same as an AVL-enabled site.
   - For sites claiming page-distributed AVL, verify actual surfaces exist before saying the work is correct:
     - `curl -i https://site/agent.txt`
     - `curl -i https://site/.agent`
     - `curl -i -H "Accept: text/agent-view" https://site/`
     - `curl -i https://site/some-route.agent`
   - Expected implementation evidence:
     - real `agent.txt` manifest, not SPA HTML fallback
     - `.agent` companion routes for meaningful human pages
     - `Content-Type: text/agent-view; charset=utf-8; version=1` or equivalent
     - content negotiation for `Accept: text/agent-view`
     - per-page alternate discovery via HTTP `Link` header and/or HTML `<link rel="alternate" type="text/agent-view" href="...">`
     - page-specific AVL content using `@meta`, `@intent`, `@state`, `@actions`, `@context`, `@nav`
   - If `.agent`, `agent.txt`, or `Accept: text/agent-view` return the normal React/SPA HTML shell, the distributed AVL layer is not implemented even if the public copy describes it accurately.

1. Inspect the repo and docs.
   - Use GitHub API/browser rather than only reading the landing page.
   - Check README, package.json, specs, examples, implementation files, release metadata, license, stars/forks, commit activity, default branch.
   - For `frontier-infra/avl`, key paths have included:
     - `README.md`
     - `package.json`
     - `specs/avl-agent-view-layer.md`
     - `specs/avl-thesis.md`
     - `specs/avl-auth-thesis.md`
     - `lib/avl/types.ts`
     - `lib/avl/serialize.ts`
     - `lib/avl/define.ts`
     - `src/index.ts`
     - `src/next.ts`

2. Verify live agent endpoints if available.
   - Try:
     - `curl -s https://site/.agent`
     - `curl -s -H "Accept: text/agent-view" https://site/`
     - `curl -s https://site/agent.txt`
   - Check `Content-Type`, route, generated timestamp, TTL, auth/session declaration, sections, and action links.

3. Evaluate the AVL document shape.
   - Good AVL documents usually include:
     - `@meta`: version, route, generated timestamp, TTL, auth context
     - `@intent`: purpose, audience, capability
     - `@state`: structured backing data, ideally token-efficient
     - `@actions`: available actions with method/href/input schema
     - `@context`: narrative explanation / meaning
     - `@nav`: self/parents/peers/drilldown
   - Confirm that `.agent` is not merely a scraped summary of HTML but a producer-side rendering of the same application/page state.

4. Evaluate auth and security.
   - The key AVL auth principle:
     - The AI agent is not a new principal. It is a delegate of an existing human session.
   - Look for “same session, same RBAC, different rendering target.”
   - Use/ask for a surface equivalence test:
     - The agent can only see and do what the human principal can see and do.
   - Flag any new shadow permission system or unfiltered sensitive data as a serious risk.

5. Connect to stack positioning.
   - For the user’s ecosystem, the relationship can be framed as:
     - vLLM gives agents local intelligence.
     - AINode gives the stack a private compute base.
     - ArgentOS gives agents memory and governance.
     - MCP gives agents hands.
     - AVL gives agents eyes.
     - AMP Cortex / business apps provide commerce/workflow surfaces.

6. Provide marketing polish.
   - Prefer category-design language over implementation-only language.
   - Show “Human View vs Agent View” visually or structurally.
   - Lead with the problem of reverse-engineering pixels, then introduce producer-side agent rendering.
   - Include proof artifacts: live `.agent` endpoint, `agent.txt`, examples, package install, spec, adopter badge.

## Suggested Landing Page Structure

1. Hero
   - Headline: “Make every web page agent-readable.”
   - Subhead: “AVL gives every human page a parallel view for AI agents — intent, state, actions, context, and navigation without scraping.”
   - CTAs: “Read the Spec”, “Add AVL to Next.js”, “See a Live .agent View”

2. The shift
   - Agents are becoming first-class internet users.
   - The web still renders primarily for humans.
   - Browser-use agents are a bridge, not the destination.

3. Human view vs agent view
   - Show `/products/kettle` next to `/products/kettle.agent`.
   - The side-by-side should sell the concept faster than paragraphs.

4. How it works
   - `.agent` suffix
   - `text/agent-view; version=1`
   - `agent.txt`
   - content negotiation
   - colocated `agent.ts` beside `page.tsx`

5. The six sections
   - `@meta`, `@intent`, `@state`, `@actions`, `@context`, `@nav`

6. Auth and trust
   - Same session, same RBAC, different rendering target.
   - Surface equivalence.
   - Delegate, not principal.

7. AVL vs alternatives
   - Scraping, llms.txt, OpenAPI/GraphQL, Schema.org, ARIA, MCP.
   - Emphasize complementarity, not replacement of everything.

8. Live proof
   - Link/curl a live adopter, e.g. AINode if still available:
     - `https://ainode.dev/.agent`
     - `https://ainode.dev/agent.txt`

9. Developer adoption
   - Install package.
   - Add `.agent` route.
   - Define agent views.
   - Add badge/manifest.

## Output Template

When the user asks for a review, produce:

Short verdict:

- One sentence on whether the concept/repo/site is credible and how to frame it.

What I checked:

- Repo/docs/specs/live endpoints.

What the idea really is:

- Explain agent-native rendering in plain language.

Why it matters:

- Explain the pixel/DOM reverse-engineering waste.

What is strong:

- Category, spec, implementation, auth model, live proof, ecosystem fit.

What to be careful about:

- Overclaiming APIs disappearing, security/auth, sounding like metadata/SEO, lack of demos.

Marketing polish:

- Hero copy, subhead, CTAs, section structure, core phrases.

Next steps:

- Specific site/docs/demo improvements.

## Implementation Hardening Workflow

When implementing AVL on an existing marketing/docs site rather than merely reviewing it:

1. Build route parity from the application route map, not from memory. Compare public human routes, prerender routes, sitemap entries, and generated `.agent` entries.
2. Add a dedicated route-parity verifier that fails if any meaningful public route lacks a page-specific `.agent` companion, if `agent.txt` omits generated companions, or if sitemap/prerender coverage drifts.
3. Verify canonical HTML and agent surfaces separately: canonical URLs must remain `text/html`; `.agent` URLs and `Accept: text/agent-view` should return the agent representation; `agent.txt` must not be an SPA fallback.
4. For prerendered React/SPAs, check head metadata after hydration/prerender. Base `index.html` metadata plus route-level SEO components can leave duplicate title/canonical/OpenGraph/Twitter tags; add singleton head dedupe in prerender and server injection paths, then test it mechanically.
5. Prefer making prerender a required build step once AVL/crawler verification depends on generated HTML. Silent prerender fallbacks can make a build look green while breaking agent discovery and crawler parity.
6. Smoke-test against the same server path production will use, not only a static/Vite preview. Vite preview may serve built assets correctly while failing to exercise Express/Node content negotiation, dotfile `.agent` routing, per-route HTML fallbacks, or `Accept: text/agent-view` handling. Use `pnpm start`/the production app server for final smoke when those behaviors live in the server.
7. Smoke-test with `curl` for `/`, representative human pages, representative `.agent` pages, `/agent.txt`, local AVL/badge assets, expected content types, required agent sections (`@meta`, `@intent`, `@actions`), and page-specific alternate discovery links.
8. If the site also has proof-rich marketing requirements, add a small targeted verifier that asserts important concepts on key pages so future edits do not regress back to thin generic copy.

## Pitfalls

- Do not collapse AVL into “another API.” Its wedge is page-level producer-side rendering.
- Do not collapse AVL into “metadata.” Use “agent-native rendering” or “parallel rendering target.”
- Do not overstate that APIs literally vanish; explain that agent-native surfaces may replace many bespoke user-workflow integrations over time.
- Always inspect live `.agent` / `agent.txt` if claimed.
- Root `/.agent` is a dotfile path; Express/static hosts may ignore or deny it by default. Add an explicit route or enable dotfile serving for that endpoint, and verify it does not fall through to SPA HTML.
- Prerendered SPAs can accidentally stamp root `/.agent` discovery links into every route. Post-process or generate per-route HTML discovery links and page-specific badges, then verify no non-root page still has `href="/.agent"`.
- Non-JS crawlers may read `<noscript>` or SPA fallback HTML instead of hydrated React. If a canonical human URL appears to return “agent-style” plain text, inspect the raw response and fallback/no-JS content before assuming content negotiation is wrong. Canonical URLs should stay `text/html` and styled/crawler-readable; `.agent` and `Accept: text/agent-view` should be the only agent representations.
- Express/static hosting can break crawler parity in two ways: dotfile `.agent` routes may be denied unless explicitly served with dotfiles allowed, and directory redirects such as `/about -> /about/` can bypass route-specific fallback logic. Verify with real `curl -i` headers for canonical routes, `.agent` routes, `agent.txt`, and `Accept: text/agent-view`.
- Static preview servers can produce false negatives or false confidence for agent-first behavior. If `.agent` routes/content negotiation are implemented in the production Node/Express server, final verification must run against that server, not only `vite preview`.
- Self-host AVL badges and discovery assets for production pages. External `raw.githubusercontent.com` dependencies are brittle at runtime and are easy review flags; copy them under public assets and smoke-test the local URL.
- Discovery-link injection/removal regexes must be attribute-order tolerant. HTML can render `<link rel="alternate" type="text/agent-view" ...>` or with attributes reordered; verifiers and dedupers should detect semantics, not exact string order.
- Extract shared path/endpoint helpers for verifiers. Duplicated root/non-root `.agent` path logic drifts quickly across `verify-agent-views`, route parity, crawler HTML, prerender, and server checks.
- Add regression scripts for agent-first sites that assert canonical pages are substantive HTML, not empty SPA shells; required pages advertise page-specific alternate agent views; `agent.txt` is not SPA HTML; and forbidden stale terms/URLs are absent from prerendered output.
- Treat auth as central, not an implementation footnote.
- Keep the mobile-first analogy, but do not let it obscure the concrete product benefit.
