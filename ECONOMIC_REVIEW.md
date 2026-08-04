# Economic Systems Review

**Date:** 2026-06-01
**Branch:** `claude/economic-review-IY22F`
**Scope:** Hawala double-entry ledger, settlement rails, payout/advance/investment flows;
analytics & balance **counters**; demand-pool **bounty** escrow and payout.
**Method:** Source review of `backend/src` with targeted verification of the money-moving
code paths. Findings below were confirmed against the cited file/line, not inferred.

Related references: `docs/POSTURE_A_COMPLIANCE.md` (CCR closed-loop posture),
`docs/FISCAL_SPONSOR_DECISION.md` (fee model), `docs/contracts/blackout-integration.md`
(commerce/economic-standing wiring).

---

## Executive Summary

The economic core is well-structured — genuine double-entry bookkeeping, six clearly
defined settlement rails (`hawala-ledger/rails.ts`), Posture-A enforcement for CCR, and
idempotent transfers via `createTransfer`. The defects are concentrated in three areas:
**(1)** money paths that defeat their own idempotency/atomicity guarantees, **(2)** an
incomplete bounty lifecycle with missing authorization, and **(3)** analytics counters that
are non-atomic or never written. None require re-architecting the ledger; all are contained
fixes.

| Category | Severity | Issues |
|---|---|---|
| Bounty payout idempotency (`Date.now()` key) | **Critical** | B4 — double-payout on retry |
| Ledger balance updates not truly atomic (TOCTOU) | **Critical** | H1 — lost updates under concurrency |
| Bounty milestone completion: no authz, no public route, no concurrency guard | **High** | B2, B5 |
| Bounty escrow never refunded on cancel/expire | **High** | B6, B7 |
| Reward-pool platform funding has no authorization | **High** | H4 |
| Bounty creation authz + RESTRICTED visibility not enforced | **High** | B8, B9 |
| Non-atomic counters (affiliate clicks, pool totals) | **High** | C1, H7 |
| Dividend idempotency key uses `Date.now()` | **High** | H7 |
| No claim/assignment path (bounties fundable but unworkable) | **Medium** | B1 |
| Karma double-count (null `source_id`) | **Medium** | H6 |
| Instant-payout limit `NaN` when unset | **Medium** | H9 |
| No ledger balance reconciliation job | **Medium** | H2 |
| Settlement batch stuck PENDING; no terminal FAILED / alert | **Medium** | H5, H10 |
| Milestone percentages not validated to 100 | **Low** | B10 |
| Chat unread returns silent 0 on Matrix outage | **Low** | C4 |
| Dead counters never written (`view_count`, `order_count`, `review_count`) | **Low** | C2, C3 |
| Subscription-renewal → order is a feature-flagged stub | **Low** | H3 |
| Advance repayment records 100% as principal | **Low** | H8 |

---

## Critical Issues

### B4 — Bounty payout & dividend idempotency keys are non-deterministic
`backend/src/services/collective-hawala.ts:277` builds the payout key as
`bounty-payout-${bounty_id}-${Date.now()}`. `createTransfer`'s idempotency check
(`hawala-ledger/service.ts:506`) keys off `idempotency_key`, so a timestamped key makes every
retry a **new transfer** — i.e. a double-payout. The same anti-pattern exists in
`distributeDividends` (`div-...-${Date.now()}`). The payout also miscategorizes the entry as
`reference_type: "ORDER"` against a demand-post id.
**Remediation:** deterministic per-milestone key `bounty-payout-${bounty_id}-m${milestone_index}`;
dividend key `div-${pool.id}-${investment.id}`; `reference_type: "DEMAND_BOUNTY"`.

### H1 — `updateBalances` is not a real compare-and-swap
`hawala-ledger/service.ts:611-671` advertises "optimistic locking with version checking," but
it re-reads the row with `listLedgerAccounts`, compares the **in-memory** balance, then issues a
plain `updateLedgerAccounts` — all outside a transaction. Two writers interleaving between the
re-read and the update both succeed, losing one delta. Retries are capped (3) with fixed backoff.
**Remediation:** add a true atomic path
`UPDATE ledger_account SET balance = balance + :d, available_balance = available_balance + :d
WHERE id = :id AND balance + :d >= 0` (rowCount 0 ⇒ insufficient balance), threaded through
`createTransfer` via an optional `pgConnection` (reusing the `getMemberBalanceByMxid` raw-SQL
precedent), with the legacy path retained as fallback and hardened (jitter, more retries).

