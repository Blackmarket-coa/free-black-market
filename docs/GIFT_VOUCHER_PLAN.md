# Gift Vouchers + Curated Attribution — design plan

Status: **proposal, no code**. This document exists because two things must be
decided by the operator before any of it is built: a values conflict with
`docs/LISTING_TYPES.md`, and a legal gate that is not a deploy step. Neither
is a code problem.

Related: `docs/POSTURE_A_COMPLIANCE.md` (the hard invariants),
`docs/LISTING_TYPES.md` (§"Discouraged / not shipping"),
`docs/CREATOR_COMMERCE_ROADMAP.md`, `MARKETPLACE_AUDIT.md` §11.

## The ask

A member finds a vendor's offering, wraps a personal gift around it, shares
it, and earns a commission when someone buys — whether the buyer keeps it or
gifts it onward. The buyer or recipient ends up holding something redeemable
for that one specific good or service.

## What already exists

Most of it. The affiliate half is built and production-grade; the gift half
is not built at all.

| Capability | Module | Status |
| --- | --- | --- |
| Vendor authorizes a member to earn commission | `creator-program` — `CreatorProgram` → `CreatorApplication` → `CreatorDeal` with a frozen `terms_snapshot` | **exists** |
| Share link, click capture, order attribution | `creator-attribution` — `AffiliateLink` (`short_code`, `deal_id`, `vendor_id`, `product_id`, status active/paused/revoked), `AttributionClickEvent`, `OrderAttribution`, `PromoCodeBinding` | **exists** |
| Commission paid out of seller gross | `payout-breakdown` — `order_payout_breakdown.total_creator_commission` | **exists** |
| Multi-party split at settlement | `payout-breakdown` — `fee-resolution.ts`, `plugin-revenue-share.ts`, `referral-revenue-share.ts`; disbursed by `subscribers/hawala-order-payment.ts` | **exists, on the internal ledger** (see premise check) |
| Commission hold + reversal on refund | `creator-attribution` — `commission_status`, `hold_until`, `subscribers/process-refund-reverses-commission.ts` | **exists** |
| Rights granted by a purchase | `entitlement` — `Entitlement`, `EntitlementGrantRule` | **exists** |
| Audit record for a non-settling flow | `hawala-ledger` — `GIFT` rail (`rails.ts`) | **exists, unusable** (see D6) |
| **`voucher` listing type** | `listing-type` catalog — 9 types, none of them this | **missing** |
| **A redeemable token with a transferable holder** | — | **missing** |
| **Buy-as-gift checkout + recipient claim** | — | **missing** |
| **Redemption with double-spend protection** | closest analogue is `progression` `XpRedemption` | **missing** |

The one thing the ask assumed was missing — a creation-time check that the
backing exists and the vendor authorized the relationship — is the part that
is most thoroughly built. An accepted `CreatorDeal` **is** that authorization,
it already carries frozen commission terms so retroactive program edits cannot
change already-attributed payouts, and `AffiliateLink.status` already supports
revocation. It does not need to be rebuilt, and it does not need to be manual.

## Vocabulary correction

The proposal's field names do not exist in this codebase and should not be
introduced: there is no `VOUCHER`/`CURRENCY`/`CREDIT`/`CLAIM`/`CAPACITY` unit
enum, no `acquisition_model`, and no `affiliate_split`. The real primitives:

| Proposed | Actual home |
| --- | --- |
| `type: VOUCHER` | a new `ListingTypeId` in `listing-type/catalog/types.ts` — **not** a `RailCode` (see D1) |
| `acquisition_model: marketplace_listing` | already true by construction; `EntitlementSource.ORDER` records it |
| `affiliate_split: enabled` | an accepted `CreatorDeal`; the split is `total_creator_commission` |

## Premise check — one assumption does not hold

The proposal's compliance argument rests on this:

> Payment split happens at the processor (Stripe/Moov), not inside
> `hawala-ledger` — one checkout, multi-party payout, `hawala-ledger` just
> records what happened. The ledger never becomes the party holding funds
> between buyer and the two recipients.

