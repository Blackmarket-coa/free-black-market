# FBM Plant Network — Repo Audit

Audit of the FreeBlackMarket (MedusaJS v2 + MercurJS) monorepo against the BMC Plant
Network requirements. The audit prompt this work is based on was written for an older
snapshot; **its assumed paths and module names are stale**. This report reconciles every
section to the **current** repo and records the stub files added for the genuine gaps.

> Scope rule followed: no existing working code was modified. Only new sidecar stub files
> + this report were added. Stubs are TODO-only and delegate to existing systems.

## Path / naming corrections vs the original prompt

| Prompt assumed | Reality in this repo |
|---|---|
| `src/...` | **`backend/src/...`** (Medusa app lives in `backend/`) |
| `order-cycles` module | **`order-cycle`** (singular) |
| `karma-event` module | **`progression`** module + **KARMA rail** in `hawala-ledger` |
| `plugin-marketplace` | `plugin-registry` |
| `farm-operations` | not present → `agriculture`, `harvest`, `harvest-batches`, `season`, `producer`, `garden` |
| `bounties` | not present → `collective-quest`, `opportunity-engine`, `demand-pool` (DemandBounty) |
| `creator-studio` | not present → `creator-program`, `creator-rewards`, `creator-attribution` |
| `collective-demand` | not present → `collective-campaign`, `demand-pool` |
| `@medusajs/medusa` route imports | **`@medusajs/framework/http`** (`MedusaRequest`/`MedusaResponse`) |
| new parallel `plant-network` module | overlaps existing modules → stubs **extend** existing modules instead |

---

## Section 9 — Module registration check (orientation)

`backend/medusa-config.ts` groups modules (financialModules, collectiveModules,
marketplaceModules, …). 73 modules exist in `backend/src/modules/`.

| Module (requested) | Status | Path | Registered |
|---|---|---|---|
| demand-pool | EXISTS | `backend/src/modules/demand-pool/` | Y (collectiveModules) |
| order-cycles | RENAMED → `order-cycle` | `backend/src/modules/order-cycle/` | Y |
| hawala-ledger | EXISTS | `backend/src/modules/hawala-ledger/` | Y (financialModules) |
| farm-operations | MISSING (see `agriculture`/`harvest`/`season`) | — | — |
| bounties | MISSING (see `collective-quest`/`opportunity-engine`) | — | — |
| creator-studio | MISSING (see `creator-program`/`creator-rewards`) | — | — |
| asset-graph | EXISTS | `backend/src/modules/asset-graph/` | Link-discovered (not in modules array) |
| karma-event | MISSING → `progression` + hawala KARMA rail | `backend/src/modules/progression/` | Y (marketplaceModules) |
| plugin-marketplace | RENAMED → `plugin-registry` | `backend/src/modules/plugin-registry/` | check config |
| collective-demand | MISSING → `collective-campaign` / `demand-pool` | — | — |

**hawala-ledger rails** (`backend/src/modules/hawala-ledger/rails.ts`): `CCR`, `USDC`,
**`USD`** (cash-convertible, Stripe ACH — the rail grower payouts need), `KARMA`, `HRS`,
`GIFT`. The USD rail required for grower cash settlement **already exists**.

**progression** (`backend/src/modules/progression/service.ts`): soulbound XP
(EIP-5192/4973), `recordXpEvent` / `recordAttestedXpEvent`, role tracks (CONSUMER,
PRODUCER, INVESTOR, COALITION, CREATOR), level thresholds, earned titles. The named
grower tiers (Seedling→Ancestor) are **not** present and are added as an app-level ladder
in the Section 7 stub.

---

## Sections 1–8, 10 — findings & stubs added

### Section 1 — Product metadata · PARTIAL
- **Found:** MedusaJS v2 default `product.metadata` JSON column (freeform). No typed
  plant fields anywhere. Produce backbone is modeled separately in `agriculture`
  (Harvest→Lot→AvailabilityWindow; `links/product-availability.ts`).
