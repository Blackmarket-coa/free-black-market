# Black Market Coalition — Aggressive Operations Guide

> **Companion docs:** [`ROADMAP.md`](../ROADMAP.md) · [`FEATURE_BUILD_PLAN.md`](../FEATURE_BUILD_PLAN.md) · [`docs/VENDOR_PORTAL_PROJECT_TRACKER.md`](VENDOR_PORTAL_PROJECT_TRACKER.md) · [`docs/VENDOR_FEATURE_MATRIX.md`](VENDOR_FEATURE_MATRIX.md) · [`docs/COLLECTIVE_BUYS_MICRO_INVESTMENT_SPEC.md`](COLLECTIVE_BUYS_MICRO_INVESTMENT_SPEC.md) · [`docs/VENDOR_HYPE_OPERATIONS_PREDICTION_WHITEPAPER.md`](VENDOR_HYPE_OPERATIONS_PREDICTION_WHITEPAPER.md) · [`docs/PROJECT_OPERATING_SYSTEM.md`](PROJECT_OPERATING_SYSTEM.md)
>
> This file is the canonical 24-month execution calendar for the Black Market Coalition. The user-supplied calendar is preserved verbatim. FBM-specific expansions are appended in clearly labeled subsections so original priorities, KPIs, and Blackout/Blackstar/marketing/daily-ops content remain unchanged.

---

# Black Market Coalition

Aggressive Operations Guide

24-Month Execution Calendar

Goal: Top-End Growth Scenario

This plan is optimized for:

maximum revenue velocity,

recursive growth,

creator acquisition,

infrastructure leverage,

and ecosystem lock-in.

The strategy:

front-load the highest-margin, fastest-scaling revenue systems first,

then recursively reinvest into:

* infrastructure,
* retention,
* logistics,
* and ecosystem defensibility.

⸻

CORE EXECUTION PHILOSOPHY

Phase 1

Monetize Attention

Focus:

* creators
* digital products
* subscriptions
* plugins
* communities
* services

Goal:

rapid recurring revenue.

⸻

Phase 2

Lock In Communities

Focus:

* identity economy
* plugin economy
* paid communities
* creator coalitions

Goal:

retention + recurring cash flow.

⸻

Phase 3

Increase Transaction Density

Focus:

* ghost kitchens
* CSA systems
* vending
* local delivery
* service ecosystems

Goal:

recurring local commerce.

⸻

Phase 4

Internalize Infrastructure

Focus:

* compute
* storage
* fulfillment
* logistics
* nodes

Goal:

operational leverage + defensibility.

⸻

PRIMARY SUCCESS METRICS

Metric	Year 1 Goal
Creators onboarded	25,000+
Paid communities	5,000+
Vendors	5,000+
Plugin creators	2,000+
Monthly GMV	$10M+
Monthly recurring revenue	$2M+
Cross-platform bridge communities	10,000+
Service providers	10,000+

⸻

MONTH-BY-MONTH OPERATIONS CALENDAR

MONTH 1

FOUNDATION + RAPID MONETIZATION

PRIORITIES

Highest ROI First

⸻

FBM

COMPLETE THESE FIRST

Task	Priority	Target Completion
Creator affiliate system	CRITICAL	100%
Digital products	CRITICAL	100%
Creator storefronts	CRITICAL	100%
Referral tracking	CRITICAL	80%
Community storefront hooks	HIGH	60%
Subscription infrastructure	HIGH	70%

#### FBM — Existing Module Leverage (Month 1)

Most of the Month-1 priorities map to modules that already ship in `backend/src/modules/`. Activate and instrument; do not rebuild:

| Calendar item | Existing FBM module(s) | Notes |
|---|---|---|
| Creator affiliate system | `creator-attribution`, `creator-program`, `creator-rewards` + routes under `backend/src/api/vendor/affiliate-links/*` | Affiliate-link generation, attribution, reward distribution all wired |
| Digital products | `digital-product`, `digital-product-fulfillment` | License delivery + entitlement (`entitlement`) live |
| Creator storefronts | `marketplace-listing`, `seller-extension`, `content-platform` | Storefront polish tracked in `STOREFRONT_AUDIT.md` |
| Referral tracking | `creator-attribution` events + `marketplace-webhooks` | Hook into Hawala for payouts (`hawala-ledger`) |
| Community storefront hooks | `cooperative`, `buyer-network`, `marketplace-listing` | Co-op-owned listings already supported |
| Subscription infrastructure | `subscription` | Recurring billing, plan tiers, dunning |

#### FBM — Additional Workstreams (Month 1)