**That architecture does not exist, and the repo's stated rule is the
opposite of it.** Verified across the whole backend:

- **Moov**: zero occurrences, anywhere, of any kind.
- **Stripe Connect**: `@mercurjs/payment-stripe-connect` is in
  `package.json` and registered nowhere. `medusa-config.ts` registers plain
  `@medusajs/medusa/payment-stripe` only.
- **No processor-level split exists**: no `application_fee_amount`, no
  `transfer_data`, no `on_behalf_of`, no destination charges. The one
  function that could do it, `createConnectTransfer`
  (`hawala-ledger/stripe-ach.ts:300`), has zero call sites.
- **Connect onboarding is a declared stub.**
  `api/v1/seller/payouts/onboarding/route.ts` writes a `pending` row and
  returns a hand-built placeholder URL; its docblock says Connect wiring is
  "intentionally out of scope."
- **Splits actually happen on the internal double-entry ledger.** The
  `order.placed` subscriber `subscribers/hawala-order-payment.ts` computes
  the breakdown and disburses by debiting the `PLATFORM_FEE` account and
  crediting `SELLER_EARNINGS` (`shared/plugin-revenue-payout.ts`,
  `shared/referral-revenue-payout.ts`). Balances accrue internally; cash
  leaves later over Stripe ACH.
- `modules/README.md` states the house rule directly: anything that moves
  money must "route value movement through `hawala-ledger` rather than moving
  it directly."

So the ledger *is* the splitting party today, which is a more custodial
posture than the proposal assumes — and it is the posture `PRE_LAUNCH_AUDIT.md`
LEG-3 already flags as stored-value exposure.

**Consequence for this feature:** do not design the voucher against a
processor-level split. Use the existing hawala disbursement path, which is
idempotent, defers rather than overdrafts, and never throws (D3). Moving FBM
to true processor-level splits is a legitimate and probably correct goal —
it is also a separate workstream (Connect onboarding, KYC, account links,
payout reconciliation) that this feature must not be made to depend on or
quietly block on.

## Decisions

### D1 — A voucher is a listing type, never a settlement rail

`RailCode` in `hawala-ledger/rails.ts` is the unit taxonomy, and a voucher
must stay out of it. Three reasons, in increasing order of seriousness:

1. `assertRailInvariants` (`posture-a-guard.ts:349`) is exhaustive with a
   `never` check — a new rail breaks the build until every guard clause
   handles it.
2. `createTransfer` derives the rail from the debit account and takes no
   currency parameter, so a new rail needs accounts denominated in it before
   anything can move. The `GIFT` rail has been defined since inception and is
   still unusable for exactly this reason.
3. The decisive one: a rail implies a balance, and a balance that is not
   consumed inside one purchase is the "wallet abstraction that holds value
   independent of commerce flow" that Posture A §3 forbids outright.

A voucher therefore carries **no balance**. Money settles once, on `USD`, at
checkout. The token that survives is a right to one specific good, not an
amount.

### D2 — The curator does not create a listing

**This is the decision that needs the operator, not the engineer.**

`docs/LISTING_TYPES.md` §"Discouraged / not shipping" says, in full:

> **Affiliate / dropship**: collapses cooperative coherence (vendors don't
> hold inventory, don't bear risk, capture margin on others' labor). If
> demanded, frame strictly as a Hub aggregator function via federation API;
> never as an Amazon-style affiliate stream.

The ask as written — any member creates *their own listing* pointing at
someone else's product — is precisely the pattern that paragraph refuses. It
was refused on cooperative-values grounds, not compliance grounds, so no
amount of compliance engineering answers it.

The proposal here keeps every user-visible behavior and drops the part the
charter objects to: **the vendor's product remains the only listing.** The
curator creates a *gift presentation* — a title, a note, an image, a
recipient — bound to an existing `AffiliateLink`. It renders as "curated by
@member", never as a competing storefront. The vendor is the seller of
record, holds the inventory, bears the risk, and sets the terms.

That distinction is not cosmetic. It is what makes the rest legal:

- The vendor is the seller receiving the funds, so the Posture A payment-
  facilitator exemption conditions 3 and 4 (a formal agreement directly with
  the seller) still hold.
