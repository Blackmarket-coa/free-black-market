# Transmutation Strategy — the joint-stock brief reconciled against the code

Status: **code-verified 2026-09-09** against `free-black-market` `e78da62`,
`blackout` `7818598` and `Blackstar` `304c736`. Two guards ride with this
document — §7.1 and §7.2 — and nothing else. Every other recommendation is
sequencing, wiring or content for an operator to schedule.

This takes the transmutation brief — study what made colonial joint-stock
companies expand fast, borrow the ethically transferable mechanisms, and add
two business lines (vendors as community-funded ventures; deconstruction and
salvage) — and reconciles each claim against what is actually in
`backend/src/modules/`, `backend/src/api/`, the storefront, the vendor panel
and the two sibling repositories. It follows the method of
`docs/CDFI_COOP_ROADMAP.md`: every row was checked by opening files, not by
matching module names.

It does **not** supersede `docs/REPO_CONSOLIDATION_REVIEW.md` (decisions
D1–D8 and the legal gates in its §8) or `docs/POSTURE_A_COMPLIANCE.md` (the
money-movement frame). Where this document and either of those could
conflict, they win and this one is wrong. The ethical frame the brief
established — no coercion, no externalised violence, no non-consensual
extraction — is treated here as a fixed constraint, not an open question,
and §2 restates it in the vocabulary the codebase already uses for
constraints of that kind: a guard that throws.

**The headline finding: the brief's two "new" business lines are both
substantially modelled already, and the growth mechanisms it recommends are
the part that is missing — but not in the way it expects.** Business line 1
(vendors as community-funded ventures) exists as `modules/collective-campaign`:
seven models, migrations, four store routes, an admin escrow-resolution route,
and a ledger escrow path. Its `Backing` model already carries
`investor_pool_share`, `payout_cap_amount` and `payout_released_amount` — a
revenue-share cap table, which the brief lists as net-new work. Business
line 2's marketplace surface is likewise already modelled: a
`CIRCULAR_ECONOMY` product archetype described in its own source as
"repaired goods, salvaged materials — condition-graded", seeded by migration,
with `condition-grade`, `repair-history` and `original-manufacturer`
attributes and a `salvaged-materials` category in the CMS blueprint seed.

What is genuinely missing is smaller and sharper than the brief's gap table,
and two of the gaps are the opposite of what it says. The internal share
exchange should not be built at all (§3.3). The Mondragon capital-pool
recommendation has an existing, better answer in the tree that pools
*loan-readiness* rather than money (§5.5). And three findings run the other
way — against the strategy rather than merely correcting it:

1. **A public page offers investment returns on a model the compliance
   document calls quiescent.** `/invest` is footer-linked and says "Earn
   returns", "Invest as little as $1", returns "as cash, revenue share, or
   product credits". Behind it, `POST /vendor/hawala/pools` let a seller create
   an `ACTIVE` pool with a chosen ROI type behind seller auth alone, and
   `POST /store/hawala/investments` let a customer fund one from an ACH-topped
   wallet — with no feature flag anywhere in the path, while
   `docs/POSTURE_A_COMPLIANCE.md` recorded the model as quiescent pending a
   securities exemption. §7.2. **This document ships the flag for it.**
2. **One environment variable crosses a recorded legal gate.**
   `docs/REPO_CONSOLIDATION_REVIEW.md` §8 gates revenue-share cash-in on Reg CF
   work and says so in words chosen to forbid exactly this: "These are hard
   release gates, not configuration toggles." `FBM_CAMPAIGN_ESCROW_LIVE=1` is a
   configuration toggle, and nothing in the escrow path distinguishes a
   `MICRO_INVESTOR` backing from a `PRE_ORDER` one. §3.2.
3. **Money buys reputation, and reputation is advertised to buy money back.**
   Backing a campaign awards 1 XP per dollar deployed
   (`subscribers/progression-campaign-backed.ts`), and the character sheet
   advertises "Reduced Commission" at Producer level 5
   (`progression/thresholds.ts:42`). The brief requires these two systems stay
   structurally separate. §3.4.
4. **Six privileges are displayed as unlocked and none is enforced.**
   Every `featureKey` in `THRESHOLD_PRIVILEGES` has zero references outside its
   own file and unit test. The character sheet renders them. §1a.

The last is the one that bears hardest on the brief's own sixth
recommendation, "infrastructure before belief". The myth is already
outrunning the code — not in marketing copy, but in shipped product surface.

---

## 1. Corrections — the brief against the code

Rows are ordered by how much the correction changes the plan.

| Claim in the brief | What the code says | Consequence |
| --- | --- | --- |
| **A cap-table/equity-ownership data model is missing, "distinct from transaction history", and must be built** | `modules/collective-campaign` ships seven models with migrations (`Migration20260304120000CreateCollectiveCampaign.ts`): `Campaign`, `MaterialLineItem`, `Backing`, `PurchaseOrder`, `VendorReputation`, `ProductiveAssetToken`, `YieldReport`. `Backing` (`models/backing.ts`) carries `mode` (`PRE_ORDER` \| `MICRO_INVESTOR`), `amount`, `investor_pool_share` (float), `payout_cap_amount` and `payout_released_amount`, with status `PLEDGED \| REFUNDED \| SETTLED`. That is a revenue-share register with cap tracking. Four store routes exist under `api/store/collective/campaigns/**` (list/create, detail, `backings`, `purchase-orders`) plus `api/admin/collective/campaigns/[id]/resolve-escrow`, `lib/campaign-escrow.ts`, a `links/order-collective-campaign.ts` link and a `subscribers/progression-campaign-backed.ts` subscriber. `service.ts` is 394 lines implementing a twelve-state campaign machine. `docs/COLLECTIVE_BUYS_MICRO_INVESTMENT_SPEC.md` is its 249-line spec. | **Extend `collective-campaign`; do not build a cap table.** The gap is not the data model — it is that the model registers a *revenue-share claim against a campaign*, not *equity in a vendor*, and those are different instruments with different law. Deciding which one BMC is offering is the real first task, and §3.1 argues the campaign-scoped one is both already built and the safer instrument. |
| **The primary blocker is a legal wrapper (Reg CF vs Reg D vs state co-op statute vs revenue-share notes) that does not exist yet** | The gate exists and is canonical. `docs/REPO_CONSOLIDATION_REVIEW.md` §8: "**Coalition investing and revenue-share subscriptions**: the EconomicUnit/claim modeling may be designed, but no cash-in/cash-out code path ships before the compliance work completes (Reg CF requirements for revenue-share; CSA-style claim framing for production claims). These are hard release gates, not configuration toggles." `docs/COMMERCE_ROADMAP.md` §4 repeats it. What does not exist is the *answer*, not the recognition. | **Re-frame the task.** The brief asks for a decision that is already scheduled; what it must supply is the content of that decision. And §3.2 records that the gate is currently crossable by an env var, which is a defect against §8 as written, not a new policy question. |
| **An internal capital market where vendor shares trade inside BMC is "the most technically ambitious net-new subsystem in this entire plan"** | Technically ambitious is the wrong axis. A venue that matches buyers and sellers of securities is an exchange; operating one in the US means registering as a national securities exchange or an alternative trading system under Reg ATS, which in turn requires broker-dealer registration and FINRA membership. That is not a build problem a solo operator solves with an order-matching engine. The repo has already reasoned about an adjacent case and refused it: §8 shelves Coliseum betting — "No money staking on debate outcomes under any framing." | **Do not build it, and record the refusal.** §3.3. The transferable part of the idea — liquidity for a backer who wants out — has a non-exchange answer (transfer-with-issuer-consent, capped and off-venue) that does not create a market. |
| **`connect.js` has three tiers, Seed free / Root $29mo / Canopy $99mo+3%, and Canopy is the natural home for a paid raise-capital feature** | The prices are right, the names are wrong, and the fee direction is inverted. Vendor monetization lives in `modules/vendor-plan`, not `connect.js`. `vendor-plan/catalog.ts` seeds five plans: `free` ($0, `platform_fee_percent: 3`), `starter` ($2900/mo, **2.5**), `pro` ($9900/mo, **2**), `scale` ($24900/mo, **1.5**), `internal` (hidden, `null`). Paid plans *reduce* commission; none adds 3%. `connect.js` is a buyer-facing storefront embed in `storefront/public/` — 1,205 lines, pinned at `v2.0.0` with an SRI hash and a test that fails the build on drift — supporting nine `data-fbm` kinds (`products`, `services`, `digital`, `booking`, `events`, `reviews`, `vendor`, `chat`, `demand-pools`) with no plan, tier, price or subscription concept anywhere in the file. (`mutual-aid` is a *proposal* in `docs/CDFI_COOP_ROADMAP.md`, not an implemented kind.) Root and Canopy are real BMC names — but they are KARMA tiers in `progression/grower-karma.ts`, Seedling / Sprout / Root / Canopy / Ancestor, carrying payout `split_pct` from 0.60 to 0.72. The brief has fused two unrelated ladders. | **Attach a capital-raise feature to `vendor-plan` as a twelfth `VendorFeatureKey`, not to `connect.js`.** Drop the Seed/Root/Canopy naming — reusing Canopy for billing would make it mean two different money things on two screens. Drop "+3%" outright: pricing a $99 tier at 3% inverts the ladder and fails `vendor-plan/__tests__/catalog.unit.spec.ts`, which asserts no plan exceeds 3% and that the ladder falls monotonically. And correct the public claim to what the code keeps — "3% is the default and the ceiling, never raised" — before someone else finds the 5% default on demand-pool group purchases (`api/admin/collective/demand-pools/[id]/route.ts`). |
| **KARMA/XP is "intentionally NOT tied to commission tiers", and reputation and capital must remain structurally separate** | The separation is intact only because the coupling was never implemented. `progression/thresholds.ts:42` declares `producer.reduced-commission` — "Reach Producer level 5 for a lower cooperative commission rate." In the other direction, `subscribers/progression-campaign-backed.ts` awards `Stance.INVESTOR` XP at 1 XP per dollar for a `MICRO_INVESTOR` backing, and `thresholds.ts:50` declares `investor.priority-campaigns` — "Reach Investor level 3 for early access to new campaigns." Deploy capital, gain XP, gain earlier access to the next capital deployment. | **Close the loop deliberately in one direction and delete the other.** §3.4. XP for *money deployed* is the coupling that matters legally; XP for *documentation completed* is the trust signal the brief actually wants. Both changes are small and both are definition-level. **Both halves deleted 2026-09-10**; the documentation signal is still to build. |
| **The Vendor Quest Engine has 13 quests in four families, and the quest pattern can carry compliance checklists** | 14 quests, four families: Capital & Funding (4), Certification & Trust (3), Cooperative & Mission (4), Market Access & Growth (3). `fiscal-sponsorship-readiness` was added since the CDFI roadmap, which recommended it. The substrate defect that roadmap recorded in its §1a — five fields initialised and never assigned, making Q5/Q7/Q13 unfinishable — has since been **fixed**: `substrate/build.ts` now assigns `wholesale_relationships` from `countWholesaleRelationships(tiers)` and `total_xp`/`dispute_count` at lines 281-282, and `substrate/__tests__/operating.unit.spec.ts` covers `summarizeOrders` precisely because "packets printed `orders_fulfilled: 0` as a fact". | **Use the engine; the objection to using it has been retired.** Adding a quest is a definition change. The open question is not capability but pricing — see §4.4 on charging for a safety checklist. |
| **Blackstar's mesh routing, reverse-auction bidding and micro-depot relays already exist and are an "ideal fit" for salvage freight** | Blackstar's own `CONSOLIDATION.md` says the opposite, in the repo's words: the "Network Advantage Engine" features — "mesh routing, batch aggregation, micro-depots, reverse-auction mechanics" — "exist as design docs only" (`api/docs/network-advantage-engine.md`). What is real is the board/claim/bid/leg data model and the per-partner HMAC bridge. The bridge is dark by default (`FBM_BLACKSTAR_INTEGRATION=0`). | **Re-sequence; it is not near-term.** `CONSOLIDATION.md` already records the ordering, pointing at `docs/CDFI_COOP_ROADMAP.md` §3.9: an FBM depot listing first, then a depot node kind a `ShipmentLeg` can hand off to, then pooling. Salvage freight does not unfreeze Blackstar; it queues behind the same three steps. §4.3. |
| **A materials grading/certification workflow is net-new and "distinct from FBM's existing product verification"** | The grading vocabulary is already seeded. `product-archetype/models/product-archetype.ts:37` defines `CIRCULAR_ECONOMY` — "Repaired goods, salvaged materials — condition-graded" — seeded by `Migration20260202001SeedCommunityArchetypes.ts` and assignable through `/vendor/products/[id]/archetype`. `cms-blueprint/seed/cms-blueprint-data.ts` seeds a `condition-grade` select attribute (`Like New`, `Good`, `Fair`, `Parts Only`, `is_filterable: true`), `repair-history`, `original-manufacturer`, a `salvaged-materials` category and a `tag_salvaged` source tag. `InventoryStrategy.LOT_BASED` exists for batch goods. | **Wire, do not build.** The archetype is not offered in the vendor onboarding wizard (`vendor-panel/src/components/onboarding/launch-wizard.tsx` hardcodes four codes: `NON_PERISHABLE`, `DIGITAL`, `SERVICE`, `TICKET`), so a salvage vendor cannot self-select it during onboarding. That is the gap, and it is S. §4.1. |
| **Storage/staging must be solved by extending Blackstar's micro-depot concept onto the Coalition App map layer** | The depot noun does not exist on either side (previous row), and the brief's premise about the interface needs its own check — see §4.3. What *does* exist for "a place that holds stock" is `aid-network`'s `network_node`, which is single-seller by construction. | **Solve it as a listing first.** `docs/COMMERCE_ROADMAP.md` Tier 3.8 already plans micro-depot *listings* pending a ruling on which of `rental`/`kitchen` survives. Salvage staging is that listing with a different archetype, not a new registry. §4.3. |
| **Tax-credit/donation-receipt tooling is net-new, "closer to nonprofit accounting than anything in FBM's current ledger"** | `modules/fund-accounting` exists behind `FF_FUND_ACCOUNTING_V1` and is sold on the `pro` plan as `vendor.fund_accounting`; `aid-network` records in-kind intake at lot level; `donation` carries a fiscal-sponsor registry. | **Smaller than claimed, but the liability question is the real one.** §4.4: FBM generating a valuation-bearing tax receipt on a nonprofit's behalf is FBM asserting a number the IRS may test, which is the underwriting posture the brief's own rule 6 forbids. |
| **BMC should adopt an internal capital pool on the Mondragon Caja Laboral model — "the single most valuable transferable colonial mechanism"** | Caja Laboral was a licensed credit cooperative. The equivalent in the US is a charter (credit union), a certification (CDFI), or a licensed lender — none available to a solo operator on this timescale, and all of them the thing `docs/CDFI_COOP_ROADMAP.md` §3.5 already refused when it disposed of insurance pooling as "not on the roadmap, deliberately" and §3.2 constrained the CDFI directory to "link out, never hand off an application, never take a fee". The tree already contains the non-custodial answer: `vendor-quest/definitions/land-pooling.ts` (Q12, "Shared Purchase / Land Pooling") aggregates *consenting members' loan-readiness* toward shared land, equipment or cold storage, gated Forming → Documented → Financing-Ready, and refers out through `partnerLinks({ kind: ["cdfi", "microlender"], serves: "farm" })`. | **Pool readiness, not money.** §5.5. This preserves the whole strategic function of Caja Laboral — members reach capital they could not reach alone — while requiring no charter, holding no deposits and taking no fee. It is the strongest single answer in the tree to the brief's central question, and it is already built. |