| Task | Priority | Target Completion | Source |
|---|---|---|---|
| Vendor Activation Sprint A — TTFLL ≤ 5 min wizard | CRITICAL | 100% | `FEATURE_BUILD_PLAN.md` §"Activation Sprint A" (lines 36–80) |
| Storefront product display polish | HIGH | 80% | `STOREFRONT_AUDIT.md`, `docs/STOREFRONT_PRODUCTS_DISPLAY_REVIEW.md` |
| Tenancy / multi-tenant scaffolding | HIGH | 70% | `backend/src/modules/tenancy` |
| Vendor identity & trust pass | HIGH | 80% | `vendor-verification`, `marketplace-signing`, `vendor-rules` |
| Hawala ledger payout activation | CRITICAL | 90% | `hawala-ledger`, `payout-breakdown` |

⸻

Blackout

Task	Priority	Target Completion
Paid communities	CRITICAL	90%
Theme system	CRITICAL	100%
Emoji marketplace	HIGH	80%
Plugin architecture MVP	CRITICAL	70%
Discord/Twitch/YouTube bridges	CRITICAL	100%
Mobile optimization	HIGH	60%

⸻

Blackstar

Task	Priority	Target Completion
Node abstraction	MEDIUM	30%
Fulfillment hooks	MEDIUM	40%
Delivery architecture	LOW	20%

⸻

MARKETING

DAILY

6–10 Hours Minimum

Content Output

* creator recruitment videos
* “make money with your community”
* “monetize your audience”
* plugin creator recruitment
* creator coalition messaging

⸻

WEEKLY TARGETS

Target	Goal
Creator outreach DMs	1,000+
Community partnerships	50
Short-form videos	50
Affiliate onboarding calls	25
Creator walkthrough demos	20

⸻

QUICK INCOME GENERATORS

PRIORITY ORDER

1.

Digital products

2.

Creator subscriptions

3.

Paid communities

4.

Plugin marketplace

5.

Services marketplace

6.

Themes/emojis

⸻

MONTH 1 TARGETS

KPI	Goal
Revenue	$5k–$15k
Creators	100–300
Paid communities	25
Vendors	50
Plugins/themes listed	50

⸻

MONTH 2–3

VIRAL ACQUISITION PHASE

FBM PRIORITIES

Task	Completion Goal
Group commerce	80%
Services marketplace	100%
Community subscriptions	100%
Revenue split systems	90%
Analytics dashboard	70%

#### FBM — Existing Module Leverage (Month 2–3)

| Calendar item | Existing FBM module(s) |
|---|---|
| Group commerce | `collective-campaign`, `demand-pool`, `bargaining`, `cooperative`, `buyer-network` |
| Services marketplace | `service-program`, `ticket-booking`, `rental` |
| Community subscriptions | `subscription` + `cooperative` + `governance` |
| Revenue splits | `payout-breakdown`, `hawala-ledger` |
| Analytics seed | `impact-metrics` (extend, do not rebuild) |

#### FBM — Additional Workstreams (Month 2–3)

| Task | Completion Goal | Source |
|---|---|---|
| Vendor Activation Sprint B (CSV import, listing templates, Launch Assist Mode) | 90% | `FEATURE_BUILD_PLAN.md` §"Activation Sprint B" (lines 82–106) |
| Order cycle aggregation productionization | 80% | `order-cycle` |
| Wishlist + content-platform creator pages | 70% | `wishlist`, `content-platform` |
| Donation rails wired to creator coalitions | 60% | `donation` |
| Volunteer coordination for coalition launches | 50% | `volunteer` |
| Spec out POS, weight pricing, channel sync data contracts | Designs frozen | `FEATURE_BUILD_PLAN.md` Phase 0 (lines 183–205) |

⸻

Blackout PRIORITIES

Task	Completion Goal
Plugin marketplace	90%
Community discovery	70%
Creator dashboards	80%
Monetized identities	100%
AI plugin APIs	60%

⸻

MARKETING STRATEGY

PRIORITY:

Coalition creator recruitment

Push:

* “earn together”
* “community monetization”
* “own your audience”
* “cross-platform monetization”
* “plugin economy”

⸻

LAUNCHES

Launch #1

Creator Monetization Launch

Focus:

* affiliates
* storefronts
* subscriptions

⸻

Launch #2

Plugin Economy Launch

Focus:

* themes
* plugins
* emoji packs
* AI plugins

⸻

PARTNERSHIPS

PRIORITY PARTNERS

Category	Goal
Mid-size creators	Highest priority
Discord communities	High
Twitch streamers	High
Open-source devs	Critical
Existing marketplaces	Critical
Ghost kitchens	Medium
CSA farms	Medium

