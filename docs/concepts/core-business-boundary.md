---
summary: "ArgentOS is one open-source codebase — the historical Core/Business overlay split and its 2026-06-10 merge-back"
read_when:
  - Wondering why licensing/workforce/intent code lives in this repo
  - Considering re-introducing a public/private code split
  - Working on license-related behavior
title: "Core and Business Boundary (historical)"
---

# Core and Business boundary

Last updated: 2026-06-10

## Current rule: one repo, one source of truth

As of **2026-06-10** there is no Core/Business code boundary. The former
ArgentOS-Business overlay — licensing client, workforce jobs runtime, execution
worker, job orchestrator, intent simulation + runtime gates, copilot control
plane, business agent tools, and the workforce dashboard surfaces — lives in
this repository as ordinary first-class code. The repository is public/open
source. Revenue comes from deploying and operating ArgentOS for clients
(Titanium services), not from license-gating features.

What remains true:

- **The license server is external.** `src/licensing/` is the client side
  (validation, offline grace, org secret sync). Key issuance/revocation lives
  in the marketplace service, not here.
- **License checks are strictly non-blocking.** Gateway startup validates a
  license if `~/.argentos/license.json` exists and logs the result; it never
  blocks boot and no feature hard-gates on license state at runtime.
- **Workforce persistence is PostgreSQL-canonical.** SQLite installs stay
  fully functional with workforce features inert (the runner self-disables;
  the gateway guard refuses non-PG workforce writes in production unless
  `ARGENT_ALLOW_NON_PG_WORKFORCE=1`).

## Historical context (pre-2026-06-10)

From 2026-03 to 2026-06 the plan of record was a licensed "Business overlay":
business code was extracted to a private `ArgentOS-Business` repo
(2026-05-05), Core shipped `*-core.ts` stubs and `loadOptionalExport` seams,
and a private-registry distribution slice was drafted
(`ops/BUSINESS_GAP_AND_LAYERING_PLAN.md` in the Business repo).

That architecture was retired for three reasons:

1. **The optional-loader seams never worked in shipped builds.** Production
   and dev both run the tsdown bundle, whose flat chunk layout made every
   relative `createRequire` specifier resolve to nothing — the gated features
   were silently absent even when "installed" (verified 2026-06-10 against
   Legacy's dist).
2. **The split stalled the product.** The overlay repo couldn't compile in
   isolation for a month while core's copies drifted.
3. **The commercial model changed.** Clients pay Titanium to install and run
   ArgentOS; nobody was buying self-hosted licenses. Open source widens the
   funnel for the services business.

The extraction-era repos (`ArgentOS-Business`, `ArgentOS-Legacy`) are retained
read-only for history. The merge-back landing map is
`ops/BUSINESS_MERGE_LANDING_MAP_2026-06-10.md`.
