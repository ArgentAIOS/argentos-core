---
title: Rust shadow runtime
description: Experimental read-only Rust gateway and executive substrate running beside the TypeScript gateway.
---

The Rust shadow runtime is an experimental Core lane for observing the Rust gateway and executive substrate without replacing the TypeScript gateway.

It is not a production cutover path. Shadow services do not own live chat traffic, model routing, tools, channel delivery, or operator-visible state. They run beside the normal gateway so Core developers can compare health, protocol shape, scheduler behavior, journal durability, and restart recovery while normal ArgentOS behavior stays on TypeScript.

## Services

Core currently exposes two Rust shadow services in the dashboard Gateway services panel:

- `Rust Gateway Shadow` starts `rust/argentd` on `127.0.0.1:18799`
- `Rust Executive Shadow` starts `rust/argent-execd` on `127.0.0.1:18809`

Both services are disabled until an operator starts them. Starting one from the dashboard builds the matching Rust package if the debug binary is missing, writes a LaunchAgent plist under `~/Library/LaunchAgents`, and runs the service as a local user LaunchAgent.

## Status

`argent status` includes two read-only lines for the executive shadow:

- `Executive shadow` reports reachability, active lane, pending lane count, ticks, boots, and journal count.
- `Exec inspect` compares the Rust executive active lane with the TypeScript consciousness kernel when both are available.

## Direct checks

```bash
curl http://127.0.0.1:18799/health
curl http://127.0.0.1:18809/health
curl http://127.0.0.1:18809/v1/executive/state
curl "http://127.0.0.1:18809/v1/executive/metrics"
```

## Promotion rule

Rust can only move beyond shadow mode after it has run for days without changing operator-visible behavior. Promotion requires parity evidence, restart recovery evidence, protocol drift checks, and an explicit release decision. Until then, TypeScript remains the live gateway and kernel authority.
