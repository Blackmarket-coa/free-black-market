# Listing-Types

A **listing-type** describes the shape of an offering on the FBM
storefront. Listing-types are orthogonal to playbooks: a playbook is who
the vendor is, a listing-type is what is on the shelf. Each playbook
declares which listing-types it allows (see `docs/PLAYBOOK_SYSTEM.md` for
the matrix). One product carries exactly one listing-type at any given
time.

The `listing-type` module module-links to Mercur's `Product` via
`defineLink`. Allowed-types-per-playbook is enforced in a workflow step on
`product.created` (and on `product.updated` when the listing-type
changes), not via a DB CHECK constraint, so seeded data is never rejected.

## v1 ship list

These nine listing-types land in this branch:

### `physical_product` (default)

The baseline. A tangible item the buyer receives via the standard
fulfillment pipeline. Shipping module engaged.

- Fields: standard Mercur product variants (price, sku, inventory, weight,
  dimensions).
- Default for every playbook except Service.

### `event`

A capacity-bound, time-windowed listing. Tickets, classes, farm dinners,
work-days, harvest sessions.

- Fields: `capacity`, `ticket_tiers` (array of {name, price, qty}),
  `window_start`, `window_end`, `waitlist_enabled`, `cancellation_policy`.
- Inventory deducts per ticket. Waitlist auto-promotes on cancellation.
- Used by Kitchen (pop-ups, ticketed dinners), Harvest (farm-to-table,
  work-days), and any playbook running open-house events.

### `digital`

A downloadable or stream-delivered file. No shipping module engaged.

- Fields: `delivery_method` (download / stream / external-link),
  `file_storage_ref`, `license_terms`, `download_limit_per_buyer`.
- Default for Stall and Atelier creator vendors; opt-in for any playbook.

### `recurring`

A subscription. Renewal cadence configurable. Underlies CSA shares
(Cycle), member-supported zines (Workshop), sliding-scale memberships
(Grove), retainer service (Service).

- Fields: `cadence` (weekly / biweekly / monthly / seasonal / annual),
  `term_length`, `auto_renew`, `cancel_window`, `pro_rate_on_cancel`.
- Cycle CSA uses this listing-type with the `cadence=seasonal` setting and
  a `share_template_id` link to `order_cycle.share_box_template`.

### `wholesale`

B2B selling with MOQ and tiered pricing.

- Fields: `moq`, `tier_pricing` (array of {min_qty, price_per_unit}),
  `customer_group_gate` (optional — Mercur customer-group reference).
- Hub is the natural seat; Atelier / Workshop / Commons opt-in.

### `consignment`

A vendor lists work on behalf of another party (an artist, a maker, a
member of a representation co-op). Revenue split is atomic at order
complete.

- Fields: `represented_party_id` (Stellar account or platform account),
  `split_rule` (e.g. `{representative: 0.75, consignor: 0.25}` —
  Stocksy-pattern 75/25 to the represented party), `agreement_id` (link to
  signed agreement).
- The revenue split is recorded as a multi-leg LedgerEntry at order
  complete, not as a separate post-hoc Credits transfer (this is a Posture
  A guard — see `docs/POSTURE_A_COMPLIANCE.md`).

### `unique_inventory`

Single-quantity, condition-graded listing for used or one-of-a-kind goods.

- Fields: `condition_state` (`mint` | `good` | `fair` | `repaired`),
  `condition_notes`, `provenance` (optional), `photos_required: true`.
- Quantity is locked to 1. Cannot be re-listed after sale (anti-flipping).
- Stall default for secondhand; Grove for mutual-aid-style thrift.

### `bookable`

A time-slot-based listing. Service appointments, kitchen rentals,
educational slots.

- Fields: `slot_template` (recurrence rule), `slot_duration_minutes`,
  `buffer_minutes`, `max_concurrent_bookings_per_slot`, `lead_time_hours`,
  `cancellation_policy`.
- Used by Service playbook for appointments; Kitchen for chef's table
  bookings; Harvest for work-days; Atelier / Workshop for tutoring.

