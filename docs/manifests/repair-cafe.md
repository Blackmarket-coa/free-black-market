# Manifest: Repair Café (v0.1.0)

| Field | Value |
| --- | --- |
| Slug | `repair-cafe` |
| Playbook | `workshop` (worker co-op with sociocratic circles, rotating roles, patronage refunds) |
| Listing types | `event`, `bookable` |
| Surface | `threshold` (per `docs/COMPOSITION_LAYER.md`, repair cafés live here alongside tool libraries) |
| Governance | `consensus` |
| Sensitivity floor | `public` |
| Settlement rails | `karma`, `gift` |

## The project

A recurring neighborhood event — typically a Saturday at a community
hall or library — where volunteer fixers diagnose and repair household
items the public brings in. Customers walk in with a broken thing
(toaster, lamp, jeans, bike); a coordinator does intake; a fixer with
the matching specialty (electronics, textile, mechanical) is paired to
the item; the repair happens; nothing changes hands but karma. Parts
the customer needs to source themselves — the café doesn't sell
anything, which is part of why it works.

The repair café is the third orthogonal v0 vertical because it tests
schema axes the nursery and tool library don't:

- **Skill-matched intake** rather than asset lending or output sales.
- **Event-based, perishable time commitments** (Saturday shifts) rather
  than recurring or durable ones.
- **A consumer-side input declaration** (`artifact.broken-item`) rather
  than a producer-side resource declaration.
- **Consensus governance** rather than individual or collective.
- **Public sensitivity floor** — anyone can walk in.

## Required asset declarations

| Slug | Role | Min count | Optional? | Notes |
| --- | --- | --- | --- | --- |
| `skill.repair.*` | fixer | 1 | no | wildcard: matches `skill.repair.electronics`, `skill.repair.textile`, `skill.repair.mechanical`, ... |
| `time.event-shift` | fixer | 1 | no | `hours_min: 2`; `lifecycle: perishable` |
| `space.event-venue` | host | 1 | no | `accessible: true`; recurring date series |
| `time.coordinator` | coordinator | 1 | no | intake + queue management, `hours_per_week_min: 2` |
| `artifact.broken-item` | client | 1 | no | the customer's intake; `lifecycle: one-time`, `sensitivity_tier: public` |

## Settlement

- **Gift** is the dominant rail. The repair itself is gifted; the labor
  is not priced. This is the constitutional rail of the surface.
- **Karma** accrues to the fixer per completed repair, surfacing
  reputation and feeding the anti-hoarding dynamic
  `docs/COMPOSITION_LAYER.md` describes. Karma is non-fungible by
  design.
- No `usd`, `usdc`, or `ccr` rails. Parts cost is out-of-scope; the
  customer sources parts. Keeping money out of the event is part of
  what makes consensus governance tractable.

## Governance

Consensus. The fixer collective consents to: which event dates run,
which item categories are in-scope, when to refuse a repair (water-
damaged electronics, items beyond economical fix), and how to add new
fixers to the circle. Governance v2 (proposal + consent rounds) lands
the actual primitives; v0 declares the model.

## What this manifest exercises in v0

- **Wildcard on `skill.repair.*`**. This proves the wildcard matcher
  isn't load-bearing on the `tool` category specifically — the same
  hierarchical-matching mechanism works for skills. If the schema ever
  drops wildcards, both this manifest and the tool library stop parsing.
- **`perishable` lifecycle** on `time.event-shift`. A fixer who signs
  up for Saturday and doesn't show forfeits the slot; the time isn't
  bankable. This is a lifecycle value neither nursery nor tools touches.
- **`one-time` lifecycle** on `artifact.broken-item`. The customer
  declares the broken item once, the repair happens (or doesn't), the
  declaration is done. Distinct from the `recurring` and
  `durable-commitment` lifecycles the other manifests rely on.
- **`consensus` governance**, completing the catalog's coverage of
  three of the four governance enum values (individual, collective,
  consensus; vote-weighted is unused).
- **`public` sensitivity floor**, distinct from the `member-visible`
  floor the other two manifests carry. Anyone can RSVP to an event.
- **`workshop` playbook**, exercising the third distinct playbook
  recipe across the catalog (grove, commons, workshop).
- **`client` role**, the consumer-intake role added to the
  `ManifestRole` enum to represent declarations made by someone
  *receiving* a service rather than contributing or operating one.
- **`event` listing-type**, which neither nursery nor tools uses.

Combined with the nursery and tool library, the v0 catalog now covers
**every value** in the `Lifecycle` and `SettlementRail` enums — the
strongest available structural proof that the schema generalizes.

## Open dependencies

- **Skill-matching engine**: the fixer-to-item routing is the matching
  workload v0 schema-defines but v0.1 has to implement. The `skill.*`
  wildcard surface looks like the `tool.*` surface but the constraint
  semantics differ (a fixer matches a broken-item category, not vice
  versa).
- **Per-event scheduling primitive**: `time.event-shift` declarations
  carry an `event_date` attribute, but the matcher needs to coordinate
  fixer availability with the event date and the venue's date series.
  This is event-loop logic the playbook/listing-type spine doesn't
  fully cover yet.
- **Karma accrual rules**: how many karma per repair? Repairs vary in
  difficulty (a stuck zipper vs. a CRT recap). Schema slot exists;
  computation does not.
- **Liability and waiver text**: a customer brings their item and the
  fixer touches it. Real repair cafés use a waiver. v0 doesn't model
  waivers; v0.1 should consider whether this is an `Attestation`
  shape or a separate primitive.

## Why this is the right v0 third manifest

The repair café is the cleanest available proof that the substrate
generalizes beyond producer-and-borrower verticals to a
**volunteer-service-with-consumer-intake** vertical, without forcing
the schema to grow new top-level concepts. Every novel dimension
(client role, broken-item declaration, event-shift perishability,
consensus governance, public floor, workshop playbook, skill.*
wildcard) lands inside existing schema slots. If something had to be
added to make repair café work, that would be a v0 failure; nothing
did.