- **Gap:** no typed view of `grower_node`, zone, prop_method, ship window, is_live_plant,
  requires_phyto_cert, etc.
- **Stub added:** `backend/src/types/plant.ts` — `PlantProductMetadata`, `PropMethod`,
  `GrowerNode`, `readPlantMetadata()`. (Typed view over `product.metadata`; no DB change.)

### Section 2 — Grower payout · PARTIAL (infra EXISTS, node attribution MISSING)
- **Found:** full ledger payout stack — `payout-breakdown` (OrderPayoutBreakdown,
  PayoutConfig, SellerPayoutSettings; creator commission, plugin/referral splits) +
  `hawala-ledger` (SELLER_EARNINGS/CREATOR_EARNINGS/PLATFORM_FEE accounts, SettlementBatch,
  USD rail), wired by `subscribers/hawala-order-payment.ts`.
- **Gap:** splits are seller/creator-scoped, not **grower-node**-scoped; no monthly node
  payout aggregation / 1099.
- **Stub added:** `backend/src/modules/payout-breakdown/grower-payout.ts` —
  `GrowerPayoutService` (delegates to existing payout/ledger services; USD rail).

### Section 3 — Order cycles / ship windows · PARTIAL
- **Found:** `order-cycle` module with draft→…→dispatched workflow, ShareBox
  templates/subscriptions, fees; `subscribers/order-cycle-order-placed.ts`;
  `links/order-order-cycle.ts`.
- **Gap:** no per-product ship-window gating from plant metadata; no daily open/close job.
- **Stub added:** `backend/src/modules/order-cycle/plant-ship-window.ts` —
  `isProductOrderable` / `syncCycleStatuses`.

### Section 4 — Demand pool · PARTIAL
- **Found:** `demand-pool` module (DemandPost/Participant/Bounty/SupplierProposal/Vote,
  full status workflow).
- **Gap:** no path for buyers to express demand for a **species with no product yet**;
  no production-activation→pre-order-listing flow.
- **Stub added:** `backend/src/modules/demand-pool/plant-demand.ts` — `PlantDemandService`.

### Section 5 — Wholesale tiers · PARTIAL
- **Found:** `vendor-rules/models/vendor-customer-tier.ts` already has a **WHOLESALE** tier
  (discount_percent, waive_order_minimum, priority_fulfillment, payment_terms_days/Net-30,
  free_delivery_threshold, requires_application). Lot/availability pricing supports tiers.
- **Gap:** no public application intake + admin approval that assigns buyers into the tier.
- **Stubs added:** `backend/src/api/store/wholesale-application/route.ts` (intake) and
  `backend/src/api/admin/wholesale-application/[id]/approve/route.ts` (approval).

### Section 6 — Multi-location fulfillment · PARTIAL
- **Found:** single default stock location (`loaders/init-stock-location.ts`,
  `scripts/setup-stock-location.ts`); fulfillment providers (`blackstar-fulfillment*`,
  `local-delivery-fulfillment`, `printful-fulfillment`).
- **Gap:** no per-node stock locations, no split fulfillment by node, no phyto-cert gate.
- **Stub added:** `backend/src/modules/agriculture/node-fulfillment.ts` —
  `NodeFulfillmentService` (groupOrderByNode / dispatch / checkPhytoCertRequirement).

### Section 7 — Grower KARMA · PARTIAL (engine EXISTS, grower events MISSING)
- **Found:** `progression` XP engine + hawala `KARMA` rail.
- **Gap:** no grower-specific event types; no named grower tier ladder.
- **Stub added:** `backend/src/modules/progression/grower-karma.ts` — `GrowerKarmaService`,
  `GrowerKarmaEventType`, `GROWER_TIERS` (delegates to `recordXpEvent`).

### Section 8 — Grower dashboard · PARTIAL (panel + scoping EXIST)
- **Found:** `vendor-panel/` app + seller-scoped `backend/src/api/vendor/` (incl. `farm/`,
  `hawala/payouts`, `order-cycles/`) via `api/vendor/_middlewares.ts` (`_seller_id`).