⸻

MONTH 3 TARGETS

KPI	Goal
Revenue	$40k–$100k/month
Creators	2,500+
Paid communities	250+
Vendors	500+
Plugin creators	100+

⸻

MONTH 4–6

ECOSYSTEM COMPOUNDING PHASE

PRIORITIES

FBM

Task	Completion Goal
Omnichannel commerce	80%
POS systems	60%
CSA systems	70%
Crop planning	60%
Ghost kitchen integrations	50%

#### FBM — Existing Module Leverage (Month 4–6)

| Calendar item | Existing FBM module(s) |
|---|---|
| Omnichannel commerce | `woocommerce-import`, `odoo`, `printful-fulfillment`, `marketplace-listing`, `marketplace-webhooks` |
| CSA systems | `agriculture`, `garden`, `season`, `producer`, `harvest`, `harvest-batches`, `food-distribution`, `order-cycle` |
| Crop planning (light today, expand here) | `agriculture`, `garden`, `season` |
| Ghost kitchen integrations | `kitchen`, `restaurant`, `food-distribution`, `order-subcontract`, `supplier-forwarding` |
| Vendor demand prediction (rare differentiator) | `vendor-hype-operations-prediction` |

#### FBM — Additional Workstreams (Month 4–6)

| Task | Completion Goal | Source |
|---|---|---|
| POS module MVP | 60% | `FEATURE_BUILD_PLAN.md` §1 "POS for in-person market/pickup sales" (lines 210–232) |
| Sell-by-weight pricing | 70% | `FEATURE_BUILD_PLAN.md` §2 (lines 234–252) |
| Channel-sync module (real-time inventory/order sync) | 60% | `FEATURE_BUILD_PLAN.md` §3 (lines 254–274) |
| `fulfillment-ops` pick-and-pack | 50% | `FEATURE_BUILD_PLAN.md` §4 (lines 280–296) |
| Vendor Hype Operations Prediction Phase A/B launch | 70% | `docs/VENDOR_HYPE_OPERATIONS_PREDICTION_GROWTH_LAUNCH_PLAN_PHASE_A_B.md` |
| Vendor Activation Sprint C (48-hr follow-up, dashboard coaching, incentives) | 100% | `FEATURE_BUILD_PLAN.md` §"Activation Sprint C" (lines 107–124) |
| CSA share-box scheduler on top of `order-cycle` | 70% | extends `order-cycle` + `food-distribution` |
| Crop planning v2 (rotation, yield forecast) | 60% | extends `agriculture` + `garden` + `season` |

⸻

Blackout

Task	Completion Goal
Community prestige systems	80%
Recommendation engine	60%
Advanced plugin APIs	80%
Service coordination tools	70%

⸻

Blackstar

Task	Completion Goal
Fulfillment nodes	60%
Pickup systems	60%
Vending architecture	40%

⸻

NEW REVENUE PUSHES

Launch #3

Service Marketplace Launch

Focus:

* creators
* freelancers
* agencies
* moderators
* developers

⸻

Launch #4

Community Commerce Launch

Focus:

* shared storefronts
* coalition communities
* creator collectives

⸻

MONTH 6 TARGETS

KPI	Goal
Revenue	$350k–$750k/month
Creators	10,000+
Paid communities	1,500+
Vendors	2,000+
Plugin creators	500+

⸻

MONTH 7–12

INFRASTRUCTURE + RETENTION PHASE

PRIORITIES

FBM

Task	Completion Goal
B2B systems	70%
White-label APIs	60%
Creator coalition tooling	80%
Advanced analytics	90%

#### FBM — Existing Module Leverage (Month 7–12)

| Calendar item | Existing FBM module(s) |
|---|---|
| Creator coalition tooling | `cooperative`, `governance`, `volunteer` |
| B2B foundation seed | `buyer-network`, `marketplace-listing`, `demand-pool`, `bargaining` |
| Advanced analytics seed | `impact-metrics` + cross-cutting event taxonomy |

#### FBM — Additional Workstreams (Month 7–12)

