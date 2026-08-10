# Trust Landscape Audit

An external competitive analysis — *"The 2026 Marketplace Trust Landscape: A Competitive
Analysis and Product Roadmap for FreeBlackMarket"* — argued that FBM's positioning is
competitively sound but that the platform **asserts** trust ("verified makers",
"community-owned") without the visible proof mechanisms its competitors use, and
recommended ten staged trust artifacts.

This document checks that analysis against the codebase, claim by claim, and records what
we decided to do about each. It follows the same evidence convention as
`docs/BMC_UNIFIED_DESIGN_BEHAVIORAL_SPEC.md`: every verdict cites files, not impressions.

> **Scope note.** The analysis reviewed the live website. This audit reviews the
> repository. That difference explains most of the disagreement below: the analysis
> consistently reports "missing" for systems that are built in `backend/src/modules/` but
> never rendered on a public page. Those are real gaps — a trust signal nobody can see is
> not a trust signal — but they are *surfacing* work, not *building* work, and sizing them
> correctly matters.

---

## Summary

Of the analysis's ten recommendations:

| Disposition | Count | Which |
|---|---|---|
| Already satisfied in code | 1 | connect.js checkout discipline |
| Built but not surfaced — needs a page, a render, or a route | 5 | fee calculator, verification badges, governance, KARMA ladder, quest catalog |
| Genuinely net-new | 2 | buyer-protection policy + claim flow, admin verification write path |
| Premise does not hold | 1 | "purchased for life" add-on charter |
| One-line correction, repeated in 5 files | 1 | the GitHub transparency link |

