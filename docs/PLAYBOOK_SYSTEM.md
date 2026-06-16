# Playbook System

A **playbook** is the social form of a vendor: who is selling, how they
govern, and how surplus is shared. Each vendor picks a playbook at setup and
that choice determines storefront identity, dashboard chrome, payout
structure, allowed listing-types, and the default values for the 14
`VendorFeatures` extension keys that gate optional modules.

Playbook is the canonical concept that replaces `vendor-type`. The existing
`vendor-type` provider remains as a deprecated re-export shim for one
release to avoid breaking the 100+ call sites currently in vendor-panel.

## The eleven playbooks

| Playbook  | Form                                                | Commission | Sliding-scale | Credits payout | Multi-member payout |
|-----------|-----------------------------------------------------|-----------:|:-------------:|:--------------:|:-------------------:|
| Stall     | Solo seller                                         | 3 %        | opt-in        | opt-in         | no                  |
| Atelier   | Affinity group, 2–12 members, flat consensus        | 3 %        | yes           | yes            | yes                 |
| Grove     | Mutual-aid co-op with internal scrip + sliding scale| 3 %        | yes (first)   | yes            | yes                 |
| Workshop  | Worker co-op, sociocratic circles, patronage refunds| 3 %        | yes           | yes            | yes                 |
| Commons   | Multi-stakeholder co-op (producer/worker/consumer)  | 3 %        | yes           | yes            | yes                 |
| Cycle     | CSA / order-cycle farm                              | 3 %        | yes           | yes            | yes                 |
| Kitchen   | Restaurant, commissary, shared kitchen              | 3 %        | yes           | yes            | yes                 |
| Harvest   | Community garden, collective harvest                | 3 %        | yes           | yes            | yes                 |
| Hub       | Federation hub, aggregates other vendors            | 3 %        | yes           | yes            | yes                 |
| Service   | Time-bank service, sliding-scale practitioner       | 3 %        | yes           | opt-in         | yes                 |
| Creator   | Independent creator monetizing an audience          | 3 %        | opt-in        | opt-in         | no                  |

A vendor picks a **primary** playbook plus, optionally, **additional roles**
(e.g. a Stall that is also a Creator). The primary drives storefront identity,
dashboard chrome, and commission; the feature modules a multi-role vendor sees
are the union of every selected role's defaults, persisted to
`seller_metadata.enabled_extensions`.

Notes:

- **Stall** is intentionally zero-overhead. A Stall vendor never sees a
  proposal flow, member-admission screen, patronage refund, governance
  pattern strip, or circle. The playbook system is the firewall that
  prevents solo sellers from being conscripted into cooperation they did
  not ask for.
- **Commons** is the most complex playbook and is not a default option in
  the 3-question picker; users must scroll to a "more options" section to
  pick it explicitly.
- **Service** defaults credits-payout to opt-in because many service
  providers (childcare, healthcare-adjacent) need predictable cash flow.

## Allowed listing-types by playbook

A playbook declares which listing-types it supports. The intersection is
enforced as a workflow step on `product.created`.

| Playbook  | physical | event | digital | recurring | wholesale | consignment | unique | bookable | campaign |
|-----------|:--------:|:-----:|:-------:|:---------:|:---------:|:-----------:|:------:|:--------:|:--------:|
| Stall     | ✓        | ✓     | ✓       | ✓         |           |             | ✓      |          | ✓        |
| Atelier   | ✓        | ✓     | ✓       | ✓         | ✓         | ✓           | ✓      | ✓        | ✓        |
| Grove     | ✓        | ✓     |         | ✓         |           |             | ✓      | ✓        |          |
| Workshop  | ✓        | ✓     | ✓       | ✓         | ✓         | ✓           | ✓      | ✓        | ✓        |
| Commons   | ✓        | ✓     | ✓       | ✓         | ✓         | ✓           | ✓      | ✓        | ✓        |
| Cycle     | ✓        | ✓     |         | ✓         | ✓         |             |        | ✓        | ✓        |
| Kitchen   | ✓        | ✓     |         | ✓         | ✓         |             |        | ✓        |          |
| Harvest   | ✓        | ✓     |         | ✓         |           |             | ✓      | ✓        | ✓        |
| Hub       | ✓        | ✓     | ✓       | ✓         | ✓         | ✓           | ✓      | ✓        | ✓        |
| Service   |          | ✓     | ✓       | ✓         |           |             |        | ✓        |          |
| Creator   | ✓        | ✓     | ✓       | ✓         |           |             | ✓      |          | ✓        |

