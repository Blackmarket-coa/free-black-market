# FBM monetization plan

**Updated:** November 21, 2026  
**Status:** Current planning policy and conditional revenue model. This documentation does not change production pricing, billing or availability.

**Authority:** [Resource Exchange Charter](FBM_RESOURCE_EXCHANGE_CHARTER.md) · [Shared game/creator plan](FBM_COALITION_GAME_AND_CREATOR_COMMERCE_PLAN.md) · [Ecosystem financial analysis](BMC_ECOSYSTEM_FINANCIAL_ANALYSIS.md)

## Revenue model

| Revenue family | Treatment |
|---|---|
| Third-party goods, local food, services and supported digital products | Fixed 3% Coalition commission after processing; reverse applicable fee on refunds. No second Blackout/Blackmask fee. |
| Existing founder-owned enhancements, equipment and portal tools | One-time product sales; founder/BMC owns proceeds after costs/refunds. Do not add an internal 3% to consolidated revenue. |
| Community-created quests, storefront templates, original art/copies and compatible game packs | Creator proceeds belong to creators; BMC receives the applicable single transaction fee. Creation, payload delivery, rights and installation must work before sale. |
| Supported purchased-item transfers | Proposed experience; no assumed resale, transfer fee or royalty until license, recipient access, financial terms and implementation are explicit. |
| Finite setup, training, branding and integration | One-time scoped services. Prefer community service providers where practical; their receipts do not become BMC's revenue. |
| Sponsorship and funded community roles | Disclosed finite deliverables and funded budgets. Only BMC's contracted delivered service portion is platform revenue. |
| Hosted/external resources | Transparent at-cost pass-through under the charter; no invented software subscription or hosting profit. |

Software enhancements are one-time purchases for the disclosed version/scope. Buying equipment, accumulating XP or reaching a KARMA tier never changes the 3% commission. Core E2EE and personal records are not enhancement paywalls. Game progress does not buy authority. Earned products can replace a purchase and must be excluded from paid conversion counts.

## Conditional 2027 projections

The [canonical ecosystem model](BMC_ECOSYSTEM_FINANCIAL_ANALYSIS.md) covers FBM, Blackout and Blackmask together, counts unique members once, and separates marketplace GMV from platform revenue.

| Scenario | Annual ecosystem BMC revenue | Surplus before founder pay/tax |
|---|---:|---:|
| Downside | $1,461 | -$2,492 |
| Base | $17,318 | $7,630 |
| Upside | $125,802 | $84,334 |

These are not three FBM-only forecasts. Base first-party FBM revenue is approximately $3,576 under a 40% allocation of shared first-party units at a proposed $25 average price. The base ecosystem includes $5,098 in retained marketplace commission across all origin apps; it must not be counted separately in each app's financial totals.

The starting inputs are founder-reported 26,000 followers and $250/month total current costs. Registration, activation, local supply, purchasing, net growth, costs and launch months are assumptions. Base annual surplus falls to about -$4,370 after valuing 40 unpaid founder hours/month at $25/hour. Prices in the model are candidate experiments, not approved or published prices.

## Priorities and release evidence

Start with working founder-owned products and ordinary local exchanges, then one complete creator download and supported game-pack journey. Close the shared metadata-only listing/payload, draft-resume, content-to-offer, signed delivery, authorization, refund and settlement gaps. Preserve existing purchase history and reconcile legacy recurring plans and expiring rights through a separately verified migration.

Before native digital sales, verify the permitted billing route and actual channel charges. The model tests a 15% native fee and a 30% case; neither replaces store-specific terms. Verify actual Stripe/Connect configuration and who bears each charge. Keep the fixed commission intact rather than silently absorbing unpriced costs.

Run `node docs/finance/project-revenue.mjs` for the three scenarios and reconciliation checks. Update its documented inputs with real transaction and cost data after launch.

