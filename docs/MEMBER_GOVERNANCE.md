# Member Governance

How members — growers, makers, buyers, co-op members — actually decide things
on FBM, and where they do not.

> **This is not `docs/GOVERNANCE.md`.** That document covers *maintainer*
> governance: who reviews PRs, how releases are gated, how ADRs get recorded.
> It says nothing about the people using the platform. This document is the
> other half, and it is deliberately blunt about the parts that do not exist
> yet, because the homepage carries an "Open Source. Community Governed." badge
> and a reader deserves to know exactly what backs it.

---

## Summary of what is real

| Layer | Member governance | Status |
|---|---|---|
| A garden or community growing project | Proposals, weighted or equal voting, quorum, delegation, roles | **Implemented** |
| A cooperative | Declared governance model, member roles, revenue shares | **Recorded, not enforced** |
| Surplus sharing | Quarterly patronage allocation proportional to commission paid | **Computed, settled manually** |
| The platform itself | Coalition-wide member voting | **Does not exist** |

The honest one-line version: **governance is implemented at the project level,
not the platform level.** What backs "community governed" at the platform level
today is the open codebase and the right to fork it — not a ballot.

---

## 1. Garden and project governance — implemented

`backend/src/modules/governance/` is a working governance system, scoped by
`garden_id`. Every model in it carries that column: proposals, votes,
delegations, comments, and roles.

### Proposals

`models/proposal.ts` (`garden_proposal`) supports nine proposal types:

`budget` · `policy` · `membership` · `infrastructure` · `governance` ·
`allocation` · `season_plan` · `partnership` · `other`

Each proposal carries a proposer, optional co-sponsors, a voting window
(`voting_start` / `voting_end`), a `quorum_required` percentage, and an
`approval_threshold` percentage. It moves through:

`draft → submitted → active → passed | rejected | tie | expired`,
then `implemented` or `withdrawn`.

`expired` specifically means voting closed **without quorum** — a distinct
outcome from rejection, which matters: a proposal nobody voted on has not been
turned down.

### Voting power

`backend/src/api/store/proposals/[id]/votes/route.ts` computes a member's
voting power from the garden's `governance_model`:

- **`one_member_one_vote`** — everyone gets exactly one vote, regardless of
  hours worked or money contributed. This is the equal-say model, and it short
  circuits the weighting below entirely.
- **Weighted** — `base_votes`, plus a bonus for labour hours contributed and a
  bonus for investment, each scaled by a per-garden weight (default 0.5 each).
  Labour accrues per 10 hours; investment per 100 units.

Gardens default to `equal_vote` (`api/store/gardens/route.ts`).

Every vote records its `power_basis` — the inputs that produced the number — so
a member can see *why* their vote counted for what it did rather than being
handed a figure. Votes are changeable while the window is open.

### Delegation, comments, roles

`models/delegation.ts` lets a member delegate their vote. `models/comment.ts`
carries deliberation on a proposal. `models/role.ts` defines garden roles.

---

## 2. Cooperatives — recorded, not enforced

`backend/src/modules/cooperative/` models a cooperative, its members, and its
listings.

- `cooperative.governance_model` is **free text** (e.g. `"one-member-one-vote"`).
  It describes how a co-op says it governs itself; nothing in the platform
  enforces it, and it does not wire into the proposal/vote machinery above.
- `cooperative.membership_requirements` is likewise descriptive text.
- `cooperative_member` carries a role (`ADMIN` / `COORDINATOR` / `PRODUCER` /
  `MEMBER`), a `membership_number`, and `revenue_share_percent` — the member's
  declared share of sales.

Treat this layer as **metadata a co-op publishes about itself**. Do not describe
it publicly as the platform running co-op elections, because it does not.

---

## 3. Surplus sharing — patronage

`backend/src/modules/hawala-ledger/patronage-compute.ts` implements the
patronage formula:

```
seller's refund = (commission that seller paid this quarter)
                / (total commission paid this quarter)
                × the allocated refund pool
```

That is proportional to *contribution*, not to capital — the cooperative
principle, and the reason it is called patronage rather than a dividend.

`backend/src/jobs/patronage-refund.ts` runs on the first day of each calendar
quarter at 02:00 UTC, computes the previous quarter's allocations, and writes
one `patronage_allocation` row per seller with `status=computed`.

**It stops there.** Settlement to `paid` is a separate step so an operator can
review before money moves, and because USD disbursement under Posture A goes via
Stripe ACH rather than the Stellar path the ledger otherwise uses. See
`docs/POSTURE_A_COMPLIANCE.md`.

So: patronage is **computed automatically and disbursed deliberately**. Anyone
describing it publicly should say so rather than implying an automatic payout.

---

## 4. Platform governance — what does not exist

There is no coalition-wide proposal, ballot, membership class, or board
election. `modules/governance` cannot express one: every table is keyed by
`garden_id`. Searching the storefront for a governance UI returns nothing but
demand-pool barter proposals and prose.

What genuinely backs the platform-level claim today:

1. **The source is public.** How commission is calculated, how verification is
   granted, how patronage is computed — all readable, all in this repository.
2. **The exit right.** A community that disagrees with the platform's direction
   can run its own node. This is the strongest governance guarantee currently
   available, and it is real in a way a consultative process would not be.
3. **Project-level self-governance**, per §1.

It is worth stating plainly that (2) is weakened while the repository carries no
`LICENSE` file — see `docs/TRUST_LANDSCAPE_AUDIT.md` Finding D. A fork right
that is not licensed is a norm, not a right.

### If platform governance is built

The pieces that would be needed, in rough order:

1. A membership concept that is not garden-scoped — who is a member of the
   coalition, and in which class.
2. Proposal and vote models at that scope, or a generalisation of
   `modules/governance` away from `garden_id`.
3. A published constitution: what is votable, what is not, and what a passed
   vote binds. A vote that maintainers may ignore is a survey.
4. A public record of outcomes.

Until those exist, no surface should say the platform is member-governed.

---

## Keeping this document honest

Public governance copy is served from `/governance`
(`storefront/src/app/[locale]/(main)/governance/page.tsx`). If the mechanics
here change, change that page in the same PR — the failure mode this whole
document exists to prevent is a governance claim outliving the mechanism behind
it.
