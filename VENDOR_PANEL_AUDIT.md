# Vendor Panel Audit Report

**Date:** 2026-07-01
**Scope:** `vendor-panel/src` (UI code-quality + frontend↔backend contract audit)
**Method:** Ran the project tooling (`pnpm typecheck`, `pnpm lint`, `pnpm test`) plus
scripted repo checks (`rg`) and a frontend↔backend route cross-check against the app's
`backend/src/api/vendor/**` and the vendored MercurJS core (`@mercurjs/b2c-core`).

---

## Executive Summary

The vendor panel is broad and feature-rich, and the baseline tooling is now **healthy**:
typecheck, lint, and the unit test suite all pass. This supersedes the 2026-02-09 report,
whose two P0 blockers (broken ESLint config, failing typecheck) are **resolved**.

The remaining themes are (1) thin automated test coverage relative to the feature surface,
(2) a large `any` footprint, and (3) a few orphaned/contradictory route modules surfaced by
the contract cross-check.

| Category | Status | Notes |
|---|---|---|
| UI structure/routing | Good | Mature domain-oriented route/component/hook structure |
| Lint baseline | ✅ Passing | Flat `eslint.config.mjs` present; `pnpm lint` exits 0 (`--max-warnings 0`) |
| Type safety baseline | ✅ Passing | `pnpm typecheck` exits 0 |
| Unit tests | ✅ Passing (thin) | 13 tests / 4 spec files vs. ~70 route modules |
| Code hygiene | Good | `console.*` usage is logger-gated (see below); TODO/FIXME = 0 |
| `any` footprint | Watch | 438 token-level matches; diffuse long tail |
| Frontend↔backend contract | Mixed | 3 orphaned/mismatched route items (see Findings) |

---

## Verified Metrics (2026-07-01)

From `vendor-panel/`:
- `pnpm typecheck` → **exit 0**
- `pnpm lint` → **exit 0**
- `pnpm test` → **exit 0** (13 tests, 4 files)
- `rg "\bany\b" src | wc -l` → **438**
- `rg "console\.(log|warn|error)" src | wc -l` → **8** (all legitimate — see note)
- `rg "TODO|FIXME" src | wc -l` → **0**

**Console note.** The 8 matches are not stray debug logging: `lib/logger.ts` (the logger
itself), `lib/telemetry.ts` (a Sentry-missing `console.warn`), 2 inside a translation test,
and 1 commented-out line. No production console cleanup is warranted.

---

## Findings

### 1) Test coverage is thin relative to the feature surface (Medium)
4 spec files / 13 tests cover ~70 route modules plus a large API-hook layer. Typecheck gives a
structural net, but there is little behavioral coverage of critical flows (auth/approval gate,
product create, payout request, vendor-type gating). This is the highest-leverage quality gap.

### 2) Large `any` footprint (Medium)
438 token-level `any` matches, concentrated in `types/domain/index.ts`, `hooks/api/requests.tsx`,
`hooks/api/woocommerce.tsx`, `extensions/forms/hooks.tsx`, and `components/forms/metadata-form`.
This erodes the guarantee that a green typecheck implies, especially at API boundaries.

### 3) Frontend↔backend contract mismatches (Medium/High) — from route cross-check

- **`api-key-management` is dead *and* backend-blocked (High).** The full route folder
  (`routes/api-key-management/*`, `hooks/api/api-keys.tsx`) calls `/vendor/api-keys`, but:
  (a) it is **not registered** in `providers/router-provider/route-map.tsx`, not registered via
  `defineRouteConfig`, and imported nowhere — i.e. unreachable dead code; and (b) the backend
  **intentionally 403s** `/vendor/api-keys` in `backend/src/api/middlewares.ts` ("Vendors do not
  have access to API key management"). Recommend deleting the frontend module (or documenting the
  intentional block) to remove the contradiction.

- **`enterprise-fees` route folder is orphaned (Low/Medium).** `routes/enterprise-fees/*` is not
  in `route-map.tsx`, not `defineRouteConfig`-registered, and not imported elsewhere — unreachable.
  (The backend `/vendor/enterprise-fees` endpoint itself exists and is used via order cycles; only
  the standalone route UI is dead.)