See `docs/LISTING_TYPES.md` for the listing-type specifications.

## Mapping from existing vendor types

The legacy `vendor-type` provider had six options. This branch maps them to
playbooks as follows. The mapping is applied as a denormalized cache on
`seller_metadata.vendor_type`; the new source of truth is
`playbook.assigned_playbook_id` linked via `defineLink` to `Seller`.

| Existing vendor-type | Default playbook | Override reachable via |
|----------------------|------------------|-----------------------|
| `producer`           | `cycle`          | "I'm a solo farmer not running a CSA" → `stall` |
| `garden`             | `harvest`        | "We're a worker co-op tending the land" → `workshop` |
| `kitchen`            | `kitchen`        | "We're an affinity-group commissary" → `atelier` |
| `restaurant`         | `kitchen`        | (consolidated with `kitchen`) |
| `maker`              | `stall`          | "There are 2–12 of us" → `atelier`; "We're worker-owned" → `workshop` |
| `mutual_aid`         | `grove`          | "We're a multi-stakeholder co-op" → `commons` |
| `creator`            | `creator`        | (creator-monetization vendors map straight across) |

Migration of existing sellers is non-destructive: a one-time backfill assigns
the default playbook above; the existing `vendor_type` column remains for
read-cache compatibility.

## 3-question picker decision tree

The picker asks three questions and produces a recommendation card that
displays the chosen playbook, the reasoning, and a "see other options"
link. The user can override; both the recommendation and the override are
stored on `PlaybookAssignment` for analytics.

### Question 1 — Size

> How many of you are there?

- **Solo** → narrows to {Stall, Service}.
- **2–12** → narrows to {Atelier, Workshop, Grove, Kitchen, Harvest, Cycle, Service}.
- **13–50** → narrows to {Workshop, Commons, Grove, Kitchen, Harvest, Cycle, Hub}.
- **50+ or federation** → narrows to {Commons, Hub, Cycle}.

### Question 2 — Governance

> How do you decide things?

- **I decide** → Stall (if Solo) / Atelier (if 2–12).
- **We agree informally** → Atelier (2–12) / Grove (any size, if mutual aid present).
- **We use circles** → Workshop (any size).
- **We have elected reps** → Commons (any size) / Hub (federation).
- **We use a federation council** → Hub.

### Question 3 — Offering

> What are you offering?

- **Things I make or grow** → Stall / Atelier / Workshop / Commons / Cycle (CSA).
- **Services on my time** → Service.
- **A subscription or season** → Cycle (CSA / seasonal share) / Service (retainer).
- **Restaurant or commissary food** → Kitchen.
- **A harvest pool from a shared space** → Harvest.
- **I aggregate other vendors** → Hub.

The recommendation is the highest-affinity playbook in the intersection of
the three filtered sets. Ties resolve to the simpler playbook (Stall over
Atelier; Atelier over Workshop) on the principle of don't-conscript-into-
governance-you-did-not-ask-for.

## Recipe configuration

Each playbook is configured as a recipe in
`backend/src/modules/playbook/recipes/<playbook>.ts`. A recipe declares:

```ts
type PlaybookRecipe = {
  id: PlaybookId
  display_name: string
  social_form: string
  commission_rate: number          // default 0.03
  allow_sliding_scale: boolean
  allow_credits_payout: boolean
  member_model: 'solo' | 'flat' | 'sociocratic' | 'multi_stakeholder' | 'federation'
  default_features: Partial<VendorFeatures>
  allowed_listing_types: ListingTypeId[]
  storefront_blurb_default: string
}
```