- The commission is a marketing expense the vendor authorized in a signed
  deal, paid out of the vendor's own gross. It is **not** the buyer
  designating funds to a third party, which Posture A §9 forbids.

If the operator would rather overturn the charter paragraph and ship real
member-created affiliate listings, that is a legitimate call — but it is an
amendment to `LISTING_TYPES.md` and should be made explicitly there, with its
own rationale, not smuggled in as a feature.

### D3 — Commission rides the existing creator-deal rail

No new payout leg, no new split arithmetic. At order completion the existing
`payout-breakdown` waterfall runs unchanged and the curator is paid through
`total_creator_commission`, funded out of seller gross at the rate frozen in
`deal.terms_snapshot`.

Note the asymmetry already encoded in this module, because the proposal's
three-way split diagram flattens it: the *generic referral* and *plugin*
shares are carved **out of the platform fee, never added on top** — so that a
seller's net never depends on who referred them, and so payouts can never
exceed what the platform collected. The *creator commission* is the one share
funded from seller gross, and that is correct here precisely because the
vendor opted into it in a signed deal. Keep both rules as they are.
`calculateBreakdown` computes and explicitly does not move money; the
subscriber performs the transfers. Preserve that separation.

Two behaviors already built that this feature depends on, and should not
reimplement:

- `OrderAttribution.commission_status` (`pending|held|approved|paid|reversed|
  disqualified`) with a `hold_until` window.
- `subscribers/process-refund-reverses-commission.ts`, which reverses the
  commission when the order is refunded.

One adjustment is needed: a voucher's commission should stay `held` until
**redemption or a defined window**, not merely until the order ages out. An
unredeemed voucher is an outstanding obligation and carries more refund risk
than a delivered good, so paying the curator on order age alone means paying
out against a sale that is more likely than usual to reverse.

### D4 — One gift hop, then it stops

`max_transfers` defaults to **1** and is enforced at the service layer.

A voucher that can be transferred without limit is a bearer instrument: a
secondary market forms, the thing starts trading at a discount to face value,
and what is being traded is value rather than a specific good. That is the
currency-exchange exposure the whole design is trying to avoid. One hop is a
gift. Unlimited hops is an unlicensed exchange.

There is no resale, no listing of a held voucher, and no cash-out. A refund
returns to the original payment method only (Posture A §7).

### D5 — Vouchers may not be purchased with CCR in v1

Buying a voucher with Coalition Credits and then gifting it is a
member-to-member CCR movement with no purchase context on the second leg —
Posture A §2 and §8, directly. Block it at the cart, not at redemption.

USD only, at least until someone works through whether a CCR-funded voucher
can be made non-transferable without making it useless.

### D6 — The transfer is audited as metadata, not as a GIFT-rail entry

The `GIFT` rail exists in `rails.ts` but has no accounts denominated in it, so
nothing can actually post to it. `barter` already hit this and settled on
recording `intended_rail: "GIFT"` in metadata against a zero-value entry
rather than claiming a rail it is not on
(`barter/models/barter-proposal.ts:31-35`). Follow that precedent exactly.

Making the `GIFT` rail real is a separate, already-scoped piece of work and
should not be smuggled into this one.

### D7 — Redemption uses compare-and-swap

Double-redemption is the primary defect risk in the whole feature: two
concurrent claims on one voucher yields two goods for one payment. The
`progression` module already solved this shape with a DB-level
compare-and-swap on redemption state (`progression/service.ts:482,534`).
Copy it. Do not rely on a read-then-write, and do not rely on a workflow hook
— `posture-a-guard.ts:19` notes that hooks can be bypassed and the service
layer is the only line that can reliably refuse.

### D8 — Ship dark behind `FBM_GIFT_VOUCHER_LIVE`

`lib/surplus-redirect.ts` establishes the house pattern for compliance-
sensitive mechanics: build it, test it, ship it behind a flag, and treat
turning the flag on as "a compliance decision with a legal sign-off attached,
not a deploy step." `campaign-escrow.ts` and `creator-credits.ts` do the same.
This feature earns that treatment (see the legal gate below).

