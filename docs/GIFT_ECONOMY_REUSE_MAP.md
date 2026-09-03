# Gift economy — what already exists to build it on

Status: **findings, no code**. Companion to `docs/GIFT_ECONOMY_READINESS.md`, which
catalogues the gaps. This one answers the follow-up: for each gap, what does FBM
already have?

The short version: **the gaps are smaller than the readiness audit implies**, because
five of them have a module that already does the work and was simply never wired to
listings or gifts. One gap turns out to be worse than described, and it is in the
compliance document rather than the code.

## The map

| Gap (readiness audit) | Existing feature | What is actually missing |
| --- | --- | --- |
| No asset ingestion; nowhere to put a sprite | `minio-file` — a real Medusa file provider, **registered** in `medusa-config.ts:350-366` behind `MINIO_*` env with `@medusajs/medusa/file-local` as fallback. Supports presigned uploads (`ProviderGetPresignedUploadUrlDTO`) | A vendor-scoped upload route, and `creator_listing.assets` storing a file id instead of a creator-hosted URL |
| Uploads have no MIME allowlist or size cap | `api/admin/digital-products/upload/[type]/route.ts` — `uploadFilesWorkflow` with a 15-type MIME allowlist and a 100 MB cap, and a public/private access split | Only that it is admin-only. The validated path exists; the vendor path bypasses it |
| No moderation state machine of any kind | `request` — a generic polymorphic approval: `type` (free text), `data` (JSON), `submitter_id`, `reviewer_id`, `reviewer_note`, and a `pending → accepted / rejected / completed / cancelled` lifecycle. Already backs seller registration end to end | Nothing structural. A `type: "listing_review"` row reuses the model, the admin queue and the lifecycle as-is |
| A designer share cannot be funded from a 3% fee | `creator-credits` — CCR mint from a platform issuer (`CREDIT_PAYOUT_MINT`), per-creator CCR wallet, balance and transaction reads, closed-loop redemption burn (`CREDIT_REFUND_BURN`). Posture-A cleared, dark behind `FBM_CREATOR_CREDITS_LIVE` | Nothing, for the earning half — see the caveat below, which is the whole story |
| Creators cannot be paid; no Stripe Connect | The same rail. CCR is closed-loop, so it needs no Connect, no ACH, and does not touch LEG-3 at all | The spend path. See **The gap that is worse than described** |
| No fee floor on a micro-transaction | `payout_config.platform_fee_min` — the column exists | It has no reader. Wiring it is a one-line change plus an operator decision on the value |
| Self-dealing is half-blocked | `referral` blocks self-referral **three ways**: `isValidAttribution` on write, `isReferralEarning` on the earning rule, and a `CK_seller_referral_not_self` DB CHECK — with the rationale written down ("a seller paying themselves out of their own orders is a laundering shape, not a referral") | The pattern is right there to copy. What is missing is a customer↔seller identity link, since `cus_*` and `sel_*` ids cannot collide |

## The one that changes the design

**The designer's share does not have to come out of the platform fee.**

