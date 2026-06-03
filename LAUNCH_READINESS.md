# Launch Readiness & Financials

**Date:** 2026-06-03
**Branch:** `claude/launch-readiness-financials-Ogc0k`
**Scope:** Answers three questions against the founder launch checklist — *Are we ready? How do we get users? What does success look like financially?* — grounded in a full code audit of this repository, not the aspirational spec.
**Target launch:** Full Blackout ecosystem (commerce engine **and** social/discovery layer).

---

## TL;DR — Go / No-Go

**The commerce engine is launch-ready. The ecosystem loop is not — yet.**

FreeBlackMarket (auth, marketplace, orders, checkout, digital products, bounties, and a real Stripe-ACH + Stellar double-entry money system) is at or near production-ready, with a documented *"release-ready for a controlled first production deployment"* QA posture. What is missing is the **social discovery half of Blackout** — Coliseum (short video), the unified Home Feed, Dens (discussion), and the Creator Hub UI.

That gap matters more than it looks. The entire marketing plan and the single KPI the founder cares about — **creator-driven sales** — depend on the *discovery loop*:

> Coalition creates demand → Creator creates awareness → Producer creates supply → FBM captures commerce.

The "FBM captures commerce" step works today. The "Creator creates awareness" step (Coliseum + Feed) is the least-built part of the system. So **readiness is not "is the marketplace done" (it nearly is) — it is "does the loop close." It does not close yet.**

**Recommendation:** Do not gate launch on a calendar; gate it on the social layer (Waves 2–3 below). Run a **Founding-100 private beta** immediately on top of the working commerce engine to generate density and real-user feedback while the social layer is built.

---

## 1. Are we ready? — Checklist vs. actual code

Legend: ✅ complete · 🟡 partial · 🔴 missing/stub

| Layer | Checklist requirement | Actual state | Evidence |
|---|---|---|---|
| **Auth** | Register, login, reset, profile, single identity | ✅ Production-grade, end-to-end (customer/seller/admin/driver) | `backend/src/shared/auth-helpers.ts`, `backend/src/subscribers/password-reset.ts`, storefront/vendor/admin login flows |
| **FBM Marketplace** | Listings, orders, checkout, categories | ✅ Largely complete (Medusa core) | `backend/src/api/v1/checkout/sessions/`, `hawala-order-payment.ts` |
| **Money rails** | (implied by fees) | ✅ Stripe ACH + Stellar/USDC + double-entry ledger; 3% fee charged. ⚠️ verification debt | `backend/src/modules/hawala-ledger/`, `stripe-ach.ts`, `stellar-settlement.ts` |
| **Demand Pools & Bounties** | Create, apply, complete, payout | ✅ Wired e2e (create/claim/escrow/vote) | `backend/src/modules/demand-pool/`, `.../bounties/[bountyId]/claim/route.ts` |
| **Digital Marketplace** | Plugins, themes, downloads | ✅ Complete (signed manifests + Minio delivery) | `backend/src/modules/digital-product/`, `digital-product-fulfillment/` |
| **Referral System** | Creator/vendor/coalition referrals, see earnings | 🟡 Backend solid; **no earnings UI** | `backend/src/modules/creator-attribution/`; endpoints exist, no dashboard |
| **Coalition** | Create, join, feed, needs board, storefront, members | 🟡 Storefront + needs-board exist; **no join/member-list API** | `backend/src/modules/cooperative/`, `/store/cooperatives/[handle]/{listings,needs}` |
| **Creator Hub** | Upload, campaigns, bounties, referrals, rewards | 🟡 APIs scattered; **no unified hub UI** | `/v1/seller/creator/*` routes; no hub surface |
| **Home Feed** | Mixed content, "never feels empty" | 🟡 **Product-only**; no aggregation | `storefront/src/lib/data/feed.ts` (personalized/following = TODO) |
| **Dens** | Discussion threads on products/coalitions | 🔴 Only governance/proposal comments | `backend/src/modules/governance/models/comment.ts` |
| **Coliseum** | Short video, saves, shares, embeds | 🔴 **Zero implementation** | — |
| **Sponsorship marketplace** | Producer↔creator, 10% fee | 🔴 Field stub, **no fee logic** | `creator-program` model `sponsorship_flat_cents` |
| **Commerce Hub** | Store directory, producer profiles, external links | 🔴 Missing | — |
| **Launch Center** | Launch product/business/sponsorship | 🟡 Campaign models exist, no flow UI | `backend/src/modules/collective-campaign/` (admin-only) |
| **Opportunity Engine** | Price tracking, demand/opportunity scoring | 🔴 Score fields exist, no algorithm (Phase 2 per checklist) | `demand-post.attractiveness_score` (never populated) |

### Launch-critical path (ranked blockers for a full-ecosystem launch)

1. **Money-path verification** (foundational — see §2).
2. **Referral/creator earnings UI** — without it the founder's single KPI is unmeasurable.
3. **Coalition join + member-list** — checklist success metric: "a coalition can function without admin intervention."
4. **Sponsorship fee logic** — turns on Revenue Stream 4.
5. **Unified Home Feed** — checklist success metric: "feed never feels empty."
6. **Coliseum** — the biggest net-new build; "users discover new content in under 30 seconds" is impossible without it.

