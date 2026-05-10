# License-Gated Distribution

**Date:** 2026-05-10
**Status:** DRAFT — pending Jason's answers to the open questions before promotion to plan-of-record
**Source of truth:** `/Users/sem/code/ArgentOS-Business/ops/LICENSE_GATED_DISTRIBUTION_SLICE.md` (this is a vault mirror; both files are kept in sync)
**Parent plan:** [[Business Gap and Layering Plan]] — read §3 (licensing infra current state), §4.3 (build/distribute), §4.6 (S-1..S-7 slice list) before this. Original lives at `/Users/sem/code/ArgentOS-Business/ops/BUSINESS_GAP_AND_LAYERING_PLAN.md`.

---

## 1. Purpose

Deliver the mechanism that lets a paying customer's **active** license key — already issued and bound to their hardware by the marketplace license server — be exchanged for a download of `@argentos/business-overlay`, with periodic re-verification that the license is still active. The goal is one path: **install once, get updates while license is active, lose access when revoked/expired.** Today the licensing primitives exist (the marketplace server has `license_keys`, `license_activations`, hardware-fingerprint binding, `max_activations` enforcement, and an activation router); the customer-facing argent CLI knows how to read `~/.argentos/license.json`. **What's missing is the bridge** — an overlay-download endpoint, a CLI subcommand, a heartbeat with kill-switch, and a publish pipeline. This slice closes the loop.

---

## 2. Existing infrastructure inventory (do not redo)

### 2.1 Marketplace license server — `/Users/sem/code/argent-marketplace`

| Surface                     | Path                                                   | What it does                                                                                                                                                                                            |
| --------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `licenses` table            | `src/db/schema.ts:52-64`                               | `id, key (UNIQUE), package_id, type, buyer_instance_id, org_id, activations, max_activations, expires_at, status ∈ {active,expired,revoked}, created_at`                                                |
| `license_activations` table | `src/db/schema.ts:67-75`                               | `id, license_id, instance_id, hardware_fingerprint, activated_at, last_verified_at`, with `UNIQUE(license_id, instance_id)`                                                                             |
| Activation router           | `src/routes/activate.ts:39-185`                        | `POST /api/v1/activate` — validates format → checks revocation → checks expiry → re-activates same instance OR same hardware (reinstall slot) OR creates new activation under `max_activations` ceiling |
| Status router               | `src/routes/activate.ts:189-236`                       | `GET /api/v1/license/:key` — returns effective status (computes expired-from-active), counts, activation details                                                                                        |
| Bulk validate               | `src/routes/activate.ts:336-403`                       | `POST /api/v1/license/validate` — accepts up to 100 keys, returns per-key validity for periodic revalidation                                                                                            |
| Test coverage               | `src/tests/license.test.ts`                            | Key-format, activation, re-activation, max-activations enforcement, expiry rejection, revocation rejection, unknown-key rejection, hardware-fingerprint reinstall slot                                  |
| Instance auth               | `src/auth/instance-auth.ts` (wired in `src/app.ts:58`) | Ed25519-signed `POST /api/v1/auth/instance` — already used by Business `client.ts`                                                                                                                      |
| Express app                 | `src/app.ts:72-90`                                     | `createActivateRouter()` mounted at `/api/v1`. CORS allows `X-License-Key` and `X-Org-Api-Key` headers.                                                                                                 |

### 2.2 Argent-core licensing surface

See [[License Onboarding Flow]] (if/when it lands in the vault) and `src/infra/license-core.ts` (current stub).

| Surface                | Path                                         | What it does                                                                                                        |
| ---------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Public-Core stub       | `src/infra/license-core.ts` (41 lines)       | Returns `unavailable_in_core` — placeholder until Business is installed                                             |
| Optional loader        | `src/gateway/server-startup.ts:30-55`        | `loadOptionalExport(..., "../infra/license.js", "validateLicenseOnStartup")` — gracefully no-ops if Business absent |
| `loadOptionalExport`   | `src/utils/optional-module.ts` (61 lines)    | The graceful-load mechanism                                                                                         |
| License key reader     | `src/agents/tools/marketplace-tool.ts:45-60` | `readLicenseKey()` — reads `~/.argentos/argent.json` then falls back to `~/.argentos/license.json`                  |
| Dashboard endpoints    | `dashboard/api-server.cjs:17688-17970`       | six license endpoints. Writes plaintext `~/.argentos/license.json` today.                                           |
| Active license on disk | `~/.argentos/license.json`                   | Canonical key file.                                                                                                 |

