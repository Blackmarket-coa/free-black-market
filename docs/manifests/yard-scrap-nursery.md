# Manifest: Yard-Scrap Nursery (v0.1.0)

| Field | Value |
| --- | --- |
| Slug | `yard-scrap-nursery` |
| Playbook | `grove` (mutual-aid co-op with internal scrip and sliding scale) |
| Listing types | `physical_product`, `bookable`, `recurring` |
| Surface | `commerce` (FBM proper) |
| Governance | `individual` |
| Sensitivity floor | `member-visible` |
| Settlement rails | `ccr`, `usdc`, `usd`, `gift` |

## The project

A neighborhood-scale closed-loop urban-agriculture node:

- Households contribute yard scraps (leaves, clippings, branches,
  kitchen scraps in some configurations) and receive Coalition Credits.
- An operator processes the inputs into compost, vermicast, biochar
  feedstock, and mushroom substrate.
- The operator grows plant plugs, native species, and culinary
  perennials in the resulting media.
- Output flows to FBM retail (`physical_product`), to installed-bed
  appointments (`bookable`), and to plant-of-the-month subscriptions
  (`recurring`).

The `grove` playbook is the right composition: its social form is
"mutual-aid co-op with internal scrip and sliding scale," which
matches the CCR-to-households pattern, and it allows the three
listing-types this manifest composes.

## Required asset declarations

| Slug | Role | Min count | Optional? | Notes |
| --- | --- | --- | --- | --- |
| `land.yard.residential` | host | 1 | no | `acreage_min: 0.25` |
| `skill.horticulture` | operator | 1 | no | |
| `tool.vehicle.truck` | operator-or-shared | 1 | no | for backhaul logistics |
| `time.recurring` | operator | 1 | no | `hours_per_week_min: 20` |
| `output-capacity.yard-scrap` | contributor | 1 | no | per household |
| `output-capacity.compost` | operator-produced | 1 | no | |
| `output-capacity.vermicast` | operator-produced | 1 | no | margin driver |
| `output-capacity.plant-plug` | operator-produced | 1 | no | margin driver |
| `skill.installation` | operator | 1 | yes | enables installed-bed listing-type |

## Settlement

- **CCR** to households for scraps (closed-loop, satisfies Posture A
  because it's in a goods/services context).
- **USD** via Stripe ACH for FBM retail sales (existing hawala-ledger
  edge).
- **USDC** as the internal Stellar asset for cross-node settlement once
  federation is live.
- **Gift** for member-rate Commons donations when the operator chooses
  not to charge.

Member-rate vs. retail pricing logic is **out of scope** here — it
lives in the FBM/Commons boundary spec, which depends on the membership
definition (also pending).

## Governance

Individual operator. Node 1 runs solo for Year 1; alpha operators come
in Year 2 with heavy mentorship; the playbook formalizes from lived
experience and opens self-serve in Year 3. Federation governance
(cross-node) is emergent and not specced here.

## What this manifest exercises in v0

- Recurring production output (`lifecycle: recurring` on multiple
  output-capacity declarations).
- Three settlement rails simultaneously (CCR ↔ households, USD ↔
  retail, gift ↔ Commons).
- Three listing-types composed onto a single playbook.
- Individual governance.

It does *not* exercise:
- Wildcard taxonomy matching (every required slug is a concrete leaf).
- Time-banked settlement (no `hours` rail).
- Collective governance.
- Sensitive declarations (everything is `member-visible` or `public`).

The tool-library manifest covers all four gaps.

## Open dependencies

- Member-rate vs. retail pricing rules (FBM/Commons boundary spec).
- Federation revenue split when nodes proliferate (post-Year-1
  question).
- State nursery license fee verification for SC/AL/TN before launching
  outside FL/GA/NC.
