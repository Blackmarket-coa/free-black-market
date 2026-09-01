# Gift Economy — readiness audit

Status: **findings, no code**. Companion to `docs/GIFT_VOUCHER_PLAN.md`.

This is what a four-way parallel read of the create → publish → send → split → pay out
chain actually found, against the proposal for a user-created gift economy: members
author customizations, publish them, and earn when a viewer sends their gift to a
streamer.

**The headline: the chain is not 80% built. It is a set of well-modelled ends with the
middle missing, and several of the pieces that look wired are not.** Every claim below
was verified by opening the file. Where an earlier assumption was wrong it is corrected
explicitly, because the wrong version is the more attractive one and will be re-proposed
otherwise.

## Corrections to the optimistic read

| Claimed | Actually |
| --- | --- |
| Blackout already does single-shot gifting on the tip rail | **No payment is ever requested.** `sendGift` records a tip obligation and returns 201; the UI says "Sent". Nobody is charged, no FBM order exists, `fbmOrderId` stays null |
| Gifts capture through the marketplace webhook | `metadata.tipId` is documented in three files and read at `marketplaceWebhook.ts:174`, and **set by nobody**. That capture branch has never executed |
| `creator_listing.developer_seller_id` exists for exactly this split | **Dead column.** Declared at `models/creator-listing.ts:87`, indexed in `Migration20260506300`, never written or read. Docblock intent, not behavior. `compatible_with` is dead the same way |
| A member can publish a customization | **No code path exists.** Publishing needs a `seller_id`; a seller exists only after manual admin approval (`shared/seller-approval-service.ts:318`), and Blackout account-linking explicitly refuses to create one (`integrations/blackout/link/route.ts:105-109`) |
| The split machinery just needs a third payee | `tips` migration 003 pins `CHECK (fee_cents + net_cents = gross_cents)`. A third payee is **impossible without a migration**, and `storeOrderBreakdown` never persists the plugin/referral totals it already computes |
| Categories like `emoji-sticker` mean the catalog is ready | No route creates a listing that is **both signed and priced** — the two create paths are disjoint. One takes manifest/assets and no price; the other takes price and hardcodes `manifest: {}`, `version: "0.0.0"` |

## Fixed on this branch

Seven of the defects below have been fixed, with tests. Each was live and none
was specific to the gift economy.

| Defect | Fix |
| --- | --- |
| Any holder of the shared API key could publish, un-suspend or hard-delete **any** seller's listing | Both commerce routes require an owner assertion and 403 on mismatch; publish additionally 409s on a SUSPENDED listing. Blackout forwards the owner it already verified; the stub enforces it too |
| Vendor money routes read the middleware-rewritten `mem_*` id, so payouts threw and earnings minted a second empty `$0` account | One `resolveVendorSellerId` helper across 17 call sites; the rate-limit bucket keeps the raw actor id deliberately |
| `payout.paid` / `payout.failed` could never match a row, so a failed payout never triggered its compensating refund | Withdraw route persists `stripe_payout_id`; webhook matches PENDING or PROCESSING and skips terminal rows so a retry cannot double-refund |
| A creator could publish a slug once and never ship a second version | Archiving now releases the slug (`Migration20260901ArchivedSlugReuse`); both create routes ignore archived rows |
| Carve-outs were disbursed **before** the settlement that funds them, so on a cold platform-fee account every share deferred and nothing retries | Disbursement moved after `processOrderPayment`; the breakdown is still stored first, so what is owed survives either way |
| `total_to_plugin_developers` / `total_to_referrers` had no writer, so nothing recorded what a payee was owed | Both persisted in `storeOrderBreakdown` |
| A test pinned a "live" promotion expiry to `2026-09-01`, coming due as a CI failure on that date | Made relative to now |

Still open below, and deliberately not rushed: the fractional-vs-rounded fee,
refund reversal for fee-funded shares, self-dealing detection, and the whole
payout link. Notes on each:

- **Self-dealing (payee == buyer)** is not the one-line id comparison it looks
  like. Payees are `sel_*` and buyers are `cus_*`, so the ids cannot collide;
  the real control is linking customer and seller identity and comparing
  *that*. A shallow id check would look like protection and provide none.
- **The payout link** is a project, not a fix. Nothing in it is safe to do
  piecemeal, and `ACH_PAYOUTS_ENABLED` is an open legal decision that has
  already been declined once.