| Task | Completion Goal | Source |
|---|---|---|
| Invoicing module | 80% | `FEATURE_BUILD_PLAN.md` §5 "Invoicing" (lines 298–315) |
| Merchant support module + SLA tooling | 80% | `FEATURE_BUILD_PLAN.md` §6 (lines 317–332) |
| Risk / fraud monitoring | 70% | `FEATURE_BUILD_PLAN.md` §7 (lines 334–350) |
| Managed onboarding success program | 70% | `FEATURE_BUILD_PLAN.md` §8 (lines 356–371) |
| Marketing guidance hub | 60% | `FEATURE_BUILD_PLAN.md` §9 (lines 373–387) |
| Advanced analytics warehouse / cohort + revenue dashboards | 90% | `FEATURE_BUILD_PLAN.md` Cross-Cutting "Data & Analytics" (lines 463–466) |
| White-label API surface — design spec + alpha | 60% | greenfield; align with `tenancy` and `ROADMAP.md` |
| B2B portal extension on top of `buyer-network` | 70% | extends existing `buyer-network` + `bargaining` |
| Vendor pilot scaling per `VENDOR_PILOT_SUPPORT_RUNBOOK.md` | 80% | `docs/VENDOR_PILOT_SUPPORT_RUNBOOK.md` |
| Multi-tenant federation hardening | 70% | `tenancy` |

⸻

Blackout

Task	Completion Goal
Full plugin ecosystem	100%
Federation optimization	80%
Community AI plugin systems	80%
Mobile-first polish	90%

⸻

Blackstar

Task	Completion Goal
Vending systems	70%
Logistics coordination	70%
Node operator dashboards	80%
Ghost kitchen infrastructure	60%

⸻

INFRASTRUCTURE REINVESTMENT

BEGIN BUYING:

* servers
* storage
* GPU systems
* edge hardware
* vending infrastructure

⸻

GHOST KITCHEN OPERATIONS

PHASE 1

Partner kitchens only.

Target:

* underutilized restaurants
* churches
* local kitchens
* food trucks

⸻

PHASE 2

Creator food brands.

⸻

PHASE 3

Coalition-owned kitchens.

⸻

MONTH 12 TARGETS

KPI	Goal
Revenue	$5M–$7M/month
Creators	50,000+
Vendors	10,000+
Paid communities	5,000+
Plugin creators	2,000+
Ghost kitchen partners	50+

⸻

YEAR 2

INFRASTRUCTURE DOMINANCE PHASE

PRIORITIES

FBM

* API infrastructure
* white-label ecosystems
* B2B scaling
* advanced creator tooling

#### FBM — Additional Workstreams (Year 2)

- Academy / training delivery (`academy` module — `FEATURE_BUILD_PLAN.md` §10, lines 389–403).
- Custom farm website services productization (`website-services` — §11, lines 405–420).
- Promotional tools suite — campaigns, bundles, referral codes, abandoned-cart nudges (§12, lines 422–436).
- E-books / webinars resource library (`resources` — §13, lines 438–452); pair with the existing **Jitsi** install in `infrastructure/jitsi/`.
- Vendor Hype Operations Prediction monetization tier rollout (`vendor-hype-operations-prediction`).
- Cooperative governance scaling + DAO-style proposal flows (`governance`).
- Impact metrics → external white-label partner reporting (`impact-metrics`).
- Multi-tenant federation + per-tenant theming on top of `tenancy`.
- Cross-coalition settlement clearing on top of `hawala-ledger`.

⸻

Blackout

* ecosystem federation
* advanced identity economy
* plugin ecosystem scaling
* creator operating system

⸻

Blackstar

* vending rollout
* fulfillment networks
* storage/compute ownership
* edge infrastructure

⸻

YEAR 2 TARGETS

KPI	Goal
Monthly revenue	$30M+
Ecosystem GMV	$500M+
Creators	250,000+
Vendors	50,000+
Plugin creators	10,000+
White-label partners	100+
Node operators	5,000+

⸻

DAILY OPERATIONS SYSTEM

EVERY DAY

SOFTWARE

* ship features
* AI-assisted code generation
* bug fixing
* analytics review

⸻

MARKETING

* creator recruitment
* short-form content
* community engagement
* partnerships

⸻

SALES

* creator outreach
* vendor onboarding
* service provider onboarding

⸻

COMMUNITY

* moderation
* coalition calls
* onboarding streams
* creator showcases

⸻

ANALYTICS

Track:

* creator retention
* conversion rates
* referral performance
* plugin sales
* community revenue
* campaign ROI

⸻

MASTER PROGRESS TRACKER TEMPLATE

FBM

System	Progress
Creator affiliates	0–100%
Digital products	0–100%
Plugin marketplace	0–100%
Revenue splits	0–100%
Services marketplace	0–100%
Crop planning	0–100%
CSA systems	0–100%
POS systems	0–100%
Ghost kitchen systems	0–100%
White-label APIs	0–100%

#### FBM — Extended Master Progress Tracker (additive rows)

Existing-module rows (already shipping, instrument and report on):

