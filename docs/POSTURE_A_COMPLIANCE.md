# Posture A Compliance Frame

FreeBlackMarket v1 operates as a **Payment Facilitator** under
FinCEN 31 CFR 1010.100(ff)(5). This document is the canonical compliance
posture. Every module that touches money must read and honor it.

## What Posture A is

The payment-processor exemption to Money Services Business (MSB)
classification applies to a business that:

1. Facilitates the purchase of goods or services (not money transmission
   itself);
2. Operates through a clearance system that admits only BSA-regulated
   financial institutions (Stripe ACH qualifies);
3. Operates under a formal agreement with the seller/creditor receiving the
   funds; and
4. Has that agreement directly with the seller, not as an intermediary
   conduit.

When FBM accepts a buyer's payment, holds it briefly, and disburses to a
vendor's US bank account via Stripe ACH in the context of a goods-or-services
purchase, FBM is a payment facilitator — not a money transmitter.

## What Posture A is not

Posture A is **not** a registered MSB. It is **not** an agent of a licensed
money transmitter. FBM has neither FinCEN Form 107 registration nor
state-by-state money-transmitter licensing. We do not maintain a BSA officer,
AML program, SAR filing pipeline, or CTR filing pipeline at this posture.

A future posture (Posture C — agent of a licensed principal) is architected
for, but requires both a partnership with a licensed transmitter (Circle,
Bridge, Stellar Disbursement Platform, MoneyGram Access) and a written
agency agreement before activation.

## Lines that cannot be crossed under Posture A

Crossing any of these turns FBM into an unlicensed Money Services Business.
The penalties (18 USC 1960, civil and criminal) apply to operators and
officers personally. Treat these as hard architectural invariants, not
preferences.

### Coalition Credits

1. **No Credits-to-cash conversion.** Credits are never redeemable for USD
   in any form, including via gift card, prepaid card, ATM, or peer
   exchange. The Stellar custom asset is issued with `authorization_required`
   and `authorization_revocable` set true so the issuer (FBM) can refuse
   trustlines from accounts not under platform control.
2. **No vendor-to-vendor Credits transfer outside a goods/services
   purchase context.** A vendor cannot send Credits to another vendor as a
   gift, a loan, a settlement of an off-platform debt, or an expression of
   support. The only Credit-to-account-not-the-issuer movement is as
   consideration in an FBM-recorded purchase.
3. **No balance-holding outside the purchase-payout context.** A vendor's
   LedgerAccount Credits balance reflects either (a) earned-but-not-yet-spent
   Credits from a sale on FBM, or (b) Credits being applied to an active
   purchase. There is no Credits "wallet" abstraction that holds value
   independent of commerce flow.

One of these three rules is enforced architecturally today. The other two
enforcements described here were **never built**, and this section claimed them
for long enough that both `docs/CCR_HRS_IGNITION.md` §3 and
`docs/GIFT_ECONOMY_REUSE_MAP.md` had to rediscover it independently. What is
actually true:

- **Built.** `assertPurchaseContext` in `posture-a-guard.ts` is reached from
  `createTransfer` via `assertRailInvariants`, so it covers every CCR movement
  the service can make — the service layer is the enforcement point, deliberately,
  because workflow hooks can be bypassed (`posture-a-guard.ts:19-21`).
- **Not built — no purchase-context middleware.** `backend/src/api/hawala-validation.ts`
  is a schema library, not middleware; there is no `x-purchase-context` header
  anywhere in the repo, and its `createTransferSchema` is dead code the admin
  route never imports.
- **Not built — no cart reservation, release, or reaper.** `workflows/hooks/`
  contains three hooks and none touches credits; nothing in the repo writes a
  ledger entry with `reference_type: "CART"`, even though the guard blesses
  `CART` as a purchase context precisely so that a reservation could clear it.

The practical consequence, and the reason this correction matters beyond
tidiness: **Coalition Credits can be minted and burned but not spent.** The only
CCR mint and burn sites are the two creator-credits routes. Until a spend path
exists, crediting anyone in CCR creates exactly the balance-holding-value-
independent-of-commerce-flow that rule 3 above forbids. `docs/CCR_HRS_IGNITION.md`
§5 orders the work; a spend path is downstream of two policy answers only the
operator can give (who holds CCR wallets, and what governs issuance volume).

### Vendor payouts

4. **No USDC payouts to vendors.** Vendor payout always terminates at Stripe
   ACH to a US bank account. USDC moves only internally between platform-
   controlled accounts on Stellar for treasury and bookkeeping. A vendor who
   asks for a USDC payout is told: "Available under Posture C; not before."
