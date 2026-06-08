# Launch Readiness & Financials

**Date:** 2026-06-06
**Branch:** `claude/fbm-launch-gaps-Ogc0k`
**Scope:** Answers three questions against the founder launch checklist — *Are we ready? How do we get users? What does success look like financially?* — grounded in a full code audit of this repository, not the aspirational spec.

> **Scope correction (this revision).** The original checklist mixes **two
> systems**, and an earlier pass wrongly counted one system's gaps against the
> other:
>
> - **FREEBLACKMARKET (this repo)** — the commerce substrate: marketplace,
>   orders, checkout, entitlements/economic-standing, coalition memberships, the
>   money rails, the Launch orchestration workflow, and the outbound webhooks
>   (`launch.created`, `bounty.opened`, `sponsorship.created`, `order.*`,
>   settlement) that Blackout consumes.
> - **BLACKOUT (separate repo)** — the social/discovery layer: **Coliseum**
>   (short video), **Dens** (discussion), the unified **Home Feed**, and the
>   **Creator Hub UI**.
>
> The integration boundary is settled by the contracts in
> `docs/contracts/{blackout-integration.md,entitlements.yaml,marketplace-layer.md}`.
> Blackout's social surfaces are **built in the Blackout repo and are NOT FBM
> launch blockers.** This report scores **FBM** against the checklist and lists
> Blackout items separately as out-of-scope context.

---

## TL;DR — Go / No-Go

**FBM (this repo) is launch-ready.** Auth, marketplace, orders, checkout,
digital products, bounties, coalitions, creator attribution, the Launch
orchestration (product / business / sponsorship), and a real Stripe-ACH +
Stellar double-entry money system are in place. The recent ecosystem/growth-loop
work plus this session's gap-closing pass have shipped the remaining FBM
checklist items.

The **social discovery half (Coliseum, Feed, Dens, Creator Hub UI) lives in the
Blackout repo** and is tracked there — it is not a gate on FBM shipping its
side of the contract.

**Recommendation:** FBM can support a **Founding-100 private beta** now. The
genuine remaining FBM caveat is money-path verification under real concurrency
(§2) — finish that before scaling real funds.

---

## 1. Are we ready? — FBM checklist vs. actual code

Legend: ✅ complete · 🟡 partial · 🔴 missing/stub · ⏸️ deferred

| Layer | Checklist requirement | Actual state | Evidence |
|---|---|---|---|
| **Auth** | Register, login, reset, profile, single identity | ✅ Production-grade, end-to-end | `backend/src/shared/auth-helpers.ts`, `subscribers/password-reset.ts` |
| **FBM Marketplace** | Listings, orders, checkout, categories | ✅ Largely complete (Medusa core) | `backend/src/api/v1/checkout/sessions/`, `hawala-order-payment.ts` |
| **Money rails** | (implied by fees) | ✅ Stripe ACH + Stellar/USDC + double-entry ledger; 3% fee charged. ⚠️ verification debt (§2) | `backend/src/modules/hawala-ledger/`, `stripe-ach.ts`, `stellar-settlement.ts` |
| **Demand Pools & Bounties** | Create, apply, complete, payout | ✅ Wired e2e (create/claim/escrow/vote) | `backend/src/modules/demand-pool/`, `.../bounties/[bountyId]/claim/route.ts` |
| **Bounty objective types** | Creator / Marketing / Photography needed | ✅ Enum + vendor selector | `demand-pool/models/demand-bounty.ts`, vendor `find-creators` |
| **Bounties as first-class nav** | Surfaced, not buried | ✅ Dedicated Bounties nav + route | `vendor-panel/src/routes/bounties/` |
| **Digital Marketplace** | Plugins, themes, downloads | ✅ Complete (signed manifests + Minio delivery) | `backend/src/modules/digital-product/` |
| **Referral System** | Creator/vendor/coalition referrals, see earnings | ✅ Per-creator earnings UI + platform-wide KPI rollup | `creator-studio` + `/admin/creator-attribution/rollup` |
| **Producer↔creator matching** | Ranked candidates | ✅ Ranked, unit-tested, wired into Find-Creators | `/v1/seller/matching/creators` |
| **Coalition** | Create, join, needs board, storefront, members | ✅ Self-service join + member-list API + storefront | `backend/src/modules/cooperative/` |
| **Commerce Hub** | Store directory, producer profiles, external links | ✅ Complete e2e | `/store/directory`, `/store/producers/[handle]`, vendor store-links |
| **Launch Center** | Launch product / business / sponsorship | ✅ One entrypoint, three launch types | `/v1/seller/launches` + `workflows/launch-{product,sponsorship}/` |
| **Sponsorship marketplace** | Producer↔creator, 10% fee | ✅ Escrow + 90/10 split, deterministic idempotency | `collective-hawala.ts` `paySponsorship`, `SPONSORSHIP_PLATFORM_FEE_PERCENT` |
| **"All businesses in one profile"** | Multi-seller per identity | ⏸️ Deferred (one-auth→many-sellers architecture) | — |
| **Opportunity Engine** | Demand/opportunity scoring | ✅ Implemented (deterministic 0–10 score + price tracker) | `modules/opportunity-engine/`, `api/store/opportunities`, `/store/price-tracker` — see `PHASE_2_CHECKLIST.md` |
| **Knowledge Base / DIY** | DIY library + guides (§14) | ✅ Implemented | `modules/knowledge-base/`, `api/store/knowledge-base` |
| **Economic Intelligence** | Market/price trends (§15) | ✅ Implemented | `api/v1/seller/economic-intelligence/trends` |
| **Plugin ecosystem** | Browse/install plugins (§16) | ✅ Implemented | `modules/plugin-registry/`, `api/store/plugins` |