### 1a. Found along the way — six privileges are displayed as unlocked and none is enforced

Not in the brief, but it decides how much of the brief's growth plan is
safe to run, so it is recorded here rather than left for the next audit.

`progression/thresholds.ts` defines `THRESHOLD_PRIVILEGES`, six user-facing
unlocks with XP thresholds:

| featureKey | Promise shown to the user | Threshold |
| --- | --- | --- |
| `producer.featured-listing` | "feature a listing on the market home" | Producer L3 |
| ~~`producer.reduced-commission`~~ | ~~"a lower cooperative commission rate"~~ | ~~Producer L5~~ |
| ~~`investor.priority-campaigns`~~ | ~~"early access to new campaigns"~~ | ~~Investor L3~~ |
| `coalition.proposal-authoring` | "author governance proposals" | Coalition L3 |
| `coalition.den-moderation` | "help moderate community dens" | Coalition L5 |
| `member.market-day-queue` | "priority in market-day drops" | 2,000 lifetime XP |

**Two of the six are now deleted rather than gated** — struck through above,
removed 2026-09-10 with roadmap item 8. They were not merely unenforced; they
were the wrong promise to keep. §3.4. Four remain, all still unenforced and
therefore unpublished.

`unlockedFeatures()` (`thresholds.ts:122`) computes which are met;
`progression/service.ts:744` puts the result on the character-sheet summary
alongside `nextUnlock` for "you're close" prompting; the summary is served at
`GET /store/character` and rendered by
`storefront/src/components/organisms/CharacterSheet/GlobalProgressWatcher.tsx`,
which displays `unlockedCount`. `service.ts:753` even exposes
`getUnlockedFeatures(customerId)` and documents it as "The internal-benefit
featureKeys a customer has currently unlocked".

**Nothing calls it.** Each of the six keys had zero references anywhere in
`backend/src`, `storefront/src` or `vendor-panel/src` outside
`thresholds.ts` and `__tests__/thresholds.unit.spec.ts`. No route consults
`getUnlockedFeatures`. No commission calculation reads
`producer.reduced-commission`. No campaign route reads
`investor.priority-campaigns`. A vendor who reaches Producer level 5 is shown
"Reduced Commission — unlocked" and is charged exactly what they were charged
before.