---

## High Severity Issues

### B2 / B5 — Milestone completion is unauthenticated, unreachable, and racy
`demand-pool/service.ts:303` `completeBountyMilestone` flips `milestones[i].completed` and bumps
`amount_paid_out`/status, but **does not pay out**, has **no authorization**, **no public route**,
and read-modify-writes the milestones JSON with no concurrency guard. Two concurrent calls can
both mark the same milestone complete.
**Remediation:** new `CollectiveHawalaService.completeAndPayMilestone` orchestrating
complete → pay (with the deterministic key from B4); a creator-authorized
`bounties/[bountyId]/milestones` route; and a re-check guard before the flip (DB-level CAS noted
as a follow-up).

### B6 / B7 — Bounty escrow is never returned
When a demand pool is cancelled or expires, participant escrow is released
(`releaseParticipantEscrow`) but **bounty** escrow is not — funds stay locked in the ESCROW
account. There is also no deadline enforcement.
**Remediation:** `refundBountyEscrow`/`refundAllBounties` (mirroring participant release,
idempotency key `bounty-refund-${bounty_id}`) plus an hourly `demand-pool-expiry` job that expires
past-deadline posts and refunds.

### H4 — Reward-pool platform funding is unauthorized
`fundCreatorRewardPool` funds from the platform `RESERVE` when `funderSellerId` is null, with no
authorization check.
**Remediation:** require an explicit `allowPlatformFunding` flag (default false) for the RESERVE
branch; gate it behind admin auth at the caller.

### B8 / B9 — Bounty creation & visibility lack authorization
`bounties/route.ts` POST lets any authenticated user attach a bounty to any pool; GET returns
`RESTRICTED` bounties to everyone.
**Remediation:** POST requires the pool creator or an existing participant (reusing the
`listDemandParticipants` check from the escrow route); GET filters `RESTRICTED` to
creator/contributor/assignee only.

### C1 / H7 — Non-atomic counters lose concurrent writes
Affiliate `click_count`/`attributed_order_count` (`creator-attribution/service.ts:175,438`) and
investment-pool `total_raised`/`total_investors` increment via `Number(x) + 1` read-modify-write.
**Remediation:** atomic `UPDATE … SET col = col + 1` SQL.

---

## Medium Severity Issues

- **B1 — No claim/assignment path.** `assignee_id` exists on the model but nothing sets it, so a
  funded bounty can never be paid. *Fix:* first-come `claimBounty` + `claim` route.
- **H6 — Karma double-count.** `karma_event (source_module, source_id)` is non-unique and
  operator grants use null `source_id`. *Fix:* partial unique index where `source_id IS NOT NULL`.
- **H9 — Instant-payout `NaN`.** `instant_payout_daily_limit - used_today` is `NaN` when unset.
  *Fix:* coalesce defaults and clamp ≥ 0; enforce in `requestPayout`.
- **H2 — No balance reconciliation.** Cached balances can silently drift from the entry log.
  *Fix:* a 6-hourly `hawala-balance-reconciler` that sums entries per account vs cached balance and
  alerts on drift (log-only, no auto-correct).
- **H5 / H10 — Settlement batches hang.** Stripe-ACH-selected batches are left PENDING with no
  alert; a failed Stellar submission has no terminal FAILED state. *Fix:* set FAILED + metadata on
  throw; emit a pending-manual metric/warn.

---

## Low Severity / Documented

- **B10 — Milestone percentages** aren't validated to sum to 100. *Fix:* validate in `addBounty`
  and the route schema.
- **C4 — Chat unread** returns a silent `0` on Matrix errors. *Fix:* add `degraded: true` so the UI
  can distinguish an outage from a true zero.
- **C2 / C3 — Dead counters.** `agriculture.availability_window.view_count`/`order_count` and
  `seller_metadata.review_count` are declared but never written (the review feature does not exist
  yet). *Recommendation:* wire `view_count` at the window GET; treat `review_count` as
  forward-looking until a review module lands — documented, not silently shipped.