## Data model sketch

One new model. Everything else is reuse.

```
voucher_token
  id
  product_id, variant_id, seller_id     -- the backing; required at creation
  order_id                              -- the purchase that minted it
  entitlement_id                        -- what redemption grants

  curator_seller_id      nullable       -- the member who packaged it
  affiliate_link_id      nullable
  deal_id                nullable       -- the vendor's authorization

  holder_customer_id                    -- current title holder
  status                                -- issued|claimed|redeemed|expired|refunded|void
  transfer_count         default 0
  max_transfers          default 1

  claim_token_hash       nullable       -- hashed, never stored raw
  claim_expires_at       nullable       -- the CLAIM link expires, not the value

  redeemed_at, redemption_order_id
  metadata
```

Invariants worth asserting in tests, since each maps to a decision above:

- `product_id` is required and must resolve to a live product at creation —
  there is no blank or unbacked voucher (D1).
- A curated voucher requires an `ACTIVE` `CreatorDeal` covering that vendor
  and product **at purchase time**; terms are copied from
  `deal.terms_snapshot`, never read live (D3).
- `transfer_count <= max_transfers`, enforced service-side (D4).
- Currency is `USD`; a CCR-funded cart cannot mint one (D5).
- Redemption is a compare-and-swap from `issued|claimed` to `redeemed` (D7).
- `claim_expires_at` expires the *claim link*. It must never expire the
  underlying entitlement (see legal gate).

### House conventions the new module must follow

- Migration file and class both named
  `Migration<YYYYMMDD><PascalCaseDescription>`, raw SQL via `this.addSql()`,
  with a real `down()`.
- **Enum-ish columns are `TEXT` + a `CHECK` constraint, never a Postgres
  enum** — a real enum cannot take a new value in the same migration batch
  that uses it.
- Soft deletes are universal; partial unique indexes carry
  `WHERE "deleted_at" IS NULL`.
- Module registered via `Module(NAME, { service })` in `index.ts` and added
  to the array in `medusa-config.ts`.
- Routes are file-system routed under `src/api/<scope>/...`; new surfaces use
  the `api/v1/**` style with inline zod `.strict()` schemas parsed by
  `safeParse` and the `{ message, type, errors }` error envelope.

**Which "product" the voucher points at.** There are two parallel concepts and
the voucher must be explicit about which it binds. Medusa core `product` is
the real commerce object, and ownership is not a column on it — it lives in
the MercurJS `seller_product` link table, so `seller_id` on `voucher_token`
must be resolved through that link rather than read off the product.
`creator_listing` is the separate digital/marketplace listing model, which
does carry `seller_id` directly and materializes a shadow product to enter a
cart. v1 should bind to the Medusa `product_id`/`variant_id` pair, since that
is what checkout and `EntitlementGrantRule` already key on.

## The legal gate

This is the part that is genuinely new risk, and it is not the part the
proposal worried about.

**Gift certificates are separately regulated**, independently of money
transmission. The federal CARD Act sets a five-year floor on expiry and
restricts dormancy fees; state unclaimed-property and escheatment rules vary
widely and several states prohibit expiry on certificates outright.

The design's saving grace is that a voucher here references **one specific
good**, not a stored dollar amount. In most states that is a "merchandise
certificate" and is treated more leniently than a cash-value gift card. That
is a reason to expect a workable answer, not a reason to skip counsel.

Two questions counsel has to answer before `FBM_GIFT_VOUCHER_LIVE` flips:

1. **Expiry.** Can the claim link expire while the entitlement does not? The
   model above assumes yes and is built that way.
2. **Who owes the good if it is never redeemed?** The vendor was paid at
   checkout, so the obligation sits with the vendor, and it is an obligation
   with no time limit unless (1) resolves otherwise. Vendor onboarding copy
   and the deal terms have to say so plainly, and an unredeemed-voucher
   liability report is a vendor-panel requirement, not a nice-to-have.

Precedent for gating on exactly this kind of question: `PRE_LAUNCH_AUDIT.md`
LEG-3, where ACH deposit→withdraw sits behind `ACH_PAYOUTS_ENABLED` pending
counsel sign-off.