### FBM launch-critical path (remaining)

1. **Money-path concurrency soak** against a real Postgres (foundational — see §2). The code-side hardening is **done** (atomic balance CAS + atomic pool totals are now the default); the residual gate is running the soak under parallel load in a DB-equipped env.
2. *(Deferred)* Multi-seller "all businesses in one profile" — tracked, not a launch blocker per founder.

### Blackout (separate repo) — NOT FBM scope

These were previously mis-counted as FBM blockers. They are Blackout's
discovery surfaces, consuming FBM's webhooks/entitlements over the contract:

- **Coliseum** (short video) · **Dens** (discussion threads) · unified **Home
  Feed** aggregation · **Creator Hub UI**.

FBM's obligation to them is the **outbound event/entitlement contract**, which
is implemented (`marketplace-webhooks`, `launch.created` / `bounty.opened` /
`sponsorship.created`, entitlements sync). Building the surfaces themselves is
Blackout-repo work.

---

## 2. Money-path trust statement (verified firsthand)

The `ECONOMIC_REVIEW.md` remediation table marks the critical money bugs
**Fixed**, and current code confirms it:

- `backend/src/services/collective-hawala.ts` — deterministic key
  `bounty-payout-${bounty_id}-m${milestone_index}` + `reference_type:
  "DEMAND_BOUNTY"` (B4 ✅); and now `paySponsorship` splits escrow 90/10 with
  `sponsorship-fee-${id}` / `sponsorship-payout-${id}` keys (Revenue Stream 4 ✅).
- `backend/src/modules/hawala-ledger/service.ts` — `updateBalancesAtomic`
  raw-SQL compare-and-swap (H1 ✅).
- `.../bounties/[bountyId]/claim/route.ts` exists (B1 ✅).

> An earlier automated read reported these as still broken. That read was
> **stale** — the fixes are present. Do not act on the "money is broken" claim.

**Status update (this session) — code-side gate closed.** The atomic path is
now the **default**, not conditional on caller wiring:

- `createTransfer` self-resolves a pg connection from the module container
  (`resolvePgConnection`, mirroring `creator-attribution`) and uses the atomic
  balance CAS by default. None of the ~39 call sites have to thread
  `pgConnection`; the legacy read-modify-write only runs when no connection is
  reachable (DI-less unit tests).
- The two flagged pool-total read-modify-writes (`createInvestment`
  total_raised/total_investors; `distributeDividends` total_distributed) now use
  a single atomic `col = col + ?` UPDATE (`atomicPoolIncrement`), with the same
  graceful fallback.
- New regression specs: `atomic-by-default.unit.spec.ts` (atomic-by-default,
  explicit-over-resolved precedence, fallback, atomic pool increments). Full
  hawala unit suite green (112 tests).

**Latent table-name bug found and fixed while writing the soak.** Wiring the
atomic path on by default exposed two raw-SQL statements that targeted
**non-existent tables** (no compatibility view exists):

- `updateBalancesAtomic` did `UPDATE ledger_account` — the real table is
  `hawala_ledger_account`. As dormant code this never fired; as the new default
  it would have thrown on **every** transfer. Fixed.
- `reconciler.ts` summed `FROM ledger_entry` — real table `hawala_ledger_entry`
  — so the balance-drift reconciler job was silently erroring on every run.
  Fixed (both queries).

This is exactly the class of bug the gate existed to catch.