### 2.3 ArgentOS-Business licensing extraction — `src/licensing/`

| File             | Lines | Role                                                                                                            |
| ---------------- | ----: | --------------------------------------------------------------------------------------------------------------- |
| `client.ts`      |   219 | HTTPS client → `/validate`, `/activate`, `/deactivate`, `/auth/instance`. Offline-grace helpers.                |
| `manager.ts`     |   283 | High-level façade — `activate / validate / deactivate / checkAccess / syncSecrets`.                             |
| `storage.ts`     |   111 | Encrypts `StoredLicense` into `config.license`                                                                  |
| `crypto.ts`      |    89 | AES-256-GCM. `getMachineId()` mixes hostname + NIC MAC.                                                         |
| `secret-sync.ts` |   113 | Pulls org-shared secrets from `${apiUrl}/enterprise/secrets/sync`.                                              |
| `license.ts`     |   105 | Gateway-startup path — reads `~/.argentos/license.json`, GETs `${MARKETPLACE_URL}/api/v1/license/check/${key}`. |
| `types.ts`       |    80 | DTOs. Defaults `offlineGracePeriodHours: 72`, `validationIntervalHours: 24`.                                    |

**Summary of what's already paid for:** key generation + format validation + activation under max-activations + hardware-fingerprint reinstall slot + revocation flag + expiry handling + Ed25519 instance auth + AES-GCM client-side crypto + 72h offline grace + a status read endpoint + a bulk validate endpoint. The license server is feature-complete for the validation/lifecycle side. **All the work below is plumbing, not new licensing primitives.**

---

## 3. What's missing (the actual gap)

1. **No overlay download endpoint.** Marketplace can activate a key but cannot serve a tarball of `@argentos/business-overlay`.
2. **No `argent license install business` CLI subcommand.** No one-liner that fingerprints + downloads + extracts + restarts.
3. **No heartbeat / revocation kill switch.** `LicenseManager.checkAccess()` exists but has zero callers (see [[Business Gap and Layering Plan]] §3.5).
4. **No build / publish pipeline.** `package.json` has no build script, no tarball generation, no signing.
5. **No fingerprint computation in argent-core.** Today it lives in Business — chicken-and-egg: you need it _before_ downloading Business.
6. **No overlay-entitlement runtime store in Core.** [[Business Gap and Layering Plan]] §4.2 specifies `OverlayEntitlementStatus.state ∈ none/active/grace/expired/revoked/invalid/disabled/error` but the store doesn't exist.

---

## 4. Design

### 4.1 Mechanism overview

```
Customer machine                                  Marketplace server
─────────────────                                  ──────────────────
~/.argentos/license.json (key)                     /api/v1/license/* routes
  │                                                  │
  ▼                                                  │
argent license install business                      │
  │                                                  │
  │  1. compute hardware fingerprint                 │
  │  2. POST /api/v1/overlays/business/install ────▶│  validate chain:
  │     headers:                                    │     active → not expired
  │       Authorization: Bearer <license-key>       │     → not revoked
  │       X-Hardware-Fingerprint: <fp>              │     → fingerprint matches
  │       X-Instance-Id: <instance-id>              │       OR new activation
  │                                                  │       under max_activations
  │  3. receive signed download URL (or stream)   ◀──
  │  4. fetch tarball + verify signature             │
  │  5. extract to ~/.argentos/overlays/business/    │
  │  6. write instance_id + version to argent.json   │
  │  7. restart gateway                              │
                                                     │
[every 24h + on startup]                             │
argent gateway → heartbeat                           │
  │                                                  │
  │  POST /api/v1/license/verify ─────────────────▶ │  returns:
  │    {key, hardwareFingerprint, instanceId}       │    {status, expires_at,
  │  ◀──────────────────────────────────────────────     revocation_reason?}
  │
  │  if status ∈ {revoked, expired-and-grace-burned}:
  │     unload overlay handlers
  │     persist OverlayEntitlementStatus
  │     dashboard chip → "license inactive"
```

### 4.2 Marketplace endpoint: install

`POST /api/v1/overlays/business/install`

