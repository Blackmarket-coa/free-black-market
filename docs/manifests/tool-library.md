# Manifest: Tool Library (v0.1.0)

| Field | Value |
| --- | --- |
| Slug | `tool-library` |
| Playbook | `commons` (multi-stakeholder co-op: producers + workers + consumers + supporters) |
| Listing types | `bookable` |
| Surface | `threshold` (per `docs/COMPOSITION_LAYER.md`, tool libraries live here) |
| Governance | `collective` |
| Sensitivity floor | `member-visible` |
| Settlement rails | `hours`, `karma`, `ccr`, `gift` |

## The project

A neighborhood-scale lending pool. Members declare tools they're willing
to lend (matched via the `tool.*` wildcard); borrowers reserve a slot
via the `bookable` listing-type; loans settle in time-banked hours and
Karma, with Coalition Credits covering lost-tool replacement and gift
covering low-value consumables. A member librarian coordinates returns
and disputes.

This manifest is the **minimum-viable Commons**: if surplus-routing,
member-rate vs. retail boundary, governance, and time-bank settlement
all work for tool lending, they work for most cooperative resource
sharing.

## Required asset declarations

| Slug | Role | Min count | Optional? | Notes |
| --- | --- | --- | --- | --- |
| `tool.*` | lender | 1 | no | wildcard: matches any tool subkind |
| `space.storage` | library-node | 0 | yes | for a centralized library variant |
| `time.coordinator` | librarian | 1 | no | dispute resolution + returns coordination |
| `credential.trust-score` | borrower-side | 1 | no | `sensitivity_tier: match-only` by default |

## Settlement

- **Hours** for ordinary loans — time-banked, member to member. The
  `hours` rail is a flagged v0.1 extension to `hawala-ledger`
  (recommendation: add an `hours` asset alongside CCR / USDC / Karma).
- **Karma** as the anti-hoarding signal described in
  `docs/COMPOSITION_LAYER.md`. Borrowing accrues Karma debt that
  resolves on return.
- **CCR** for lost-tool replacement (closed-loop satisfied: the payment
  is in a goods/services context — the replacement tool).
- **Gift** for low-value consumables (lost screwdriver bits, etc.) the
  community absorbs.

## Governance

Collective. The lost-tool policy, borrower vetting bar, librarian
selection, and removal of bad actors all run through Blackout
governance rooms. Governance v2 (proposal + consent rounds) is the
post-composition workstream that lands the actual primitives; v0 just
declares the model.

## What this manifest exercises in v0

- Wildcard taxonomy matching (`tool.*`). If the schema ever drops
  hierarchical matching, this manifest stops parsing — the right
  pressure on the taxonomy design.
- `exhaustible-borrow-return` lifecycle, which the nursery does not
  touch.
- Two new settlement rails (hours, karma) that the nursery does not
  use.
- Collective governance, which the nursery does not use.
- A `match-only` sensitivity-tier declaration (`credential.trust-score`),
  which v0 stores but does not yet cryptographically enforce.

## Open dependencies

- **`hours` rail** must land in `hawala-ledger` before the project
  instance executor can run. Decision: extend the existing ledger
  rather than fork in a separate time-bank OSS (Cyclos / hOurworld
  are heavier and tangential).
- **Karma** model location should be finalized in `hawala-ledger`
  before instance executor lands.
- **Match-only sensitivity enforcement** is deferred to the
  Blackout-side privacy work. v0 stores the tier; v1 enforces.
- **Reputation algorithm** for `credential.trust-score` (how prior
  loans accrue, how disputes deduct) is post-v0 — schema slot exists,
  computation does not.

## Why this is the right v0 second manifest

The plan's selection rationale, kept here for future readers:

> Tool library hits both architectural goals at once:
> orthogonal-to-nursery (different settlement, lifecycle, governance,
> surface, output destination) **and** zero regulatory exposure
> (unlike childcare, which forces mandated-reporter law,
> background-check statutes, and state licensing thresholds). It also
> doubles as the minimum-viable Commons — if surplus routing, member
> rates, and governance work for tool lending, they work for most
> cooperative sharing.

Childcare is the cluster-3 stress test (deferred to v1; sanity-check
appendix in `docs/ASSET_GRAPH.md`).