**The soak harness now exists** —
`backend/src/modules/hawala-ledger/__tests__/concurrency-soak.integration.spec.ts`
spins up a real Postgres via `moduleIntegrationTestRunner`, wires a live
`PG_CONNECTION` (so the atomic-by-default paths are exercised), and fires
concurrent operations to assert three invariants: (1) no overdraw under
concurrent debits, (2) total value conserved across interleaved bidirectional
transfers, (3) exact pool totals under concurrent investments.

**The soak is wired into CI.** A dedicated `test-soak` ("Money-Path
Concurrency Soak") job in `.github/workflows/ci.yml` runs it on every push/PR
against a Postgres service. It's independent of the `integration:http`
app-boot debt (TI-3) because `moduleIntegrationTestRunner` stands up its own
isolated module schema without booting the full app. Per the repo's own
live-Postgres rollout convention (see the `test-integration` TI-1/TI-3
history), it lands **non-blocking** (`continue-on-error: true`) because it was
authored in a DB-less env; **flip it to fail-fast** (delete that one line)
once it's been observed green against live Postgres.

**The one part that still cannot be closed from the web env:** actually
*running* the soak — this container has no DB (`pg_isready` → no response).
The CI job above is the automated path; to run it locally in a DB-equipped
environment:

```
cd backend && TEST_TYPE=integration:modules NODE_OPTIONS=--experimental-vm-modules \
  npx jest --runInBand --forceExit \
  src/modules/hawala-ledger/__tests__/concurrency-soak.integration.spec.ts
```

(Idempotency is already well-covered: bounty transfer, sponsorship split, and
`createTransfer` all have regression specs.)

---

## 3. How do we get users? — Marketing-plan reality check

The Founding-100 → weekly-campaign plan is sound. The sequencing dependency that
mattered — Coliseum/Feed — is **Blackout-repo** work, so it does not block FBM.

| Plan phase | Depends on | FBM side built? |
|---|---|---|
| Founding-100 density | Commerce engine + coalitions + bounties | ✅ (coalition join shipped) |
| Week 2 Creator Campaign ("earn by helping businesses grow") | Creator attribution + earnings visibility | ✅ earnings UI + KPI rollup |
| Week 4 Bounty Campaign (real bounties/rewards) | Bounties + payout | ✅ bounties + escrow/payout |
| "Launch a Business" series | Launch flow | ✅ Launch-a-Business wizard |
| Producer + Creator success stories | Blackout Feed + creator content | ↔️ Blackout repo |

**Recommendation:** Run the **Founding-100 private beta on the working commerce
engine now**; it generates the success-story content the plan needs while
Blackout's discovery surfaces are built in their repo against FBM's (live) event
contract.

---

## 4. What does success look like financially? — Model reality check

| Revenue stream | Model | Code reality | Ship readiness |
|---|---|---|---|
| 1. Black Market digital products | $2k→$10k/mo | ✅ Built; highest margin | **Ship first** |
| 2. Marketplace fees (3%) | $1.5k→$15k/mo | ✅ Charged in `hawala-order-payment.ts`, `payout-config.ts` | **Ready** |
| 3. Creator marketplace (3%) | — | ✅ Creator commission built (`creator-attribution`) | **Ready** |
| 4. Sponsorship marketplace (10%) | $1k/mo | ✅ Escrow + 90/10 payout split (`paySponsorship`) | **Ready** |
| 5. Featured placement | low priority | 🔴 No code | **Defer** |

**Re-ranked by build-readiness:** digital products → marketplace fees → creator
marketplace → **sponsorship (now ready)** → featured (defer). The conservative
Phase-1 targets ($1k–$5k digital, $25k–$100k GMV) are achievable on the
already-built streams, and Revenue Stream 4 is now live on the FBM side.

**The single KPI is aggregated.** The per-creator attribution data, the earnings
surface, and the platform-wide **creator-driven-sales rollup**
(`/admin/creator-attribution/rollup`) all exist. Feed attribution lands when
Blackout's unified feed ships (Blackout repo).

---

## 5. Recommended sequence

| Wave | Contents | Owner | Gates |
|---|---|---|---|
| **1 — now** | Money-path concurrency verification (thread `pgConnection`, concurrency tests) | FBM | Final FBM money gate before scale |
| **2 — Blackout surfaces** | Coliseum (phased), Dens, unified Feed, Creator Hub UI | **Blackout repo** | Closes the discovery loop |
| **Deferred** | Multi-seller ("all businesses in one profile"); Featured Placement | FBM (later) | Not launch blockers |

Founding-100 private beta runs concurrently from Wave 1 onward on the working
FBM commerce engine.

**Out of scope (Phase 3+, per checklist "What Can Wait"):** product tokens,
coalition credit backing, investments, Blackstar vending, asset sharing,
logistics automation, advanced governance, Featured Placement revenue.