The audit also surfaced three problems the analysis could not see from outside, and which
we consider higher priority than most of what it recommended. They are listed under
[Findings the analysis missed](#findings-the-analysis-missed).

---

## Claim-by-claim verdicts

### 1. Fee transparency — **Partly wrong**

The analysis recommends building a commission-transparency page with a live calculator and
a competitor comparison table.

That calculator already exists. `storefront/src/components/sections/FeeBreakdown.tsx` is an
interactive widget with a sale-price slider and per-platform fee math for seven platforms
(FBM 3%, Shopify, Etsy, Amazon FBA, Uber Eats, DoorDash, Faire), showing effective rate and
take-home. It renders in exactly one place: `sell/SellPageClient.tsx`.

A second, entirely unused widget set sits at
`storefront/src/components/molecules/PriceTransparency/PriceTransparency.tsx`
(`PriceTransparencyWidget`, `WhereYourMoneyGoes`, `PriceComparison`) — exported from
`molecules/index.ts`, rendered by nothing. A third, `sections/TrustWidget/`, renders only
inside `CartReview`.

The 3% is real in the backend, not just copy: `backend/src/modules/vendor-plan/catalog.ts`
sets `platform_fee_percent: 3` on the free plan (2.5 / 2 / 1.5 on paid tiers),
`payout-breakdown/models/payout-config.ts` defaults to the same, and the fee is booked as a
`COMMISSION` ledger entry in `hawala-ledger/service.ts` and reversed by
`subscribers/process-refund-reverses-commission.ts`.

**Correct part of the claim:** there is no `/transparency`, `/fees`, or `/pricing` route.
Fee transparency is only reachable from `/sell`, `/how-it-works`, and `/why-we-exist`.

**Action:** build the page from the components we already have; source the rate from
`vendor-plan/catalog.ts` so published copy cannot drift from what is charged.

### 2. Vendor verification — **Partly wrong, and worse in one respect**

The analysis reports no badge, no criteria, no verification page.

`backend/src/modules/vendor-verification/` is substantial: `VerificationLevel` (UNVERIFIED
→ SELF_REPORTED → VERIFIED → AUDITED → CERTIFIED), `VerificationType` (7 check types
including IDENTITY, PRODUCTION, PRACTICES, CERTIFICATION), `BadgeType` (14 badges), and a
`BADGE_CONFIG` table in `service.ts` carrying per-badge name, description, icon, colour and
learn-more URL — which is precisely the published-criteria table the analysis asks for.
`seller_metadata.verified` exists; `api/v1/seller/programs/**/decide/route.ts` gates on
`min_verification_level`; `vendor-quest/substrate/build.ts` reads verification into the
quest substrate.

`storefront/src/components/molecules/TrustIndicators/TrustIndicators.tsx` — 434 lines
mirroring all 14 badge types plus level explainers — is **an orphan**. Exported, rendered
nowhere. Vendor cards instead show a naive boolean tick
(`sections/VendorsPage/VendorsPage.tsx:74,412`, `ProducerDetailPage.tsx:94,206`).

**Worse than the analysis reported:** `admin-panel/src/routes/vendor-verification/page.tsx`
is a read-only funnel dashboard (counts, median time-to-verify) fed by
`api/admin/vendor-verification/funnel/route.ts`. There is **no approve/reject/grant-badge
UI and no admin write route**. The badge system as shipped cannot be operated.

**Action:** render `TrustIndicators`, publish a `/verification` criteria page generated from
`BADGE_CONFIG`, and build the missing admin write path first — displaying a badge nobody can
grant would be theatre.

### 3. Buyer protection — **Confirmed**

Returns exist and are Medusa-backed (`(main)/user/returns`, `user/orders/[id]/return`,
`sections/OrderReturnSection/`, vendor-side `return-reasons/`). An escrow dispute state
machine exists (`hawala-ledger/escrow-state-machine.ts`: funded → dispute → disputed →
resolve/recover, with an arbitrator role). Service-contract dispute routes exist.

But there is no buyer-facing dispute or claim flow for ordinary marketplace orders, and no
buyer-protection policy page. The guarantee existed only as **unrendered copy**:
`molecules/ConversionCopy/ConversionCopy.tsx` defined `PaymentProtectionBadge`,
`CheckoutTrustMessage` and `DisputeResolutionMessage` ("Our Protection Guarantee"), none of
them imported anywhere — all three asserting that producers are "paid only after you
confirm delivery".

Note that only those exports were unused; the module as a whole is live
(`ValueProposition` is on the homepage, `ProductTrustBanner` on every product page). Two
further unbacked claims were in the *rendered* half: "Every creator is verified", and a
product banner asserting "Verified producer" on behalf of every seller regardless of their
actual level.

**Action:** publish a policy page and add real claim types to the existing returns flow.
See also [Findings the analysis missed](#findings-the-analysis-missed) — this is not merely
an absence; the site currently promises protection it does not implement.

### 4. GitHub transparency link — **Confirmed, in five places**

`https://github.com` (the bare GitHub homepage) is linked as "View GitHub transparency" or
"Contribute on GitHub" from:

- `storefront/src/app/[locale]/(main)/page.tsx:366`
- `storefront/src/components/organisms/Footer/Footer.tsx:87`
- `storefront/src/data/footerLinks.ts:26`
- `storefront/src/app/[locale]/(main)/sell/SellPageClient.tsx:296`
- `storefront/src/app/[locale]/(main)/why-we-exist/page.tsx:74`

**Action:** point all five at `https://github.com/Blackmarket-coa/free-black-market` from a
single shared constant.

### 5. Cooperative governance — **Confirmed for the public surface**

The analysis is right that nothing is visible. It is wrong that nothing exists.

`backend/src/modules/governance/` models proposals (9 types, quorum, approval threshold, 9
statuses, vote tallies), votes (with `voting_power`, `power_basis`, delegation, changeable
votes), delegations, comments and roles. `api/store/proposals/[id]/votes/route.ts`
implements the voting-power calculation, including `one_member_one_vote` alongside
labour-hours and investment weighting. Patronage is computed by
`hawala-ledger/patronage-compute.ts` into `models/patronage-allocation.ts`, driven by the
quarterly job `jobs/patronage-refund.ts` (settlement itself deferred).
`cooperative/models/cooperative-member.ts` carries member roles and
`revenue_share_percent`.

Storefront governance UI: none. A grep for `proposals` in `storefront/src` returns only
demand-pool barter proposals and prose.

**A scoping correction found while building this out, and the most important part of §5:**
every model in `modules/governance` is keyed by `garden_id` — proposals, votes, delegations,
comments, roles. Governance is implemented at the **project** level, not the platform level.
There is no coalition-wide proposal or ballot, and the module cannot express one.
`cooperative.governance_model` is free text a co-op publishes about itself; nothing enforces
it.

So the homepage's "Community Governed" badge and `/why-we-exist`'s claim that "Coalitions
steer platform-level decisions through petitions and proposals" were not merely
unsurfaced — the second describes a mechanism that does not exist at any layer. Both were
corrected, and `/governance` now leads with that limit rather than the flattering half.

Separately, `docs/GOVERNANCE.md` documents **repo maintainer** governance — core/area
maintainers, PR approval, release gating. It is not member governance, and nothing in the
repo documented member governance. That is a genuine doc gap the analysis did not name, now
filled by `docs/MEMBER_GOVERNANCE.md`.

**Action:** a `/governance` page exposing the real mechanics, plus
`docs/MEMBER_GOVERNANCE.md` cross-linked with the maintainer doc.

### 6. KARMA tiers — **Wrong on the names, right on visibility, and it missed a drift bug**

The analysis states the ladder is Seedling → Cultivator → Griot → Steward → Elder →
Ancestor. It is not. The actual ladder is five tiers: **Seedling / Sprout / Root / Canopy /
Ancestor**. "Cultivator", "Griot" and "Elder" do not exist as tiers anywhere in the
codebase.

A benefits ladder also already exists — twice. `packages/bmc-portal-kit/src/tiers.ts`
carries an `unlocks` string per tier ("Governance voting, wholesale listings" at Root,
"Hub co-governance, node mentorship" at Ancestor) plus `canAccessGovernance()`. Separately,
`backend/src/modules/progression/thresholds.ts` defines `THRESHOLD_PRIVILEGES` — a
distinct, XP-level-based ladder (featured listing, reduced commission, proposal authoring,
den moderation, market-day queue).

**Correct part of the claim:** none of it is public. `/character` and `/rewards` render
progress well but are login-gated, so no prospective vendor can see the benefit ladder
before signing up — which is exactly where the gamification research the analysis cites
says the ladder has to be visible.

See [Findings the analysis missed](#findings-the-analysis-missed) for the drift bug.

### 7. Vendor Quest Engine — **Right that it is not public; wrong that it is not surfaced**

All thirteen quests ship as definitions in `backend/src/modules/vendor-quest/definitions/`
(`fsa-farm-loan`, `grant-readiness`, `microlender-readiness`, `crowdfunding-traction`,
`wholesale-account`, `market-vendor`, `ready-to-hire`, `compliance-tracker`,
`wellness-insurance`, `trust-tier`, `coop-formation`, `land-pooling`,
`commons-contribution`), running through one generic engine with packet generation, a
consent-scoped collective flow, and six unit-test suites.

They are fully surfaced in the vendor panel (`vendor-panel/src/routes/quests/*`, registered
in `route-map.tsx`, with a nav entry), gated behind the `FF_VENDOR_QUESTS_V1` feature flag
**and** the `vendor.quests` plan feature (Scale plan, or the `quest_pack` add-on).

They are not on the public storefront. `/coalition/quests` is a different system entirely
(`backend/src/modules/collective-quest` — community thermometers and group goals).

**Action:** a public catalog page, with the plan gate stated plainly rather than implied
away.

### 8. "Meet the vendor" storytelling — **Partly wrong**

Producers have it end to end: `producer.story` is a real field
(`modules/producer/models/producer.ts:89`), edited in
`vendor-panel/src/routes/farm/profile/page.tsx`, and rendered as an "Our Story" section at
`sections/ProducerDetailPage/ProducerDetailPage.tsx:610`. Product pages carry
`cells/FarmStory/FarmStory.tsx` — an expandable farm story with producer photo, region and
provenance.

General sellers do not. `sections/SellerPageHeader/SellerPageHeader.tsx` renders only
`seller.description`, and `seller_metadata.creator_bio` is never rendered anywhere.

**Action:** render `creator_bio` on seller pages, mirroring the producer treatment.

### 9. "Purchased for life" add-on charter — **The premise does not hold**

The analysis devotes a section to AppSumo-style lifetime-deal backlash and recommends
publishing a scope charter defining covered updates versus new paid tiers.

There is no lifetime promise in this product to scope. `backend/src/modules/vendor-plan/addons.ts`
states in its module docblock that an add-on is *"deliberately NOT a subscription. Each
purchase buys a fixed window (`duration_days`); buying again while a window is open EXTENDS
it."* Every pack in `VENDOR_ADDON_CATALOG` is `duration_days: 30`. A repo-wide grep for
"purchased for life", "lifetime deal", "lifetime license" and "lifetime access" returns
zero hits; the only "lifetime" in the codebase is lifetime XP totals on the character
sheet.

The analysis's underlying advice is still sound — commitments about paid add-ons should be
written down. But the commitment to write down is the one the code actually makes.

**Action:** publish an add-on commitment charter describing fixed windows that extend
rather than stack, no auto-renew, no retroactive revocation, and the "3% never creeps
upward" pledge. Introducing an actual lifetime SKU would be a new product decision, not a
documentation task.

### 10. connect.js checkout discipline — **Already satisfied**

The analysis recommends architecting `connect.js` to keep checkout on FBM and never
intercept external platforms' checkouts, citing Shopify Buy Button and reseller
cross-listing tools.

`storefront/public/connect.js` (1,205 lines) already works this way. It offers three
integration depths — zero-JS `data-fbm="products|services|events|booking|reviews|..."`
attributes, `FBM.render*()` widgets, and a raw API — all read/render only, authenticated by
scoped vendor embed keys (`modules/embed-keys/`, `middlewares/embed-key.ts`) with usage
recorded in `modules/embed-analytics/`. It never touches an external platform's checkout,
because it never touches an external platform.

**Action:** none. Documented here so the recommendation is not re-raised.

---

## Findings the analysis missed

These came out of reading the code and were not visible from the live site. We rank them
above most of the recommendations above.

### A. The KARMA ladder has two disagreeing sources of truth

| | `packages/bmc-portal-kit/src/tiers.ts` | `backend/src/modules/progression/grower-karma.ts` |
|---|---|---|
| Seedling | 0 karma, 70% split | 0 XP, 60% split |
| Sprout | 50, 73% | 50, 62% |
| Root | 200, 76% | 200, 65% |
| Canopy | 500, 80% | 500, 68% |
| **Ancestor** | **1000, 85%** | **1500, 72%** |

The names and the first four thresholds agree; the top threshold and every split
percentage do not. `tiers.ts` is consumed by all four vertical portals;
`grower-karma.ts` feeds `effectiveGrowerTier()` and therefore real payout splits.

The header comment in `tiers.ts` asserts that *"the backend `progression` module seeds the
same plant-themed ladder"* — an invariant that is not enforced and does not currently
hold.

This was not merely latent. `packages/bmc-ui/src/KarmaBar.tsx` renders
`"{remaining} to {next.name} ({next.split_pct}% split)"` from the portal ladder, on the
nursery portal's Payouts page — so a Canopy grower was told **"500 to Ancestor (85%
split)"** while `payout-breakdown/grower-payout.ts` would promote them at 1500 KARMA and
post a COMMISSION transfer at 72%. Wrong threshold and wrong rate, in the vendor's favour,
on a page about their earnings.

**Resolved:** the portal ladder now mirrors the backend (60 → 72%, Ancestor at 1500), so no
surface promises a split that will not be paid. `packages/bmc-portal-kit/src/tiers.parity.spec.ts`
parses `GROWER_TIERS` out of the backend source and fails on divergence — the portal is the
follower, so the guard lives on that side and runs under `pnpm portals:test`. The
`tiers.ts` header, which asserted the two already agreed, now says which file wins and why.
The nursery-portal fixtures were recomputed at the real rates so the mocks stop teaching
unreachable numbers.

**Confirmed:** 60 → 72% is the intended ladder — Seedling 60, Sprout 62, Root 65, Canopy 68,
Ancestor 72, with Ancestor at 1500 KARMA. So the portal was simply wrong rather than ahead of
a pending decision, and nothing further is owed to growers who saw the higher figure. Both
files now carry that in their comments, so the next person to read them finds a settled
number rather than an invitation to change it.

### B. Live copy promises buyer protection the checkout does not implement

Three public surfaces already tell buyers their payment is held:

- `how-it-works/page.tsx:87` — "Secure checkout with buyer protection. Your payment is held until delivery is confirmed."
- `how-it-works/page.tsx:669` — "We have buyer protection. If your order doesn't arrive or isn't as described, we'll step in to make it right. Payments are held until delivery is confirmed."
- `vendor-types/page.tsx:431` — "Buyer Protection — Payment held until delivery confirmed"

Escrow is real, but it is wired into creator bounties, collective purchases, campaigns,
order subcontracts and service programs — **not the ordinary Stripe Connect checkout**. For
a normal product purchase, no payment is held.

This is the inverse of the problem the analysis describes. It is not a missing trust
signal; it is an unbacked trust claim already in production. Shipping a buyer-protection
page on top of it without fixing it would compound the problem.

### C. Live copy promises marketplace imports that do not exist

`sell/SellPageClient.tsx:277` — "Import from Etsy, Shopify, TikTok Shop, your website, or a
CSV." Lines 110–119 list `importChannels = ["Amazon","Faire","Etsy","Shopify","TikTok
Shop","CSV","Manual","Website URL"]`.

`backend/src/modules/channel-connector/catalog.ts` ships `CHANNEL_IDS = ["faire"]`, and its
docblock records that Amazon and Etsy were deferred. The only implemented imports are
WooCommerce, Odoo, Printful and CSV (`modules/woocommerce-import/`, `modules/odoo-import/`,
`api/vendor/onboarding/import-csv/route.ts`). The vendor panel's own import screen
(`vendor-panel/src/routes/products/product-import/product-import.tsx:115`) offers no Etsy,
Shopify or Amazon option.

Those `importChannels` entries render as "Import from Amazon" buttons with **no click
handler at all**, next to a hardcoded "Import progress: 3/4 products previewed" line. The
`sell_signup` model captures `selling` (categories) only — it never stores a channel
choice. So this is not lead capture with optimistic labelling; it is a mockup rendered as
if it were live onboarding.

### D. "Open Source. Community Governed." with no licence

The homepage badge (`(main)/page.tsx:363`) says "Open Source. Community Governed." There is
no `LICENSE` file in the repository, and the root `README.md` says so explicitly: *"This
repository does not currently include a `LICENSE` file. Until one is added, treat the code
as 'all rights reserved'."*

This matters beyond the badge. The analysis's proposed wind-down insurance for paid add-ons
— "lean on the open-source, self-hostable nature of connect.js as the ultimate insurance" —
does not exist as a legal matter today.

Resolving it is a licensing decision for the maintainers, not an engineering one. It is
recorded here so it is not mistaken for an oversight.

---

## What we did about it

All four stages shipped. Summary of the surfaces and mechanisms added:

| Area | Now exists |
|---|---|
| Fees | `/transparency` with the calculator, plan ladder, a reverse "target profit" solver, and published commitments; `GET /store/fee-schedule` reads the billing catalog so copy cannot drift from what is charged |
| Verification | `/verification` criteria page; badges rendered on seller pages and vendor cards; `GET /store/sellers/:handle/trust`; `GET /store/verification-criteria`; and the admin write path the system shipped without — decide a check, grant/suspend/revoke a badge |
| Buyer protection | `/buyer-protection` policy; an `order_claim` type covering never-arrived, not-as-described, damaged and missing items; `GET/POST /store/order-claims` with ownership checks and a 30-day window; a claim form on every order |
| Governance | `/governance` and `docs/MEMBER_GOVERNANCE.md`, both stating that governance is project-level and that platform rules are not put to a member ballot |
| KARMA | portal ladder aligned to the ladder that actually pays, with a parity test; `/karma` publishing thresholds, splits, earning rules, and which plans skip you up |
| Vendor story | `GET /store/sellers/:handle/story`; "Meet the maker" on general seller pages |
| Quests | `/quests` publishing all thirteen with their gatekeepers, stages, and the plan gate stated in full |
| Add-ons | `docs/ADDON_COMMITMENTS.md` and a "What we commit to" section on `/transparency` |

Nine unbacked claims were corrected along the way — the escrow promise in three
places, the import promise on `/sell`, "Every creator is verified" on the
homepage, "Verified producer" on every product page, the platform-petitions
claim on `/why-we-exist`, the "Community Governed" badge, and the KARMA split.

**Still open:** the licence question (Finding D) — a decision rather than a defect. The
KARMA ladder (Finding A) has since been confirmed at 60 → 72%, which is where the code
already sits.

## The staged plan as executed

Stage 0 came before everything the analysis recommended, because publishing trust
artifacts on top of unbacked claims is the failure mode the analysis itself warns about.
Stage 1c (the admin write path) came before 1b (showing badges) for the same reason:
displaying a badge nobody could grant would have been theatre.

**Stage 0 — retire the claims the code does not back.** Rewrite the buyer-protection copy
(Finding B) to describe what actually protects a buyer today; correct the import copy
(Finding C); point the five GitHub links at the real repository.

**Stage 1 — ship the trust artifacts.** `/transparency` built from `FeeBreakdown`;
`/verification` criteria page generated from `BADGE_CONFIG`, with `TrustIndicators` rendered
on vendor cards, seller pages and product pages; the missing admin verification write path;
`/buyer-protection` plus real claim types on the returns flow.

**Stage 2 — make cooperative legitimacy and KARMA visible.** Resolve the tier drift
(Finding A) with a drift test, then publish the ladder; `/governance` plus
`docs/MEMBER_GOVERNANCE.md`; `creator_bio` on seller pages.

**Stage 3 — surface the differentiator and scope the add-ons honestly.** Public quest
catalog with the plan gate stated; add-on commitment charter matching the 30-day-window
design.

Open decisions carried into Stage 2 were the correct KARMA numbers (Finding A) and the
licensing question (Finding D). The ladder has since been confirmed at 60 → 72%; licensing
remains open.

---

## Caveats on the source analysis

Worth recording, since the document will be read again:

- Its market research is not in scope here and was not checked. Only its claims about this
  codebase were.
- It flags several of its own figures as vendor-reported (the multichannel-GMV and
  "70% use cloud software" numbers). Treat those as directional.
- Its central strategic argument — that FBM asserts trust rather than proving it — survives
  the audit intact. The correction is about *why*: not that the proof mechanisms were never
  built, but that they were built and never wired to a page.