Auth: Bearer license key + `X-Hardware-Fingerprint` + `X-Instance-Id`.

Validation chain (extends the activation chain at `src/routes/activate.ts:60-76`):

1. License exists; else `404 not_found`.
2. `status === "active"`; else `403 {revoked | invalid | pending}`.
3. `expires_at == null || expires_at > now`; else `403 expired`.
4. Hardware-fingerprint match:
   - `(license_id, hardware_fingerprint)` exists → reuse that slot.
   - else `(license_id, instance_id)` exists → reuse that slot (instance reinstall, fingerprint changed — possibly OS upgrade).
   - else → new activation; check `activations < max_activations`.
5. Insert/update activation; bump `last_verified_at`.

Response:

```json
{
  "downloadUrl": "https://marketplace.argentos.ai/overlays/business/<version>/tarball?sig=...&exp=...",
  "version": "0.1.0",
  "size": 1234567,
  "sha256": "<hex>",
  "signature": "<ed25519-over-sha256>",
  "expiresAt": "2027-05-10T00:00:00Z",
  "heartbeatIntervalHours": 24
}
```

`downloadUrl` is a 1h TTL signed URL. Initial implementation streams from server-local `overlays/<name>/<version>.tgz`; follow-up swaps to pre-signed S3/R2 (see open question 1 below).

### 4.3 Marketplace endpoint: heartbeat verify

`POST /api/v1/license/verify`

Body: `{key, hardwareFingerprint, instanceId, installedVersion}`.

Response:

```json
{
  "status": "active",
  "expiresAt": "2027-05-10T00:00:00Z",
  "revocationReason": null,
  "latestVersion": "0.1.0",
  "serverTime": "2026-05-10T12:00:00Z",
  "nextHeartbeatAfter": "2026-05-11T12:00:00Z"
}
```

Idempotent and read-only on `license_activations` — does NOT count against `max_activations`. May bump `last_verified_at` for observability.

### 4.4 Tarball delivery options

| Option                                | Pros                         | Cons                                                                   |
| ------------------------------------- | ---------------------------- | ---------------------------------------------------------------------- |
| **A. Marketplace-streamed (initial)** | Zero new infra. One PR.      | Bandwidth on marketplace host. Doesn't scale or CDN.                   |
| **B. Pre-signed S3 / R2**             | Cheap at scale. Edge-cached. | Adds S3/R2 secret. Old-version cost growth (lifecycle rule mitigates). |

**Recommendation:** A for first launch. Migrate to B around 50+ installs. The `downloadUrl` contract is the same; only the backing store changes.

### 4.5 Kill switch — client behavior

On heartbeat response with `status ∈ {revoked, expired}`:

1. Persist `OverlayEntitlementStatus = {state, reason, observedAt}` to Core's overlay-registry primitive (also needed for [[Business Gap and Layering Plan]] slice S-4).
2. Call `unregister(overlayId)` on every Business descriptor.
3. Dashboard reads via new RPC `business.status`, renders "License inactive" chip, swaps panel content for renew CTA.
4. Files on disk NOT deleted (per [[License Onboarding Flow]] policy — data preserved, artifact preserved). Tarball stays at `~/.argentos/overlays/business/`.
5. Next successful active heartbeat re-registers handlers. No restart needed.

**Grace policy:**

- `revoked` → 0h. Hard disable.
- `expired` → 72h offline grace per `types.ts:offlineGracePeriodHours`, then hard disable.
- Network error → offline grace counted from last successful heartbeat (open question 4 below).

### 4.6 Hardware fingerprint formula

Move `getMachineId()` from `ArgentOS-Business/src/licensing/crypto.ts` to argent-core `src/infra/hardware-fingerprint.ts`. Reasons:

- It must exist _before_ Business is downloaded.
- It's pure (`os.*` + crypto digest), no licensing semantics.
- Reused by the heartbeat client.

**Proposed algorithm:**

```ts
// argent-core/src/infra/hardware-fingerprint.ts
import os from "node:os";
import crypto from "node:crypto";

export function computeHardwareFingerprint(): string {
  const parts = [
    os.hostname(),
    `${os.platform()}-${os.arch()}`,
    readMachineUuid() ?? "no-machine-uuid",
    firstNonLoopbackMac() ?? "no-mac",
  ];
  return crypto.createHash("sha256").update(parts.join("|")).digest("hex");
}
```

