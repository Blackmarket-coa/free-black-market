# ADR-0003: XP Demurrage and Soulbound Semantics

- **Status:** Accepted
- **Date:** 2026-06-24
- **Owners:** Platform / Progression
- **Phase:** BMC Unified Design & Behavioral System

## Context

The progression module (`backend/src/modules/progression/`) carries a **dual XP
balance** on the character sheet: lifetime `total_xp` (status — gates tiers,
levels, titles) and `spendable_xp` (an allowance consumed by redemptions). Two
design questions follow from the unified-design brief:

1. **Hoarding.** A spendable balance that never decays incentivizes hoarding and
   detaches the economy from ongoing participation. Community-currency practice
   (Sarafu / Gesell *demurrage*) addresses this with a small recurring decay that
   keeps value circulating.
2. **Speculation / signal integrity.** XP is reputation, not money. Its value
   "comes from the opportunities it unlocks, not from market trading" (the
   soulbound-token thesis; EIP-5192 lock flag, EIP-4973 account-bound). XP is
   *already* non-transferable by construction (no wallet→wallet transfer exists;
   the ledger is `customer_id`-scoped), but this is implicit and unstated, and
   raw-volume accrual is farmable.

## Decision

1. **Demurrage applies to `spendable_xp` only.** A weekly job decays each
   sheet's spendable balance by a small rate above a grace floor. It writes an
   append-only `xp_event` (`reason: "demurrage"`, `source_module:
   "demurrage-job"`) so every decay is auditable and reversible. It is
   implemented as a dedicated `recordDemurrage` path — **separate** from
   `recordXpEvent`, whose negative-amount path also decrements `total_xp` and
   role XP. Demurrage **must never** reduce `total_xp`, role XP, levels, or
   titles. That invariant is load-bearing and unit-tested.

2. **Lifetime status is permanent.** `total_xp`, role levels, and earned titles
   never decay. This preserves the Stack Overflow "spend vs. status duality":
   spend the allowance, keep the standing.

3. **XP is soulbound by construction, made explicit.** A
   `progression/soulbound.ts` constant + doc records the EIP-5192/4973 mapping:
   non-transferable, owner-bound, revocable only via signed clawback `xp_event`s.
   No transfer API will be added.

4. **Peer attestation weights XP by verified value.** `recordAttestedXpEvent`
   writes an `xp_attestation` row and awards `base × clampedWeight`, rejecting
   self-attestation and requiring a trusted attester (reusing
   `vendor_verification.trust_score` / governance role). Verified contributions
   (e.g. `volunteer_log.verified_by_id`) are the first attestation source. This
   is the anti-karma-farming control.

## Consequences

### Positive

- Spendable XP circulates; lifetime standing is safe and motivating.
- Every decay and award is an auditable ledger row.
- Soulbound + attestation make the signal hard to farm or speculate on.

### Tradeoffs

- Demurrage and `beginRedemption` both mutate `spendable_xp`. Mitigation: run
  demurrage off-peak (weekly, 03:00), always floor at 0, and rely on the ledger
  for audit/repair. A redemption can never be driven negative by demurrage.
- Attestation adds a model + a trust lookup per attested award.

## Implementation Notes

- `recordDemurrage` / `applyDemurrage`: `backend/src/modules/progression/service.ts`.
- Job: `backend/src/jobs/xp-demurrage.ts` (mirrors `backend/src/jobs/demand-pool-expiry.ts`).
- Soulbound: `backend/src/modules/progression/soulbound.ts`.
- Attestation: `backend/src/modules/progression/models/xp-attestation.ts` +
  `recordAttestedXpEvent` + `Migration<date>AddXpAttestation.ts`.
- Invariant tests: `backend/src/jobs/__tests__/xp-demurrage.unit.spec.ts`,
  `backend/src/modules/progression/__tests__/attestation.unit.spec.ts`.