## Defects that exist today, independent of this feature

These are live. They are not gift problems; the gift feature would simply be the first
thing to stand on them.

### Security

- **Ownership bypass on publish.** `POST /v1/integrations/blackout/commerce/seller/listings/[id]/publish`
  resolves the listing **by id alone, with no seller scope** (`publish/route.ts:16`), then
  sets `PUBLISHED` with `signed_at=now` — no signing, no manifest validation, no
  `SUSPENDED` check. Anyone holding the shared `FREEBLACKMARKET_API_KEY` can publish or
  effectively un-suspend any seller's listing. The sibling `DELETE` hard-deletes any
  listing the same way. Logged as debt at `docs/contracts/extension-manifest.md:176`.
- **The signature attests to a hash the seller typed in.** FBM never fetches
  `code_blob_url` or `assets[].url`; the SHA-256 values are accepted on a
  `/^[a-f0-9]{64}$/` regex and fed into the signed payload. The platform Ed25519 key
  certifies a client assertion, not bytes the platform saw — and the URL is the
  creator's own host, whose contents can be swapped after signing.
- **The only seller-reachable upload has no MIME allowlist and no size cap**, forced to
  `access: 'public'` (MercurJS `/vendor/uploads`). The validated route (100 MB cap,
  MIME allowlist) is admin-only.

### Money

- **Disbursement runs before the settlement that funds it.** In
  `subscribers/hawala-order-payment.ts` the plugin and referral shares are paid at
  :214-231, but `processOrderPayment` — which writes the ESCROW→PLATFORM_FEE leg — is
  not called until :295-326. On a cold `PLATFORM_FEE` account every share defers, and
  **no reconciliation job retries a deferred share.** Payees are paid only out of
  residue from earlier orders.
- **The buyer leg needs a prepaid wallet, and its failure is swallowed.**
  `processOrderPayment` leg 1 debits the buyer's `USER_WALLET`. With no stored balance
  `createTransfer` throws "Insufficient balance", and `hawala-order-payment.ts:346-349`
  catches and only logs. **An order settles with zero ledger entries and nothing
  surfaces.** The only funders of that wallet are the ACH deposit route and the Stripe
  webhook — i.e. exactly the stored balance the no-coins constraint forbids.
- **Fractional ledger fee vs rounded breakdown fee.** `hawala-order-payment.ts:140-146`
  computes the platform fee in dollars with no rounding; `service.ts:332` computes
  `Math.round(cents)`. `PLATFORM_FEE` is credited 0.075 for a 250c gift while the
  breakdown carves against 8 cents, so a carve-out can exceed what was credited. On the
  gift price ladder this fires on the **second** SKU.
- **Refunds never reverse plugin or referral shares.** Only creator commission is
  reversed (`process-refund-reverses-commission.ts`). "Payout never exceeds collected"
  holds at settlement and stops holding the moment a gift is refunded or charged back.
- **The breakdown items array is already not a partition** of `customer_paid` —
  `communityFund` and `paymentProcessing` are reported in totals and subtracted from
  nobody. Any new payee line is added to an array that does not balance.
- **Self-dealing is half-blocked.** Both share computations exclude payee == selling
  seller; **neither excludes payee == buyer**, and no code compares an allocation payee
  against `customerId`. Designer-gifts-own-asset-to-a-confederate routes the designer
  share back out of their own payment; a three-account ring defeats pairwise checks
  anyway. `jobs/attribution-fraud-sweep.ts` covers creator attribution and has no
  equivalent here.

### Payout — the load-bearing gap

Nothing in this section is about gifts. It is about whether anyone on this platform can
be paid at all.

- **No Stripe Connect anywhere.** Not one `accounts.create`, `accountLinks.create`,
  `transfer_data`, `application_fee_amount`, `on_behalf_of`, or `{stripeAccount}` call
  in either repo. `creator_payout_account.external_account_id` is modelled and never
  written. `createConnectTransfer` (`stripe-ach.ts:300-321`) — the correct primitive —
  has **zero call sites**.
- **`@mercurjs/payment-stripe-connect` is a trap by name.** Declared dependency, unpacked
  in `node_modules`, registered nowhere, and its shipped provider contains zero Connect
  features. It also pins `stripe: ^19.1.0` against the app's 17.7.0.