Properties:

- Stable across reboots — yes.
- Stable across OS minor upgrades — yes.
- Stable across OS major upgrades — usually yes on macOS, variable on Linux. Mitigation: `instance_id` in `~/.argentos/argent.json` is the secondary identifier.
- Stable across hardware swap — no (intentional; consumes an activation slot).

**Excluded:** CPU model (changes on virt re-host), OS version (defeats survives-upgrade goal).

---

## 5. Implementation footprint

| Repo                 |  LOC |                                                                                                                                         File touches |
| -------------------- | ---: | ---------------------------------------------------------------------------------------------------------------------------------------------------: |
| `argent-marketplace` | ~510 |                                                    8 (2 new routers, schema bump, queries, app mount, storage helper, sign-url helper, 2 test files) |
| `argent-core`        | ~848 | 11 (fingerprint + tests, overlay-downloader + tests, heartbeat, registry skeleton, CLI subcommand + tests, server-startup wire, business-status RPC) |
| `ArgentOS-Business`  | ~110 |      5 (`package.json` scripts, `tsconfig.json` per parent plan S-1, build-tarball script, GH publish workflow, `business-overlay.json` version pin) |

**Total:** ~1,470 LOC across 24 file touches.

---

## 6. PR sequence

| #        | Title                                                                  | Repo                         | Depends on            | Scope                                                                                        |
| -------- | ---------------------------------------------------------------------- | ---------------------------- | --------------------- | -------------------------------------------------------------------------------------------- |
| **PR-1** | Marketplace install endpoint + DB migration                            | `argent-marketplace`         | —                     | `src/routes/overlays.ts`, schema, queries, app mount, storage helper, sign-url helper, tests |
| **PR-2** | Argent-core hardware fingerprint helper                                | `argent-core` → `dev`        | —                     | `src/infra/hardware-fingerprint.ts` + tests                                                  |
| **PR-3** | Argent-core `argent license install business` CLI                      | `argent-core` → `dev`        | PR-1, PR-2            | CLI subcommand, downloader, tests                                                            |
| **PR-4** | Marketplace heartbeat verify endpoint                                  | `argent-marketplace`         | —                     | `src/routes/verify.ts` + tests                                                               |
| **PR-5** | Argent-core heartbeat client + kill switch + overlay registry skeleton | `argent-core` → `dev`        | PR-3, PR-4            | heartbeat loop, registry, business.status RPC, dashboard chip                                |
| **PR-6** | ArgentOS-Business publish workflow + first tarball                     | `ArgentOS-Business` → `main` | parent-plan S-1, PR-1 | `tsconfig.json`, `package.json` scripts, GH workflow                                         |
| **PR-7** | End-to-end smoke test                                                  | wherever fits                | PR-1..PR-6            | install + revoke + restore round-trip                                                        |

Each PR is explicit in the source doc about scope, files, tests, and DOD. See `LICENSE_GATED_DISTRIBUTION_SLICE.md` §6 for the full per-PR breakdown.

---

## 7. Open questions for Jason

Each blocks one or more PRs. Quick yes/no preferred where possible.

1. **Tarball storage** — marketplace-streamed vs S3/R2 pre-signed? **Reco:** marketplace-streamed for PR-1, R2 after 50+ installs.
2. **Hardware fingerprint algorithm** — include OS version? **Reco:** NO (defeats survives-upgrade goal). Final list: hostname + platform + arch + machine-uuid + first-MAC.
3. **Heartbeat cadence** — 24h, 6h, startup-only? **Reco:** 24h + on-startup.
4. **Offline grace after last successful heartbeat** — 7d, 14d, 30d? **Reco:** 14d.
5. **Revocation reason taxonomy** — `revoked` only, or `{refunded, fraud, support, customer-request, fingerprint-mismatch}`? **Reco:** structured enum from day one.
6. **Multi-version support** — latest-only or pin-to-version? **Reco:** latest-only in PR-3; add `--version=<v>` flag follow-up.
7. **Distribution channel beyond this slice** — private GitHub Packages, Verdaccio on Dell R750, or signed tarballs as proposed? **Reco:** signed tarballs now; private registry when `pnpm add @argentos/business-overlay` ergonomics matter.
8. **Who signs the install URL** — single marketplace key or per-license key? **Reco:** single marketplace key.
9. **Encrypt overlay tarball at rest?** **Reco:** NO — tarball is signed (tamper-evident); encryption adds zero real security and complicates debugging.

