# Savings routing — ledger spec + counsel questions (Move 5)

How a member's group-buy savings become something the ledger knows about —
and, only after counsel clears it, something a member can direct. Grounded
in a full sweep of the demand-pool, collective-hawala, buyer-network, and
split-payout code (2026-08-28); every claim cites its file. Companion to
`docs/POSTURE_A_COMPLIANCE.md` (the compliance frame this spec must not
break), `docs/CCR_HRS_IGNITION.md`, and
`docs/COLLECTIVE_BUYS_MICRO_INVESTMENT_SPEC.md`.

**Shape of the proposal:** three tiers, strictly ordered. Tier 0 returns
money the platform is already stranding (a defect fix, not a feature).
Tier 1 records realized savings (bookkeeping; no new custody). Tier 2 —
member-directed savings destinations — is specified here but **gated on
the counsel questions in §6**, because it is exactly where the
payment-facilitator posture gets tested.

## 1. What the code does today

- **Savings are determined but never captured.** A group buy's price
  becomes final at the `DEAL_APPROVED` transition, when `selectSupplier`
  writes `final_unit_price`/`final_total_price` from the winning
  proposal's volume tiers (`modules/demand-pool/service.ts:857-915`,
  tier resolution `:1189-1205`). The savings figure —
  `(target_price − final_unit_price) × quantity` — is computed **on read
  only** by `calculateSavings`
  (`services/collective-hawala.ts:757-795`), whose sole caller is one
  admin GET (`api/admin/collective/demand-pools/[id]/route.ts:22-27`).
  No model field, ledger entry, or metadata ever stores it; no transfer
  ever moves it.
- **Escrow residuals are stranded — real money, today.** Participants
  escrow a **free-form amount** (`.../[id]/escrow/route.ts:9-11,43-48`),
  not `quantity × price`. Completion (`processGroupPurchase`,
  `collective-hawala.ts:672-748`) drains exactly `final_total_price`
  from the pool escrow (fee floored to whole dollars `:702-704`, then
  the supplier leg `:725-734`). Anything a participant over-escrowed —
  `total_escrowed − final_total_price` — **remains in the pool's ESCROW
  account with no sweep, reconciliation, or refund path.** The full
  release path (`releaseParticipantEscrow`, `:117-215`) exists only for
  cancellation/withdrawal, not completion.
- **A purpose-built accumulator sits unwired.**
  `BuyerNetworkModuleService.recordGroupBuyParticipation(networkId,
  customerId, savingsAmount)` persists `total_savings` onto
  `network_member` and `buyer_network`
  (`modules/buyer-network/service.ts:216-249`,
  `models/network-member.ts:36`, `models/buyer-network.ts:45`) and has
  **zero callers** — despite an existing module link between demand
  posts and buyer networks (`links/demand-post-buyer-network.ts:10-16`).
- **The routing-rule engine exists and is unreachable.** The
  split-payout mechanism (`PayoutConfig`/`PayoutSplitRule`,
  `processSplitPayout` at `hawala-ledger/service.ts:2761`) is the
  natural template for member-directed routing — and is dead end-to-end:
  `getOrCreatePayoutConfig` (`:2674`) has no callers, so no config row
  can ever exist and the config/splits routes 400; `processSplitPayout`
  has no callers; its `SPLIT_PAYOUT` entry_type is an orphan literal
  absent from the enum (`models/ledger-entry.ts:31-55`); split legs
  carry **no idempotency key**; sum-to-100 is a warning at process time
  (`service.ts:2783-2786`), not a write-time invariant; `fixed_amount`
  and `priority` are stored but never read for allocation; no UI exists.
- **The one working analog is surplus-redirect.** On escrow release, a
  participant whose `surplus_disposition` is `DONATE` — and only when
  `FBM_SURPLUS_REDIRECT_LIVE=1` and `FBM_MUTUAL_AID_ACCOUNT_ID` is set —
  has their refund leg routed to the mutual-aid account instead of their
  wallet, with destination-distinct idempotency keys
  (`demand-release-${participant_id}` vs `demand-donate-${participant_id}`,
  `collective-hawala.ts:163-193`; gate `lib/surplus-redirect.ts:63-100`).
  Per-member disposition + env master switch + fail-to-default is the
  pattern this spec copies.