- **`/vendor/return-request` has no handler (Medium).** The order-return hooks in
  `hooks/api/requests.tsx` (`useOrderReturnRequest`, `useOrderReturnRequests`,
  `useUpdateOrderReturnRequest`) call `/vendor/return-request`, which exists nowhere in the app
  backend or MercurJS core; MercurJS exposes `/vendor/returns` instead. The requests→order-return
  flow (`routes/requests/request-order-return`) likely 404s. *Static evidence only — not
  runtime-confirmed (no database available in the audit environment).*

### 4) Order status helpers crashed on unmapped statuses (High) — FIXED
`lib/order-helpers.ts` destructured a status→`[label, color]` lookup that returns `undefined`
for any status not in its map. `getOrderStatus` declared fallback defaults (`"-"`, `"orange"`)
that never applied — destructuring `undefined` throws a `TypeError` before defaults kick in —
and `getOrderPaymentStatus`/`getOrderFulfillmentStatus` had no fallback at all. Medusa emits
statuses outside these maps (`archived`, `requires_action`, `draft`; payment `not_paid`), so the
order status badge would throw. Fixed with a `?? []` guard on all three, now covered by
`lib/order-helpers.spec.ts`.

### 5) Feature breadth exceeds depth in places (Low — informational)
Several routes are thin but **functional** MVPs, not empty shells (e.g. `pos` self-labels
"(MVP)" and is wired to real hooks; `bug-report` posts to the GitHub tracker; `donations-list`
is ~205 lines). Worth an explicit MVP-vs-GA inventory so navigation doesn't advertise
half-finished flows, but no dead-shell problem was found.

---

## Remediation Applied (2026-07-01)

- **Fixed** the order-status helper crash (Finding 4) + added `lib/order-helpers.spec.ts`.
- **Added tests** for vendor-type feature gating (`vendor-type-context.spec.ts`) and order
  helpers — suite grew from 13 tests / 4 files to **30 tests / 6 files**.
- **Reduced `any`** from 438 → 418 by replacing metadata-blob `Record<string, any>` with
  `Record<string, unknown>` in `types/domain/index.ts` and `components/forms/metadata-form`,
  and tightening query params in `hooks/api/requests.tsx`.
- Recorded the contract mismatches (Finding 3) for follow-up; no code deleted pending owner
  decision on `api-key-management` / `enterprise-fees` / the `return-request` path.
- typecheck / lint / test all remain green after these changes.

## Recommended Remediation

### Immediate (P0)
1. Resolve the `api-key-management` contradiction (delete the dead frontend module, or document
   the intentional backend block).
2. Fix or remove the `/vendor/return-request` order-return path (repoint hooks to `/vendor/returns`
   or add the missing backend route), after runtime-confirming in a DB-equipped env.

### Near-term (P1)
1. Add behavioral tests for the critical flows named in Finding 1.
2. Reduce `any` in the hotspot files (Finding 2), starting at the API-hook boundary.
3. Remove or wire the orphaned `enterprise-fees` route folder.

### Ongoing (P2)
1. Add a lightweight CI check that flags route folders neither present in `route-map.tsx` nor
   registered via `defineRouteConfig` (catches future orphaned modules).
2. Track UI quality KPIs (type errors, lint warnings, `any` count, test count) per release.

---

## Commands Executed

From `vendor-panel/`:
- `pnpm typecheck` → exit 0
- `pnpm lint` → exit 0
- `pnpm test` → exit 0 (13 tests, 4 files)
- `rg "TODO|FIXME" src | wc -l` → 0
- `rg "\bany\b" src | wc -l` → 438
- `rg "console\.(log|warn|error)" src | wc -l` → 8 (all legitimate)

Route cross-check against `backend/src/api/vendor/**` and
`@mercurjs/b2c-core/.medusa/server/src/api/vendor/**`.

---

*Audit refreshed on 2026-07-01 to reflect verified current repository state and to record a
frontend↔backend contract cross-check.*