---

## 2. Money-path trust statement (verified firsthand)

The `ECONOMIC_REVIEW.md` remediation table marks the critical money bugs **Fixed**, and current code confirms it:

- `backend/src/services/collective-hawala.ts:281` — deterministic key `bounty-payout-${bounty_id}-m${milestone_index}` + `reference_type: "DEMAND_BOUNTY"` (B4 ✅).
- `backend/src/modules/hawala-ledger/service.ts:644` — `updateBalancesAtomic` raw-SQL compare-and-swap (`balance = balance + ?`, `rowCount` guard) (H1 ✅).
- `backend/src/api/store/collective/demand-pools/[id]/bounties/[bountyId]/claim/route.ts` exists (B1 ✅).

> Note: an earlier automated read reported these as still broken. That read was **stale** — the fixes are present in current code. Do not act on the "money is broken" claim.

**The genuine caveat:** the atomic balance path only runs **when a caller passes `pgConnection`** (`service.ts:581-586`); otherwise it silently falls back to the legacy non-atomic `updateBalances`. Pool-total increments at `service.ts:1125,1188` are still flagged non-atomic TODO. So "fixed" is *conditional on caller wiring* and currently unproven under real concurrency.

**Before real funds at scale:** confirm every money-moving caller threads `pgConnection`, and add concurrency + idempotency tests (Wave 1).

---

## 3. How do we get users? — Marketing-plan reality check

The Founding-100 → weekly-campaign plan is sound. The problem is **sequencing**: each phase leans on a social surface that does not exist yet.

| Plan phase | Depends on | Built? |
|---|---|---|
| Founding-100 density | Commerce engine + coalitions + bounties | ✅ mostly (needs coalition join — Wave 1) |
| Week 2 Creator Campaign ("earn by helping businesses grow") | Creator Hub + earnings visibility | 🟡 needs Wave 1 earnings UI |
| Week 4 Bounty Campaign (real bounties/rewards) | Bounties + payout visibility | ✅ bounties / 🟡 payout UI |
| "Launch a Business" series → TikTok/YouTube/**Coliseum** content | Coliseum | 🔴 not built |
| Producer + Creator success stories | Feed + creator content | 🟡 feed is product-only |

**Recommendation:**
- **Run marketing behind the build, not the calendar.** Tie Week-2/Week-4 campaigns to Wave 1–2 completion.
- **Founding-100 private beta is the bridge** — it monetizes the working commerce engine, generates the success-story content the plan needs, and lets you build Coliseum/Feed with real users in-loop.
- Your stated biggest asset (17k followers, viral Blackout content, creator access) is real leverage — but point it at a product whose discovery loop actually closes, or early users churn on an empty feed.

---

## 4. What does success look like financially? — Model reality check

The model's mechanics map to real code — with two exceptions.

| Revenue stream | Model | Code reality | Ship readiness |
|---|---|---|---|
| 1. Black Market digital products | $2k→$10k/mo | ✅ Built; highest margin | **Ship first** |
| 2. Marketplace fees (3%) | $1.5k→$15k/mo | ✅ Charged in `hawala-order-payment.ts`, `payout-config.ts` | **Ready** |
| 3. Creator marketplace (3%) | — | ✅ Creator commission built (`creator-attribution`) | **Ready** |
| 4. Sponsorship marketplace (10%) | $1k/mo | 🔴 `sponsorship_flat_cents` stub, **no fee logic** | **Wave 2** |
| 5. Featured placement | low priority | 🔴 No code | **Defer** |

**Re-ranked by build-readiness:** digital products → marketplace fees → creator marketplace (all ready now) → sponsorship (Wave 2) → featured (defer). The conservative Phase-1 targets ($1k–$5k digital, $25k–$100k GMV) are achievable on the **already-built** streams.

**The single KPI is not yet measurable.** "How many sales happened because a creator/coalition/bounty/referral generated them?" requires the referral/attribution earnings surface (Wave 1) plus feed attribution (Wave 2). **You cannot watch your one KPI until Wave 1 ships.** That alone makes the earnings UI a launch blocker, not a nice-to-have.

---

## 5. Recommended sequence

| Wave | Contents | Gates |
|---|---|---|
| **1 — now** | Money-path verification tests; referral/creator earnings UI; coalition join + member-list API | Unblocks KPI + Founding-100 beta |
| **2 — revenue + feed** | Sponsorship 10% fee; unified Home Feed aggregation + seed data | "Feed never empty"; Revenue Stream 4 live |
| **3 — net-new** | Coliseum (phased sub-plan); Dens (polymorphic threads); Creator Hub UI; Commerce Hub; Launch Center wizard | Closes the discovery loop → **full-ecosystem launch date** |

Founding-100 private beta runs concurrently from Wave 1 onward.

**Out of scope (Phase 3+, per checklist "What Can Wait"):** product tokens, coalition credit backing, investments, Blackstar vending, asset sharing, logistics automation, advanced governance, Featured Placement revenue.