## 2. Tier 0 — return the residual (defect fix; ship first)

At `process_payment` (the admin action that calls `processGroupPurchase`,
`api/admin/collective/demand-pools/[id]/route.ts:53-75`), add a residual
leg per participant, synchronously with the drain:

- `owed_i = quantity_i × final_unit_price`; `residual_i =
  escrow_amount_i − owed_i` (clamp at 0; a shortfall is a separate
  pre-existing validation problem and must fail the drain, not this leg).
- Route `residual_i` by the participant's existing `surplus_disposition`
  exactly as `releaseParticipantEscrow` does: default → their
  `USER_WALLET` as `entry_type: "REFUND"`, `reference_type: "ORDER"`,
  `reference_id: demand_post_id`; `DONATE` (+ live flags) → mutual aid
  as `TRANSFER`/`"ORDER"`.
- Idempotency: `demand-residual-${participant_id}` (distinct from the
  release keys; `createTransfer` dedupe at
  `hawala-ledger/service.ts:848-856` makes retries safe).
- Update `escrow_amount`/`total_escrowed` bookkeeping the way release
  does (`collective-hawala.ts:198-212`).

No new vocabulary, no new accounts, no policy question: this is money the
member already owns, moving on already-blessed `REFUND`/`ORDER` vocabulary
(CCR-compatible under Posture A's purchase-context rule from day one).
It also remediates the unclaimed-property exposure in §6.3.

## 3. Tier 1 — record realized savings (bookkeeping; no custody change)

Wire the existing accumulator at the completion moment:

- **Attachment point:** a subscriber on `demand_pool.fulfilled`,
  following `subscribers/progression-demand-pool-fulfilled.ts` (flat
  awards, idempotent `source_id`, errors swallowed). The event payload
  carries no prices (`.../[id]/route.ts:100-109`), so the subscriber
  re-fetches the post.
- **Fix the event first:** the emitter builds `participant_ids` from
  `status: COMMITTED` only (`route.ts:93-96`), which **excludes
  `ESCROWED` participants — the people who actually paid.** Include
  escrowed (and adopt the defined-but-never-assigned
  `ParticipantStatus.CONFIRMED`, `models/demand-participant.ts:6`, at
  the payment step so the lifecycle finally distinguishes
  committed/escrowed/confirmed).
- Per participant: `savings_i = max(0, (target_price −
  final_unit_price)) × quantity_i`; resolve the network via the
  demand-post↔buyer-network link; call `recordGroupBuyParticipation`.
  Idempotent by a per-(post, participant) source key, mirroring the
  progression subscriber.
- **No ledger entry in this tier.** Realized savings are a fact about a
  purchase, not a balance. Recording them as member/network totals
  creates the member-visible "your coalition saved you $X" surface with
  zero custody implications — and produces the demand evidence Tier 2's
  counsel review will want.

## 4. Tier 2 — member-directed savings destinations (counsel-gated)

The member-facing promise: "route my residual (Tier 0) and, optionally, a
chosen % of my realized savings into a savings destination instead of
back to my spending wallet."

- **Rule storage:** resurrect the split-payout skeleton for members —
  a `savings_disposition` config per customer (extending the
  `surplus_disposition` pattern rather than the unreachable
  PayoutConfig, unless the config row problem is fixed first), with
  destinations: `WALLET` (default, = Tier 0 behavior), `SAVINGS`,
  `MUTUAL_AID`, `INVESTMENT_POOL` (**see §6.2 before ever enabling**).
- **The SAVINGS account:** a new `account_type: "SAVINGS"` ledger
  account, `owner_type: CUSTOMER`, same rail as the source (USD today),
  freely transferable back to the member's `USER_WALLET` (no lockup, no
  yield in v1 — both would sharpen the §6 questions). Registered in
  `generateAccountNumber` (`hawala-ledger/service.ts:86-103`) and the
  account-type enum.
