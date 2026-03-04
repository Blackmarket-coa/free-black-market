# Free Black Market — Collective Buys & Micro-Investment System

## Purpose
This document captures the full product specification for extending the existing Collective Buys feature into a direct-to-supplier funding and micro-investment system.

## 1) Vision
Build a crowdfunded production and productive-asset investment system for freeblackmarket.com that removes capital barriers for vendors while preserving backer trust through direct supplier purchasing and transparent execution.

- Funds do **not** go to vendors.
- Funds are used to purchase approved campaign materials directly from suppliers.
- The platform supports both fixed production runs and ongoing productive assets.

## 2) Non-Negotiable Design Constraint
**Direct-to-supplier funding:** campaign funds never touch vendor hands for material purchases.

When funding is complete:
1. purchase orders are created from campaign material line items,
2. supported supplier purchases are auto-executed,
3. unsupported sources are fulfilled through manual fallback,
4. tracking/receipt data is written back to the campaign dashboard.

## 3) Campaign Types

### A. Production Run Campaign
For one-time batches of finished products.

State machine:
`Draft → Active → Funded → Sourcing → Materials Received → Producing → Fulfilling → Selling → Complete`

Failure/dispute branches:
- `Active → Failed` (goal not reached)
- Any post-funded state → `Disputed`

### B. Productive Asset Campaign
For infrastructure/assets with recurring yield.

State machine:
`Draft → Active → Funded → Asset Acquisition → Establishment → Producing → Yielding → Mature`

Failure/dispute branches:
- `Active → Failed` (goal not reached)
- Any post-funded state → `Disputed → Wind Down` (if unresolved)

## 4) Campaign Creation Requirements

### Common fields
- Name, description, media
- Campaign type
- Batch minimum (production) or funding goal (asset)
- Maker fee
- Estimated production time
- Shipping per unit / pickup flag
- Return cap multiplier (micro-investors)

### Material line items (required)
Per item:
- Item name
- Supplier URL
- Unit cost at listing time
- Quantity per output unit
- Quantity per full campaign
- Auto-purchase support flag

Derived calculations:
- Total material cost
- Maker fee subtotal
- Platform fee (3%)
- Shipping subtotal
- Campaign goal and per-unit backer cost

### Productive asset fields
- Asset type
- Productive lifespan
- Yield per cycle
- Cycle frequency
- Time to first yield
- Compounding profile
- Projected return curve over time

## 5) Funding & Payout Model

### Backer modes
- **Pre-order backers:** buy finished units.
- **Micro-investors:** fund unsold capacity and receive revenue/yield share.

Campaign success requires full goal funding (materials + maker fee + platform fee + shipping).

### Fees
- Platform fee: **3% flat** for successful campaigns.

### Return caps
- Vendor chooses return cap (e.g., 2x, 3x, 5x).
- Investor payouts stop when cap is reached.

### Production run payout pool
Post-sale revenue is split using campaign math with investor share proportional to invested pool percentage until cap is reached.

### Productive asset payouts
Ongoing cycle-based entitlements delivered as:
- physical redemption, or
- cash-equivalent settlement.

## 6) Purchasing Pipeline

### Auto-purchase path
Supported suppliers are auto-ordered after funding.

### Manual fallback
Unsupported suppliers generate actionable POs for operator execution or restricted virtual-card purchase.

### Purchase order object (minimum fields)
- campaign_id
- line_items[] with item/budget/actuals
- order confirmations
- tracking + carrier
- ETA + delivery status

### Monitoring & variance
- Price/stock checks while campaign is Active.
- Verified badge for stable/in-stock materials.
- Variance policy:
  - <5% absorbed in buffer,
  - >=5% pauses line and requires vendor action.

## 7) Reputation-Gated Maker Fee Release

- **Tier 1:** maker fee escrowed, 10–15% advance at material receipt, campaign cap $500.
- **Tier 2:** 50/50 release at material receipt and fulfillment, cap $2,000.
- **Tier 3:** 75/25 release, cap $5,000.
- **Tier 4:** 100% release at material receipt, no cap.