- **Gap:** no node-scoped earnings/units/payout/KARMA aggregate endpoint.
- **Stub added:** `backend/src/api/vendor/farm/grower-dashboard/route.ts` (GET, seller-scoped).

### Section 10 — Shipping profiles · PARTIAL
- **Found:** generic shipping seeding in `scripts/seed/seed-functions.ts` (MercurJS
  SELLER_SHIPPING_PROFILE_LINK). No live-plant profile.
- **Gap:** no USPS-Priority/heat-pack/restricted-state/3-day live-plant profile.
- **Stub added:** `backend/src/scripts/seed-plant-shipping-profiles.ts`.

---

## Final summary table

| # | Feature | Status | Key files (real) | Gap | Est dev |
|---|---|---|---|---|---|
| 1 | Product metadata | PARTIAL | `backend/src/types/plant.ts` (new); `product.metadata` | typed plant fields wired into product create/update + storefront | 4–8h |
| 2 | Grower payout | PARTIAL | `payout-breakdown/`, `hawala-ledger/` (+ new `grower-payout.ts`) | node attribution + monthly settlement + 1099 | 16–24h |
| 3 | Order cycles / ship windows | PARTIAL | `order-cycle/` (+ new `plant-ship-window.ts`) | metadata-driven gating + daily job | 8–12h |
| 4 | Demand pool | PARTIAL | `demand-pool/` (+ new `plant-demand.ts`) | species-without-product + activation | 8–12h |
| 5 | Wholesale tiers | PARTIAL | `vendor-rules` WHOLESALE tier (+ new app routes) | intake + approval flow | 8–12h |
| 6 | Multi-location fulfillment | PARTIAL | `loaders/init-stock-location.ts` (+ new `node-fulfillment.ts`) | per-node locations, split fulfillment, phyto gate | 20–32h |
| 7 | Grower KARMA | PARTIAL | `progression/`, hawala KARMA rail (+ new `grower-karma.ts`) | grower event types + tier mapping | 6–10h |
| 8 | Grower dashboard | PARTIAL | `vendor-panel/`, `api/vendor/` (+ new dashboard route) | node-scoped aggregation + panel UI | 10–16h |
| 9 | Module registration | EXISTS | `backend/medusa-config.ts` | naming reconciliation only | — |
| 10 | Shipping profiles | PARTIAL | `scripts/seed/seed-functions.ts` (+ new seed script) | live-plant profile + product attach | 4–6h |

**Total estimated remaining:** ~90–130 hours.

**Blockers (before first plant sale):**
- Per-node stock locations + split fulfillment (Section 6) — orders can't ship from the
  right node without it.
- Grower-node payout attribution (Section 2) — growers can't be paid their share.
- Ship-window gating (Section 3) — seasonal listings would oversell out of season.
- Phyto-cert gate (Section 6) — legal blocker for restricted-state live-plant shipments.

**Quick wins (config / low dev):**
- Wholesale: the WHOLESALE tier already exists — wire the application routes + price list.
- Shipping: add the live-plant profile via the existing seed workflow.
- Plant metadata: pass `product.metadata` through existing product admin (typed view ready).

---

## Stub files added by this audit
1. `backend/src/types/plant.ts`
2. `backend/src/modules/payout-breakdown/grower-payout.ts`
3. `backend/src/modules/order-cycle/plant-ship-window.ts`
4. `backend/src/modules/demand-pool/plant-demand.ts`
5. `backend/src/api/store/wholesale-application/route.ts`
6. `backend/src/api/admin/wholesale-application/[id]/approve/route.ts`
7. `backend/src/modules/agriculture/node-fulfillment.ts`
8. `backend/src/modules/progression/grower-karma.ts`
9. `backend/src/api/vendor/farm/grower-dashboard/route.ts`
10. `backend/src/scripts/seed-plant-shipping-profiles.ts`