Recipes are seeded at first boot via
`backend/src/scripts/seed-playbooks.ts`. Editing a recipe requires a
migration if the change affects denormalized caches (commission_rate,
allow_credits_payout) or a non-breaking re-seed if it only changes display
copy.

## VendorFeatures extension key defaults

The 14 keys defined on `vendor-type-provider/vendor-type-context.tsx` carry
forward to the new `playbook-provider`. The defaults per playbook (which
backend `playbook.recipes/*.ts` and frontend `playbook-provider`
`getFeaturesByPlaybook` both must match):

| Feature          | Stall | Atelier | Grove | Workshop | Commons | Cycle | Kitchen | Harvest | Hub | Service |
|------------------|:-----:|:-------:|:-----:|:--------:|:-------:|:-----:|:-------:|:-------:|:---:|:-------:|
| hasProducts      | ✓     | ✓       | ✓     | ✓        | ✓       | ✓     | ✓       | ✓       | ✓   |         |
| hasInventory     | ✓     | ✓       | ✓     | ✓        | ✓       | ✓     | ✓       |         | ✓   |         |
| hasSeasons       |       |         |       |          |         | ✓     |         | ✓       |     |         |
| hasVolunteers    |       |         | ✓     |          | ✓       |       |         | ✓       |     |         |
| hasMenu          |       |         |       |          |         |       | ✓       |         |     |         |
| hasDeliveryZones |       |         |       |          |         |       | ✓       |         | ✓   |         |
| hasDonations     |       |         | ✓     |          | ✓       |       |         | ✓       |     |         |
| hasSubscriptions |       |         |       |          |         | ✓     |         | ✓       |     | ✓       |
| hasSupport       | ✓     | ✓       | ✓     | ✓        | ✓       | ✓     |         | ✓       | ✓   | ✓       |
| hasHarvests      |       |         |       |          |         | ✓     |         |         |     |         |
| hasPlots         |       |         |       |          |         |       |         | ✓       |     |         |
| hasRequests      |       |         | ✓     | ✓        | ✓       |       | ✓       |         | ✓   | ✓       |
| hasFarm          |       |         |       |          |         | ✓     |         | ✓       |     |         |
| hasShows         |       |         |       |          |         |       | ✓       |         |     |         |

The matrix above omits **Creator** (the eleventh playbook) for width;
Creator defaults to `hasProducts`, `hasInventory`, `hasSubscriptions`,
`hasShows`, and `hasSupport`.

The above set are the existing 14 keys on `vendor-type-provider`. Adding
new governance-specific keys (e.g. `hasMembers`, `hasGovernance`,
`hasBookings`) is deferred to a follow-up branch that ships the
governance v2 module.

A vendor can opt into any feature their playbook doesn't enable by default
via their settings, with the caveat that some combinations make less sense
than others.

## Rename strategy

This branch deprecates `vendor-type` rather than removing it. The migration
path:

1. New `playbook-provider` exports the canonical API
   (`usePlaybook`, `Playbook`, `PlaybookFeatures`).
2. `vendor-type-provider/index.ts` becomes a thin re-export shim:
   `export { usePlaybook as useVendorType, Playbook as VendorType }` with
   `@deprecated` JSDoc.
3. Call-site migration is incremental in subsequent branches; the type alias
   keeps the 14 `VendorFeatures` keys identical, so behavior is unchanged
   while names migrate.
4. After two release cycles with the deprecation shim, the
   `vendor-type-provider` directory is removed.

The migration does **not** touch the Postgres enum on `seller_metadata.vendor_type`.
That column becomes a denormalized read cache populated by a subscriber on
playbook-assignment events.

## Future playbooks

A future v3 may add a further playbook, **Lattice** — a representation-and-
licensing co-op (Stocksy / Resonate / publisher-of-record shape) where
members upload work and the co-op licenses on their behalf with royalties
splitting atomically. Deferred until consignment-heavy demand surfaces.