- **Vocabulary:** new `entry_type: "SAVINGS_ROUTE"` registered in the
  `LedgerEntry` enum **and** the guard/parity surfaces in the same
  commit (the `reference-type-parity.unit.spec.ts` discipline;
  `reference_type` stays `"ORDER"` with the demand-post id, so the
  entries remain purchase-context-valid if a CCR variant ever exists).
  Do not repeat the `SPLIT_PAYOUT` orphan-literal mistake.
- **Mechanics to copy from the template notes:** deterministic
  idempotency key per (participant, post, destination); write-time
  validation of percentages (hard-fail, not warn); the cross-rail guard
  (`service.ts:868-878`) already forbids mixed-currency legs.
- **What Tier 2 must NOT do at Posture A:** create a CCR savings
  balance. Posture A's hard invariant list is explicit — *"No
  balance-holding outside the purchase-payout context… no Credits
  'wallet' abstraction that holds value independent of commerce flow"*
  (`docs/POSTURE_A_COMPLIANCE.md:56-60`). A CCR `SAVINGS` account is
  that abstraction by definition. CCR savings are a posture change, not
  a feature flag.

## 5. Sequencing

1. **Tier 0** — residual return. A money-correctness fix in the Move 1
   class (member funds stranded today); shippable immediately.
2. **Tier 1** — event fix (+ `CONFIRMED` adoption) and the recording
   subscriber; shippable immediately after.
3. **Counsel review** (§6) with Tiers 0–1 live as evidence.
4. **Tier 2** — `SAVINGS` destination for USD, per counsel's answers.
5. **CCR variant** — only with `docs/CCR_HRS_IGNITION.md` ignition
   complete *and* a posture change (or counsel's blessing that a
   purchase-context-bound savings instrument survives invariant 3).

## 6. Counsel questions (the memo)

FBM's stated posture is the FinCEN payment-processor exemption —
facilitator, "holds it briefly," disburses to the seller
(`docs/POSTURE_A_COMPLIANCE.md:3-23`); it is **not** a registered MSB and
holds no state money-transmitter licenses (`:27-30`), with 18 USC 1960
named as the personal-liability stake (`:39-42`). Savings routing tests
that frame at four points; the spec ships nothing custody-changing until
these come back.

1. **Duration of holding.** Member `USER_WALLET` balances already persist
   between purchases; a named `SAVINGS` balance is *designed* to persist.
   At what holding duration/purpose does the exemption's
   facilitation-of-a-purchase rationale stop covering us — and does
   labeling a balance "savings" itself change the analysis (deposit-taking
   / state money-transmission definitions), given that cash-out is
   currently fail-closed (`ACH_PAYOUTS_ENABLED=false`,
   `.env.production.example:110-115`)?
2. **Securities adjacency.** The investment-pool surface
   (`roi_type: "REVENUE_SHARE"`, `revenue_share_percentage`,
   `distributeDividends` — `hawala-ledger/service.ts:1653-1809`) is
   investment-contract-shaped. Routing *savings* into pools —
   including the dormant `auto_invest_percentage` path
   (`service.ts:1367-1371`, unpopulated in production per the refund-path
   note `:1513-1518`) — must be assumed a securities offering until
   counsel says otherwise. Question: can `INVESTMENT_POOL` ever be a
   savings destination without registration/exemption work, and does the
   collective-buys design (`docs/COLLECTIVE_BUYS_MICRO_INVESTMENT_SPEC.md`
   §5's backer returns) change that answer?
3. **Unclaimed property, already.** The stranded residuals of §1 are
   member property held by the platform with no return path — do state
   escheatment obligations already attach, and does Tier 0 discharge
   them going forward (plus what look-back remediation is owed)?
4. **Yield and promotion.** v1 pays no yield on `SAVINGS`. If any later
   version credits patronage, dividends, or match incentives to savings
   balances, which of deposit-broker rules, savings-promotion statutes,
   or the §6.2 securities analysis bind first?

**Standing instruction** (mirror of the Posture A one): any PR touching
savings routing must state which tier it implements and, for Tier 2+,
link the counsel sign-off.