The readiness audit framed this as a dead end: a 3% fee on a 100¢ gift is 3¢, so a
fee-funded designer share is arithmetically real and economically empty, while a
gross-funded one inverts the invariant the payout module is built on ("a developer share
can never change what the seller receives").

`creator-credits` is a third option that was already built and never connected to this
problem. The designer's reward is **minted** on the CCR rail by the platform issuer, not
carved out of anything. It is therefore not bounded by the 3% fee, it does not touch the
streamer's net, and it does not need a buyer-designated third leg — which keeps it clear
of Posture A rule 9 by construction rather than by argument.

Everything it needs exists: `getOrCreateCreatorCcrAccount`, `getOrCreateCcrIssuerAccount`,
`getCreatorCreditBalance`, `listCreatorCreditTransactions`, the mint and burn entry types
(already in the `LedgerEntry` enum and in `posture-a-guard.ts`'s `ISSUER_ENTRY_TYPES`),
and the dark-launch flag. The XP→credits conversion in `creator-credits.ts` is a working
precedent for minting a reward against non-monetary contribution.

**Minting is not free.** A credit is a claim on real goods: when it is spent, a vendor is
paid real money for what it buys. It is a marketing and loyalty cost carried by the
platform, bounded by what the issuer account is seeded with — `creator-hub.ts:89-92` is
explicit that an unfunded issuer makes conversions fail safely rather than silently
overdraw. That bound is a feature: it caps the platform's exposure at a number an
operator sets, which the 3%-of-a-dollar problem never could.

## The gap that is worse than described

> **Update (2026-09-02): partly closed — read the specifics, not the
> headline.** Commit `1af77af` landed the CCR cart-**reservation** lifecycle
> (`lib/ccr-cart-ledger.ts`, `lib/ccr-checkout.ts`,
> `POST /store/carts/[id]/credits`, and the `validate-ccr-reservation` hook
> wired into `complete-cart-validate.ts`), so the `CART` purchase context
> described below as "a permission granted for a mechanism that was never
> built" now has its writer, and `BURN` has its first real caller. The
> compliance-document correction this section calls for was made separately
> in `dec8156`.
>
> **CCR still cannot be spent.** By that commit's own statement, credits are
> tender and the tender half is not built: applying credits must reduce the
> cash charged while the vendor is still paid in full, and the reduced-amount
> payment collection is not implemented. `completeCartWorkflow` therefore
> refuses any cart holding a reservation — the one transition that could
> charge full price *and* consume credits is deliberately bolted shut. The
> whole surface is dark behind `FBM_CCR_CHECKOUT_LIVE` and
> `FBM_CCR_CENTS_PER_CREDIT`, both operator config with no defaults.
>
> So this section's conclusion still holds: paying anyone in CCR before the
> tender half exists recreates the shape it warns about.

`docs/POSTURE_A_COMPLIANCE.md` states, as one of the three ways the closed-loop rules are
"enforced architecturally":

> Workflow hooks reserve credits at cart-create and release at cart-complete or
> cart-abandon; orphan reservations are reaped nightly.

**None of that exists.** Verified:

- `backend/src/workflows/hooks/` contains exactly three hooks —
  `add-to-cart-validation.ts`, `complete-cart-validate.ts`,
  `validate-sliding-scale-tier.ts`. None reserves credits.
- A backend-wide search for `reserveCredits` / `releaseCredit` / `creditReservation`
  returns nothing outside an asset-graph manifest description.
- The storefront's `lib/data/coalition-credits.ts` exposes `getCoalitionCreditsWallet`
  and `listCoalitionCreditsTransactions` — reads only. There is no apply-at-checkout.
- No route, workflow or panel anywhere in `backend/`, `storefront/` or `vendor-panel/`
  references applying credits to a cart under any spelling.

Two independent confirmations, either of which stands alone:

- **`CART` is an allowed purchase context with zero writers.**
  `posture-a-guard.ts`'s `PURCHASE_CONTEXT_REFERENCE_TYPES` includes `CART` precisely so
  that a cart-time credit reservation would clear the closed-loop guard. Nothing in the
  codebase ever writes a ledger entry with `reference_type: "CART"`. The permission was
  granted for a mechanism that was never built.
- **The only CCR mint and burn sites are the two creator-credits routes.**
  `convert-xp` mints (`CREDIT_PAYOUT_MINT`), `withdraw` burns (`CREDIT_REFUND_BURN`), and
  nothing else touches either entry type. The entire CCR lifecycle today is
  XP → credits → manual settlement.

So CCR today can be **minted and burned, but not spent**. The consequences:

1. The compliance document overstates what is architecturally enforced. It is the
   governing artifact for every money-touching module, and one of its three enforcement
   claims describes machinery that was never built. That is worth correcting on its own,
   independently of gifts.
2. Paying designers in CCR **before** a spend path exists would recreate the exact shape
   Posture A §3 forbids — a balance that holds value independent of commerce flow. It
   would be the same defect as the `SELLER_EARNINGS` accrual, in a second currency.

The redemption route is a real exit, but a manual one: `withdraw` burns credits back to
the issuer and records the burn "pending manual settlement". For a small co-op that is a
defensible starting posture. It is not a spend path, and it should not be described as
one.

## What this changes about sequencing

The readiness audit's step 1 was "make one person payable", with Stripe Connect on the
critical path. That is still true **for cash**. It is not true for the gift economy,
which can run entirely on the closed-loop rail — if, and only if, credits can be spent.

Revised, with the cheaper path first:

1. **Wire CCR spend at checkout**, and correct `POSTURE_A_COMPLIANCE.md` to match
   whatever is actually built. This is the single highest-leverage item in either
   document: it turns an existing, Posture-A-cleared, already-dark rail into a working
   compensation loop, and it closes a false claim in the compliance artifact.
2. **Vendor upload route** on the existing `uploadFilesWorkflow` path, and store a file
   id on `creator_listing.assets`.
3. **Listing review** as a `request` row.
4. **Then** the gift-specific work: a member-publishable priced listing type, the
   `gift_sku` namespace, and the designer payee — which by then is a mint on a rail that
   already works, not a carve-out of a fee that cannot fund it.

Stripe Connect stays necessary for cash payouts and for anyone who wants dollars rather
than credits. It stops being a blocker for shipping the gift economy at all.

## Not resolved by any of this

- **A member still cannot publish.** `request` + `seller-approval-service` is the
  existing path and it requires manual admin approval. Whether an ordinary member gets
  a self-serve or auto-approved tier is an operator decision, not a missing feature.
- **Tax.** Credits are almost certainly a different tax question from cash, and probably
  a lighter one, but "probably" is not a posture. `PRE_LAUNCH_AUDIT.md` LEG-5 (no W-9/TIN
  collection while UI copy promises 1099s) is unchanged either way.
- **The `tips` three-way split.** Migration 003's
  `CHECK (fee_cents + net_cents = gross_cents)` still forbids a third payee on a tip row,
  whatever currency the third payee is paid in.