Demotions:
- One dispute: drop one tier.
- Two unresolved disputes in a row: reset to Tier 1.
- Abandonment: suspend new campaigns pending resolution.

## 8) Backer Dashboard Requirements

- Funding progress and allocation breakdown.
- Sourcing timeline with line-item shipment status.
- Production updates and revised completion estimate.
- Fulfillment status (pre-order) and sales progress (investors).
- Investor payout tracker with cap progress.
- Productive asset yield reports and cycle projections.

Must hide:
- private vendor personal data,
- non-public internal dispute communications,
- cross-backer identity exposure.

## 9) Product-Backed Token Layer (Productive Assets)

- Fixed token supply per productive-asset campaign on low-fee EVM chain.
- Metadata includes: asset type/location/yield expectations/vendor identity reference/creation date.
- Token grants proportional output entitlement.
- Token value anchored to measurable output, not pure speculation.
- Token transfer/trade supported on-platform.

Wallet support:
- Connected self-custody wallet,
- or platform custodial abstraction for non-crypto users.

Yield oracle behavior:
- Yield reports update backing metrics and payout accounting each cycle.

## 10) Hawala + Dual-Rail Settlement

Funding rails:
- Fiat (Stripe Connect)
- Crypto (smart contract escrow)

Settlement options:
- Local physical redemption
- Local fiat equivalent
- Remote fiat via Stripe or hawala network
- On-chain crypto payout for crypto-native holders

All movements must be recorded for auditability and dashboard transparency.

## 11) Cross-Campaign Material Aggregation

- Normalize material demand across campaigns.
- Surface potential pooled buying opportunities.
- Apply volume discount breakpoints.
- Allocate savings proportionally back to campaigns.

## 12) Escrow, Disputes, and Safety

- All-or-nothing funding windows (14/21/30 days).
- Optional minimum viable threshold support.
- Milestone misses can trigger backer-voted freeze of remaining escrow.
- Quality claims require evidence and affect vendor reputation.
- Underperforming productive assets can trigger holder vote: continue, remediate, or wind down.

## 13) Technical Integration Targets

### Stack alignment
- MedusaJS v2 + MercurJS (existing)
- PostgreSQL (existing)
- Railway (existing)
- Stripe Connect (fiat escrow)
- Low-fee EVM contracts (token + crypto escrow)
- Supplier APIs + manual fallback ops tooling
- Existing hawala module for cross-border settlement

### Core entities
- `Campaign`
- `MaterialLineItem`
- `Backing`
- `PurchaseOrder`
- `VendorReputation`
- `ProductiveAssetToken`
- `YieldReport`

## 14) MVP Phasing

### Phase 1 (build first)
- Campaign creation with material line items
- Pre-order funding + sourcing + tracking
- Reputation tier fee release
- Real-time dashboard for funding/sourcing/production/fulfillment
- Stripe escrow milestone releases
- 3% fee processing
- Semi-automated purchasing (API + manual fallback)

### Phase 2
- Micro-investor flow + return caps
- Productive-asset campaign type
- ERC-1155 issuance and basic wallet abstraction
- Yield reporting and projected return curves

### Phase 3
- Hawala settlement integration for remote payouts
- Dual-rail unified funding
- Cross-campaign bulk input aggregation
- Token transfer/trading UX
- Advanced dispute voting and yield-oracle hardening

## 15) Acceptance Criteria (MVP)

1. A production campaign can be created with material line items and calculated goal.
2. Campaign transitions through funding and sourcing with PO + tracking visibility.
3. Vendor maker-fee release follows tier gating and milestone state changes.
4. Backers can observe end-to-end status updates from funding to fulfillment.
5. Failed campaign triggers full refund path.
6. Dashboard surfaces investor payout metrics for funded production-run inventory.

---
This specification defines the implementation baseline for the Collective Buys expansion focused on trust, transparency, and productive community wealth building.