| System | Progress | Backing module(s) |
|---|---|---|
| Vendor verification & KYC | 0–100% | `vendor-verification` |
| Marketplace signing | 0–100% | `marketplace-signing` |
| Demand pools | 0–100% | `demand-pool` |
| Collective campaigns | 0–100% | `collective-campaign` |
| Bargaining | 0–100% | `bargaining` |
| Cooperative governance | 0–100% | `cooperative`, `governance` |
| Buyer network | 0–100% | `buyer-network` |
| Order cycles | 0–100% | `order-cycle` |
| Hawala ledger settlements | 0–100% | `hawala-ledger` |
| Payout breakdowns | 0–100% | `payout-breakdown` |
| Vendor Hype Operations Prediction | 0–100% | `vendor-hype-operations-prediction` |
| WooCommerce / Odoo / Printful integrations | 0–100% | `woocommerce-import`, `odoo`, `printful-fulfillment` |
| Tenancy / multi-tenant | 0–100% | `tenancy` |
| Volunteer coordination | 0–100% | `volunteer` |
| Impact metrics | 0–100% | `impact-metrics` |
| Content platform | 0–100% | `content-platform` |
| Ticket booking + rental | 0–100% | `ticket-booking`, `rental` |
| Producer / garden / season / harvest | 0–100% | `producer`, `garden`, `season`, `harvest`, `harvest-batches` |
| Wishlist + donation | 0–100% | `wishlist`, `donation` |
| Food distribution + order subcontracting | 0–100% | `food-distribution`, `order-subcontract`, `supplier-forwarding` |
| Subscription billing | 0–100% | `subscription` |
| Entitlements | 0–100% | `entitlement` |
| Creator program & rewards | 0–100% | `creator-program`, `creator-rewards`, `creator-attribution` |
| Marketplace webhooks | 0–100% | `marketplace-webhooks` |

Unbuilt-workstream rows (build & track):

| System | Progress | Status |
|---|---|---|
| POS module | 0–100% | unbuilt; see `FEATURE_BUILD_PLAN.md` §1 |
| Weight-based pricing | 0–100% | unbuilt; §2 |
| Channel sync (`channel-sync`) | 0–100% | unbuilt; §3 |
| Pick-and-pack (`fulfillment-ops`) | 0–100% | unbuilt; §4 |
| Invoicing | 0–100% | unbuilt; §5 |
| Merchant support | 0–100% | unbuilt; §6 |
| Risk / fraud monitoring | 0–100% | unbuilt; §7 |
| Managed onboarding success | 0–100% | unbuilt; §8 |
| Marketing guidance hub | 0–100% | unbuilt; §9 |
| Academy / workshops | 0–100% | unbuilt; §10 |
| Website services | 0–100% | unbuilt; §11 |
| Promotional tools suite | 0–100% | unbuilt; §12 |
| Resource library (e-books/webinars) | 0–100% | unbuilt; §13 |
| Vendor activation TTFLL wizard (Sprints A/B/C) | 0–100% | partially specced; see `FEATURE_BUILD_PLAN.md` Activation Sprints |
| Advanced analytics warehouse | 0–100% | unbuilt; Cross-Cutting §Data & Analytics |
| B2B portal | 0–100% | unbuilt; greenfield on top of `buyer-network` |
| White-label API surface | 0–100% | unbuilt; greenfield on top of `tenancy` |

⸻

Blackout

System	Progress
Paid communities	0–100%
Plugin architecture	0–100%
Theme marketplace	0–100%
Emoji marketplace	0–100%
AI plugin system	0–100%
Community discovery	0–100%
Creator dashboards	0–100%
Cross-platform bridges	0–100%
Prestige systems	0–100%
Federation scaling	0–100%

⸻

Blackstar

System	Progress
Fulfillment nodes	0–100%
Pickup systems	0–100%
Delivery coordination	0–100%
Vending systems	0–100%
Ghost kitchen integration	0–100%
Compute/storage ownership	0–100%
Edge infrastructure	0–100%

⸻

MOST IMPORTANT STRATEGIC RULE

Every feature must:

* increase monetization,
* increase retention,
* increase creator earnings,
* increase ecosystem lock-in,
* or increase infrastructure ownership.

If not:

deprioritize it aggressively.

---

## Appendix A — FBM Module Inventory & Mapping

This appendix is additive. It maps every calendar item that touches FBM to the concrete code path under `backend/src/modules/*` (and the spec doc, where one exists). Use it as the source of truth when a new contributor asks "where does X live?".

### Creator economy
| Calendar item | Module path | Spec / docs |
|---|---|---|
| Creator affiliate system | `backend/src/modules/creator-attribution` | — |
| Creator program | `backend/src/modules/creator-program` | — |
| Creator rewards | `backend/src/modules/creator-rewards` | — |
| Affiliate links API | `backend/src/api/vendor/affiliate-links/*` | — |

