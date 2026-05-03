# Rust Spine Sprint, May 2-3 2026

This folder is the human view of the current push to move ArgentOS spine services toward Rust.

Use this first:

- [[Current Status]]
- [[Timeline]]
- [[Lane Status]]
- [[Open Blockers]]
- [[Bus Summary]]

## The goal

Move the core spine into a small Rust runtime that is:

- harder to wedge
- restart-safe
- easier to audit
- fail-closed by default
- safe to test locally before any live authority switch

## What Rust spine means here

Rust is being prepared to own or guard the important always-on parts of ArgentOS:

- Gateway control surfaces
- audit receipts
- scheduler and wakeup leases
- workflow and run boundaries
- connector execution gates
- the always-on consciousness kernel

## Current rule

Node is still live authority.

Rust is still shadow-only.

No production traffic, connector execution, customer data, or authority switch is allowed until promotion gates pass.