### `campaign`

A crowdfunded listing. All-or-nothing settlement timer; funds escrowed
during the funding window.

- Fields: `goal_amount`, `funding_window_start`, `funding_window_end`,
  `stretch_goals` (array), `delivery_estimate`, `escrow_id` (link to
  `hawala-ledger.EscrowAgreement`).
- Funds are held in a Stellar escrow account during the funding window.
  On window close: if goal met, escrow releases to the vendor and orders
  enter normal fulfillment; if not met, escrow recovers to buyers via
  pre-authorized recovery transaction.
- Used by Cycle (pre-season CSA capitalization), Workshop (cooperative
  capitalization), Atelier (project launches).

## v2 deferral list

These ship in subsequent branches:

- **`bookable_space`** — PostGIS-located, time-window inventory for
  community space, coworking, camping, glamping. Available to Commons,
  Workshop, Harvest.
- **`intake_workflow`** — repair / restoration / refurbishment with
  states `received → diagnosed → quoted → approved → repaired → returned`.
  Service playbook for paid repair; mutual-aid surface (Threshold) for
  free repair cafés.
- **`cohort`** — capacity-limited scheduled course (apprenticeship,
  trades school, skill share). Workshop playbook for guild-pattern
  schools.
- **`mobile_location`** — vendor publishes a schedule of (location,
  time-window) tuples. Surfaces in storefront "now/today/this week"
  filter. Used by Kitchen / Stall for food trucks and mobile vendors.
- **`drop`** — timed-reveal listing with optional queue and
  purchase-cap-per-customer. Simple extension on top of `physical_product`
  or `digital` with `activates_at` + queue-token middleware.
- **`quote_workflow`** — request → quote → deposit → balance pattern for
  performers, photographers, caterers, consultants. Service playbook with
  the quote_workflow extension. For one-off creative commissions, route
  through Refrain (creator bounties) instead — that's the cooperative-
  aligned cleaner pattern.

## v3 deferral list

- **`auction`** — reserve, time-bound bidding, automatic checkout on
  close. Niche; needs real-time bid handler (Redis pub/sub). Reserve
  cautiously to categories that don't pressure-test cooperative trust.
- **`live_goods`** — plant nurseries, livestock. Requires `usda_class`,
  `perishability`, `requires_in_person_pickup`. Animal sales need per-
  region allow-list and explicit policy gate at vendor onboarding.
- **`membership`** — `recurring` plus access-token issuance. Gyms,
  makerspaces, libraries-of-things. Library-of-things specifically
  belongs on the Threshold mutual-aid surface when free; here only when
  paid.

## Discouraged / not shipping

- **Affiliate / dropship**: collapses cooperative coherence (vendors
  don't hold inventory, don't bear risk, capture margin on others'
  labor). If demanded, frame strictly as a Hub aggregator function via
  federation API; never as an Amazon-style affiliate stream.
- **Healthcare / wellness with PHI**: HIPAA isolation is a hard line.
  Don't merge PHI with the standard order schema. Route to a separate
  compartmented sub-app with BAA partner when demanded.

## Workflow validation

When a product is created or updated, the workflow step
`assertListingTypeAllowedForPlaybook` runs:

```
playbook = getPlaybookForSeller(product.seller_id)
listing_type = getListingTypeForProduct(product.id)
if listing_type not in playbook.allowed_listing_types:
  throw ListingTypeNotAllowedError
```

The error message includes a hint pointing the vendor at their playbook's
allowed types and the option to switch playbooks if their offering shape
no longer fits.

## Discriminator-driven rendering

Storefront and vendor-panel use the listing-type as a discriminator to
choose the right card layout, detail page, and form. A `recurring`
listing renders cadence-aware copy; an `event` listing shows time-window
prominence; a `campaign` listing shows progress-toward-goal. The
discriminator is a string field on the linked `ListingType` row; the
storefront's existing `selectPresentation()` helper at
`storefront/src/lib/listing/presentation.ts` (shipped in §5.1) is extended
to branch on listing-type.
