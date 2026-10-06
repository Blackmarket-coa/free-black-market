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

10. **A donation is collected only as a Stripe direct charge on the recipient
    organisation's own connected account, and FBM records it without ever
    holding it.** Concretely, under `FF_NONPROFIT_PARITY_V1`:

    - One PaymentIntent per recipient org, created **on** that org's
      connected account via the `stripeAccount` request option
      (`modules/stripe-connect-direct`). N orgs ⇒ N intents. The funds settle
      on the org's Stripe balance and never transit FBM's.
    - **Only the server names the account.** The provider reads the
      connected account from the payment-session *context*
      (`shared/stripe-direct-charge.ts` `DIRECT_CHARGE_CONTEXT_KEY`), which
      Medusa's stock `POST /store/payment-collections/:id/payment-sessions`
      route cannot set — that route copies the request body into `data`, and
      the provider refuses a session whose context lacks the marker or whose
      `data.connected_account_id` disagrees with it. A storefront caller with
      a Connect account of their own therefore cannot aim a goods payment at
      it through this provider.
    - **No** `transfer_data` (destination charges), **no** `on_behalf_of`,
      **no** `application_fee_amount`, **no** separate-charges-and-transfers.
      Those are the shapes under which money passes through the platform
      first; the provider refuses them anywhere in its input and the donation
      service's guard refuses to record an intent that carries them
      (`shared/stripe-direct-charge.ts`).
    - **BMC's fee is 0** by the transaction-kind rung of the platform-fee
      chain (`payout-breakdown/fee-resolution.ts`, above the seller override;
      not a plan row, not an override of 0). The checkout asserts the chain
      returned 0 by that rung before minting; the record carries
      `bmc_fee_cents` under a DB `CHECK (= 0)`.
    - **The org bears Stripe's processing fee natively** — that is how a
      direct charge settles. The checkout shows this to the donor as a
      disclosure, never as a transfer FBM made.
    - **FBM writes a record, never a balance.** `donation_split_record`
      (donation module) holds the intent id, the connected account, gross and
      fee cents, and the recipient's verification status, IRS file date and
      org type **frozen at charge time** (L11). It is not a
      `hawala_ledger_entry` — `createTransfer` needs two `LedgerAccount`s and
      moves cached balances, which is the custody shape rule 3 forbids, and
      the hawala guard cannot see USD at all. No `PURCHASE_CONTEXT_REFERENCE_TYPES`
      or `reference_type` entry was added.
    - **Recipient eligibility at charge time**: `partner_org.published`,
      a non-null `stripe_connect_account_id`, and an IRS-affirmed
      `verification_status` (`pub78_eligible`, `bmf_only`) or a
      `coop` / `unincorporated` org type (publishable only with the
      operator's acknowledgement already recorded). Every refusal is the
      same 403 (`shared/community-read-access.ts` `forbidden()`).
    - **Refunds** are issued on the connected account. `charge.refunded`
      records Stripe's `amount_refunded` as `refunded_cents`; the status
      becomes `refunded` only when that covers the gross, a partial refund
      keeps the status and records the amount. Never routed through the
      hawala `processRefund`.
    - The guard lives in the **service layer**
      (`modules/donation/direct-split-guard.ts`,
      `DonationModuleService.recordDirectSplit` / `applyDirectSplitProcessorEvent`)
      for the reason `posture-a-guard.ts` gives: hooks can be bypassed. It is
      strict only; there is no warn or off mode.
    - Connected-account webhooks arrive at `POST /webhooks/stripe-connect`,
      dark (404) with the flag off, verified with
      `STRIPE_CONNECT_WEBHOOK_SECRET` (503 when unset), and applied
      idempotently by intent id — processor first, record second. An intent
      the ledger never recorded is back-filled from a success **only** when
      `event.account` is the connected account the directory holds for the
      org the intent names and that org passes the eligibility rule now; the
      gross is Stripe's `amount`, never the intent's metadata, because
      metadata is writable by whoever holds the connected account.

    The **legacy tier-2 path** — a 501(c)(3) fiscal sponsor as donor of
    record, with the donation accrued on FBM's books
    (`beneficiary.metadata.accrued_balance`) and batch-disbursed weekly — is
    the custody shape legal checkpoint **L24** asks counsel about. It is
    superseded under the flag: `subscribers/donation-order-accrued.ts` and
    `jobs/donation-batch-disbursement.ts` are no-ops and the admin settings
    route refuses `settlement_mode: "ledger_batch"` (409 naming
    `split_processor`) while `FF_NONPROFIT_PARITY_V1` is on. With the flag off
    it is unchanged for tenants without a Connect account. Whether it was ever
    acceptable is not decided here.

    **Needs counsel before live money** (docs/legal/checkpoints.md): **L24**
    — confirm that direct charges (and only direct charges) satisfy the
    custody question; **L25** — commercial co-venturer status; **L11** —
    representing a third party's tax status, surfaced by the frozen snapshot
    and the as-of date shown with every status. The flag,
    `STRIPE_CONNECT_DIRECT_ENABLED` and `STRIPE_CONNECT_WEBHOOK_SECRET` stay
    unset until then; with the flag off nothing on this path is reachable
    (the provider is not even registered, the checkout and the webhook both
    answer 404 before reading a body).

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

#### Card clearing: how a card order enters the ledger (SD-36)

`FF_CARD_ORDER_LEDGER_V1`, default off; `modules/hawala-ledger/card-clearing.ts`.

**What was wrong.** Every order's purchase leg debited the customer's
`USER_WALLET`. FBM's only payment provider is Stripe, so every order is a card
order; the wallet was created at $0, the debit was refused, and the error was
swallowed — no card order reached the ledger. Funding the wallet would have
made it work, but a customer-held balance is exactly what the closed-loop
rule in `posture-a-guard.ts` rules out (no balance-holding outside the
purchase-to-payout context), so that was never the fix.

**What it does instead (flag on).** A single SYSTEM account,
`CARD_CLEARING` / owner `stripe`, USD only, stands for money that came in
through FBM's own Stripe account. A card order settles once that order's
own money is captured (never on authorisation alone): the purchase leg is
`CARD_CLEARING -> ESCROW`, then the usual fee, processing and seller legs out
of escrow. On a multi-seller cart each seller's order settles for its own
share. A refund's customer leg is `ESCROW -> CARD_CLEARING`, back to the card,
for exactly what was refunded on that order — as Medusa or Mercur record it.
A refund or chargeback made directly in the Stripe dashboard never reaches
Medusa (its Stripe webhooks handle payment intents only), so it never reaches
the ledger either; that is an operational gap recorded in SD-36, not a
balance anyone holds.

**Why this stays inside the posture.**

- No customer balance. A card order never reads, creates or credits a
  customer wallet, and a refund returns to the card, not to a wallet. Card
  orders previously left a $0 wallet behind; they no longer create one.
- No new value. `CARD_CLEARING` is the only ledger account allowed below
  zero (it reads as minus the card money received and not refunded), and
  `createTransfer` refuses every leg touching it except a `PURCHASE` into the
  order escrow or a `REFUND` out of it, each with an `order_id`. It cannot
  pay a vendor, a wallet or a payout directly, and both sides of one leg can
  never be clearing. The non-negative CAS on every other account is
  unchanged, and the account's identity is re-checked in the SQL itself.
- USD only. The account is USD; the cross-rail check already refuses a CCR
  leg against it, and the clearing guard refuses any non-USD clearing account
  besides.
- Not FBM's money, not FBM's books. A Stripe Connect direct charge (rule 10)
  posts nothing here.
- No new reference type, no new entry type.

**What it does not change.** Vendor payouts still terminate at Stripe ACH
(the payout path is untouched); the ledger records the purchase-to-payout
context that already existed on paper. Whether the operator needs counsel's
view before setting the flag is the operator's call; this section records the
design, not a legal conclusion.

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

- `DonationModuleService.recordDirectSplit` and `applyDirectSplitProcessorEvent`
  are the only writers of `donation_split_record` **that run the guard**: both
  call `assertDirectSplitInvariants` (`direct-split-guard.ts`) before the
  write — charge on a connected account, none of `transfer_data` /
  `on_behalf_of` / `application_fee_amount`, `bmc_fee_cents === 0`, a dated
  recipient snapshot, and no `HAWALA_LEDGER_MODULE` resolution in the flow
  that produced the record. Strict only. `MedusaService` also generates
  `createDonationSplitRecords` / `updateDonationSplitRecords` on the same
  class; they bypass the guard and are not to be called directly — for a
  write that reaches them anyway, the DB CHECKs below are the only rules left.
- `donation_split_record` carries `CHECK (bmc_fee_cents = 0)`,
  `CHECK (gross_cents > 0)` and `CHECK (refunded_cents IS NULL OR 0 ≤
  refunded_cents ≤ gross_cents)` at the DB layer; `stripe_payment_intent_id`
  is unique (partial, `WHERE deleted_at IS NULL`, declared on both the model
  and the migration), so the processor's intent id is the record's
  idempotency key.
- `modules/stripe-connect-direct` is the only provider that can mint a
  donation intent; it exists in the process only when
  `FF_NONPROFIT_PARITY_V1`, `STRIPE_CONNECT_DIRECT_ENABLED="true"` and the
  platform `STRIPE_API_KEY` are all set (`registration.ts`).
- Legacy (flag off only): `fiscal_sponsor_account_id` on `donation_settings`
  names the LedgerAccount the batch-disbursement job would credit under
  `settlement_mode: "ledger_batch"`. Under the flag that job, the accrual
  subscriber and the `ledger_batch` setting are retired (see rule 10).

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
- **`InvestmentPool`** (with `Investment`): pooled investment vehicle.
  Quiescent under Posture A unless and until the offering is structured under a
  securities exemption (Reg CF, Reg A, Coop Investment Cooperative) with
  appropriate filings. *2026-09-09:* this bullet claimed quiescence that was
  never enforced. `POST /vendor/hawala/pools` created an `ACTIVE` pool with a
  caller-chosen `roi_type` behind seller auth alone; `GET /store/hawala/pools`
  listed them; `POST /store/hawala/investments` debited a customer's
  `USER_WALLET` into one; and `/store/hawala/deposit` funds that wallet by
  Stripe ACH. The pool and investment routes sit behind
  `FF_INVESTMENT_POOLS_V1` (`api/middlewares.ts`), default off. The customer
  wallet routes (`/store/hawala/wallet`, `/deposit`, `/withdraw`,
  `/bank-accounts`, `/bank-accounts/link`, `/transactions`) were not behind it,
  despite this bullet saying so; since 2026-10-06 they sit behind their own
  `FF_CUSTOMER_WALLET_V1` (storefront twin `NEXT_PUBLIC_FF_CUSTOMER_WALLET_V1`),
  default off (ledger SD-35). Flipping it is the activation this
  bullet gates, and it is also a `REPO_CONSOLIDATION_REVIEW.md` §8 item
  (revenue-share cash-in). See `docs/TRANSMUTATION_STRATEGY.md` §7.2. Note the
  pool's `auto_invest_percentage` field is settable but read by nothing: the
  auto-invest branch in `processOrderPayment` fires only when a caller passes
  the percentage, and the live order subscriber does not.
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

`pnpm test:posture-a` (`backend/package.json`, pattern `posture-a`) runs in
`.github/workflows/security.yml` — not in `ci.yml` — and collects two specs.
What they actually assert, and nothing more:

`backend/src/modules/hawala-ledger/__tests__/posture-a-invariants.unit.spec.ts`

1. `assertPurchaseContext` passes a CCR transfer that carries an `order_id`,
   a `cart_id`, or a recognised `reference_type` + `reference_id`, and
   rejects a CCR transfer with none (strict mode), including an empty
   `reference_id`.
2. Non-CCR currencies pass through; issuer entry types (`ISSUE`, `BURN`,
   `CREDIT_PAYOUT_MINT`, `CREDIT_REFUND_BURN`) pass through.
3. `warn` and `off` guard modes do not throw.
4. The constant sets (`PURCHASE_CONTEXT_REFERENCE_TYPES`, `ISSUER_ENTRY_TYPES`,
   `CCR_CURRENCY_CODE`) hold their documented values.

`backend/src/modules/donation/__tests__/posture-a-direct-split-invariants.unit.spec.ts`

5. `assertDirectSplitInvariants` rejects a record whose charge is not on a
   connected account, an intent carrying `transfer_data` / `on_behalf_of` /
   `application_fee_amount` at any depth, a non-zero `bmc_fee_cents`, a
   non-positive or non-integer gross, a non-donation kind, a missing or
   undated recipient snapshot, an IRS-affirmed status without the file's
   as-of date, a snapshot that is neither IRS-affirmed nor a non-IRS org
   type, and a flow in which `HAWALA_LEDGER_MODULE` was resolved; it has
   no warn or off mode.
6. `PURCHASE_CONTEXT_REFERENCE_TYPES` carries no donation or split entry.
7. Through the real `DonationModuleService` (prototype, shadowed CRUD):
   `recordDirectSplit` runs the guard before the write, is idempotent by
   intent id and refuses to re-attach an intent to another account;
   `applyDirectSplitProcessorEvent` is monotone (a full refund is terminal;
   a late failure cannot un-succeed), records a partial refund as
   `refunded_cents` without moving the status and clamps it to the gross,
   refuses an account mismatch, ignores an unknown intent without a
   fallback, and creates from a fallback only under the same guard.

What this gate does **not** assert, and nothing else in CI does either:
that `HawalaLedgerModuleService`'s public methods call the guard (the
service-layer wiring is read, not tested); the Stellar asset
`authorization_required` / `authorization_revocable` flags; the
`EscrowAgreement.subject_type` CHECK (that is a DB constraint in
`Migration20260510AddEscrowAndPatronage.ts`, exercised only by a database);
any Stripe call shape (the provider and route specs under `pnpm test:unit`
cover `{ stripeAccount }`, the forbidden parameters, the server-only context
marker, idempotency against a Stripe fake with idempotency semantics, and the
webhook's account pinning — but they are not in this gate). Do not cite "the
posture gate passed" as evidence of any of those.

A failing posture invariant blocks merge. Treat this gate as
non-overridable.

## Open posture questions

- **Fiscal sponsor selection**: ✓ Resolved as a working recommendation
  (Allied Media Projects) for the **legacy tier-2 path only**. See
  `docs/FISCAL_SPONSOR_DECISION.md` for the evaluation matrix and the open
  agreement / board-sign-off items. The sponsor `live` flag stays false in
  `backend/src/modules/donation/fiscal-sponsors.ts` and the donation widget
  surfaces "pending fiscal sponsor" copy. With `FF_NONPROFIT_PARITY_V1`
  **off**, a donation chosen at checkout still accrues in pending state on
  FBM's books (`beneficiary.metadata.accrued_balance`) — the custody shape
  L24 asks about. With the flag **on**, that accrual is a no-op and
  donations are direct charges on the org's own account (rule 10); whether
  the sponsor path is retired for good is operator input, not decided here.
- **Direct-charge donations (L24, L25, L11)**: needs counsel. Rule 10 is
  built so that nothing on the path is reachable until the operator sets
  the flag and the Stripe env after clearance.
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