- **The registered provider cannot do destination charges.** `@medusajs/payment-stripe`
  2.14.2 has no `transfer_data` / `application_fee_amount` / `on_behalf_of` support in
  its dist. Processor-level splits need a custom provider, or a `paymentIntents.update`
  between authorize and capture.
- **Flipping `ACH_PAYOUTS_ENABLED` does not yield a payout.** The withdraw route passes
  `bankAccount.stripe_bank_account_id` as `destination` to `stripe.payouts.create`, but
  that field holds a `pm_*` Financial Connections payment method attached to a
  *customer*. `payouts.create` pays the platform's own external account and does not
  accept a customer payment method. The flag is not the only thing in the way.
- **The `payout.paid` / `payout.failed` webhook can never fire** — it filters on
  `stripe_payout_id` + status `PENDING`, while the withdraw route writes
  `stripe_transfer_id` + status `PROCESSING`. Two independent misses, so a failed payout
  never triggers its compensating refund and a customer stays debited against money that
  bounced.
- **The vendor payout route is broken by an identity mismatch.** Earnings accrue under
  `sel_*`; `api/vendor/hawala/payouts/route.ts` reads `auth_context.actor_id`, which the
  vendor middleware deliberately rewrites to `mem_*`. `requestPayout` throws "Vendor
  account not found" — and the sibling earnings route has the same bug but **creates**
  the missing account, silently minting a second, permanently-empty `SELLER_EARNINGS`
  row and showing the creator a $0 balance.
- **`CREATOR_EARNINGS` has no payout path at all.** Every payout query filters
  `account_type: 'SELLER_EARNINGS', owner_type: 'SELLER'`, so everything
  `creditCreatorCommission` and `creditCreatorReward` write is unreachable.
- **Nothing consumes `PayoutRequest`.** `requestPayout` debits SELLER_EARNINGS →
  SETTLEMENT and sets `PROCESSING`; no job, route or subscriber advances it, and nothing
  ever debits `SETTLEMENT`. Vendor payout money accrues into a platform system account
  permanently.
- **No seller can attach a payout destination.** `createBankAccounts` has one call site,
  hardcoded to `owner_type: 'CUSTOMER'`. There is no `/vendor/hawala/bank-accounts` route.
- **Payout tiers are fiction.** INSTANT / SAME_DAY / NEXT_DAY / WEEKLY are declared and
  surfaced to the vendor UI as selectable; nothing implements RTP, FedNow or debit-card
  push anywhere.
- **No KYC or tax collection.** `PRE_LAUNCH_AUDIT.md:232` (LEG-5): W-9/TIN collection is
  not implemented while UI copy promises 1099s. Paying thousands of small designer
  shares makes this a hard blocker.

## The economics do not work at the proposed fee

Default `platform_fee_percent` is 3, and Blackout's tip split is 300 bps. On the existing
gift ladder the entire platform fee is:

| Gift | Price | Platform fee (3%) | Left for a designer after plugin + referral |
| --- | --- | --- | --- |
| Spark | 100c | 3c | under 3c |
| Flame | 250c | 7.5c | under 7c |
| Galaxy | 5000c | 150c | under 150c |

Carving the designer out of the platform fee is arithmetically real and economically
empty at the low end, where the volume is. Funding them from the streamer's gross
inverts the invariant the entire payout module is built on — "a developer share can
never change what the seller receives" (`payout-breakdown/service.ts:347-349`) — and
would have to be disclosed to the streamer.

`platform_fee_min` and `platform_fee_max` exist for exactly this and are **dead columns**
with no enforcement. A per-listing-type fee floor is the smallest honest fix.

## Compliance notes that change the design

- **Posture A rule 9 constrains the shape, and it is satisfiable.** "FBM does not let a
  payer designate funds to flow to a recipient who is neither the seller of the listed
  goods nor a registered donation beneficiary." The gift designer is exactly that third
  party. Paying them **out of the platform fee** — money FBM already collected — is
  compliant. A buyer-designated third leg is not. This is an argument for the
  platform-fee funding model even though its economics are worse, and therefore an
  argument for raising the fee floor on gifts rather than changing who funds the share.
- **The Posture A guard does not guard USD.** `assertPurchaseContext` returns immediately
  for any non-CCR currency; USD/USDC/GIFT are explicit passthrough. The purchase-context
  discipline has to be enforced by design, not inherited from the guard.