### Commerce primitives
| Calendar item | Module path | Spec / docs |
|---|---|---|
| Digital products | `backend/src/modules/digital-product`, `backend/src/modules/digital-product-fulfillment` | — |
| Subscription infrastructure | `backend/src/modules/subscription` | — |
| Marketplace listings | `backend/src/modules/marketplace-listing` | `docs/VENDOR_FEATURE_MATRIX.md` |
| Entitlements | `backend/src/modules/entitlement` | — |
| Wishlist | `backend/src/modules/wishlist` | — |

### Group commerce / coalition
| Calendar item | Module path | Spec / docs |
|---|---|---|
| Group commerce | `backend/src/modules/collective-campaign`, `demand-pool`, `bargaining`, `cooperative`, `buyer-network` | `docs/COLLECTIVE_BUYS_MICRO_INVESTMENT_SPEC.md` |
| Cooperative governance | `backend/src/modules/cooperative`, `backend/src/modules/governance` | — |
| Order cycles | `backend/src/modules/order-cycle` | — |
| Volunteer coordination | `backend/src/modules/volunteer` | — |

### Services / events / rentals
| Calendar item | Module path | Spec / docs |
|---|---|---|
| Services marketplace | `backend/src/modules/service-program` | — |
| Ticket booking | `backend/src/modules/ticket-booking` | — |
| Rentals | `backend/src/modules/rental` | — |

### Settlements / payouts
| Calendar item | Module path | Spec / docs |
|---|---|---|
| Revenue split rails | `backend/src/modules/payout-breakdown`, `hawala-ledger` | — |

### Identity / trust
| Calendar item | Module path | Spec / docs |
|---|---|---|
| Vendor verification & KYC | `backend/src/modules/vendor-verification` | — |
| Marketplace signing | `backend/src/modules/marketplace-signing` | — |
| Vendor rules | `backend/src/modules/vendor-rules` | — |
| Work verification | `backend/src/modules/work-verification` | — |

### Agriculture / CSA / food
| Calendar item | Module path | Spec / docs |
|---|---|---|
| Crop planning | `backend/src/modules/agriculture`, `garden`, `season` | — |
| Producers / harvests | `backend/src/modules/producer`, `harvest`, `harvest-batches` | — |
| CSA / food distribution | `backend/src/modules/food-distribution` | `backend/src/modules/food-distribution/README.md` |
| Ghost kitchens | `backend/src/modules/kitchen`, `restaurant`, `order-subcontract`, `supplier-forwarding` | — |

### Omnichannel / integrations
| Calendar item | Module path | Spec / docs |
|---|---|---|
| WooCommerce sync | `backend/src/modules/woocommerce-import` | — |
| Odoo ERP integration | `backend/src/modules/odoo` | — |
| Printful POD | `backend/src/modules/printful-fulfillment` | — |
| Webhooks | `backend/src/modules/marketplace-webhooks` | — |

### Fulfillment / delivery
| Calendar item | Module path | Spec / docs |
|---|---|---|
| Fulfillment hooks | `backend/src/modules/blackstar-fulfillment`, `blackstar-fulfillment-provider` | — |
| Local delivery | `backend/src/modules/local-delivery-fulfillment`, `delivery` | — |

### Forecast / impact
| Calendar item | Module path | Spec / docs |
|---|---|---|
| Vendor Hype Operations Prediction | `backend/src/modules/vendor-hype-operations-prediction` | `docs/VENDOR_HYPE_OPERATIONS_PREDICTION_WHITEPAPER.md` and the full `VENDOR_HYPE_OPERATIONS_PREDICTION_*` series |
| Impact metrics | `backend/src/modules/impact-metrics` | — |

### Platform
| Calendar item | Module path | Spec / docs |
|---|---|---|
| Tenancy / multi-tenant | `backend/src/modules/tenancy` | — |
| File / object storage | `backend/src/modules/minio-file` | — |
| Email / SMTP / Resend | `backend/src/modules/smtp`, `resend` | — |
| CMS blueprint | `backend/src/modules/cms-blueprint` | — |
| Content platform | `backend/src/modules/content-platform` | — |

---

## Appendix B — Open-Source Adoption Map for Unbuilt FBM Workstreams

For every unbuilt FBM workstream the calendar names, this table recommends a primary OSS project to fork, embed, or crib patterns from, plus viable alternates. License is listed; **AGPL/SSPL and similar strong-copyleft items are sidecar-only or pattern-only — never compiled into `backend/src/modules/*` source** without legal review.