---

## 8. Risks

| ID  | Risk                                                                                                                                                            | Severity          | Mitigation                                                                                                                                   |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| D-1 | Heartbeat false-positive locks paying customer during marketplace outage                                                                                        | High              | 14d offline grace + manual `argent license force-active` admin CLI                                                                           |
| D-2 | Hardware FP changes on OS upgrade → customer hits max_activations                                                                                               | Medium            | Secondary `instance_id` in `argent.json`; install endpoint matches `(license_id, instance_id)` _before_ `(license_id, hardware_fingerprint)` |
| D-3 | Tarball storage cost growth                                                                                                                                     | Low               | Lifecycle: keep last 3 minor versions; auto-prune older                                                                                      |
| D-4 | Signed URL replay within 1h TTL                                                                                                                                 | Low               | URL signature binds `(instance_id, hardware_fingerprint)`; replay by other machine fails                                                     |
| D-5 | Race between heartbeat-says-revoked and a long-running gateway request                                                                                          | Medium            | `unregister` returns instantly; in-flight requests complete; no new dispatches                                                               |
| D-6 | `loadOptionalExport` path mismatch — license validation **silently no-ops today even when Business is installed** ([[Business Gap and Layering Plan]] §3.5 R-5) | High              | PR-3 makes loader specifier absolute (`~/.argentos/overlays/business/current/dist/license.js`) or moves to package specifier                 |
| D-7 | Air-gapped customers can't heartbeat                                                                                                                            | Medium            | Out of scope v1. Document. Future slice: manual offline-token flow.                                                                          |
| D-8 | Server-side admin upload endpoint doesn't exist yet                                                                                                             | Medium            | PR-6 stubs the upload step; manual `scp` for the first tarball; admin endpoint is a follow-up                                                |
| D-9 | Business repo can't compile today ([[Business Gap and Layering Plan]] M-2)                                                                                      | Critical for PR-6 | Parent-plan S-1 must land first; PR-1..PR-5 are unaffected                                                                                   |

---

## 9. Success criteria

This slice is done when **all of the following** are true on a clean dev machine:

1. ✅ Licensed customer can run `argent license install business`; gateway runs with Business descriptors registered within ~30s.
2. ✅ Marketplace `license_activations` row records hardware fingerprint + recent `last_verified_at`.
3. ✅ Revoking the license server-side disables descriptors within `(24h + 0h grace)`.
4. ✅ Reactivating restores descriptors within `(24h)` with no restart.
5. ✅ Network outage < 14d does not lock customer out.
6. ✅ Network outage > 14d puts entitlement into `grace-burned`, unloads descriptors.
7. ✅ Second machine with same key fails with `max_activations` if at ceiling.
8. ✅ Second machine with same key + existing fingerprint slot (reinstall path) succeeds without bumping count.
9. ✅ Marketplace `overlay_downloads` table records every install with bytes + version.
10. ✅ All 9 open questions in §7 answered and reflected in code.

---

## 10. Cross-links

- **Source-of-truth doc (this is a mirror):** `/Users/sem/code/ArgentOS-Business/ops/LICENSE_GATED_DISTRIBUTION_SLICE.md`
- **Parent plan:** [[Business Gap and Layering Plan]] (file at `/Users/sem/code/ArgentOS-Business/ops/BUSINESS_GAP_AND_LAYERING_PLAN.md`)
- **Extraction record:** [[Extraction Manifest]] (file at `/Users/sem/code/ArgentOS-Business/EXTRACTION_MANIFEST.md`)
- **Surface manifest:** `/Users/sem/code/ArgentOS-Business/business-overlay.json`
- **Marketplace schema:** `/Users/sem/code/argent-marketplace/src/db/schema.ts`
- **Marketplace activation tests:** `/Users/sem/code/argent-marketplace/src/tests/license.test.ts`
- **Boundary spec:** [[License Onboarding Flow]] (file at `ArgentOS-Business/docs/internal/boundary/LICENSE_ONBOARDING_FLOW.md`)

---

_Mirror of the ArgentOS-Business slice plan. The Business repo file is the source of truth — when amending, edit there first, then re-mirror here._