- **Gifts cannot move to CCR to gain that guard.** `createTransfer`'s same-rail check
  would then forbid a CCR debit crediting a USD earnings account, so the streamer could
  not be paid in cash-convertible units at all.
- **The bounty path is genuinely approved, for the shape it actually has.**
  `DemandBounty` already carries `CREATOR_NEEDED` / `MARKETING_NEEDED` objectives, USD
  `currency_code`, escrow fields and milestones, and `DEMAND_BOUNTY` has a written Posture
  A review in `POSTURE_A_COMPLIANCE.md`. That review approves it because "value moves
  against work performed". A **one-time commission** for a custom gift fits exactly. An
  **open-ended share of future sends does not** — that is a profit-participation
  interest, the `InvestmentPool` category the same document keeps quiescent pending a
  securities exemption. Use the bounty for the commission and a frozen
  `terms_snapshot` deal record for any ongoing split.
- **Escrow currently funds from the buyer's internal wallet**
  (`collective-hawala.ts#escrowParticipantFunds`), so a bounty inherits the stored-balance
  problem unless funded directly from a checkout.

## Blockers specific to a designer's working life

- **A seller can publish a slug exactly once and can never ship v2.** PATCH 409s on a
  published listing telling you to bump the version and create a new draft; POST 409s
  `duplicate_slug` because the existence check has no status filter; DELETE only archives
  and does not free the slug. Designers iterate on sprites constantly — this is
  discovered only after the first publish.
- **Suspension is seller-wide and irreversible.** There is no unsuspend. The admin route
  suspends every non-archived listing a seller owns plus their payout account. One bad
  gift permanently removes every gift that designer ever made.
- **There is nowhere to put a sprite.** `creator_listing.assets` is written at create and
  read exactly once, to build signature hashes. It is absent from both public mappers;
  the only image that survives is `media_urls[0]` as a product thumbnail. No dimensions,
  duration, loop behavior, or audio.
- **No global SKU namespace.** `creator_listing` is unique only on `(seller_id, slug)`,
  but a `gift_sku` is the attribution key on the tip and must be globally unique and
  stable forever.
- **The shadow product is publicly purchasable outside the gift flow** — created
  `PUBLISHED` on the default sales channel, so every priced gift is also a browsable
  storefront product, buyable with no recipient and no streamer to pay. That is a direct
  route around the three-way split.
- **Status vocabularies disagree across the repo boundary.** FBM:
  draft|signing|published|archived|suspended. Blackout:
  draft|pending_review|published|rejected|archived. Neither is a superset; Blackout's
  normalizer drops anything not exactly `published`, so a listing mid-`signing` vanishes
  and `suspended` is indistinguishable from `draft`.
- **No moderation state machine of any kind.** For a user-created catalog whose assets
  render over someone else's live stream, this is ship/no-ship on its own.

## What this means for sequencing

The gift economy cannot be the first thing built on this stack, because it would be the
first thing to depend on a payout path that does not work, a publish path an ordinary
member cannot reach, and a split that a DB constraint forbids.

A defensible order:

1. **Make one person payable.** Connect account creation, the `account.updated` webhook,
   the `sel_*`/`mem_*` identity fix, a vendor bank-account route, and either a
   `PayoutRequest` executor or destination charges. Nothing else matters until a
   creator can withdraw one dollar.
2. **Fix the money defects above** — disbursement ordering, the swallowed insufficient-
   balance throw, fractional-vs-rounded fee, refund reversal for fee-funded shares.
   These are wrong today for plugin and referral payees already.
3. **Close the publish bypass and the upload gap**, and decide the moderation model.
   These are prerequisites for any user-generated catalog, gift or not.
4. **Then** a member-publishable, priced, signed listing type, and only then the third
   payee and the dynamic gift catalog.

Steps 1-3 are worth doing whether or not the gift economy ships. That is the strongest
argument for doing them first.

## Provenance

Findings come from a parallel four-agent read of the chain (create/publish, send,
split, payout) with every assertion cited to file and line. The adversarial stress pass,
the economic model panel, and the trust/abuse read did not complete — the session hit its
usage limit — so this document is **grounding without the refutation pass**. Treat the
defect list as high-confidence (each was read directly) and the sequencing as a proposal
that has not yet been argued against.
