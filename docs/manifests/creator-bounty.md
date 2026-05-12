# Manifest: Creator Bounty Pool (v0.1.0)

| Field | Value |
| --- | --- |
| Slug | `creator-bounty-pool` |
| Playbook | `atelier` (small affinity group, flat consensus among makers) |
| Listing types | `campaign`, `digital` |
| Surface | `refrain` (creator-bounty surface) |
| Governance | `vote-weighted` |
| Sensitivity floor | `public` |
| Settlement rails | `usdc`, `karma`, `gift` |

## The project

A creator commits to producing a piece of work — a story, an album, a
series of paintings — funded by supporter pledges. Each supporter
declares a `capital.bounty-contribution` pledge. The pledge amount
denominates the supporter's vote weight when the manifest's
`governance_model: vote-weighted` resolves which work the creator
funds next.

The stretch-goal model: every pledge counts for funding, and bigger
pledges have proportionally more say in *which* queued work gets
produced first. This is the substrate version of Patreon-with-
stretch-goals or Kickstarter-with-funded-roadmap.

## Required asset declarations

| Slug | Role | Min count | Optional? | Notes |
| --- | --- | --- | --- | --- |
| `skill.creative.*` | operator | 1 | no | wildcard: matches visual / writing / music subkinds |
| `output-capacity.creative-work` | operator-produced | 1 | no | `lifecycle: one-time` — the deliverable ships, declaration discharges |
| `capital.bounty-contribution` | contributor | 3 | no | each supporter's `amount_minor` is their vote weight |
| `time.coordinator` | coordinator | 1 | no | `hours_per_week_min: 2`; runs intake + tallies the vote |
| `credential.creator-verification` | operator | 0 | yes | optional VC; supporters can require it but anonymous pools are valid |

## Settlement

- **USDC** for the bounty disbursement. When the vote resolves and
  the creator ships, the pool's pledges settle via
  `hawala-ledger.createTransfer` between supporters' `USER_WALLET`
  accounts and the creator's. The reconciler routes these as
  ordinary cash-rail transfers; the dual-rail selector decides
  Stripe-ACH vs. Stellar-USDC per the bridge health snapshot.
- **Karma** accrues to supporters on funded delivery. The first
  manifest where karma is recognition of *support*, not *labor*.
- **Gift** when a supporter declines reciprocation (e.g., asks for
  no karma credit, donates anonymously).

No CCR (this is fan-funded creative work, not co-op resource
sharing); no hours (the creator's labor isn't a peer time-bank
exchange); no USD on the manifest (settlements happen through
USDC for cleanliness, with Stripe-ACH falling out via the dual-rail
selector when bridge health requires it).

## Governance

`vote-weighted`. This is the manifest that lands the last unused
governance enum value. The mechanism:

1. The creator has a queue of works they could produce
   (`output-capacity.creative-work` declarations, each with a
   `description` and optional `delivery_target_date`).
2. Each supporter's `capital.bounty-contribution` carries an
   `amount_minor` and optionally an `earmarked_for` work id.
3. The coordinator tallies pledges. Earmarked pledges count fully
   toward their target work; unearmarked pledges count toward the
   pool's aggregate vote.
4. The work with the highest weighted-pledge sum is funded next.

The actual tally + resolution workflow lives in Governance v2 (the
same workstream that owns consensus rounds for childcare). The v0.1
manifest declares intent + carries the data shape.

## What this manifest exercises in v0.1

- **`vote-weighted` governance** — last unused enum value. The
  catalog now covers all four governance models.
- **`refrain` surface** — last newly-exercised surface among the
  four. `blackstar` (delivery/mobility) is the only remaining
  unused surface.
- **`atelier` playbook** — fourth distinct playbook in the catalog
  (after grove, commons, workshop).
- **`capital` asset category** — the AssetCategory enum value
  existed since v0 but had no concrete kind. `capital.bounty-
  contribution` is the first; the seed now has both a `capital`
  root and one leaf.
- **`skill.creative.*` wildcard** — third distinct category root
  using wildcards (after `tool.*` and `skill.repair.*`). Proves the
  wildcard mechanism isn't load-bearing on the `skill.repair`
  branch either.
- **Mixed pledge currencies** — `capital.bounty-contribution`'s
  attribute schema admits `USDC` or `USD`; supporters can pledge in
  either and the dual-rail selector decides settlement routing per
  pledge.

## Open dependencies

- **Vote-tally workflow.** Governance v2 owns the actual
  proposal/tally primitive. v0.1 captures the data shape (per-
  pledge amount + optional earmark) but the resolution logic isn't
  implemented.
- **Per-pledge attribution to settlements.** When the bounty pays
  out, each supporter's `karma_event` should reference their
  pledge id as `source_id` so the karma accrual is traceable. The
  settlement composer threads `karma_source` metadata for exactly
  this; the wiring from pledge → settlement is the next layer.
- **Creator-verification VC issuer trust.** Whose issuance of
  `credential.creator-verification` counts? The VC body parses
  structurally (per v0.1's `attestations/vc.ts`) but whose
  signature satisfies *supporters* is a curation question for the
  platform.
- **Refund logic on undelivered work.** If a creator misses the
  delivery target, what happens to the pledged USDC? v0.1 ships
  the schema; the refund flow is a workflow-side concern.

## Why this is the right v0.1 fifth manifest

Three reasons.

First, it lands the last unused governance enum value
(`vote-weighted`) and exercises an unused asset category
(`capital`), so the catalog now covers every value in the four
enums the manifest schema cares about (Lifecycle, SettlementRail,
GovernanceModel; only Surface still has one unused value —
`blackstar`).

Second, it proves the substrate fits a creator-side vertical
without changes. The four earlier manifests covered producer-side
(nursery), borrower-and-coordinator (tools), volunteer-and-client
(repair café), and rotating-care (childcare). Creator-bounty is
the *patron-funded* shape, which doesn't fit any of the four
patterns above — and the schema accepted it.

Third, the wildcard mechanism gets stretched to a third category
root, which the orthogonality test now asserts as a structural
fact. If wildcards stopped working in any one place, the manifest
catalog now fails to parse in three different spots.
