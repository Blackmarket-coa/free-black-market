# Reuse Report — step 0.1, internal inventory

Verified 2026-10-01 against working trees: `free-black-market` @ `ebff02ea`
(+ this branch), `blackout` @ `f61ac39d` (PR #932), `Blackstar` @ `338ae58`
(PR #33).

Method: direct inspection of `src/modules/**`, registration-key constants,
definition catalogues, workflow YAML and the built panel flag path. Every status
below was checked, not inferred. Statuses the work prompt supplied as hypotheses
are marked **confirmed** or **corrected**.

---

## Present and reusable

| Capability | Path | Registration key | Notes |
|---|---|---|---|
| Collective quests | `backend/src/modules/collective-quest` | `collectiveQuestModuleService` | Aggregates consenting members' substrates |
| Quest engine + catalog | `backend/src/modules/vendor-quest` | `vendorQuestModuleService` | Q1–Q15; `definitions/` is code config |
| Progression / KARMA | `backend/src/modules/progression` | `progressionModuleService` | `grower-karma.ts` holds `GROWER_TIERS` |
| Demand pools | `backend/src/modules/demand-pool` | `demandPoolModuleService` | |
| Bargaining groups | `backend/src/modules/bargaining` | `bargainingModuleService` | |
| Collective campaigns | `backend/src/modules/collective-campaign` | — | Prompt called this `campaign` |
| Mutual aid | `backend/src/modules/mutual-aid` | `mutualAidModuleService` | |
| Aid network | `backend/src/modules/aid-network` | `aidNetworkModuleService` | `FF_AID_NETWORK_V1` |
| Order cycles | `backend/src/modules/order-cycle` | `orderCycleModuleService` | Oversell fix from PR #853 |
| Hawala ledger | `backend/src/modules/hawala-ledger` | `hawalaLedger` | Patronage, consignment splits, Posture A guard |
| Plugin registry | `backend/src/modules/plugin-registry` | `plugin_registry` | Prompt called this "app store" |
| Blackstar fulfilment | `backend/src/modules/blackstar-fulfillment` (+ `-provider`) | `blackstarFulfillment` | |
| Marketplace listing | `backend/src/modules/marketplace-listing` | `marketplaceListing` | |
| Embed keys / analytics | `backend/src/modules/embed-keys`, `embed-analytics` | | connect.js auth + telemetry |
| Shipping-label seam | `backend/src/modules/agriculture/label-provider.ts` | — | Provider-agnostic, default no-op, `PLANT_LABEL_PROVIDER`. Karrio slots in here |
| Customer-data registry | `backend/src/lib/customer-data-registry.ts` | — | Reuse for the required data export |
| connect.js | `storefront/public/connect.js`, `public/v2.0.0/connect.js` | — | 47,404 bytes, identical; widgets: products, services, events, reviews, demand-pools, digital, vendor, chat |
| Embed bookings | `backend/src/api/store/embed/bookings` | — | Embed booking is real |
| Coalitions | `blackout/packages/api/src/services/coalition*.ts` | — | 23 services |
| Delegated voting | `blackout/apps/blackout-server/blackout_runtime/{module,server_semantics}.py` | — | |

## Confirmed hypotheses

- **Vendor Quest Engine: catalog live, engine flag off** — confirmed.
  `FF_VENDOR_QUESTS_V1` appears in no `.yml`, `.yaml`, `.env*`, `.json` or
  `Dockerfile` in the repo. Off in every environment by default; setting the env
  var on the host is sufficient, no rebuild.
- **KARMA 5-tier ladder: live, sets real payout shares** — confirmed.
  `GROWER_TIERS` = Seedling 0 / 0.60, Sprout 50 / 0.62, Root 200 / 0.65,
  Canopy 500 / 0.68, Ancestor 1500 / 0.72. Sets the grower's `split_pct`; does
  **not** feed the platform fee, so it coexists with flat 3% without conflict.
- **Patronage disbursement built, flagged off** — confirmed. Plans only;
  `patronageDisbursementPort` is resolved at
  `api/admin/hawala/patronage/disburse/route.ts:233` and registered nowhere.
  `FBM_PATRONAGE_DISBURSEMENT_LIVE` gates the live path. Issue #865.
- **Consignment splits built** — confirmed (hawala-ledger + unit tests).
- **Order Cycles (status unconfirmed)** — confirmed present.
- **connect.js v2.0.0 in the FBM storefront** — confirmed.
- **Coalitions coded** — confirmed, extensively.

## Corrected hypotheses

| Prompt said | Reality |
|---|---|
| "$10/mo all-access plan (0% commission)" as a current plan | Does not exist. Catalog is free/3%, starter $29/2.5%, pro $99/2%, scale $249/1.5%, internal/null. This is a migration, not a constraint |
| "Community capital circles and first-order guarantee: built, gated" | No such module, model or identifier. The real gated capital pair is `VendorAdvance` (`FF_VENDOR_ADVANCES_V1`) and `InvestmentPool`/`Investment` (`FF_INVESTMENT_POOLS_V1`) |
| Modules `bounty`, `escrow`, `app-store`, `campaign` | Not present under those names. `plugin-registry` and `collective-campaign` are the nearest real things; bounty/escrow logic sits inside `demand-pool` |
| Blackstar "batch claims and micro-depots" | Not under those names. Real shape: `ShipmentBoardListing` + `claim_policy` + the award endpoint |

## A reported blocker that was already fixed

The first pass reported the panels' `VITE_FF_*` flags as unwired. Against
`main` that is **wrong** — `965d9d40` (25 Sep) declares all twelve ARGs across
the two panels and passes all seven from repo variables.

The finding was made against `ebff02ea`, this branch's six-day-old base, without
re-checking `origin/main`. The mechanism described (Vite inlines at build time;
`enabled(undefined)` is `false`; an undeclared flag is compiled as permanently
false) is accurate and worth keeping. Its application to current `main` was not.

What remains novel is the guard, `scripts/check-panel-feature-flags.mjs` —
`main` has no equivalent. It passes against `main`'s wiring, so it locks in the
existing fix instead of redoing it.

**Method note for the remaining Reuse Reports:** verify against `origin/main`,
not the working tree, and stamp every status with the commit it was checked at.

## Steps 0.2 and 0.3 — done 2026-10-01

- **0.2 OSS equivalents** → `docs/reuse/02-oss-equivalents.md`. Ten candidates,
  licence verified from each project's own statement: AGPL-3.0 (CiviCRM with a
  PHP-License exception, Open Food Network, Listmonk, Bigcapital, Windmill CE),
  GPL-3.0 (Mautic, ERPNext), MIT (Open Collective, Activepieces core),
  Apache-2.0 + LGPL-3.0 plugins (Karrio core — **with a paid Enterprise Edition
  to pin away from**). Last-commit and maintainer counts are **not** recorded:
  this session's GitHub access is gated to the three BMC repos, so
  `api.github.com` 403s for third parties. Liveness checks are still owed.
- **0.3 Public data and APIs** → `docs/reuse/03-public-data-and-apis.md`. The
  two load-bearing results: **IRS TEOS has no API** (monthly pipe-delimited bulk
  files only — so it becomes the system of record for org verification, with
  ProPublica's keyless v2 API as enrichment only), and **Open Referral HSDS 3.0**
  already exists as the interchange standard that findhelp, United Way 211 and
  Unite Us consume — which replaces a stack of bilateral integrations with one
  documented format. Feeding America publishes **no** developer API; the ones on
  commercial marketplaces are third-party scrapers and must not be built on.
  Four new legal checkpoints (L11–L14) came out of this step.

## Step 0.4 — done 2026-10-01, with four of five sections unfact-checked

`docs/reuse/04-partner-platforms.md`. The one-line answer: **do not build a
partner directory or a resource finder; publish FBM's partner directory as an
HSDS 3.x feed, consume the two live open US HSDS feeds (Feed America, Mutual
Aid NYC), and route money to whichever fiscal host a partner already has.**
The only no-custody donation pattern found is a Stripe Connect *direct* charge
on the nonprofit's own connected account — already FBM's processor. Eleven new
legal checkpoints (L15–L25); L24 and L25 gate Open Decisions 2 and 1.

Four narrow BUILD NEW items are justified because nothing covers them: an
HSDS 1.1→3.x upgrade in ingest (211 vendor exports are 1.1-era), a
host+collective recipient model (every giving API models an EIN), group-
controlled default-private publication (Mutual Aid LA pulled its directory
over safety), and status/consent filtering on ingest (Mutual Aid NYC's public
dump includes "Do Not Publish" records).

**Limitation:** the HSDS section was adversarially fact-checked (14
corrections applied); the 211, mutual-aid, food-access and giving sections were
not — a rate limit cut those checks off. Their "unverified" labels are the
researcher's own.

## Still owed

- **Liveness** for every 0.2 candidate and every 0.4 tool (last commit,
  maintainer count, licence read from the repository) — GitHub API is 403 here.
- **NAFC clinic locator** (carried from 0.3).
- **Fact-check of 0.4 §3–§6** against primary sources.
- **Operator approval** of the BUILD NEW list in 0.4 §7 before any of it starts.
