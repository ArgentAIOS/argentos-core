---
summary: "ArgentOS Core versus Business boundary and licensing overlay model"
read_when:
  - Working on public Core packaging
  - Moving features between Core and Business
  - Adding license-gated Business behavior
title: "Core and Business Boundary"
---

# Core and Business boundary

Last updated: 2026-04-24

## Product rule

Every user installs **Core** first. Core must be useful without a license key and
must not hide personal-agent capabilities behind Business gates.

Business is a licensed overlay on top of Core. A Business customer activates a
license key, Core validates it with the licensing server, and then the Business
overlay enables worker-agent governance features.

## Core includes

- Main agent and family agents.
- Personal chat, model routing, provider profiles, local fallback behavior, and
  configured-provider selection.
- Memory, MemU, Memory v3 health, user-owned vaults, and vault import paths.
- Operations, live logs, system settings, database/gateway diagnostics, and
  other local operator controls.
- Marketplace discovery and install flows for skills, plugins, and connectors.
- Personal skills creation, skill listing, and skill execution.
- Connectors and AOS command-line utilities that are public, small, and safe to
  ship to all users.
- Consciousness kernel controls, including shadowed Rust kernel/gateway surfaces
  when they are public-safe.
- Audio/TTS, image attachment handling, screenshots, and other personal-agent
  runtime capabilities.
- Install, update, doctor, migration, and public release rails.

## Business includes

- Worker agents as a distinct class from the main agent and family agents.
- Workforce/job orchestration, job boards, assignments, and worker execution
  lanes.
- Governance through the worker-agent system, including intent hierarchy,
  approvals, promotion gates, and executive review.
- Observer/training periods where workers can run through turns without live
  authority.
- Worker onboarding and organization-scoped worker configuration.
- Private registry/package distribution, organization entitlements, and
  Business-only license sync behavior.

## Licensing flow

1. Install Core from the public installer.
2. Enter a Business license key.
3. Core calls the licensing server and receives entitlements.
4. If entitled, Core downloads/enables the Business overlay.
5. `argent update` updates Core for everyone and updates the Business overlay
   only when the local install has active Business entitlements.

No Core feature should display "not available in public Core" unless that
feature is truly Business-only under this document.

## Engineering guardrails

- Public Core must not import Business-only modules on the startup path.
- Business may depend on Core extension points; Core must not depend on
  Business internals.
- Removing a dashboard route from Core requires checking this boundary first.
- If a feature is personal-agent, family-agent, marketplace, memory, vault,
  operations, diagnostics, provider, install, or update related, assume it is
  Core unless this document says otherwise.
- License checks should enable Business behavior; they should not disable Core
  behavior.
