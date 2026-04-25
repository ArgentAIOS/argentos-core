# argentd

`argentd` is the first Rust scaffold for the ArgentOS runtime spine.

Current scope:

- shadow-only daemon
- default bind: `127.0.0.1:18799`
- exposes a minimal HTTP `GET /health`
- exposes a temporary HTTP `POST /v1/connect` payload-parity seam
- returns typed JSON health metadata and `req/connect`-shaped handshake responses

Non-goals in this first scaffold:

- no cutover from the TypeScript gateway
- no websocket transport parity yet
- no session/event/process ownership yet
- no claim that the HTTP `connect` seam is a real client transport replacement

The purpose of this crate is to establish:

- a stable Rust workspace in the repo
- an executable daemon target
- a concrete health surface for shadow-mode verification
- a place to encode runtime contracts without touching product behavior
- black-box verification around the first shadow health/connect surfaces

Current verification:

- `cargo check -p argentd`
- `cargo test -p argentd`

Live interop harness:

```bash
pnpm -C /Users/sem/code/argentos exec tsx \
  /Users/sem/code/argentos-rust-gateway-shadow/scripts/interop/compare-live-ts-gateway.ts
```

Notes:

- compares the running local TypeScript gateway against a fresh Rust shadow instance
- uses the local gateway token from `~/.argentos/argent.json`
- writes a normalized report to:
  - `/Users/sem/code/argentos-rust-gateway-shadow/.omx/state/rust-gateway-shadow/live-interop-report.json`

Next seam:

- keep the current HTTP shadow seam honest
- add the first real WebSocket post-connect parity surface:
  - `req { method:"health" }`
  - `res { ok:true, payload:<HealthSummary> }`