## Build sequence

Each phase is shippable and useful alone. The affiliate binding is last on
purpose — it is the piece blocked on D2, and the first three phases are
valuable whether or not the operator ever unblocks it.

**P0 — decisions.** Operator resolves D2 against `LISTING_TYPES.md`. Counsel
opens on the gift-certificate questions. No code.

**P1 — voucher as a listing type.** Add `voucher` to the `ListingTypeId`
union and catalog. Add `voucher_token` and the issue-on-order subscriber.
Redemption with D7's compare-and-swap. No transfer, no curator. This alone
ships "buy a gift for yourself, redeem it later" and is the whole risky
surface, so it gets the most test coverage.

**P2 — title transfer.** Claim link, `max_transfers`, recipient claim flow,
D6 audit metadata. This is where "gift it to someone else" appears.

**P3 — curated attribution.** Bind `voucher_token` to `affiliate_link_id` and
`deal_id`; commission flows through the existing waterfall untouched.
Gated on D2.

**P4 — surfaces.** Storefront create/share/claim/redeem. Vendor-panel
unredeemed-liability report. Blackout consumer surface.

## What this unlocks beyond the original ask

The gift-token mechanic is worth more as infrastructure than as an affiliate
feature. Each of these is a real module in this repo that currently has a gap
this would fill.

**Unblocks a documented blocker.** `MARKETPLACE_AUDIT.md` §11 lists
`ambassador.commission_paid` as one of three emitters that cannot be wired
because "FBM has no ambassador flow to hook." P3 is that flow.

**Retires Blackout's `comped` hack.** `docs/contracts/fbm-billing-consumer.md`
records that gifts and pay-it-forward are handled as "local-only `comped`
overrides, deliberately NOT a payment flow" because "a stored gift-credit rail
would violate FBM's Posture-A no-balance-holding stance." A voucher is a
*paid* gift that holds no balance — it is the thing `comped` was standing in
for. Gifting a creator subscription becomes a real, attributable purchase
instead of an admin override.

**Mutual aid, and this is the strongest case.** `mutual-aid`, `donation`, and
the Threshold surface already exist. "Buy a voucher, release it to the pool
for whoever needs it" is a gift-forward primitive that is values-aligned
rather than extractive — the same mechanic as the affiliate flow, pointed at
solidarity instead of margin. It routes through the fiscal-sponsor rules in
`donation` when it is a donation, and is a plain title transfer when it is
not.

**CSA shares.** `harvest/models/harvest-claim.ts` already has
`claim_basis: 'gift'` in its enum with nothing that produces it. A gifted
harvest share is a direct fit for a field that is sitting there waiting.

**Wishlists.** The `wishlist` module exists. "Fund a wishlisted item" is a
voucher minted against a specific product someone already asked for — the
highest-intent gift there is, and zero new primitives.

**Everything with a schedule or a seat.** `booking`, `ticket-booking`,
`season`, `kitchen`, `restaurant`, `cottage-food` — gift a class, a table, a
meal, a season pass. These are the listing types where "I want to give this to
someone" is the *normal* purchase intent, not an edge case.

**Vendor quests and progression.** `vendor-quest` and `progression` can issue
vouchers as rewards, replacing XP-for-entitlement with XP-for-a-real-good
without inventing a second redemption lifecycle.

**Acquisition, measurably.** A claim link requires an account to redeem, and
`analytics-event` already carries `affiliate_short_code` and
`affiliate_link_id`. Gift recipients become an attributable acquisition
channel on instrumentation that already exists.

## Open questions

- Does a curated voucher's presentation need moderation, or does
  `AffiliateLink.status` revocation plus vendor deal termination cover abuse?
  Leaning: the latter, since both are already built and vendor-controlled.
- Partial redemption for variable-price services — deliberately out of scope
  in v1, because "remaining value" is a balance, and D1 says no balances.
- Whether the curator's commission should be visible to the buyer. Argues for
  yes on cooperative-transparency grounds; needs a copy decision.