5. **No payout to a non-BSA-regulated channel.** Stripe ACH (BSA-regulated)
   is the only outbound rail. PayPal, Venmo, CashApp, Zelle for direct
   vendor disbursement: not in v1.
6. **No banking-as-a-service abstraction.** FBM does not offer vendors a
   bank account, debit card, savings yield, or any product that resembles
   one. Foreign or unbanked vendors are referred to banking partners
   (Mercury, Lili, Lower East Side People's FCU); FBM does not stand
   between the vendor and that partner.

### Inter-account movement

7. **No buyer-to-buyer transfers.** A buyer with a refund credit cannot send
   it to another buyer. Refunds either return to the originating payment
   method or apply to a future purchase by the same buyer.
8. **No vendor-to-buyer transfers outside a refund.** A vendor cannot send a
   buyer a "thank you bonus" or "loyalty kickback" through the ledger; that
   path is money transmission.
9. **No third-party fund-routing.** FBM does not let a payer designate funds
   to flow to a recipient who is neither the seller of the listed goods nor
   a registered donation beneficiary. Pay-it-forward and
   convert-this-purchase mechanics (deferred to a later branch) route
   through the same vendor's order pipeline, not as standalone transfers.

### Donations

10. **All donation receipts route through a 501(c)(3) fiscal sponsor.**
    FBM does not maintain the donor-recipient relationship directly. The
    fiscal sponsor (selected from Allied Media Projects, NEO Philanthropy,
    Tides Foundation, or an SELC-recommended local sponsor) handles state
    charity registration in roughly 40 states and issues donor receipts.
    Donation widgets surface the sponsor name to the donor as part of the
    consent flow.

## How each module enforces these rules

### `hawala-ledger`

- `assertPurchaseContext` on the service layer (mandatory; cannot be bypassed
  by callers that depend on the public API).
- CCR Stellar asset issued with `authorization_required` so issuer can refuse
  trustlines.
- `EscrowAgreement` (new) requires a `subject_type` in
  {`order`, `bounty`, `campaign`, `service_engagement`}; CHECK constraint at
  the DB layer.
- Reconciliation job: sum of ledger entries per account must equal Stellar
  on-chain balance nightly; drift is a bug, triaged immediately.
- Audit log emits `auditFinancialTransaction` for every state change; logs
  are immutable and retained.

#### `DEMAND_BOUNTY` as a purchase context

`PURCHASE_CONTEXT_REFERENCE_TYPES` in `posture-a-guard.ts` carries a standing
instruction that any addition be reviewed against this document. This records
the review for `DEMAND_BOUNTY`.

**Decision:** `DEMAND_BOUNTY` is a valid goods-or-services purchase context.

**Rationale.** A demand-pool bounty is payment for delivered work: a
contributor escrows funds against a specified deliverable, an assignee claims
it, and the escrow releases per completed milestone. That is the same
transaction category as `ORDER` — value moves against work performed, not
between members as a free-standing balance transfer. The three call sites in
`services/collective-hawala.ts` (escrow funding, milestone payout, escrow
refund) are each tied to a recorded bounty record.

**Why this is not an expansion of the CCR surface.** `bounty` is already an
accepted `EscrowAgreement.subject_type` under Posture A, enforced by a DB CHECK
constraint (see above). Bounty escrow was therefore always inside the posture;
what was missing was the `reference_type` vocabulary to express it. Adding it
aligns the guard with a boundary this document had already drawn.

**What it does not authorize.** Bounties remain closed-loop: CCR stays
`cash_convertible: false` in `rails.ts`, and a bounty cannot be used to move
Credits without an associated bounty record. Bounty payouts confer no
redemption right.

**Defect this closed.** `DEMAND_BOUNTY` was absent from both this set and the
`LedgerEntry.reference_type` enum while being posted at three money-moving call
sites. Because `createTransfer` derives currency from the debit account, every
bounty path threw `ClosedLoopViolationError` on a CCR-denominated wallet in
strict mode — latent only because CCR wallets were not yet in production use.
`modules/hawala-ledger/__tests__/reference-type-parity.unit.spec.ts` now fails
the build if the guard's vocabulary, the model enum, and the caller literals
drift apart again.

### `playbook`

- Each playbook recipe declares `allow_credits_payout: bool` (defaults true
  except for Stall and Service where it requires per-vendor opt-in).
- Each recipe declares `commission_rate` (default 3 %).

### `listing-type`

- `consignment` listing-type requires `represented_party_id`; revenue split
  on that listing is recorded as a multi-leg LedgerEntry at order-complete,
  not as a separate post-hoc Credits transfer.
- `campaign` (crowdfunding) listing-type uses `EscrowAgreement` for funds
  held during the funding window; release or refund is tied to the campaign
  outcome and recorded as goods/services context.

### `donation`

- `fiscal_sponsor_account_id` (added in this branch) is required on the
  `donation-settings` model; the donation-batch-disbursement job routes all
  donations through the fiscal sponsor's LedgerAccount.

### `seller-extension`, `entitlement`, `order-cycle`, `creator-program`

- These modules do not initiate CCR transfers directly; they call into
  `hawala-ledger` for any Credits movement. The closed-loop guard applies
  uniformly.

## Existing models documented as quiescent under Posture A

`hawala-ledger` has been built somewhat ahead of strict Posture A scope. The
following models exist but are either inactive or restricted under Posture A:

- **`VendorAdvance`**: vendor advance against future sales. Quiescent under
  Posture A — an advance can look like lending without proper licensure.
  Activate only after legal review. *2026-09-06:* the `GET/POST
  /vendor/hawala/advances` routes and the vendor-panel "Get Advance" section
  had been live behind seller auth alone; both now sit behind
  `FF_VENDOR_ADVANCES_V1` (API) and `VITE_FF_VENDOR_ADVANCES_V1` (panel),
  default off. Flipping them is the activation this bullet gates.
- **`InvestmentPool`**: pooled investment vehicle. Quiescent under Posture A
  unless and until the offering is structured under a securities exemption
  (Reg CF, Reg A, Coop Investment Cooperative) with appropriate filings.
- **`ChargebackProtection` / `ChargebackClaim`**: a pool for vendor
  chargeback insurance (0.2% of each sale, capped coverage, claim
  adjudication states). Tables are migrated; no service method, route, job
  or dispute handler reads or writes them. Quiescent under Posture A — FBM
  holding pooled premiums and paying claims is a risk-bearing, custodial
  product with no recorded gate (`docs/CDFI_COOP_ROADMAP.md` §3.5, §5).
  Do not wire until an operator rules on it in
  `docs/REPO_CONSOLIDATION_REVIEW.md` §8.
- **`BankAccount`**: vendor banking metadata. Active for storing payout-
  destination details only; does not constitute FBM offering banking
  services.

Do not remove these models. They may activate under Posture C. Mark
quiescent paths with a comment referencing this document.

## Posture flip path (Posture A → Posture C)

When Posture C is activated:

1. Partner agency agreement with a licensed money transmitter executed.
2. KYC + W-8BEN/W-9 collection added to vendor onboarding for vendors
   requesting USDC payout.
3. `playbook` recipe gains `usdc_payout_eligible` flag, defaulting false.
4. `hawala-ledger` adds USDC-to-vendor disbursement workflow gated by both
   the recipe flag and the partner agency state.
5. `assertPurchaseContext` semantics are unchanged; CCR remains closed-loop.

This is a configuration and partnership change, not a rewrite. The data
model and service surface added in this branch are designed to flip without
schema migration.

## Compliance gate (CI)

`backend/src/modules/hawala-ledger/__tests__/posture-a-invariants.spec.ts`
asserts the following at every CI run:

1. Public methods on `HawalaLedgerModuleService` that move CCR throw when
   called without a purchase context.
2. The CCR asset configuration carries `authorization_required: true` and
   `authorization_revocable: true`.
3. `EscrowAgreement.subject_type` accepts only the four allowed values.
4. The donation job test asserts disbursement target is the fiscal sponsor
   account.

A failing posture invariant blocks merge. Treat this gate as
non-overridable.

## Open posture questions

- **Fiscal sponsor selection**: ✓ Resolved (working recommendation —
  Allied Media Projects). See `docs/FISCAL_SPONSOR_DECISION.md` for the
  evaluation matrix and the open agreement / board-sign-off items that
  must close before the disbursement job flips to live. Until then the
  sponsor `live` flag stays false in
  `backend/src/modules/donation/fiscal-sponsors.ts`, the donation
  widget surfaces "pending fiscal sponsor" copy, and donations accrue
  in pending state on FBM's books.
- **Banking partner for unbanked vendors**: Mercury, Lili, or LES People's
  FCU. Decision affects vendor onboarding copy. Not blocking for this
  branch.
- **Closed-loop guard scope for refunds**: a refund that returns CCR to a
  buyer must be tied to the originating order. The service-layer guard
  treats `refund_id` as a valid purchase context only when the refund
  references an order.

## Reference

- FinCEN Bank Secrecy Act regulations: 31 CFR Chapter X.
- 18 USC 1960 (unlicensed money transmitting business).
- FinCEN 2003 guidance on payment processors and the 2014 reaffirmation.
- FinCEN 2019 CVC guidance (FIN-2019-G001).
- GENIUS Act 2025 (federal stablecoin framework).
- SELC Mutual Aid Toolkit (donation routing recommendations).