### Selection principles
1. **Permissive (MIT/Apache/BSD) > weak-copyleft (LGPL/MPL) > strong copyleft (GPL/AGPL).** Strong-copyleft items are deployed as sidecar microservices behind an HTTP API or used purely as pattern reference.
2. Prefer projects with **active commits in the last 90 days** and **≥1k GitHub stars** unless the niche is small (e.g. CSA / agri tools).
3. Prefer projects whose **data model can be expressed as a Medusa module** so we end up with one event bus, one auth model, one ledger.
4. When two projects tie, choose the one already adjacent to FBM's stack (Postgres, Node/TS, Redis) to avoid a polyglot tax.

### Core unbuilt workstreams

| Unbuilt workstream | Primary OSS recommendation | License | Alternates |
|---|---|---|---|
| **POS module** | **uniCenta oPOS** (`https://github.com/poin/unicenta-opos`) — mature web/desktop POS, hardware-friendly | GPL-3.0 | **Odoo POS** (already integrated via `odoo` module; LGPL/AGPL); **Open Source POS** (`https://github.com/opensourcepos/opensourcepos`, MIT); **Floreant POS** (restaurant-focused, `https://github.com/floreantpos/floreantpos`, MPL-2.0) |
| **Weight-based pricing** | **OCA `sale_order_variable_quantity`** (`https://github.com/OCA/sale-workflow`) — Odoo Community Association weighted-quantity patterns | AGPL-3.0 | PrestaShop "Variable Quantity" community modules (OSL-3.0); copy patterns into a Medusa price-calculation workflow |
| **Channel-sync (real-time inventory/order sync)** | **Debezium** (`https://github.com/debezium/debezium`) for Postgres CDC + Apache Kafka topics | Apache-2.0 | **Saleor** (`https://github.com/saleor/saleor`, BSD-3) — already-built multi-channel model to crib; **Vendure** (`https://github.com/vendure-ecommerce/vendure`, MIT); **n8n** (`https://github.com/n8n-io/n8n`, Sustainable Use) for connector glue |
| **Pick-and-pack (`fulfillment-ops`)** | **OpenBoxes** (`https://github.com/openboxes/openboxes`) — purpose-built WMS with pick lists, packing slips, substitutions | Eclipse-1.0 | **ERPNext Stock** (`https://github.com/frappe/erpnext`, GPL-3.0); **Tryton stock_inventory** (GPL-3.0) |
| **Invoicing** | **Invoice Ninja** (`https://github.com/invoiceninja/invoiceninja`) — modern PHP/Laravel invoicing, PDF + email + payment recon | Elastic-2.0 (review) | **Crater** (`https://github.com/crater-invoice/crater`, AGPL-3.0); **Akaunting** (`https://github.com/akaunting/akaunting`, GPL-3.0); **InvoicePlane** (MIT but stagnant) |
| **Merchant support / case management** | **Chatwoot** (`https://github.com/chatwoot/chatwoot`) — modern Rails, REST + webhooks, multichannel inbox | MIT | **FreeScout** (`https://github.com/freescout-helpdesk/freescout`, AGPL-3.0); **Zammad** (`https://github.com/zammad/zammad`, AGPL-3.0); **UVdesk** (`https://github.com/uvdesk/community-skeleton`, MIT) |
| **Risk / fraud monitoring** | **Drools rules engine** (`https://github.com/kiegroup/drools`) for the rules layer + **MaxMind GeoLite2** (`https://github.com/maxmind/GeoIP2-node`) for IP/geo signals | Apache-2.0 / proprietary-redistributable | **Apache Flink CEP** (Apache-2.0) for streaming velocity rules; **Stripe Radar** webhook events as upstream signal |
| **Managed onboarding success** | **Plane** (`https://github.com/makeplane/plane`) — modern issue/cycle/milestone tracker, embed via API | AGPL-3.0 (review) | **Focalboard** (`https://github.com/mattermost/focalboard`, MIT/Custom); **OpenProject** (`https://github.com/opf/openproject`, GPL-3.0); **Vikunja** (`https://github.com/go-vikunja/vikunja`, AGPL-3.0) |
| **Marketing guidance hub** | **Mautic** (`https://github.com/mautic/mautic`) — embeddable marketing automation, playbooks, campaigns | GPL-3.0 | **listmonk** (`https://github.com/knadh/listmonk`, AGPL-3.0) for newsletters; **PostHog** (`https://github.com/PostHog/posthog`, MIT) for funnel guidance |
| **Academy / training (`academy` module)** | **Moodle** (`https://github.com/moodle/moodle`) — most mature LMS; courses, certificates, SCORM | GPL-3.0 | **Open edX** (`https://github.com/openedx`, AGPL-3.0); **Forem** (`https://github.com/forem/forem`, AGPL-3.0); pair with **BigBlueButton** (`https://github.com/bigbluebutton/bigbluebutton`, LGPL-3.0) for live workshops, or reuse the existing **Jitsi** in `infrastructure/jitsi/` |
| **Website services productization** | **Plane** for project tracking + **Penpot** (`https://github.com/penpot/penpot`) for design handoff | AGPL-3.0 / MPL-2.0 | **OpenProject** (GPL-3.0); **Kanboard** (`https://github.com/kanboard/kanboard`, MIT) |
| **Promotional tools suite** | **Medusa core promotions module** (already a dependency) — extend, do not replace | MIT | **GrowthBook** (`https://github.com/growthbook/growthbook`, MIT) for A/B campaign measurement; **Saleor promotions** patterns (BSD-3) |
| **Resource library (e-books/webinars)** | **Strapi** (`https://github.com/strapi/strapi`) headless CMS for gated assets | MIT (community edition) | **Ghost** (`https://github.com/TryGhost/Ghost`, MIT) for content; **Outline** (`https://github.com/outline/outline`, BSL — review); existing **Jitsi** + **BigBlueButton** for webinars |
| **Vendor activation TTFLL wizard** | **react-step-wizard** (`https://github.com/jcmcneal/react-step-wizard`) + **React Hook Form** (`https://github.com/react-hook-form/react-hook-form`) | MIT / MIT | Reference **Saleor Dashboard** onboarding flows (BSD-3); **Vendure Admin UI** wizards (MIT) |
| **Advanced analytics warehouse** | **ClickHouse** (`https://github.com/ClickHouse/ClickHouse`) + **Cube** (`https://github.com/cube-js/cube`) semantic layer + **Metabase** (`https://github.com/metabase/metabase`) BI | Apache-2.0 / Apache-2.0 / AGPL-3.0 | **Apache Superset** (`https://github.com/apache/superset`, Apache-2.0); **PostHog** (MIT) for product analytics standalone; **DuckDB** (`https://github.com/duckdb/duckdb`, MIT) for embedded |
| **B2B portal** | **Vendure B2B starter** (`https://github.com/vendure-ecommerce/vendure`) — quote workflow, account hierarchies, MIT-clean to crib from | MIT | **Sylius B2B Suite** (`https://github.com/Sylius/Sylius`, MIT); **Spree** (`https://github.com/spree/spree`, BSD-3); **Saleor** B2B features (BSD-3); **Akeneo PIM** (`https://github.com/akeneo/pim-community-dev`, OSL-3.0) for catalog |
| **White-label API surface** | **Kong Gateway** (`https://github.com/Kong/kong`) — multi-tenant routing, key auth, rate limits, plugin model | Apache-2.0 | **KrakenD CE** (`https://github.com/krakend/krakend-ce`, Apache-2.0); **Tyk** (`https://github.com/TykTechnologies/tyk`, MPL-2.0); pair with the existing `tenancy` module for key/tenant binding |

