# FreeBlackMarket — Phase 2 Checklist Status

_Last updated: 2026-06-08_

This maps the Phase 2 "Functioning Features" spec to the code in **this repo
(FBM)**. The spec spans two systems; the social/discovery half (**Dens**,
**Coliseum**, the unified **Feed**, the **Creator Hub UI**) is built in the
separate **Blackout** repo and reached over the webhook/entitlements contract in
`docs/contracts/blackout-integration.md`. Those are marked _Blackout_ below and
are not FBM gaps.

Legend: ✅ implemented · 🟡 partial · 🔵 Blackout repo

| # | Feature | Status | Primary evidence (FBM) |
|---|---|---|---|
| 1 | User Accounts & Identity | ✅ | `lib/blackout-identity.ts`, `api/v1/integrations/blackout/oauth`, `seller-extension` (`blackout_user_id`, `mxid`) |
| 2 | Marketplace | ✅ | `product-archetype`, `listing-type`, checkout/cart, Stripe, `delivery` + order tracking |
| 3 | Vendor Profiles | ✅ | `producer`, `cooperative` memberships, `creator-attribution` partnerships, producer story |
| 4 | Commerce Hub | ✅ | `api/store/directory`, `shared/external-stores.ts`, `woocommerce-import`, storefront links |
| 5 | **Opportunity Engine** | ✅ | **`modules/opportunity-engine`** (scoring + price tracker), `api/store/opportunities[/:subject]`, `/store/price-tracker`, recompute job |
| 6 | Launch Center | ✅ | `api/v1/seller/launches`, `workflows/launch-{product,sponsorship}` |
| 7 | Producer–Creator Matching | ✅ | `api/v1/seller/matching/{creators,opportunities}`, `_ranking.ts` |
| 8 | Bounty Marketplace | ✅ | `demand-pool`, bounty claim/milestone routes, escrow payout |
| 9 | Sponsorship Marketplace | ✅ | `workflows/launch-sponsorship`, `collective-hawala.paySponsorship` (90/10) |
| 10 | Referral System | ✅ | `creator-attribution`, affiliate links, earnings + KPI rollup |
| 11 | Vendor Growth Dashboard | ✅ | metrics dashboard + **`api/v1/seller/growth/suggestions`** (creators / coalitions / high-demand) |
| 12 | Business Launch System | ✅ | **`opportunity-engine/startup-guides`** catalog, `api/store/startup-guides[/:slug]` |
| 13 | Community Product Pages | ✅ / 🔵 | **`api/store/products/:handle/community`** (coalitions + creator content); Dens threads = Blackout |
| 14 | **Product Knowledge Base / DIY Library** | ✅ | **`modules/knowledge-base`**, `api/store/knowledge-base[/:slug]`, community contributions + moderation |
| 15 | **Economic Intelligence** | ✅ | **`api/v1/seller/economic-intelligence/trends`**, price-trend analysis in `opportunity-engine/_scoring.ts` |
| 16 | Black Market Product Integration | ✅ | **`modules/plugin-registry`** (`/store/plugins`, install), `/store/black-market/templates`, `digital-product` |

## What this phase added (the former red/yellow gaps)

The commerce substrate (1–4, 6–10) was already done. This phase closed the
"discover → learn → opportunity" half of the funnel:

- **§5 Opportunity Engine + §15 Economic Intelligence** — new `opportunity-engine`
  module: a deterministic 0–10 opportunity score (high demand + low competition
  + low startup cost) over live `demand-pool` / `wishlist` / `cooperative` /
  catalog signals, a price tracker with trend analysis, materialized scores
  (recompute job), and store/seller APIs. Pure scoring is unit-tested.
- **§12 Business Launch System** — in-code startup-guide catalog (seedling,
  compost, soap, gardening) supplying the startup-cost signal and a
  "start a business" directory that feeds the Launch Center.
- **§14 Product Knowledge Base** — new `knowledge-base` module: DIY library,
  container-gardening guides (by climate/space/difficulty), substitution guides,
  and a community-contribution moderation queue.
- **§11 Growth Suggestions** — `/v1/seller/growth/suggestions` reusing the
  matching ranking + opportunity scores + coalitions.
- **§13 Community Product Pages** — `/store/products/:handle/community`
  aggregation (Dens threads stay Blackout-hosted).
- **§16 Plugin Ecosystem** — new `plugin-registry` module (browse + install) and
  a curated business-templates directory.

## Still deferred (Phase 3, per the spec's "What Can Wait")

- Multi-seller "all businesses in one profile" (one auth → many sellers).
- Featured Placement revenue.
- Product tokens, coalition credit backing, investments, Blackstar vending,
  advanced logistics/governance automation.

## Seeds & jobs

- `pnpm medusa exec ./src/scripts/seed-opportunity-engine.ts` (startup guides +
  baseline prices), `./src/scripts/seed-knowledge-base.ts`,
  `./src/scripts/seed-plugins.ts`.
- Job `recompute-opportunity-scores` (every 6h) materializes opportunity scores.

## Verification

- Unit (DB-less): `cd backend && TEST_TYPE=unit … jest` — opportunity scoring,
  KB catalog/filter, plugin catalog (24 new tests).
- Typecheck: `cd backend && node node_modules/typescript/bin/tsc --noEmit` (0 errors).
- DB-dependent (CI / DB env): module-integration specs + seed scripts; API smoke
  on `/store/opportunities`, `/store/price-tracker`, `/store/knowledge-base`,
  `/store/startup-guides`, `/store/plugins`, and authed
  `/v1/seller/growth/suggestions`, `/v1/seller/economic-intelligence/trends`.