- **H3 — Subscription renewal.** `SUBSCRIPTION_RENEWAL` is an allowed ledger reference type, but
  `renew-subscription.ts` returns `renewal_prepared: true` without creating an order and is gated
  behind `FBM_SUBSCRIPTION_RENEWAL_LIVE`. Full renewal→order is a feature build, not a bug;
  documented as roadmap.
- **H8 — Advance repayment** records the whole repayment as principal (`// Simplified` at
  `service.ts:~1698`). *Recommendation:* pro-rata principal/fee split once the advance fee model is
  finalized; documented until then.

---

## Remediation Status

| ID | Finding | Disposition |
|---|---|---|
| B4 | Bounty/dividend idempotency + reference_type | Fixed |
| H1 | Atomic balance update path | Fixed (atomic path + hardened fallback) |
| B2 | Authorized, paying milestone route | Fixed |
| B5 | Milestone completion concurrency guard | Fixed (DB-level CAS; proven under contention) |
| B6 | Refund bounty escrow on cancel/expire | Fixed |
| B7 | Deadline-expiry job | Fixed |
| H4 | Reward-pool funding authorization | Fixed |
| B8 | Bounty-creation authorization | Fixed |
| B9 | RESTRICTED visibility filter | Fixed |
| C1 | Atomic affiliate counters | Fixed |
| H7 | Atomic pool totals + dividend key | Fixed (key + increments) |
| B1 | Bounty claim/assignment | Fixed (first-come) |
| H6 | Karma dedup unique index | Fixed (migration) |
| H9 | Instant-payout null safety | Fixed |
| H2 | Balance reconciliation job | Fixed |
| H5 | Settlement pending-manual alert | Fixed |
| H10 | Settlement terminal FAILED state | Fixed |
| B10 | Milestone percentage validation | Fixed |
| C4 | Chat unread degraded flag | Fixed |
| B3 | Bounty proof-of-work capture | Minimal (metadata); full review flow = roadmap |
| C2 | Agriculture view/order counters | Documented (wire view_count) |
| C3 | Seller review_count | Documented (no review module yet) |
| H3 | Subscription renewal → order | Documented (feature-flagged stub) |
| H8 | Advance principal/fee split | Documented (pending fee model) |

**Integration-level follow-ups** (cannot be proven by unit tests): true concurrent-write behavior
of H1's atomic UPDATE and the H6 unique constraint require a live Postgres harness; tracked as
follow-ups rather than claimed under unit coverage.

**Update — these follow-ups are now closed**, each by a live-Postgres spec that runs the real
statement against the real constraint:

| Follow-up | Harness | Proves |
|---|---|---|
| H1 atomic UPDATE | `hawala-ledger/__tests__/concurrency-soak.integration.spec.ts` | no overdraft, value conservation, exact pool totals under contention |
| B5 milestone CAS | `demand-pool/__tests__/milestone-cas.integration.spec.ts` | one winner per index, no cross-index clobber, payouts sum to the bounty exactly |
| H6 karma dedup | `hawala-ledger/__tests__/karma-dedup.integration.spec.ts` | concurrent duplicates collapse to one row; null `source_id` still repeats; soft delete releases the key |

Closing B5's follow-up **found a live defect the unit tests could not have caught**. The CAS guard
read `milestones -> ? ->> 'completed'`, and the driver binds that parameter as text. `->` is
overloaded — integer indexes a jsonb array, text looks up an object key — so the uncast parameter
selected the text overload, an object-key lookup against an array, which is always `NULL`.
`COALESCE(NULL, false) = false` is then always true, so **the guard passed for every caller** and the
same milestone could be completed repeatedly, each pass adding its payout to `amount_paid_out`
again. The escrow debit was still protected by B4's deterministic key, so money did not move twice,
but the bounty's own accounting claimed it had. Fixed by casting the index (`?::int`); the
regression is held by the first two cases in the milestone spec.

This is the concrete argument for the harness: the guard had been reviewed, described correctly in
its own comment, and was inert in production. Only executing it against Postgres under real
contention showed that.