### Bonus mappings — calendar items where OSS leverage helps fill gaps in already-built modules

| Calendar item | OSS to evaluate | License | Notes |
|---|---|---|---|
| **CSA systems** (`agriculture` + `food-distribution`) | **Open Food Network** (`https://github.com/openfoodfoundation/openfoodnetwork`) | AGPL-3.0 | Native CSA share boxes, drop-points, producer billing — closest to FBM's coalition model |
| **Crop planning** (deepen `agriculture` / `garden` / `season`) | **LiteFarm** (`https://github.com/LiteFarm/LiteFarm`) | GPL-3.0 | Cooperative farm planning + crop rotation; or **farmOS** (`https://github.com/farmOS/farmOS`, GPL-2.0); or **Tania** (`https://github.com/Tanibox/tania-core`, Apache-2.0, archived but referenceable) |
| **Ghost kitchen ops** (extend `kitchen` + `restaurant`) | **Floreant POS** (`https://github.com/floreantpos/floreantpos`) for kitchen-side ticketing | MPL-2.0 | Existing `kitchen` module covers orchestration; Floreant fills the FOH/BOH ticket gap |
| **Live workshops / community calls** | **Jitsi Meet** (already vendored under `infrastructure/jitsi/`) | Apache-2.0 | Already in-tree; default to Jitsi before reaching for BigBlueButton |
| **Webhook reliability / connector glue** | **n8n** (`https://github.com/n8n-io/n8n`) | Sustainable Use License | Useful for low-code creator → coalition integrations alongside Medusa events |

---
