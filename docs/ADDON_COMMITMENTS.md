# Add-on and Pricing Commitments

What FBM promises about paid add-ons and the commission, and what those
promises are worth.

## Why this document is not a "purchased for life" charter

The 2026 marketplace-trust analysis recommended publishing a scope charter for
"purchased for life with updates" add-ons — defining which updates are covered,
what counts as a new paid tier, and what happens to the asset if the coalition
winds down. It cited AppSumo's lifetime-deal strain, ChatPlayground revoking
licences it had confirmed in writing, and ContentGroove vanishing fourteen
months after purchase.

The advice is sound. The premise does not apply here: **FBM sells no lifetime
add-ons.** A repository-wide search for "purchased for life", "lifetime deal",
"lifetime licence" and "lifetime access" returns nothing. The only "lifetime" in
the codebase is lifetime XP on the character sheet.

`backend/src/modules/vendor-plan/addons.ts` says so in its own module docblock:

> An add-on is deliberately NOT a subscription. Each purchase buys a fixed
> window (`duration_days`); buying again while a window is open EXTENDS it from
> its current end […] commitment-free by construction, with no renewal cron, no
> dunning, and no state machine beyond the entitlement's own expiry.

Every pack in `VENDOR_ADDON_CATALOG` is `duration_days: 30`.

So the useful thing to publish is not a scope charter for a promise we never
made. It is a plain statement of the promises the code *does* make — which is
what follows. Introducing a genuine lifetime SKU would be a new product
decision, and it would need the wind-down clause the analysis describes before
it shipped, not after.

---

## The commitments

### 1. An add-on is a window, not a subscription

One purchase buys a fixed number of days — 30 for every current pack. There is
no renewal job, no dunning sequence, and nothing that charges you again unless
you choose to buy again.

Buying while a window is still open **extends** it from its current end rather
than starting a second, overlapping one. You never pay twice for the same days.

Enforced by construction: an add-on is a set of seller-keyed `ACCESS_PASS`
entitlements carrying an `expires_at` (`backend/src/shared/vendor-addons.ts`).
The plan snapshot drops expired rows, so access lapses on its own when the
window closes. Nothing has to run for that to happen — which is also why
nothing can fail to run and leave you charged.

### 2. Nothing is revoked for cost reasons

Access you have paid for runs to the end of its window. We will not shorten a
window, retire a pack out from under an open window, or reprice a purchase
already made.

If a pack is withdrawn from sale, existing windows run out normally. This is the
Jasper-exit standard the analysis identifies as the gold standard, applied to
the shorter promise we actually make.

### 3. The commission never creeps upward

The platform fee is a separate promise from add-ons, and the more important one.

- `PLATFORM_DEFAULT_FEE_PERCENT` in
  `backend/src/modules/vendor-plan/catalog.ts` is the rate a seller pays with no
  plan and no negotiated override.
- Every paid plan's rate is **lower**, and a unit test asserts the ladder falls
  monotonically as plans get more expensive, so an upgrade can never raise
  someone's take rate.
- A further test asserts the free tier sits exactly at the platform default,
  because introducing plans must not have raised what an existing vendor paid.

The rate is published at `/transparency`, read live from that same catalog via
`GET /store/fee-schedule` — so the page cannot quote a number we do not charge.

### 4. Add-ons never gate what should not be gated

Feature keys behind an add-on are tooling. They do not gate:

- Selling, listing, or being paid.
- Verification. No plan or pack grants or accelerates a badge or level
  (`/verification` says so publicly).
- Privacy or encryption commitments.

Quests specifically are opt-in, never auto-enrolled, and never a prerequisite
for selling — a hard constraint recorded in `docs/VENDOR_QUEST_ENGINE.md`.
Dropping a quest never deletes the underlying records.

### 5. What happens if this node winds down

Honestly stated, because the analysis is right that this is where lifetime
deals go wrong:

- Your catalogue and customer list are exportable. There is no exit fee.
- Open add-on windows are short by design, so the maximum exposure is one
  window — days, not the years an unhonoured lifetime deal represents.
- The code is public, so another operator can run the same platform.

**The caveat, stated plainly:** the repository currently has no `LICENSE` file,
and the root `README.md` says to treat the code as all rights reserved. Until a
licence is added, "you could run it yourself" is a description of what is
technically possible, not a right you hold. That gap is tracked as Finding D in
`docs/TRUST_LANDSCAPE_AUDIT.md` and should be closed before any wind-down clause
leans on self-hosting.

---

## If a lifetime SKU is ever introduced

It should not ship without, at minimum:

1. **A covered-updates definition.** Which changes are maintenance (covered) and
   which are a new capability tier (not). Undefined, this is the single largest
   source of lifetime-deal disputes.
2. **A wind-down clause** that does not depend on an unlicensed repository.
3. **A no-revocation guarantee** in writing, honoured even when the economics
   turn — the ChatPlayground failure was not fraud but a vendor deciding the
   deal had become unaffordable.
4. **A holder register** durable enough to honour the promise after a team
   change.

Until all four exist, the 30-day window is the more honest product.

---

## Keeping this honest

The public statement of these commitments lives on `/transparency`
(`storefront/src/app/[locale]/(main)/transparency/page.tsx`). If `addons.ts` or
the plan catalog changes what is actually promised, change both in the same PR.
