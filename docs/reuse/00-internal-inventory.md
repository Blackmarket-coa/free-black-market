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

## Blocker discovered while inventorying

**Seven panel feature flags can never be true.**

`vendor-panel/src/lib/phase0-feature-flags.ts` reads `VITE_FF_POS_V1`,
`VITE_FF_WEIGHT_PRICING_V1`, `VITE_FF_PICK_PACK_V1`, `VITE_FF_INVOICING_V1`,
`VITE_FF_CHANNEL_SYNC_V1`, `VITE_FF_VENDOR_ADVANCES_V1`,
`VITE_FF_INVESTMENT_POOLS_V1`.

`vendor-panel/Dockerfile` declares four `VITE_*` ARGs — none of them `VITE_FF_*`.
`docker-build.yml`'s `panelargs` step emits four vars — none of them `VITE_FF_*`.

Vite inlines `import.meta.env.VITE_*` at build time; the helper is
`enabled(value, fallback = false)` and returns `false` for `undefined`. So all
seven are false in the published image, permanently. Five built features are
unreachable; two are correctly dark but by accident rather than by the flag.

Same failure shape as SD-26: a mechanism that looks wired and isn't. Must be
fixed before any panel-side flag in this programme can work.

---

## Not yet done

Steps 0.2–0.4 require outbound research and are outstanding:

- **0.2 OSS equivalents** — CiviCRM, Open Collective, Open Food Network, Karrio,
  Bigcapital, ERPNext, Listmonk, Mautic, Activepieces, Windmill, plus whatever
  search surfaces. Record licence, last commit, maintainers, and whether it runs
  on the single DL360. **FBM is AGPL-3.0 — licence compatibility must be checked
  per candidate before adoption.**
- **0.3 Public data and APIs** — IRS TEOS / Pub 78 / EO BMF, ProPublica
  Nonprofit Explorer, HRSA Find a Health Center, NAFC clinic locator,
  LawHelp.org, LSC grantee directory, 211 / findhelp, Feeding America locator.
  Verify terms, rate limits and current availability for each.
- **0.4 Existing nonprofit and mutual-aid platforms** to partner with rather
  than compete against.

No BUILD NEW decision is final until these three land and are approved.