This is the same class of defect `docs/CDFI_COOP_ROADMAP.md` found in the
donation widget and the den's "4 FBM-HOUR" kitty, but it sits on the surface
the brief wants to make the centre of recruitment. Treating the mythos as
infrastructure (the brief's recommendation 1) means these promises become
load-bearing; today they are decoration that reads as mechanism. **Fix before
amplifying, not after.** Two acceptable fixes, and the choice is the
operator's:

1. **Implement them.** Each is small on its own. Two of the six were never
   candidates for this option — `producer.reduced-commission` and
   `investor.priority-campaigns` are the coupling that must not exist, and are
   now deleted outright (§3.4). The choice below applies to the four that
   remain.
2. **Stop displaying what is not enforced.** Gate the character sheet's
   privilege list on an allowlist of keys that have a real consumer, so the
   list is empty until something honours it. This is S and is the honest
   default.

The engine itself is sound: privileges are derived and auto-lapsing, and
`unlockedFeatures` already supports the earned-vs-bought duality
(`planGrantedKeys`) that the plan ladder needs. The defect is that the
consumer side was never written.

---

## 2. The ethical frame, restated as a constraint the code can hold

The brief settled the moral boundary and asked that it be treated as fixed:
no coercion, no externalised violence, no non-consensual extraction. That is
accepted here without re-argument. What this section adds is a translation,
because a boundary that lives only in a strategy document is the weakest kind
this codebase knows how to keep.

The repo already grades its boundaries, and the grading is the useful part:

- **Enforced by a guard that throws.** `hawala-ledger/posture-a-guard.ts`
  `assertPurchaseContext` rejects a Coalition Credits transfer with no
  goods-or-services purchase context, and is reached from `createTransfer` via
  `assertRailInvariants` — the service layer deliberately, "because workflow
  hooks can be bypassed" (`posture-a-guard.ts:19-21`). `dual-rail-selector.ts`
  throws `NonCashRailError` on any attempt to settle time-bank hours as cash.
  Blackstar's `NonCustodialPaymentGuard.php` throws unconditionally on custody.
- **Stated in a docblock.** `channel-connector/catalog.ts`'s rule that no entry
  may be listed that cannot work; `partner-directory/catalog.ts`'s "curate; do
  not scrape".
- **Shown to the user as copy.** Quest gatekeeper disclaimers;
  `coop-formation.ts`'s "FBM never generates legal filings".

The brief's moral boundary maps onto the first grade in exactly two places,
and those two are the whole of §7's code work:

1. **No non-consensual extraction of capital** becomes: a `MICRO_INVESTOR`
   backing may not move money until the securities gate is answered. Today
   the only thing standing between a backer's dollars and a campaign escrow
   is an environment variable. §3.2.
2. **No coercion through status** becomes: reputation may not be purchasable
   and may not purchase economic advantage. Today a dollar buys an XP point
   and the product advertises that XP buys a lower fee. §3.4.

Everything else the brief asks for — myth as recruitment, asymmetric early
incentives, centralised execution with a sunset, infrastructure-first
sequencing — is a matter of sequencing and copy, not of guards. It is handled
in §5.

The one mechanism the brief excluded outright, state-chartered quasi-sovereign
power, has no analogue to guard against because nothing in the tree reaches
for it. The nearest thing is the lock-in recommendation (§5.3), and that one
fails on its own terms rather than on ethics.

---

## 3. Business line 1 — vendors as community-funded ventures

### 3.1 The instrument that already exists, and the one the brief proposed

`modules/collective-campaign` implements campaign-scoped funding, not vendor
equity, and the distinction is the most consequential thing in this document.

`docs/COLLECTIVE_BUYS_MICRO_INVESTMENT_SPEC.md` opens with a
**non-negotiable design constraint**: "Direct-to-supplier funding: campaign
funds never touch vendor hands for material purchases." Funds buy approved
material line items from suppliers; the vendor receives a maker fee released
against milestones on a reputation tier ladder; backers are either
`PRE_ORDER` (buying finished units) or `MICRO_INVESTOR` (funding unsold
capacity for a revenue share capped by a `return_cap_multiplier`).

That design is doing more work than it advertises. A pre-order backer is
buying goods — squarely inside the payment-facilitator frame Posture A rests
on. A campaign-scoped, capped revenue share against a specific production run
is a materially narrower instrument than "a capital stake in a vendor's
business", which is what the brief proposes. The brief's version is an equity
interest in a going concern: an investment contract on any reading, with the
vendor as issuer, and with no natural cap, no defined term and no defined
underlying.

**Recommendation: keep the campaign-scoped instrument and drop the
vendor-equity framing.** It is already built, it is already capped, it is
already tied to an identifiable use of funds, and it is the version a
CSA-style claim analysis has some chance of clearing — which is precisely the
analysis `REPO_CONSOLIDATION_REVIEW.md` §8 names. Vendor equity restarts that
analysis from zero for a strictly harder instrument, and adds an obligation
the brief did not price: an equity holder has continuing information rights,
which means annual reporting per issuer, which is the fourth item on the
brief's own missing list.

The pieces that would need to exist either way, and their real state:

| Piece | State |
| --- | --- |
| Campaign lifecycle | Built. `service.ts` 394 lines, twelve states, guarded transitions. |
| Backer register with pool share and cap | Built. `models/backing.ts`. |
| Escrow in and refund out | Built, dark. `lib/campaign-escrow.ts`, `hawala.openCampaignBackingEscrow` / `refundCampaignBackingEscrow` / release. |
| Purchase orders to suppliers | Model + route (`campaigns/[id]/purchase-orders`). |
| Vendor-side reputation tier for fee release | `models/vendor-reputation.ts` — a second reputation store; see §3.4. |
| Productive-asset token | Model + migration only. No issuance, transfer or trading code anywhere in the tree. |
| Yield reports | Model + migration; read by `service.ts:364` into a campaign summary; no writer. |
| Vendor-panel or storefront screen | **None.** No campaign UI in either app. |

So the honest status is: the backend of business line 1 is largely built and
has no front door, and its two most speculative models (`ProductiveAssetToken`,
`YieldReport`) are inert. Nothing needs a rebuild. What it needs is a decision
(§3.2), a guard (§7.1), a screen, and the deletion of one subscriber line
(§3.4).

### 3.2 The gate is recorded, and one environment variable crosses it

`docs/REPO_CONSOLIDATION_REVIEW.md` §8 is unambiguous:

> **Coalition investing and revenue-share subscriptions**: the EconomicUnit/claim
> modeling may be designed, but no cash-in/cash-out code path ships before the
> compliance work completes (Reg CF requirements for revenue-share; CSA-style
> claim framing for production claims). These are hard release gates, not
> configuration toggles.

`lib/campaign-escrow.ts` defines `CAMPAIGN_ESCROW_FLAG = "FBM_CAMPAIGN_ESCROW_LIVE"`
and `isCampaignEscrowLive()`. When set to `1`,
`POST /store/collective/campaigns/[id]/backings` calls
`hawala.openCampaignBackingEscrow` *before* persisting the backing, moving the
backer's money from their `USER_WALLET` into a per-campaign `ESCROW` account.
The route validates `mode` against the full `BackingMode` enum and applies the
same escrow path to both values. There is no branch on `MICRO_INVESTOR`
anywhere in the escrow path; the only three non-test references to that enum
value in the whole backend are two filters inside `collective-campaign/service.ts`
and the XP-stance selector in the subscriber.

The consequence is precise: **the cash-in path for a revenue-share instrument
is presently gated by a configuration toggle, which is the one thing §8 says
it must not be.** The flag defaults off, the surrounding engineering is careful
(idempotency keys, compensating refund on insert failure, pre-flag behaviour
byte-identical), and there is no evidence anyone has set it. This is a latent
defect, not an incident. But the gate as written is not being kept by anything
except nobody having typed the variable.

**Do this first, before any other work in this business line:** add a guard
that refuses `MICRO_INVESTOR` escrow regardless of `FBM_CAMPAIGN_ESCROW_LIVE`,
unless a separate flag whose name states what it asserts is also set. §7.1
gives the shape. It costs nothing, it changes no current behaviour, and it
converts §8 from a sentence in a document into the grade of boundary §2
describes as the only kind this codebase reliably keeps.

There is a second-order question the guard does not settle, and it should go
to counsel with the rest. Posture A rests on the payment-processor exemption
at 31 CFR 1010.100(ff)(5), which applies to a business that "facilitates the
purchase of goods or services". A `PRE_ORDER` backing is a purchase of goods.
A `MICRO_INVESTOR` backing is not a purchase of anything; it is a contribution
of capital against a future share of revenue. Escrowing it may therefore sit
outside the exemption the whole posture depends on — separately from, and in
addition to, the securities question. `openCampaignBackingEscrow` posts the
transfer with `reference_type: "MANUAL"`, which is not in
`PURCHASE_CONTEXT_REFERENCE_TYPES`; that has no effect today because
`assertPurchaseContext` only inspects CCR-denominated transfers and campaign
escrow is USD. The guard in §7.1 should not rely on that accident.

### 3.3 The internal exchange: do not build it

The brief calls a venue where vendor shares trade inside BMC the most
technically ambitious net-new subsystem in the plan, and frames the difficulty
as order matching, share transfer records and valuation display.

The difficulty is not technical. In the US, a venue that brings together the
orders of multiple buyers and sellers in securities and uses non-discretionary
methods to match them is an exchange; operating one requires registration as a
national securities exchange, or operation as an alternative trading system
under Reg ATS, which requires the operator to be a registered broker-dealer and
a FINRA member. Those obligations attach to the *venue operator* — BMC — not to
the vendors whose shares trade. This is the same structural trap as the
funding-portal question in §3.5: the brief's rule 6 says BMC must not become
the liable party for a vendor's securities obligations, and an exchange makes
BMC the liable party for its own, larger set.

The repo has refused a smaller version of this already. `REPO_CONSOLIDATION_REVIEW.md`
§8: "**Coliseum betting stays shelved.** No money staking on debate outcomes
under any framing." The phrase "under any framing" is the operative precedent.

**Recommendation: record the refusal in §8 alongside the others, and solve the
underlying need instead.** The need a secondary market serves is exit: a backer
whose money is committed for the length of a productive-asset campaign wants a
way out. Two answers exist that do not create a venue:

1. **Transfer with issuer consent, off-venue.** A backing changes hands only by
   the campaign vendor approving a named transferee, recorded as a change of
   `backer_id` on the `Backing` row. No matching, no order book, no price
   discovery, no continuous market. This is how private company stock actually
   moves.
2. **Redemption against the cap.** `payout_cap_amount` and
   `payout_released_amount` already exist; an early-exit discount against the
   remaining cap is an issuer-side buyback, not a trade.

Both stay inside the instrument the campaign already defines. Neither should
ship before the §8 compliance work either.

### 3.4 Reputation and capital: one coupling to delete, one to build

The brief requires that KARMA/XP and capital stay structurally separate,
citing the legal exposure of gamification tied to monetary value. The current
state is a closed loop that is half-built in both directions.

**Money buys reputation — built.** `subscribers/progression-campaign-backed.ts`
listens on `campaign.backed` and awards XP at "1 XP per whole currency unit
deployed", assigning `Stance.INVESTOR` for a `MICRO_INVESTOR` backing and
`Stance.CONSUMER` for a `PRE_ORDER` one. The event is emitted by the backings
route on every successful backing. A backer's `capital_deployed_cents` snapshot
is refreshed at the same time. So XP is, for this path, a direct linear
function of dollars.

**Reputation buys money — declared, not built.** `thresholds.ts:42`
`producer.reduced-commission`, and `thresholds.ts:50`
`investor.priority-campaigns` ("early access to new campaigns" — that is,
preferential access to the next investment). Per §1a neither is enforced.

Taken together the intended design is: pay in, level up, get a lower fee and
earlier access to the next raise. That is the "gamification tied to real
monetary value" pattern the brief flagged, and for an instrument that may be a
security it is worse than a gamification problem — preferential access to an
offering tied to prior investment is a distribution practice that wants a
lawyer's eye.

**Recommendations, all small:**

1. ~~**Stop awarding XP for `MICRO_INVESTOR` backings.**~~ **Done 2026-09-10.**
   The `PRE_ORDER` → `CONSUMER` branch is kept: buying a thing is ordinary
   commerce and XP for it is ordinary loyalty. The investor branch is gone —
   one conditional in one subscriber. `recomputeAggregates` still runs for
   every mode, so `capital_deployed_cents` is still refreshed: capital is
   recorded as capital, it just no longer buys reputation.
2. ~~**Delete `producer.reduced-commission` from `THRESHOLD_PRIVILEGES`.**~~
   **Done 2026-09-10.** The commission ladder already lives in `vendor-plan`
   where it is bought, not earned; having a second, earned path to the same
   benefit both couples the systems and contradicts the public "3% is the
   ceiling" claim in a way that is hard to explain. §1a's option 2 covers the
   rest of the list.
3. ~~**Delete or demote `investor.priority-campaigns`.**~~ **Done 2026-09-10.**
   Preferential offering access as an XP reward was the highest-risk item on
   the list.
4. **Then build the coupling the brief actually wants.** Reputation should
   reflect *documentation completeness* — permits, insurance, safety
   certifications uploaded and verified — as a trust signal distinct from
   sales volume. That is a quest-substrate read, not a money read, and the
   vault already carries verification and expiry with `document-status.ts`
   deriving `effective_status`. §4.2.

**One consequence of 1-3, deliberately left standing.** Nothing writes the
INVESTOR XP track any more — that subscriber was its only source. So
`investor_level` stays at 0 for everyone, and the two INVESTOR rows in
`DEFAULT_TITLES` ("Community Investor" L1, "Guild Builder" L5) are now
unreachable. They are dormant catalog rows rather than a broken promise: only
*earned* titles are ever exposed, and no surface lists the catalog, so a title
that cannot be earned is a title nobody is shown. They are left in place
because the track should move again — driven by recommendation 4's
documentation signal, not by dollars. Deleting them would need a migration to
remove already-seeded rows and would foreclose that. The reasoning is recorded
in `progression/stance.ts` so the next reader does not treat the flat track as
a bug.

Note also that `collective-campaign/models/vendor-reputation.ts` is a second
reputation store, parallel to `karma_event`, which decision D7 names as the
single canonical write path. It exists to drive maker-fee release tiers. It
should become a derived projection over `karma_event` plus campaign history
rather than an independent score, on the same reasoning that
`REPO_CONSOLIDATION_REVIEW.md` applied to Blackstar's `NodeTrustScore`. M, and
not urgent — but it should not grow a UI before it is reconciled.

### 3.5 Who is the issuer, and who is the intermediary

The brief treats the legal wrapper as a choice among Reg CF, Reg D, a state
co-op statute and revenue-share notes, and assigns the choice to the vendor as
issuer. That is only half the question, and the half BMC does not control is
the one that matters more.

Reg CF's exemption is available to an *issuer* only if the offering is conducted
through an intermediary that is itself a registered funding portal or a
broker-dealer. If FBM hosts vendors' offerings, FBM is that intermediary. The
obligation attaches to the platform, not to the vendor, and it is the
obligation the brief's own rule 6 says BMC must not take on. The same logic
produced §3.3's conclusion about a secondary venue; it applies with less force
but the same direction to the primary offering.

This is the decision that unblocks or kills the business line, and it is an
operator decision, not an engineering one. The shapes, in increasing order of
what they demand of BMC:

| Shape | Who registers | What BMC becomes | Ongoing burden on BMC |
| --- | --- | --- | --- |
| **Pre-order only** (`PRE_ORDER` backings; no revenue share) | Nobody | A marketplace, as today | None beyond current |
| **Refer out to a licensed portal** | The portal | A directory entry, per the `partner-directory` pattern | None; link out, take no fee |
| **Revenue-share notes offered by the vendor, off-platform** | The vendor | A record-keeper | Low, but "off-platform" must be real |
| **Reg CF hosted on FBM** | FBM as funding portal, plus each vendor | An intermediary | Portal registration, FINRA membership, per-issuer annual reporting |
| **Reg D 506(b)/(c)** | The vendor; BMC risks broker status if compensated | Possibly a broker | Accreditation verification under 506(c) |
| **Secondary trading** | FBM as broker-dealer/ATS | An exchange operator | Refused — §3.3 |

Row 2 is the row that matches everything else in this codebase. It is exactly
the disposition `docs/CDFI_COOP_ROADMAP.md` §3.2 reached for lending: link out,
never hand off an application, never take a fee — and the machinery already
exists. `modules/partner-directory` ships a curated catalog with kinds `cdfi`,
`credit_union`, `microlender`, `crowdfunder`, `back_office`, `legal`,
`fiscal_sponsor` and `certifier`, and `vendor-quest` definitions already pull
from it via `partnerLinks({ kind: [...] })`. Two existing `crowdfunder` entries
are already in that catalog. A vendor who wants a Reg CF raise gets a quest
that tells them what a portal will ask for and links them to portals — which
is what `microlender-readiness` (Q3) and `crowdfunding-traction` (Q4) already
do for lenders and crowdfunders.

**Recommendation: default to row 2, keep row 1 live, and treat rows 4-6 as
gated.** That preserves the whole *function* the brief wants — vendors reach
outside capital they could not reach alone, and BMC's quests and ledger make
them ready for it — while leaving the registration burden with the parties
whose business it is. It also means the answer to "which legal wrapper" is not
BMC's to pick: each vendor and their counsel picks, and BMC's job is the
readiness packet. That is a smaller, shippable product, and it is consistent
with rule 6.

If the operator instead wants FBM to host offerings directly, that is a
legitimate choice, but it should be made knowing it is a
funding-portal-registration decision with a multi-quarter timeline and
recurring obligations, not a feature decision. Either way it is a §8 gate item
and belongs in front of counsel before any further code.

---

## 4. Business line 2 — deconstruction and salvage

**Headline: the marketplace half is already modelled and needs wiring, not
building; the business half is contracts and insurance, and no amount of
software substitutes for it.** The brief said as much for the abatement
subcontractors (its recommendation 4) and was right. What it got wrong is the
other side: it listed grading, listing and staging as net-new when the first
two are seeded and the third is already sequenced elsewhere.

### 4.1 The listing surface exists; the onboarding path does not

`product-archetype/models/product-archetype.ts:37` defines
`CIRCULAR_ECONOMY`, commented in its own source as "Repaired goods, salvaged
materials — condition-graded". It is seeded by
`Migration20260202001SeedCommunityArchetypes.ts` and its enum value added
idempotently by `Migration20260202000AddCommunityArchetypeEnums.ts`. Archetypes
are assignable through `PUT /vendor/products/[id]/archetype` and manageable at
`/admin/product-archetypes`.

The attribute vocabulary is seeded too, in
`cms-blueprint/seed/cms-blueprint-data.ts`: `attr_condition_grade` (a
filterable dropdown — `Like New`, `Good`, `Fair`, `Parts Only`),
`attr_repair_history`, `attr_original_manufacturer`, a `cat_salvaged_materials`
category ("Reclaimed lumber, building materials, parts, and reusable
components") and a `tag_salvaged` source tag. `InventoryStrategy.LOT_BASED`
exists for goods that arrive as a batch rather than a SKU.

What is missing is the front door. `vendor-panel/src/components/onboarding/launch-wizard.tsx`
hardcodes four archetype codes — `NON_PERISHABLE`, `DIGITAL`, `SERVICE`,
`TICKET` — so a salvage vendor completing onboarding cannot select the
archetype built for them and lands on `NON_PERISHABLE`, losing the
condition-grade attribute set. The same file is why
`vendor-type-context.spec.ts` already carries a regression note about a literal
list that "silently stopped covering any newly added archetype".

**Wire, do not build. S.** Add `CIRCULAR_ECONOMY` to the wizard, confirm the
cms-blueprint attributes are attached to the archetype rather than only seeded,
and give the storefront a filter on `condition-grade`. That is the whole
marketplace-side gap for reclaimed materials.

Two genuinely absent things, both real and both small:

- **Sell-by-weight pricing — exists, dark.** `POST /vendor/products/[id]/weight-pricing`
  ships behind `FF_WEIGHT_PRICING_V1` (`api/middlewares.ts:1002-1006`,
  default off). Scrap metal is priced by weight, so this is a flag flip and a
  panel screen rather than a build. What genuinely does not exist is the
  weights-and-measures *device certificate* — the scale certification a seller
  needs to sell by weight lawfully — which is a `document-vault` doc type under
  §4.2, not a pricing feature.
- **A lot noun for mixed goods.** `harvest-batches` models a lot for produce
  and is the right shape to copy, but a salvage lot is heterogeneous — a pallet
  of mixed fixtures — where a harvest lot is homogeneous. M.

### 4.2 Grading: extend the vault, do not ship a standard

The brief asks for a grading/certification workflow, "especially for used
electrical/solar components". The right answer is constrained by a rule the
repo already made for a structurally identical problem.

`modules/cottage-food` tracks permit and food-handler expiry as **self-declared**
facts and deliberately refuses to ship a state-law table, because a platform
that publishes a regulatory table becomes the party that got it wrong. The same
reasoning applies with more force to a used 480V disconnect or a
twenty-five-year-old PV module: if FBM publishes "Grade B = safe for
residential reuse", FBM has made a safety representation about a product it
never touched.

**Therefore: FBM ships the evidence structure, never the standard.** Concretely:

1. **The seller declares against a named external standard**, not against an
   FBM grade. The `condition-grade` attribute stays as a coarse marketplace
   filter (`Like New`/`Good`/`Fair`/`Parts Only`) and is explicitly *not* a
   safety claim. For anything electrical, the meaningful artifact is a test
   report against a named method — for PV modules, a flash test reporting
   measured output against nameplate, which is what "still 80% efficient"
   actually means and is measurable.
2. **The test report is a vault document.** `document-vault` gained real
   verification and expiry on 2026-09-03; `document-status.ts` derives
   `effective_status` so an expired certificate stops reading as verified. A
   flash-test report is a document with a date, an issuer and an expiry — the
   vault's existing shape. This needs one new `doc_type` enum value, and the
   repo already adds enum values in their own idempotent migration
   (`ALTER TYPE … ADD VALUE IF NOT EXISTS`).
3. **Third-party inspection is the trust anchor, not FBM.** `work-verification`
   is the closest existing module for "someone competent attested to this
   work". `partner-directory` gains a `certifier` kind it already has, plus new
   entries for electrical and PV test labs.
4. **`vendor-verification` badges stay about the vendor, not the product.**
   Badges like `ORGANIC_CERTIFIED` describe a seller's credential. Introducing
   a product-level FBM badge would be FBM vouching for an item — the
   underwriting posture rule 6 forbids.

   Worth seeing clearly before copying the pattern, because it is the weakest
   boundary in the tree. `POST /admin/vendor-verification/[id]/badges` grants
   `ORGANIC_CERTIFIED` on either a `documentation_url` that need only parse as
   a URL or a `certification_number` of up to 200 characters; `expires_at` is
   optional; nothing resolves the link or contacts the certifying body. The
   route's own error text is candid that the badge "asserts an external
   certification". It is admin-granted, so an operator stands behind each one —
   but what the storefront then displays is an FBM assertion about a third
   party's certification, recorded on a string.

   For produce that is a manageable risk. For a used 480V disconnect or a
   twenty-five-year-old PV module the failure mode is not a mislabelled
   tomato, so **salvage grading should copy Blackstar's attestation-plus-
   eligibility shape rather than FBM's badge shape**: the seller attests, the
   document is verified and dated in the vault, and eligibility is computed
   from it — rather than FBM minting a mark that reads as its own judgement.

**Net-new: S.** One `doc_type` value, a handful of directory entries, and copy
that states plainly that a condition grade is a marketplace descriptor and not
a fitness-for-purpose warranty. The cold-start problem is real and is
addressed in §6.

### 4.3 Staging and depots: a listing, then a node, then pooling

The brief proposes extending Blackstar's micro-depot relay concept into a
member-hosted storage registry surfaced on a map. Two premises fail.

**The depot does not exist on the Blackstar side.** `CONSOLIDATION.md` states
that mesh routing, batch aggregation, micro-depots and reverse-auction
mechanics "exist as design docs only", and the code agrees: the terms appear
only in `api/docs/network-advantage-engine.md`, and Blackstar's own backlog
(`workflows/blackstar-console-nav-workplan.md:50`) lists "Relay point
management — CRUD micro-depots with map picker, capacity/hours/status" as
**NOT STARTED**. What is real is `ShipmentBoardListing`, `ShipmentBid` and
`ShipmentLeg` with their eligibility and progression services, plus node
attestation and the per-partner HMAC bridge. The `ShipmentLeg` relay is
genuinely good work — a guarded two-node handoff with proof and a settlement
reference, with tests.

But `nodes` is fourteen columns and none of them describes a place: no
latitude, longitude, geometry, kind, hours or capacity. It carries a
`service_radius` with no centre, and that column is never read outside its own
validator. A `ShipmentLeg`'s `to_node_id` therefore points at a table that
cannot say where anything is.

**The bidding is not a reverse auction, and the architecture rules out the
routing.** Bids are write-only: `ShipmentBid` appears in the model, factory,
migration and a single `updateOrCreate`, plus an uncalled `bids()` relation.
Nothing awards. Worse, `claim()` never checks the listing's `claim_policy`, so
on a listing configured for bidding the first eligible node to POST `/claim`
takes it and every bid row is ignored. And mesh routing is not merely unbuilt
but excluded by design: `GlobalDispatchService::autoAssign()` returns null
unconditionally, and `api/docs/shipment-board-api-delta.md:10` states "The
platform does not compute mandatory route assignments."

**FBM cannot see the relay anyway.** Blackstar emits seven event types; FBM's
`verify-blackstar-signature.ts` maps five. The two leg events — precisely the
ones a depot handoff would ride — are signed, delivered, and answered with
202 `{"status":"ignored"}`.

**The sequence is already written and salvage does not change it.**
`CONSOLIDATION.md` points at `docs/CDFI_COOP_ROADMAP.md` §3.9: an FBM depot
*listing* first, then a depot node kind a `ShipmentLeg` can hand off to, then
pooling. `docs/COMMERCE_ROADMAP.md` Tier 3.8 already plans micro-depot listings
pending its §4 decision 2 on whether `rental` or `kitchen` survives.

Note also which repo actually has the right shape: `aid-network`'s
`network_node` already carries coordinates, node kinds including cold storage,
routes and a live vendor screen. Its limitation is that it is single-seller —
transfers refuse another seller's node — which is a smaller problem to solve
than adding geography to Blackstar's legal-entity table.

**Recommendation: salvage staging is a listing, and it ships on the FBM side
alone.** A member with a barn lists staging capacity as a `rental`-shaped
listing with a location and an availability window. That works with no
Blackstar involvement, no new registry and no map. It also matches the brief's
own coordination-not-ownership principle better than a registry would: a
listing is already a thing a vendor owns, prices and withdraws.

Do not unfreeze Blackstar for this. The bridge is dark by default
(`FBM_BLACKSTAR_INTEGRATION=0`), per-shipment sequence numbers are an open
bilateral change, and the winner-selection gap above means the relay cannot
route a salvage job even if depots existed.

**One liability item the brief did not raise, and it is the important one.** A
member-hosted depot holding other people's goods is a bailment, not a delivery.
Blackstar's node attestations cover insurance, licensing, transport law and
platform indemnification — all framed around carriage — and there is no
depot-specific attestation term. Shipping a staging registry without one puts
uninsured custody of third-party property onto volunteers with a spare barn.
Whatever form staging takes, the host's own insurance position has to be an
explicit, vendor-supplied, verified document before the listing goes live —
the `document-vault` pattern from §4.2, not a checkbox.

### 4.4 Referral, not underwriting — and the checklist pricing question

The brief's recommendation 4 is right and the repo already has the pattern.
Licensed asbestos and lead abatement is a contracting relationship, not a
build. `modules/partner-directory` is the machinery: a curated catalog
("curate; do not scrape") with kinds, served to quest definitions through
`partnerLinks()`. Adding `abatement`, `deconstruction` and `reuse_center` kinds
plus real entries is a catalog change — **S** — and it inherits the §3.2 rule
from the CDFI roadmap: link out, never hand off an application, never take a
fee. A compensated referral to an abatement contractor would be BMC taking a
cut of a hazmat job, which is the fastest available route to being named in a
suit.

Compliance checklists then follow the quest pattern, which §1's sixth row
confirms is sound and whose blocking substrate defect has been fixed. A
"deconstruction contractor readiness" quest in the Certification & Trust family
reads the same substrate as the others, asks for vendor-supplied vault
documents (licence, general liability and workers' comp certificates, disposal
manifests, an abatement subcontractor agreement), and refers out through the
directory. Requirements are `platform`, `assisted` or `vendor-supplied` exactly
as the existing fourteen are.

**One policy question the operator must answer, and it is not technical.**
Quests are gated: `/vendor/quests*` requires `FF_VENDOR_QUESTS_V1` **and** the
`vendor.quests` entitlement, which the `scale` plan ($249/mo) grants, the
`quest_pack` add-on ($49/30 days) grants, and `free`, `starter` and `pro` do
not. For capital-readiness quests that is defensible pricing. For a checklist
whose function is to stop someone disturbing asbestos in a 1950s building, it
means the safety content sits behind a paywall. `docs/CDFI_COOP_ROADMAP.md` §4
already recorded the pricing of capital-access quests as an open operator
question; this is the same question with a sharper edge.

**Recommendation: make safety-critical quest content free of the entitlement
gate.** Either add a `is_safety` flag on the definition that exempts it, or
publish the deconstruction checklist through the public
`GET /store/quest-catalog` surface that already renders gatekeeper links for
non-enrolled visitors. S either way.

### 4.5 The land loop, and the one place FBM has no noun

The brief's closing move — cleared lots become nursery and compost growing
space — is the part of the thesis with the least code behind it, for a simple
reason: **land is not a noun in FBM.** There is no parcel, plot, field or site
entity with a location and an area. The closest things are
`ProductArchetypeCode.LAND_ACCESS` ("Garden plots, farm plots —
reservation-based, no inventory"), which models *access to* a plot as a
sellable thing rather than the plot itself, and `modules/garden`.

That absence is worth naming because two of the brief's goals — land ownership
and food sovereignty — terminate in it. It is not urgent and it should not be
built speculatively; a parcel model with no acquisition pipeline behind it is
schema for its own sake. But every downstream feature the brief wants (a
cleared lot becoming a growing site, a shared purchase under Q12, a site's
production history) needs it, and it should be recognised as the single
structural gap in the land thesis rather than discovered later.

What *does* exist, and is the strongest thing in the tree for this line, is
`vendor-quest/definitions/land-pooling.ts` — Q12, "Shared Purchase / Land
Pooling", a `collective` quest in the Cooperative & Mission family. It
aggregates consenting members' loan-readiness ("Aggregated member
loan-readiness", "Shared-use plan", "Cost-share agreement") across three gates
(Forming → Documented → Financing-Ready, the last at two members, $25,000
combined revenue and six months of combined cash-flow) and refers out to
`partnerLinks({ kind: ["cdfi", "microlender"], serves: "farm" })`. §5.5 argues
this is the answer to the brief's capital-pool question.

---

## 5. The six growth mechanisms, re-sequenced

The brief's transferable mechanisms are taken as given. What changes here is
the order and, in two cases, the mechanism itself — because the tree already
contains a better answer than the one proposed.

### 5.1 Myth as infrastructure — already built, and currently overdrawn

The brief asks that the Seedling→Ancestor identity system function as the
recruitment engine rather than decoration. It largely does already:
`modules/progression` carries the ladder, XP, levels, soulbound marks, stances
and titles; `modules/playbook` carries recipe-shaped onboarding (`hub`,
`kitchen`, `cycle`, `service`, `grove`, each declaring a `commission_rate` of
0.03); `GET /store/character` and the storefront character sheet render the
result; Blackout mirrors it in its own character-sheet and objectives features.
This is not a recommendation to adopt — it is a system to repair.

The repair is §1a. Six privileges are advertised on the character sheet and
none is enforced. A recruitment engine that promises a lower commission and a
featured listing, and delivers neither, converts every new member into someone
who will eventually discover it. The order is: **fix or hide the remaining
four, then amplify.** Not the reverse. (Two of the original six were deleted
rather than fixed — §3.4.)

One thing worth stating plainly because the brief does not: the Ifá/Odu routing
layer has no implementation anywhere in the three repos. It is an aspiration,
and it should be described as one until it is not.

### 5.2 Asymmetric early-mover incentives — the safe version and the unsafe one

The brief proposes four options. Against the code and the compliance posture:

| Option | Verdict |
| --- | --- |
| **Priority land/inventory allocation** | No allocation engine exists to prioritise. `demand-pool` awards sealed supplier proposals by manual selection; there is no queue to jump. Build before promise. |
| **Extra governance weight** | Platform governance does not exist (§5.4). Weighting nothing by nothing. |
| **Status capital via KARMA tiers** | The cheapest and the safest — *if* the status stays non-monetary and non-transferable. `progression/soulbound.ts` already makes marks non-transferable, which is the property that matters. |
| **Literal equity-like claims** | The most dangerous. This is §3 in its entirety: a security, with an intermediary question attached, behind a §8 gate. |

**Recommendation: build the third and refuse the fourth.** The concrete safe
form is a founding-steward mark: a soulbound, non-transferable title, awarded
by date of joining or by verified contribution, that confers recognition,
sequence in non-scarce contexts, and nothing economic. `modules/progression`
already has `titles` and a title catalog seeder; this is a seed-data change, S.

The unsafe form was already half-present and has been removed:
`investor.priority-campaigns` granted earlier access to investment
opportunities based on prior capital deployed. Whatever else that is, it is not
status capital — it is a distribution preference on a possible security.
Deleted 2026-09-10; §3.4.

### 5.3 Infrastructure lock-in — ship the licence before deepening the moat

This is the recommendation this document declines, and the reason is in the
repo rather than in ethics.

`docs/MEMBER_GOVERNANCE.md:142-143`: FBM has no `LICENSE` file — "A fork right
that is not licensed is a norm, not a right." (Blackout, by contrast, carries
`LICENSE-AGPL-3.0`, `LICENSE-GPL-3.0` and `LICENSE-COMMERCIAL`.) FBM's stated
philosophy is forkable, community-data-sovereign infrastructure, and the whole
legitimacy of asking members to invest their commerce in it rests on their
being able to leave with it. That exit right is currently unlicensed.

Deliberately increasing switching cost before shipping the licence inverts the
bargain. The colonial analogy is unusually apt and unusually unflattering here:
chartered monopoly worked because the subject could not leave. An ethical
version of that mechanism has to keep the leaving genuinely available, and
"you may fork" is only a mechanism if it is a licence.

**Recommendation, in order:** (1) add a `LICENSE` to FBM; (2) make data export
real and testable — `docs/TRUST_LANDSCAPE_AUDIT.md` Finding D is the existing
record of this; (3) then invest in integration depth freely. Integration that a
member could walk away from is a product advantage. Integration they cannot is
the mechanism the brief excluded.

The integration substrate itself is real but shallower than the brief implies:
the FBM↔Blackstar bridge is dark by default (`FBM_BLACKSTAR_INTEGRATION=0`),
`connect.js` is pinned at v2.0.0 under SRI, and cross-repo contracts follow a
documented FBM-canonical / consumer-mirror pattern
(`docs/contracts/mas-identity-consumer.md`). That pattern is the right
investment; it is also the one that makes forking easier, not harder.

### 5.4 Centralised execution with a governance sunset — keep the first, do not publish the second

The brief recommends concentrated founder decision-making during buildout with
a publicly committed sunset date when democratic governance activates.

**The first half is already true and needs no announcement.** Decisions are
made by an operator and recorded in canonical documents; `docs/GOVERNANCE.md`
describes maintainer governance only. That is a normal early-stage posture and
the brief is right that pretending otherwise costs speed.

**The second half should not be published, because there is nothing to
activate.** `ProposalEngine` and `VotingEngine` do not exist in any repo; the
names survive only in Blackout docs pointing at a `_port/` tree that is not in
the checkout, and a completion tracker that still asserts they exist. What does
exist is proposal and vote code in four parallel implementations
(`packages/core/src/governance/index.ts`'s `tallyVotes`, the client's
`useProposals.ts`, `packages/api`'s governance module, the protocol's
`co.bmc.proposal` / `co.bmc.vote` state events — Blackout's own
`CONSOLIDATION.md` calls for reconciling all four), plus FBM's
`modules/governance`. Every one of them is scoped to a room or a `garden_id`.
None is platform-scoped.

FBM has already written the honest version of this and should not now
contradict it. `docs/MEMBER_GOVERNANCE.md:22` lists "The platform itself |
Coalition-wide member voting | **Does not exist**", and its §4 explains why the
module cannot express one: "every table is keyed by `garden_id`". Line 155: "A
vote that maintainers may ignore is a survey." Line 159: "Until those exist, no
surface should say the platform is member-governed."

Publishing a sunset date against that is how a documented, honest limitation
becomes a broken promise. **Recommendation: commit to the preconditions, not to
a date.** Say what must exist before governance activates — a written
constitution defining what is votable and what a passed vote binds; a
membership class that is not a garden; a licence; an append-only record of
decisions — and let the date follow the artifacts.

Two defects found on the way, both of which must be fixed before any surface
says "democratic":

- **Blackout's client has no majority test.** `useProposals.ts:390-399`
  computes `quorumReached` and sets a proposal `passed` on expiry if turnout
  met quorum; `leadingOptionId` is computed and discarded. A binary proposal on
  which every vote was "against" passes. Consent is the one method implemented
  correctly (`lib/bmc-core/consent.ts:140-143`); "ranked" is Borda scoring, not
  instant-runoff, and should not be called ranked-choice.
- ~~**FBM's garden proposals never close.**~~ **Done 2026-09-10.**
  `workflows/governance/finalize-proposal.ts` has the only real threshold
  arithmetic in either repo, and `finalizeProposalWorkflow` had no callers at
  all; routes hit the service directly, so a garden proposal stayed `active`
  for ever. `jobs/close-garden-proposals.ts` now sweeps hourly for proposals
  past `voting_end`.

  Wiring it up meant that arithmetic would run for the first time, and two
  defects in it had to be fixed before it could:

  - **Quorum was met unconditionally.** Turnout is `unique_voters /
    eligible_voters`, `eligible_voters` is nullable, and *nothing in the tree
    writes it* — so it is always null, and the code read it as
    `(proposal.eligible_voters as number) || 1`. One ballot was therefore 100%
    turnout, at every quorum setting, for every proposal. It now throws
    `UnknownElectorateError` rather than guessing a denominator, and the sweep
    filters these out first so they are a counted, warned-about skip: a
    proposal that stays visibly open is a better failure than one falsely
    resolved. Recording an electorate is the remaining gap, and it is now a
    loud one.
  - **The `tie` status was unreachable.** `approvalPercentage >=
    approvalThreshold` was tested before the tie branch, so a 50/50 split under
    a simple-majority threshold took `passed` — 50 >= 50. An even split is not
    a majority. The tie test now runs first, on raw counts rather than a float,
    and only where the bar is 50%: meeting a 66% supermajority exactly is
    passing it, not tying it.

  The arithmetic is extracted into a pure `decideProposalOutcome` and covered
  by 14 tests, because §5.4 makes it a precondition for any surface calling
  itself democratic.

### 5.5 The internal capital pool — pool readiness, not money

This is the brief's centrepiece, and the tree has a better answer than the one
proposed.

Caja Laboral solved Mondragón's capital problem by *being a licensed bank*. The
US equivalents — a credit-union charter, CDFI certification, a licensed lending
company — are multi-year institutional projects, and FBM has already refused
the adjacent version twice: `docs/CDFI_COOP_ROADMAP.md` §3.5 disposed of
insurance pooling as "not on the roadmap, deliberately" because FBM holding
pooled premiums is a custodial, risk-bearing product; §3.2 constrained the CDFI
directory to link out, never hand off an application, never take a fee.

`vendor-quest/definitions/land-pooling.ts` is the answer that survives those
constraints. Q12 aggregates the *loan-readiness of consenting members* — their
combined revenue, operating history and cash-flow record — into a single
financing-ready packet, and refers out to real CDFIs and microlenders through
`partner-directory`. It holds no money. It takes no fee. It requires no
charter. And it delivers the actual function the brief wants from a capital
pool: members reach capital that none of them could reach alone.

**Recommendation: name readiness-pooling as BMC's capital strategy, and extend
Q12 rather than founding a bank.** Concretely:

1. **Generalise Q12 beyond land.** Its title already says "shared land,
   equipment, or cold storage"; the substrate is generic. A deconstruction
   crew pooling toward a truck and a container is the same quest.
2. **Add the missing referral kinds** to `partner-directory`, per §4.4.
3. **Leave `InvestmentPool` quiescent** — and make it actually quiescent, which
   §7.2 shows it is not.
4. **Finish patronage instead.** `hawala-ledger/patronage-allocation.ts`,
   `patronage-compute.ts` and `jobs/patronage-refund.ts` implement a quarterly
   patronage refund that stops at `status=computed`. Patronage — returning
   surplus in proportion to how much a member traded, not how much they
   invested — is the co-operative mechanism for internal capital, it is
   already 80% built, and it does not create a security. This is the single
   highest-value unfinished thing in the money stack. M.

### 5.6 Infrastructure before belief — the sequencing this document endorses

The brief's sixth recommendation is correct and is the one everything else
should be ordered behind. The specific form it takes here:

1. Guards first (§7). They cost days and they close the two paths where the
   ethical frame is currently unenforced.
2. Repairs second (§1a's six promises; the governance tally bugs in §5.4; the
   prediction module's live defects noted below). These are the places where
   the product already says something untrue.
3. Wiring third (`CIRCULAR_ECONOMY` in the wizard; a campaign screen;
   patronage completion). Small, and each turns something built into something
   usable.
4. Only then recruitment.

### 5.6a The copy already outruns the code — eleven more instances

`docs/CDFI_COOP_ROADMAP.md` found three places where user-facing text promised
what the code does not do. This sweep found eleven more, plus §1a's six
privileges. Ranked by how much damage the gap does if a member relies on it:

| Where | What it says | What is true |
| --- | --- | --- |
| `/invest` page, footer-linked | "Earn returns"; "Invest as little as $1"; returns "as cash, revenue share, or product credits" | §7.2. A public offer of returns on a model `POSTURE_A_COMPLIANCE.md` calls quiescent |
| Blackout `features/home/widgets/premiumWidgets.tsx:21-22` | "🟢 Anonymized transport (Tor) — active", under a heading calling it "Live status" | `features/privacy-tools/useHardeningFeatures.ts:6-7` says Tor transport "remain[s] planned". No SOCKS or onion code exists. A paying user may act on this |
| `buyer-protection` page | "A person reads it" — human dispute review | `GET /admin/disputes` exists; `admin-panel/src/routes/` has 55 directories and no disputes screen |
| `creator-portal` / `wellness-portal` `PayoutsPage.tsx:58` | "your 1099 will be available in January 2027" | `generate1099Report` has zero callers; no W-9 route; `nursery-portal`'s "Upload W-9" button has no handler |
| `ReportSellerForm.tsx:44-45` | A seller-report/DMCA form | `onSubmit` is a `logger.info` call. The notice goes nowhere |
| `featureMatrix.ts:39-45` | "CSA share management — Available now" | No share-box screens exist in either app; `share_box_subscription` has no price column |
| Homepage:334, `why-we-exist:25` | "Settle through our internal ledger (Coalition Credits)" | Dark behind `FBM_CCR_CHECKOUT_LIVE`; and CCR has no spend path |
| `buyer-protection:170`, `how-it-works:675`, `vendor-types:432` | Escrow on crowdfunding campaigns | Dark behind `FBM_CAMPAIGN_ESCROW_LIVE` |
| `what-you-sell:30` | "auto-bills every Friday" | No money path behind it |
| `transparency:42-43` | "Card processing is absorbed in the coalition fee" | `payout-config.ts:45,56,59` — platform 3% against processing at 2.9% + 30¢ |
| Footer | — | No `/terms`, `/privacy` or `/refund` page exists or is linked. `PRE_LAUNCH_AUDIT.md` LEG-1 records this as P0, open |

Two of these are outside this document's business lines but belong in the same
step, because the brief's recruitment push would amplify all of them: the Tor
claim is a safety representation to people who may make decisions based on it,
and the missing terms and privacy pages are the foundation every trust page on
the site rests on.

The pattern to correct toward is one this repo has already used successfully
twice: **state the gate, not the aspiration.** "Escrow protects campaign
backers — shipping when the compliance review completes" is both true and
better copy than a promise that is currently false.

Across the three repos this sweep counted **45 gates that default dark** — 37
in FBM (19 `FF_*_V1` keys requiring the literal string `true`, eight
`FBM_*_LIVE` gates requiring `1`, ten more env gates) and eight in Blackout.
That is a healthy engineering practice and a marketing hazard at the same time:
almost everything is built, almost nothing is on, and the copy was written
against the build.

One item found during this review belongs in step 2 and is not otherwise in
this document's scope. `modules/vendor-hype-operations-prediction` is
registered unconditionally in `medusa-config.ts` and its market-creation and
position-placement routes are live behind ordinary customer auth with no
feature flag. Its jurisdiction gate matches the literal key `"US"` only, so
`"US-CA"` passes; its per-user position cap is 50 where its own compliance
matrix sets the default at 1; and a currency-denominated stake can be placed on
a `non_cash` market. Settlement is effectively disabled because
`PREDICTION_ORACLE_PUBLIC_KEYS` is empty by default, but taking positions is
not. Given that `REPO_CONSOLIDATION_REVIEW.md` §8 shelves money-staking on
debate outcomes "under any framing", these three defects should be fixed or the
routes flagged off, and the relationship between the hype market and that gate
should be recorded explicitly one way or the other.

---

## 6. Cold start — what a human must author before the community can iterate

The brief flagged this correctly and it is worth keeping sharp, because the
whole coordination-not-ownership design depends on there being something to
iterate on. Crowdsourced refinement cannot produce a first draft. Each item
below must be authored once, by the operator or a paid expert, before any
community loop has an input.

| Artifact | Who can author it | Blocks |
| --- | --- | --- |
| The securities decision (§3.5) — which row of the table BMC operates | A securities lawyer. Not researchable to a safe conclusion. | All of business line 1 beyond `PRE_ORDER` |
| First deconstruction-readiness quest definition — licence, insurance, manifest and abatement-subcontractor requirements for SC | Operator, from SC DHEC and OSHA sources; reviewed by a contractor | §4.4's quest |
| "How to grade a used PV module" — the flash-test method, what nameplate vs. measured output means, what a report must contain | Operator or a PV technician; one document | §4.2's evidence structure |
| Abatement subcontractor relationships | Operator. A contracting task, not a content task | Any pre-1980 structure |
| Partner-directory entries for `abatement`, `deconstruction`, `reuse_center`, electrical/PV test labs | Operator, curated under the existing "curate; do not scrape" rule | §4.4 |
| The constitution (§5.4) — what is votable, what a passed vote binds | Operator, then members | Any governance sunset language |
| FBM's `LICENSE` | Operator | §5.3, and the honesty of the fork right |

Note what is *not* on this list. Blackout's Documents feature already seeds
four founding documents (bylaws, mission, decision rules, mutual-aid
agreement) adapted from SELC, USFWC and Center for Family Life with licence
attribution — the co-op-formation cold start is already paid for, and
`docs/CDFI_COOP_ROADMAP.md` §3.4 records the remaining work as export and
linkage, not authorship.

### 6a. The education surfaces, checked

The brief proposed Coliseum as the home for salvage and cooperative-finance
education, and Challenge Link as a funnel that pulls non-members in. Both
premises need correcting, and the correction improves the plan.

**Coliseum is real, live and default-on**, with two crowd-tallied verdict
engines: a clean-room Polis port for topic debates (k-means clustering,
consensus as the minimum agree-rate across clusters) and a 1v1 match format
whose verdict is plurality tallying over five fixed questions. Its own source
is explicit that "There is NO AI at any stage — this module is pure tallying
over crowd input."

That is the right instrument for a contested question and the wrong one for a
settled one. **Adding "salvage" and "cooperative finance" as domains is nearly
free and nearly pointless.** Free because domains are a hardcoded 13-key `as
const` in `packages/core/src/coliseum/taxonomy.ts` — two keys plus labels.
Pointless on its own because there would be no content, no seed and no
reviewer; and it is not quite free either, because
`REPUTATION_SUBJECTS = COLISEUM_TOPIC_CATEGORY_KEYS`, so a new domain silently
becomes a new reputation subject.

**Put canonical procedure in FBM's `knowledge-base` instead.** It already has
drafts, categories, community submission and an admin approve/reject gate —
the shape safety content needs, where a wrong answer is corrected rather than
out-voted. Reserve Coliseum for what it is good at: whether deconstruction pays
better than demolition, whether a given co-op structure suits a given trade.
And follow the §8 precedent that shelved Coliseum betting by naming what the
arena does not adjudicate. "Is this panel safe to reuse" is not a debate.

**Challenge Link exists by that exact name and does not work.**
`packages/core/src/coliseum/challengeLink.ts` is real, a token is minted at
match creation, and `GET /matches/:id/link` returns a path of
`/coliseum/c/<token>`. That path has no route registered —
`features/coliseum/routes.ts` mounts only `/coliseum` and
`/coliseum/topics/:topicId` — and the client fetch has zero callers, as does
the endpoint that would mark a challenge seen, so the `seen` state can never
be set. It is built-but-unreachable server plumbing.

**And even finished it could not funnel non-members**, because the Blackout
client router only mounts when logged in. There are exactly three logged-out
escapes — an invite token, a public directory that depends on a Synapse
setting left at its `False` default, and a handle page. Coliseum is not among
them; a logged-out visitor gets the login card. (The API is a different story:
19 of the 55 `/v1/coliseum` GET routes never call `requireUser`, so the content
is publicly readable by `curl` while being unreachable in the product. That
asymmetry is worth an operator decision in its own right.)

**So the education funnel is an auth problem, not a Coliseum problem.** A
guest-readable surface is a real M that touches authentication, and it should
be scheduled as that rather than as a content task. Until it exists, the
honest funnel is the one that already works: the public
`GET /store/quest-catalog` surface on the FBM side, which renders gatekeeper
links to non-enrolled visitors.

### 6b. Creator monetisation — the recommended currency cannot be spent

The brief proposes that members document and monetise deconstruction
walkthroughs through the Creator Hub. Two of its three pieces hold up and the
third has to be re-pointed.

**Streaming is real.** Owncast, RTMP to HLS, with VOD recording, server-side
clip cutting with captions, RTMP simulcast fanout and OBS-WebSocket
compatibility. (LiveKit is also present but is the voice SFU, not the video
path.) The client is not yet a player — the viewer embeds the Owncast player in
an iframe pending an `hls.js` wiring that is deferred. **One thing to do before
anyone links a stream:** the viewer routes sit behind `BLACKOUT_STREAMS_VIEWER`,
default false, while the Creator Hub's Content tab imports the live directory
directly and bypasses that gate. On defaults, Content → Live is a wall of dead
links.

**Short-form is real and reachable** — a genuine vertical reel with scroll-snap
paging and a browser-side composer, behind a flag that defaults on.

**Earnings is the dead end.** Blackout's bounty module says so in its own
source: settlement and payout "live in FBM and are out of scope here — the
bounty only records the reward terms." Its schema has no escrow columns and its
routes make no ledger calls. Completion writes `status: 'earned'` and waits for
an inbound FBM webhook `bounty.reward_settled` that **FBM never emits**; FBM
emits `quest.reward_settled` instead, with a composite completion id that can
never match the random id Blackout generates. Blackout bounty rewards are
therefore permanently `earned` and never paid.

Coalition Credits are the other half of the problem and `POSTURE_A_COMPLIANCE.md`
already records it: CCR can be minted and burned but not spent, because no
spend path exists. Directing members to monetise in CCR points them at a
balance that cannot be spent, converted or withdrawn, whose only exit burns it
for nothing.

**Re-point the recommendation at the two paths that move real money.** The
creator-rewards pool distribution settles over the Stripe ACH payout rail, and
FBM's demand-pool bounties carry live creator-facing objectives
(`CREATOR_NEEDED`, `MARKETING_NEEDED`, `PHOTOGRAPHY_NEEDED`) with real escrow,
payout and refund paths and a `DEMAND_BOUNTY` purchase context already blessed
in `posture-a-guard.ts`. Both are USD. Neither needs CCR.

**One finding from that sweep belongs in §5.6's step 2 rather than here**, and
it is the most serious defect this review found outside the securities line.
Reproduced and fixed on 2026-09-09; recorded here because the shape is worth
remembering.

`escrowBountyFunds` and `escrowParticipantFunds` credit the **same** per-pool
`ESCROW` account — both call `getOrCreateDemandEscrow(demand_post_id)` — and
`payBountyMilestone` debits that account by id. So a bounty that was never
escrowed did not fail for want of funds. It paid out of the purchase money
other participants had committed to the pool, and the ledger's non-negative
invariant only noticed once the whole pool was drained.

Nothing in the preflight caught it, and the preflight is otherwise careful: it
checks that the bounty exists, belongs to *this* pool, has an assignee, and
that both ledger legs resolve, in that order and before the committed
completion. It simply never asked whether the bounty had funded anything.

It was reachable from the public API. `POST /store/collective/demand-pools/:id/bounties`
lets any pool creator or participant add a bounty with any positive `amount`
and never escrows it; only the `create-creator-bounty` workflow escrows, and
its docblock says why — "a funded bounty must be backed by escrow so the
displayed reward is real."

The fix is one guard in the preflight: a milestone cannot be paid until the
bounty's own funds are escrowed. Escrowing at creation instead would take money
the caller may not have and would change the route's contract, so the payout
side is the right place. `__tests__/collective-hawala.unit.spec.ts` now proves
an unfunded bounty is refused with neither the completion nor the transfer
attempted.

---

## 7. The code this document recommends, and why it is only two guards

Everything else in this document is sequencing, wiring or content. Two items
are code, and both exist to move the ethical frame from prose into the grade of
boundary §2 describes as the only one this codebase reliably keeps.

### 7.1 A guard on micro-investor escrow

**Problem (§3.2).** `FBM_CAMPAIGN_ESCROW_LIVE=1` enables ledger escrow for
every backing mode, including `MICRO_INVESTOR`, which is a revenue-share
instrument gated by `REPO_CONSOLIDATION_REVIEW.md` §8 — a gate whose own words
are "hard release gates, not configuration toggles".

**Shape.** A guard in the escrow helper, called from the backings route before
any ledger call, that throws unless a second, separately-named flag is set:

```
assertBackingModeReleasable(mode)
  → throws SecuritiesGateError when mode === MICRO_INVESTOR
    and FBM_SECURITIES_GATE_CLEARED !== "1"
```

The flag name is the point: `FBM_CAMPAIGN_ESCROW_LIVE` describes a mechanism,
so setting it reads like enabling a feature. `FBM_SECURITIES_GATE_CLEARED`
describes an assertion about the world, so setting it reads like a claim
someone has to be willing to make. Default off; current behaviour with the
escrow flag unset is unchanged.

### 7.2 `InvestmentPool` is documented as quiescent and is not

**Problem.** `docs/POSTURE_A_COMPLIANCE.md:219-221` records:

> **`InvestmentPool`**: pooled investment vehicle. Quiescent under Posture A
> unless and until the offering is structured under a securities exemption
> (Reg CF, Reg A, Coop Investment Cooperative) with appropriate filings.

It is not quiescent. Reachable today, with no feature flag anywhere in the path:

| Route | Auth | Effect |
| --- | --- | --- |
| `POST /vendor/hawala/pools` | seller | Creates an `InvestmentPool` with `status: "ACTIVE"`, a caller-chosen `roi_type` (`FIXED_RATE` with an annual `roi_rate`, `REVENUE_SHARE`, `PRODUCT_CREDIT`, `HYBRID`) and a `PRODUCER_POOL` ledger account |
| `GET /store/hawala/pools` | public | Lists `ACTIVE` pools with target, raised and progress |
| `POST /store/hawala/investments` | customer, 10/min | Debits the customer's `USER_WALLET` into a pool; writes an `Investment` row |
| `POST /store/hawala/deposit` | customer, 5/min | Stripe ACH from a verified bank account, $10–$10,000, with NACHA mandate capture |
| `POST /store/hawala/withdraw` | customer, 5/min | Out |

That is a complete retail offering path: fund a wallet by ACH, browse pools,
buy a fixed-rate or revenue-share position in a named producer's business. A
vendor creates the offering themselves, behind seller auth alone, and it is
`ACTIVE` on creation. The `Investment` model carries `expected_return`,
`actual_return`, maturity and withdrawal timestamps.

Two things this is *not*, stated so the finding is not overread. There is no
evidence any pool exists in production; the paths are reachable, not
necessarily used. And the auto-invest-from-order branch in
`processOrderPayment` (`service.ts:1483-1499`) is not live — it fires only when
a caller passes `auto_invest_percentage`, and the one live caller,
`subscribers/hawala-order-payment.ts:299`, does not. The pool's own
`auto_invest_percentage` field is settable by the vendor and admin routes and
read by nothing.

**This is the same defect the same document already caught next door, and the
fix is already precedented.** Its `VendorAdvance` bullet records: the
`GET/POST /vendor/hawala/advances` routes and the vendor-panel "Get Advance"
section "had been live behind seller auth alone; both now sit behind
`FF_VENDOR_ADVANCES_V1` (API) and `VITE_FF_VENDOR_ADVANCES_V1` (panel), default
off." The 2026-09-06 sweep that fixed advances did not reach pools.

**Shape, and what shipped.** `FF_INVESTMENT_POOLS_V1`, default off — matching
how advances were handled, including the same `=== "true"` semantics. Route
middleware over `/vendor/hawala/pools*`, `/admin/hawala/pools*`,
`/store/hawala/pools*` and `/store/hawala/investments*`, returning 404 when
unset. The Posture A bullet now records the correction rather than claiming an
enforcement it never had.

Route middleware alone was not enough, and the gaps are worth recording because
they are the shape this kind of fix usually leaks through:

- **`GET /vendor/hawala/dashboard` is not one of those matchers**, and
  `getVendorDashboard` returns an `investment_pools` array. The gate therefore
  also sits in the service, which is where this repo puts boundaries that must
  not be routed around (`posture-a-guard.ts:19-21` gives the reasoning). With
  the flag unset the array is empty regardless of caller.
- **The vendor panel rendered that array unconditionally.**
  `vendor-panel/src/routes/finances/finances.tsx` gated the advances section on
  `VITE_FF_VENDOR_ADVANCES_V1` and rendered "Your Investment Pools" with no
  check at all. It now mirrors the API on `VITE_FF_INVESTMENT_POOLS_V1`.
- **The public offer was the largest part and is not an API surface at all.**
  `/invest` now calls `notFound()` unless `NEXT_PUBLIC_FF_INVESTMENT_POOLS_V1`
  is set, and the three inbound links — the footer, the investor card on
  `/start`, and the "Learn about investing" link on `/how-it-works` — are
  removed or gated with it. An offer of securities is an exposure whether or
  not anyone can act on it, so a gated API behind a live advertisement would
  have closed the smaller half.

**And it is not only an API surface.** `storefront/src/app/[locale]/(main)/invest/page.tsx`
is a live, footer-linked marketing page (`storefront/src/data/footerLinks.ts:31`)
headed "Invest in Local Agriculture", telling visitors "Earn returns while
building a more sustainable food system", "Invest as little as $1" and "Receive
returns as cash, revenue share, or product credits based on the pool type".
That is a public offer of returns, pointed at working endpoints, on a model the
compliance document calls quiescent. Gating the routes without removing the
page leaves an advertisement for a product that 404s.

**How this sits with the recorded operator decision.**
`PRE_LAUNCH_AUDIT.md` §6 LEG-3/LEG-4 records: "**owner decision (no counsel):
keep the money features live**, accepting the exposure. `ACH_PAYOUTS_ENABLED`
stays default-off. Revisit if a legal review ever happens. *(accepted risk)*"
That decision is the operator's to make and this document does not reopen it.
Three things make gating the right default anyway, and none of them is a
re-argument of the risk posture:

1. **A more specific decision points the other way.** LEG-3 is a
   money-transmission judgement. The securities question is a separate gate,
   and `REPO_CONSOLIDATION_REVIEW.md` §8 does not waive it — it names
   revenue-share cash-in a hard release gate.
2. **The operator's own most recent action on an identical model was to gate
   it.** `VendorAdvance` sat under the same "money features" umbrella and was
   put behind `FF_VENDOR_ADVANCES_V1`, default off, on 2026-09-06 — after
   LEG-3 was recorded.
3. **The inconsistency is not a risk posture, it is a factual error.**
   `POSTURE_A_COMPLIANCE.md` asserted quiescence that was never enforced. That
   has to be fixed by making it true or by amending the claim; leaving a
   canonical compliance document wrong is the one option that helps nobody.

The change is fully reversible in one environment variable:
`FF_INVESTMENT_POOLS_V1=true` restores the previous behaviour exactly. If the
operator's decision is to keep the offering live, that is the switch, and the
Posture A bullet should then be amended to say so rather than claiming
quiescence.

**Do this before anything else in this document.** It is the only finding here
where the gap between what a canonical compliance document asserts and what the
code does is load-bearing on securities law.

---

## 8. Legal gates — restated, with two added

Nothing here loosens the standing gates in
`docs/REPO_CONSOLIDATION_REVIEW.md` §8. Two are added and one is sharpened:

- **Coliseum betting stays shelved.** Unchanged. See §5.6 on whether the
  vendor-hype prediction module sits inside or outside this gate — it currently
  is not addressed either way, and should be.
- **ACH payouts stay disabled** pending money-transmitter sign-off
  (`PRE_LAUNCH_AUDIT.md` §5-C). **Sharpened:** the gate names payouts; §7.2
  records a live ACH *deposit* path into a customer wallet. Whatever the
  disposition, the gate should say which direction(s) it covers.
- **Coalition investing and revenue-share** stay gated on Reg CF and CSA-style
  claim analysis. **Sharpened:** §3.2 and §7.2 record two paths that presently
  cross it — one behind a configuration toggle, one behind no flag at all. The
  gate is not being kept by anything today.
- **NEW — no secondary market in vendor claims, under any framing.** §3.3. An
  internal venue matching buyers and sellers of vendor shares is an exchange
  or an ATS; operating one requires broker-dealer registration and FINRA
  membership. Transfer-with-issuer-consent and redemption against the cap are
  the permitted alternatives, and both remain behind the revenue-share gate.
- **NEW — FBM does not become an offering intermediary without registration.**
  §3.5. Hosting vendors' Reg CF offerings makes FBM a funding portal. Until an
  operator decides otherwise with counsel, the disposition is refer-out through
  `partner-directory`, on the §3.2 rule: link out, never hand off an
  application, never take a fee.

## 9. Operator decisions this document cannot take

1. **The securities row (§3.5).** Which shape business line 1 operates in.
   Everything else in that line is downstream. Needs counsel, not research.
2. **Whether safety-critical quest content sits behind the `vendor.quests`
   entitlement (§4.4).** A pricing decision with a safety consequence.
3. **Whether to fix or hide the four remaining unenforced privileges (§1a).**
   Both are defensible; leaving them displayed is not. Currently hidden, which
   is the safe default while the decision is open. The other two of the
   original six are deleted, not pending (§3.4).
4. **Whether the vendor-hype prediction module falls inside the §8 betting
   gate (§5.6).** It is currently unaddressed in either direction.
5. **Whether `FF_INVESTMENT_POOLS_V1` stays off (§7.2).** This document ships
   it default-off on the reasoning in §7.2, but `PRE_LAUNCH_AUDIT.md` LEG-3/4
   records an owner decision to keep money features live as an accepted risk.
   One variable reverses it. If the answer is to keep the offering live, amend
   the Posture A bullet to say so rather than leaving it claiming quiescence.
6. **Whether `/invest` comes down (§7.2, §5.6a).** Gating the API without
   touching the page leaves an advertisement for a 404.
7. **Ship FBM's `LICENSE` (§5.3).** An operator action; it also unblocks the
   honest version of the lock-in strategy.
8. **Abatement subcontractor relationships (§6).** Contracts, not code.

---

## 10. Ordered roadmap

Ordering rule: close the gaps between what a canonical document asserts and
what the code does, before building anything new on either.

**Now — guards and truth (days)**
1. `FF_INVESTMENT_POOLS_V1`, default off, across the pool and investment routes, the vendor dashboard payload, the panel section and the `/invest` page with its three inbound links; Posture A bullet corrected. **Shipped with this document.** §7.2.
2. Micro-investor escrow guard. §7.1.
3. ~~Hide or allowlist the six unenforced privileges.~~ **Done 2026-09-09**: privileges carry an `enforced` marker, the summary publishes only marked keys, none is marked, and a spec fails the build if one is marked without a consumer. §1a.
4. ~~Fix the three prediction-module defects.~~ **Done 2026-09-09**: unmapped jurisdictions now allow non-cash only and a subdivision inherits its country's blocks; the position cap defaults to the matrix's 1; a currency stake is refused on a non-cash market. §5.6.
5. Publish Terms, Privacy and Refund pages — `PRE_LAUNCH_AUDIT.md` LEG-1, P0, open. Every trust claim on the site currently rests on nothing enforceable. §5.6a.
6. ~~Stop rendering Tor transport as "active" in Blackout.~~ **Done 2026-09-09** in `blackout#903`: entitlement and implementation are now separate questions, and an unbuilt capability reads "planned". §5.6a.
7. ~~Reproduce and fix the demand-pool bounty escrow gap.~~ **Done 2026-09-09**: an unescrowed bounty paid from the shared pool escrow, reachable from the public bounty route. §6b.

**Next — repairs (weeks)**
8. ~~Stop awarding XP for `MICRO_INVESTOR` backings; delete `producer.reduced-commission` and `investor.priority-campaigns`.~~ **Done 2026-09-10**: the pay-in / level-up / pay-less / get-in-earlier loop is cut at both ends, and a spec on each half fails the build if either is reintroduced. §3.4.
9. Blackout's missing majority test; stop calling Borda scoring ranked-choice. §5.4.
10. ~~Wire FBM's `finalizeProposalWorkflow` to a scheduled job so garden proposals close.~~ **Done 2026-09-10**: hourly sweep, plus two fixes to the threshold arithmetic it was about to run for the first time — quorum was met unconditionally on an electorate nobody records, and the `tie` status was unreachable. §5.4.
11. FBM `LICENSE`; verify data export. §5.3.

**Then — wiring what is already built (weeks)**
12. `CIRCULAR_ECONOMY` in the vendor onboarding wizard; condition-grade filter on the storefront. §4.1.
13. Finish patronage: take `patronage-refund` past `status=computed`. §5.5.
14. Partner-directory kinds and entries for abatement, deconstruction, reuse centres, PV/electrical test labs. §4.4.
15. Deconstruction-readiness quest definition, exempt from the entitlement gate. §4.4, §6.
16. A campaign screen — business line 1's backend has no front door. §3.1.

**Later — gated or sequenced behind the above**
17. Sell-by-weight pricing; a heterogeneous lot noun. §4.1.
18. Micro-depot staging as an FBM listing, after the `rental`/`kitchen` ruling. §4.3.
19. Generalise Q12 beyond land. §5.5.
20. A parcel noun, when there is an acquisition pipeline to justify it. §4.5.
21. Anything in business line 1 past `PRE_ORDER` — behind §8.

**Refused, deliberately**
- An internal secondary market in vendor claims. §3.3.
- FBM as a funding portal without registration. §3.5.
- An internal bank or pooled-premium insurance vehicle. §5.5, and `docs/CDFI_COOP_ROADMAP.md` §3.5.
- A published governance sunset date before the preconditions exist. §5.4.
