/**
 * Every entity that holds a customer's personal data, and what a deletion
 * request does to each (D11-1).
 *
 * ## Why this exists
 *
 * `GET /store/customers/me/data-export` returned the customer profile, saved
 * addresses and order history, under a payload that told the person it
 * "contains the personal data Free Black Market holds for your account".
 * `POST /store/customers/me/deletion` removed saved addresses, anonymised the
 * customer record and revoked the sign-in identity. Neither touched anything
 * else, and **47 tables carry a `customer_id`** — a past delivery kept the
 * recipient's name, phone and street address; volunteer attendance, garden
 * membership, ledger balances, governance votes and wellness records all
 * survived a "deletion".
 *
 * They drifted for one reason: each endpoint hand-listed the entities it knew
 * about, and nothing told either of them when a module added another. So the
 * fix is not two longer hand-lists. It is this registry, consumed by both, with
 * `__tests__/customer-data-registry` failing the build when a model gains a
 * `customer_id` without an entry here. A new module cannot quietly start
 * holding personal data that neither endpoint can see.
 *
 * ## The rule each disposition follows
 *
 * Assigning these was a judgement, so the rule is written down rather than left
 * to be inferred from 47 rows:
 *
 *  - **`delete`** — a person's own participation record, with no third party
 *    depending on it. Their volunteer hours, their wishlist, their push tokens.
 *    Leaving these is the pure case of holding data about someone who asked you
 *    to stop.
 *  - **`anonymise`** — the row must survive because something shared depends on
 *    it, but the link to the person does not. A governance vote is the clearest
 *    case: removing it silently changes a tally that other people relied on,
 *    while the voter's identity is not what makes the tally correct.
 *  - **`retain`** — a completed financial record kept under a named legal
 *    basis. `basis` is required by the type for exactly that reason: a
 *    retention without a stated basis is not a decision, it is an omission with
 *    better grammar.
 *
 * Where a row is both a transaction and a bundle of contact details — a food
 * order carries the delivery address — it is `retain` with `anonymiseFields`,
 * so the accounting record survives and the address does not.
 *
 * ## What this does not decide
 *
 * Retention *periods*. Every `retain` here means "kept under this basis"; how
 * long is a policy question the operator has to answer, and `/legal/privacy`
 * says "the period tax and accounting rules require" because that is the
 * honest state of it.
 *
 * ## What it still does not reach
 *
 * `UNREGISTERED_CUSTOMER_REFERENCES`, below: the columns that hold a customer
 * id under another name (a voter, a proposer, a wallet owner), the
 * customer-named columns a retained row keeps (`customer_external_id`), and
 * the rows with no customer column at all that hang off one that has (a food
 * order's delivery, with the recipient's address). None of them is in the
 * export or the erasure. They were found on 2026-11-15 when the drift walk was
 * widened past `customer_id` (P1-13 follow-up). Each carries a proposed
 * disposition for someone to decide; none is applied.
 *
 * The follow-up to the P1-13 review applied four of the proposed `clear`s,
 * where the column is plainly the customer's own words or public name on a
 * row the registry already keeps: `embed_product_review.customer_display_name`,
 * `standing_order.customer_notes`, and `food_order.customer_notes` and
 * `customer_review` (which wait on food_order's own known failure, below). It
 * also registered `password_history_entry`, which the widened walk still
 * missed because it names its person `auth_identity_id`.
 *
 * Plugin tables the walk cannot see, because it reads only `src/modules`:
 * Mercur's `order_set` is registered below. Mercur's `review` (the buyer's
 * `customer_note`) and `wishlist` are tied to the customer only through link
 * tables (`@mercurjs/reviews` customer-review, `@mercurjs/b2c-core`
 * customer-wishlist), which this registry's one-column filter cannot follow.
 * Proposed: `review` anonymise with `customer_note` cleared, like
 * `embed_product_review`; `wishlist` delete, like `shopper_wishlist`. Not
 * applied.
 *
 * Two entries were removed then too: `garden_role` and
 * `hawala_investment_pool` have no customer column. The old walk credited
 * each with the `customer_id` of the next model in the same file, so the
 * deletion tried `DELETE FROM garden_role WHERE customer_id = ?` on every
 * request and failed on it.
 */

export type ErasureAction = "delete" | "anonymise" | "retain"

export type CustomerDataEntry = {
  /** Entity name as `query.graph` addresses it. */
  entity: string
  /** Owning module, so an operator can find who to ask. */
  module: string
  /** What this is, in words a person reading their export would recognise. */
  label: string
  action: ErasureAction
  /**
   * Why the record is kept. Required for `retain` and `anonymise`; a retention
   * with no stated basis is the thing this registry exists to prevent.
   */
  basis?: string
  /** Fields blanked when the action is `anonymise`, or on a `retain` row that still carries PII. */
  anonymiseFields?: string[]
  /**
   * Whether the person's own copy is included in their data export.
   * Default true — if we hold it about them, they can have it. The one
   * exception is credential material (`password_history_entry`): an old
   * password hash says nothing a reader can use about the person, except as a
   * target for offline cracking, so it is erased and never handed out.
   */
  inExport?: boolean
  /**
   * The column holding the customer id, when it is not `customer_id`. Erasure
   * and export both build their filter from it (`customerColumnOf`), so a
   * table that names its customer differently is reached through that name.
   * A framework table always names it, even `customer_id`, because the
   * registry spec cannot read its model to check; one of ours names it only
   * when it is not `customer_id` (`collective_backing.backer_id`), and the
   * registry spec fails if the model has no such column. On an entry
   * `keyedBy: "auth_identity"` it is the column holding that identity's id.
   */
  customerColumn?: string
  /**
   * Which of the person's ids `customerColumn` holds. Default `customer`: the
   * customer id. `auth_identity`: the id of the sign-in identity the deletion
   * revokes (`auth_context.auth_identity_id`), for a table that knows the
   * person only by how they sign in. The erasure binds that id instead of the
   * customer id, and reports the entry as failed when it is not given one.
   * Never exported (the registry spec holds every such entry to
   * `inExport: false`): the export is read by customer id.
   */
  keyedBy?: "customer" | "auth_identity"
  /**
   * How the export reads the table. Default `query`: `query.graph` on
   * `entity`. `sql`: one parameterised SELECT on the table and customer
   * column, the same identifiers the erasure already uses. Only for a table
   * Query cannot address; `QUERY_CANNOT_ADDRESS` below says why for each.
   */
  exportVia?: "query" | "sql"
  /**
   * Set for a table that Medusa core or a plugin owns rather than
   * `src/modules/**`. The anti-drift walk in the registry spec reads only our
   * models, so it cannot discover these and does not report them as stale;
   * each is listed by hand, with the column that ties its rows to the person.
   */
  framework?: true
}

const TAX = "Tax and accounting records, retained for the statutory period."
const TALLY = "Removing the row would alter a shared result other people relied on."
const LEDGER = "Financial ledger integrity; balances must reconcile."

/**
 * The tables the export reads by SQL (`exportVia: "sql"`), each with the
 * reason. Query derives the list method from the table name; each of these
 * modules registers the model under a shorter MedusaService key, so
 * `query.graph` asks the service for a method it does not have. On Postgres
 * every one of these put `{ _error: "could not be read: Method \"list…\" does
 * not exist on …" }` in every customer's export in place of their rows
 * (integration-tests/http/customer-data-registry.spec.ts reads every entry and
 * fails on any `_error`).
 */
export const QUERY_CANNOT_ADDRESS: Record<string, string> = {
  ar_invoice: "Query calls listArInvoices; accounts-receivable's key `Invoice` generates listInvoices.",
  hawala_investment: "Query calls listHawalaInvestments; hawala-ledger's key `Investment` generates listInvestments.",
  collective_backing: "Query calls listCollectiveBackings; collective-campaign's key `Backing` generates listBackings.",
  garden_proposal_comment: "Query calls listGardenProposalComments; governance's key `ProposalComment` generates listProposalComments.",
  embed_product_review: "Query calls listEmbedProductReviews; reviews' key `ProductReview` generates listProductReviews.",
  garden_role_assignment: "Query calls listGardenRoleAssignments; governance's key `RoleAssignment` generates listRoleAssignments.",
  garden_harvest_claim: "Query calls listGardenHarvestClaims; harvest's key `HarvestClaim` generates listHarvestClaims.",
  garden_time_credit: "Query calls listGardenTimeCredits; volunteer's key `TimeCredit` generates listTimeCredits.",
  garden_work_party_signup: "Query calls listGardenWorkPartySignups; volunteer's key `WorkPartySignup` generates listWorkPartySignups.",
  order_channel: "Query calls listOrderChannels; order-channel's key `OrderChannelAttribution` generates listOrderChannelAttributions.",
  wellness_member: "Query calls listWellnessMembers; wellness's key `Member` generates listMembers.",
  wellness_client_profile: "Query calls listWellnessClientProfiles; wellness's key `ClientProfile` generates listClientProfiles.",
  wellness_class_attendee: "Query calls listWellnessClassAttendees; wellness's key `ClassAttendee` generates listClassAttendees.",
}

export const CUSTOMER_DATA_REGISTRY: CustomerDataEntry[] = [
  // ---- Financial and transactional: retained, PII stripped where present ----
  { entity: "ar_invoice", module: "accounts-receivable", label: "Invoices", action: "retain", basis: TAX, exportVia: "sql" },
  { entity: "order_payout_breakdown", module: "payout-breakdown", label: "Order payout breakdowns", action: "retain", basis: TAX },
  { entity: "order_dispute", module: "order-dispute", label: "Order disputes and claims", action: "retain", basis: TAX },
  { entity: "order_impact", module: "impact-metrics", label: "Per-order impact records", action: "retain", basis: TAX },
  { entity: "quote", module: "quote", label: "Quotes requested", action: "retain", basis: TAX },
  { entity: "subscription", module: "subscription", label: "Subscriptions", action: "retain", basis: TAX },
  { entity: "entitlement", module: "entitlement", label: "Purchased access and entitlements", action: "retain", basis: TAX },
  { entity: "hawala_investment", module: "hawala-ledger", label: "Investments", action: "retain", basis: LEDGER, exportVia: "sql" },
  { entity: "blackout_checkout_session", module: "marketplace-listing", label: "Checkout sessions", action: "retain", basis: TAX },
  { entity: "rental", module: "rental", label: "Rentals", action: "retain", basis: TAX },
  // `customer_notes` is the customer's own note to the seller. Only
  // vendor-rules/service.ts createStandingOrder writes it, and nothing reads
  // it back, so clearing it changes no screen (P1-13 review).
  { entity: "standing_order", module: "vendor-rules", label: "Standing orders", action: "retain", basis: TAX, anonymiseFields: ["customer_notes"] },
  { entity: "batch_reservation", module: "harvest-batches", label: "Harvest batch reservations", action: "retain", basis: TAX },
  { entity: "share_box_subscription", module: "order-cycle", label: "Share box subscriptions", action: "retain", basis: TAX },
  { entity: "share_box", module: "order-cycle", label: "Share boxes received", action: "retain", basis: TAX },

  // A campaign backing: money pledged into a collective campaign. It names its
  // customer `backer_id` (written from the signed-in customer's actor id by
  // POST /store/collective/campaigns/:id/backings), which is how it stayed
  // out of both the export and the drift walk that looked only for
  // `customer_id` (P1-13).
  //
  // Not `delete`: `addBacking` re-sums the campaign's backed totals, and the
  // goal it was FUNDED against, from these rows, so removing one silently
  // rewrites a figure every other backer relied on. Not `anonymise`: a
  // failed campaign's escrow refund (`refundCampaignBackingEscrow`, from the
  // campaign route's mark-failed path) is paid to the USER_WALLET that
  // `backer_id` names, so clearing the link would strand a live refund — and
  // the column is NOT NULL, so the UPDATE would fail anyway. Kept with its
  // link, like every other `retain` row, pointing at a customer record the
  // deletion has already anonymised.
  //
  // Two things this does not settle (open, recorded in the ledger):
  //  - `metadata` is kept whole. It carries the escrow and refund ledger-entry
  //    ids that refund reads, but the backing route also spreads in whatever
  //    `metadata` the client posts, and /store is a public API. No client in
  //    this repo sends any; any client could, and the deletion would keep it.
  //  - Retaining does not make a pending refund reachable either. If the
  //    backer deletes their account while a backing is PLEDGED on a live
  //    escrow, a later failed-campaign refund is still paid to their
  //    USER_WALLET, whose sign-in the deletion has revoked. Whether the
  //    deletion should refuse or settle first, or the refund go elsewhere, is
  //    a product and legal decision (docs/POSTURE_A_COMPLIANCE.md rule 3), not
  //    a registry one.
  //
  // Exported by SQL: see QUERY_CANNOT_ADDRESS.
  {
    entity: "collective_backing",
    module: "collective-campaign",
    label: "Collective campaign backings",
    action: "retain",
    basis:
      "Escrowed campaign payment: the campaign's backed totals are summed from these rows, and a failed campaign's refund is paid to the wallet this row names.",
    customerColumn: "backer_id",
    exportVia: "sql",
  },

  // A transaction that also carries contact and location data.
  //
  // KNOWN BROKEN on Postgres, not fixed here: four of these fields are not
  // columns of food_order (customer_name, customer_email and customer_phone:
  // the table has recipient_*; safe_place_description is on food_delivery),
  // so the UPDATE fails whole, clears nothing, and every deletion reports
  // food_order in entities_failed. The fix needs a decision first:
  // `recipient_name` is NOT NULL, so it takes a placeholder or a migration
  // (integration-tests/http/customer-data-registry.spec.ts
  // KNOWN_MISSING_ANONYMISE_FIELDS pins it).
  //
  // `customer_notes` and `customer_review` are the customer's own words
  // (P1-13 review). No code writes either today, and none reads either by
  // name (the food routes return whole rows), so clearing them takes nothing
  // anyone relies on. They are listed so that they go once the UPDATE above
  // can run; it does not clear them today.
  {
    entity: "food_order",
    module: "food-distribution",
    label: "Food orders and deliveries",
    action: "retain",
    basis: TAX,
    anonymiseFields: [
      "customer_name",
      "customer_email",
      "customer_phone",
      "delivery_address_line_1",
      "delivery_address_line_2",
      "delivery_instructions",
      "safe_place_description",
      "delivery_latitude",
      "delivery_longitude",
      "customer_notes",
      "customer_review",
    ],
  },

  // ---- Shared results: the row stays, the link to the person goes ----
  { entity: "garden_vote", module: "governance", label: "Governance votes", action: "anonymise", basis: TALLY },
  { entity: "garden_proposal_comment", module: "governance", label: "Proposal comments", action: "anonymise", basis: TALLY, exportVia: "sql" },
  { entity: "quest_contribution", module: "collective-quest", label: "Collective quest contributions", action: "anonymise", basis: TALLY },
  { entity: "quest_reward_grant", module: "collective-quest", label: "Quest rewards granted", action: "anonymise", basis: TALLY },
  { entity: "buyer_impact", module: "impact-metrics", label: "Aggregate buyer impact", action: "anonymise", basis: TALLY },
  // The review stays; who wrote it does not. `customer_display_name` is the
  // public link to the person ("Jordan R.", derived from their first and last
  // name by POST /store/reviews), shown on every product and vendor review
  // page. Unlinking customer_id alone left it there (P1-13 review). The column
  // is nullable, and the review routes show "Verified buyer" in its place.
  // Nothing else on the row names the reviewer: `reviewer_seller_id` is a
  // seller, and title and body are the review itself. Reviews of customers
  // deleted before this are cleared once, on the next `medusa db:migrate`, by
  // migration-scripts/clear-deleted-customers-review-names-and-password-history.ts.
  { entity: "embed_product_review", module: "reviews", label: "Product reviews written", action: "anonymise", basis: "A review other shoppers rely on outlives the account that wrote it.", exportVia: "sql", anonymiseFields: ["customer_display_name"] },
  { entity: "order_attribution", module: "creator-attribution", label: "Purchase attribution to a creator", action: "anonymise", basis: "A creator's earned attribution must not be revoked by someone else closing their account." },
  // A direct-charge donation's record (docs/POSTURE_A_COMPLIANCE.md rule 10).
  // The money sits on the recipient org's own Stripe account; this row is what
  // lets the org's receipt and FBM's transparency page reconcile against it,
  // so it stays — the donor's link to it does not.
  { entity: "donation_split_record", module: "donation", label: "Donations to partner organisations", action: "anonymise", basis: "Donation receipt and processor reconciliation: the record must match the PaymentIntent on the recipient organisation's Stripe account; the donor identity is not what makes it match." },

  // ---- The person's own records: deleted ----
  { entity: "garden_membership", module: "garden", label: "Community garden memberships", action: "delete" },
  { entity: "garden_role_assignment", module: "governance", label: "Garden role assignments", action: "delete", exportVia: "sql" },
  { entity: "garden_harvest_claim", module: "harvest", label: "Harvest shares claimed", action: "delete", exportVia: "sql" },
  { entity: "garden_time_credit", module: "volunteer", label: "Time-bank credits", action: "delete", exportVia: "sql" },
  { entity: "garden_work_party_signup", module: "volunteer", label: "Work party attendance", action: "delete", exportVia: "sql" },
  { entity: "volunteer_log", module: "volunteer", label: "Volunteer hours logged", action: "delete" },
  { entity: "kitchen_membership", module: "kitchen", label: "Community kitchen memberships", action: "delete" },
  { entity: "network_member", module: "buyer-network", label: "Buyer network memberships", action: "delete" },
  { entity: "bargaining_member", module: "bargaining", label: "Collective bargaining memberships", action: "delete" },
  { entity: "demand_participant", module: "demand-pool", label: "Collective buy participation", action: "delete" },
  { entity: "booking", module: "booking", label: "Bookings", action: "delete" },
  { entity: "order_channel", module: "order-channel", label: "Order channel preferences", action: "delete", exportVia: "sql" },
  { entity: "shopper_wishlist", module: "wishlist", label: "Wishlists", action: "delete" },
  { entity: "device_push_token", module: "native-push", label: "Push notification tokens", action: "delete" },
  { entity: "character_sheet", module: "progression", label: "Progression character sheet", action: "delete" },
  { entity: "xp_event", module: "progression", label: "XP events", action: "delete" },
  { entity: "xp_redemption", module: "progression", label: "XP redemptions", action: "delete" },
  { entity: "wholesale_application", module: "vendor-rules", label: "Wholesale applications", action: "delete" },
  { entity: "analytics_event", module: "creator-attribution", label: "Site analytics events", action: "delete" },
  { entity: "attribution_click_event", module: "creator-attribution", label: "Referral click events", action: "delete" },
  // A 15-minute bearer link to the Blackout subscription manage page: hashes
  // and timestamps only, nothing anyone else depends on, useless once expired.
  { entity: "blackout_manage_session", module: "marketplace-listing", label: "Blackout subscription manage links", action: "delete" },

  // Old password hashes: one row per password change, written by the reuse
  // check on /auth/*/emailpass/update (api/middlewares/password-history.ts),
  // keyed by the auth identity and stamped with the path's actor type
  // ("customer" on /auth/customer/...). Nothing tied them to the customer, so
  // a deletion revoked the identity and kept every old hash (P1-13 review).
  //
  // Keyed by the identity the deletion revokes, and all of its rows go, not
  // only actor_type 'customer': the hash is the identity's password, not the
  // actor's, and the route deletes that identity whole whichever actors it
  // signs in. A 'seller' row on the same identity is the same person's old
  // password, guarding an identity that no longer exists. If the route ever
  // unlinks a shared identity instead of deleting it, this entry must follow.
  // The history of identities deleted before this is removed once, on the
  // next `medusa db:migrate`, by
  // migration-scripts/clear-deleted-customers-review-names-and-password-history.ts.
  //
  // Not exported: credential material (see `inExport`).
  {
    entity: "password_history_entry",
    module: "password-history",
    label: "Previous password hashes",
    action: "delete",
    customerColumn: "auth_identity_id",
    keyedBy: "auth_identity",
    inExport: false,
  },

  // Health-adjacent. Deleted outright and never anonymised-and-kept: an
  // "anonymised" wellness record is still a health record about one person.
  { entity: "wellness_member", module: "wellness", label: "Wellness membership", action: "delete", exportVia: "sql" },
  { entity: "wellness_client_profile", module: "wellness", label: "Wellness client profile", action: "delete", exportVia: "sql" },
  { entity: "wellness_class_attendee", module: "wellness", label: "Wellness class attendance", action: "delete", exportVia: "sql" },

  // ---- Framework-owned tables that hold a person's data ----
  //
  // Medusa's notification log: one row per notification, holding the
  // recipient address (`to`) and the template data, which for the order
  // confirmation is the buyer's first name and what they bought. A delivery
  // record nothing else depends on, so it goes. Rows are tied to the person
  // through `receiver_id`, which `subscribers/order-placed.ts` sets to the
  // order's customer. Rows written without one (guest orders, other callers)
  // are not reached by this entry.
  {
    entity: "notification",
    module: "notification (Medusa core)",
    label: "Emails and notifications sent to you",
    action: "delete",
    customerColumn: "receiver_id",
    framework: true,
  },
  // Mercur's order set: one row per checkout, grouping the per-seller orders
  // a cart split into, with the buyer's customer_id, the cart and the payment
  // collection (`@mercurjs/b2c-core` marketplace module). Nothing in it but
  // ids, and the orders and payment it groups are kept, so it is too.
  {
    entity: "order_set",
    module: "marketplace (@mercurjs/b2c-core)",
    label: "Checkouts split across sellers",
    action: "retain",
    basis: TAX,
    customerColumn: "customer_id",
    framework: true,
  },
]

/** The column a registry entry's rows name their customer in. */
export function customerColumnOf(entry: CustomerDataEntry): string {
  return entry.customerColumn ?? "customer_id"
}

/** Entities whose rows are removed entirely on a deletion request. */
export const DELETE_ENTITIES = CUSTOMER_DATA_REGISTRY.filter(
  (e) => e.action === "delete"
)

/** Entities whose rows survive with the customer link and any PII cleared. */
export const ANONYMISE_ENTITIES = CUSTOMER_DATA_REGISTRY.filter(
  (e) => e.action === "anonymise" || (e.action === "retain" && e.anonymiseFields?.length)
)

/** Entities included in a person's data export. */
export const EXPORT_ENTITIES = CUSTOMER_DATA_REGISTRY.filter(
  (e) => e.inExport !== false
)

export function registryEntry(entity: string): CustomerDataEntry | undefined {
  return CUSTOMER_DATA_REGISTRY.find((e) => e.entity === entity)
}

/**
 * Customer references that neither the export nor the erasure reaches yet.
 *
 * Found on 2026-11-15 by widening the registry spec's walk from `customer_id`
 * to every column named for a person (P1-13 follow-up), then to every column
 * that mentions `customer` whatever it ends in, and to the rows that hang off
 * a registered table without a customer column of their own (the P1-13
 * review). Each was checked against the code that writes it, cited in
 * `holds`. "Dormant" means no code writes the column today, so it holds
 * nothing yet but would hold a customer id once something does.
 *
 * Three kinds of entry:
 *  - a column holding a customer id under another name, keyed by that column;
 *  - a customer-named column a registered row keeps (`proposed: "clear"`:
 *    add it to that entry's `anonymiseFields`);
 *  - a row with no customer column, keyed by the column that ties it to its
 *    parent, with `via` naming the parent and `clear` the columns on it that
 *    are about the person. `food_delivery` is the one that matters: the
 *    recipient's name, phone and street address that D11-1 was opened for
 *    live on the delivery, not only on the order.
 *
 * Why listed rather than registered: most do not fit the registry's shape,
 * which is one customer column per table filtered by equality. A wallet is a
 * customer's only when `owner_type = 'CUSTOMER'`; a vote row carries both the
 * voter and the person who delegated to them; a seller's tier holds customer
 * ids in a JSON array; a wellness note is reached through the client profile
 * it belongs to. And each disposition is a judgement under the rule at the top
 * of this file, which is the decision this registry exists to make on
 * purpose rather than by default. `proposed` is the starting point for that
 * decision, not the decision.
 *
 * Neither endpoint reads this list. The registry spec does: a person-named
 * column, or a child row of a registered table, that is in neither the
 * registry nor this list (nor the spec's own lists of what turned out not to
 * be customer data) fails the build, and so does an entry here once it is
 * registered or cleared. The list can only shrink.
 */
export type UnregisteredCustomerReference = {
  /** What the code writes there, and where. */
  holds: string
  /**
   * Proposed, not applied. `remove-from-array` for a JSON list of ids;
   * `clear` to add the column to its registered entry's `anonymiseFields`.
   */
  proposed: ErasureAction | "remove-from-array" | "clear"
  why: string
  /**
   * For a row with no customer column of its own: the registered (or listed)
   * table its key column points at. The registry spec checks the link.
   */
  via?: string
  /** Columns on the row that are about the person, proposed to be cleared. The registry spec checks each exists. */
  clear?: string[]
}

const OWN = "The person's own record; nothing shared depends on it."
const SHARED = "A shared record other people relied on; the link to the person is not what makes it correct."
const MONEY = "Moves or settles money; the row and its link are needed to reconcile or refund."
const SECONDARY = "A second identifier on a row the registry already retains by customer_id; the retained row keeps a direct identifier the anonymised customer record no longer does."
const VIA_PROFILE = "Reached only through a registered row that the deletion removes; the health record survives its parent and is still about one person."

export const UNREGISTERED_CUSTOMER_REFERENCES: Record<string, UnregisteredCustomerReference> = {
  // asset-graph: member ids are the /store actor id.
  "asset_declaration.member_id": { holds: "the signed-in customer (store/asset-graph/declarations)", proposed: "delete", why: OWN },
  "match_proposal.member_id": { holds: "the declaring customer, copied by asset-graph/matcher.ts", proposed: "delete", why: OWN },
  "attestation.attestor_member_id": { holds: "a member id from the request payload (asset-graph/service.ts)", proposed: "anonymise", why: SHARED },
  "settlement_record.from_member_id": { holds: "a member id (asset-graph/settlement.ts)", proposed: "retain", why: MONEY },
  "settlement_record.to_member_id": { holds: "a member id (asset-graph/settlement.ts)", proposed: "retain", why: MONEY },
  "project_instance.operator_member_id": { holds: "the proposing member (asset-graph/instance-lifecycle.ts)", proposed: "anonymise", why: SHARED },
  "project_instance.member_ids": { holds: "every member's id, as a JSON array (asset-graph/instance-lifecycle.ts)", proposed: "remove-from-array", why: SHARED },

  // bargaining and barter (Buyer Center).
  "bargaining_group.organizer_id": { holds: "the signed-in customer (store/collective/bargaining-groups)", proposed: "anonymise", why: SHARED },
  "bargaining_proposal.proposer_id": { holds: "a customer or seller id (bargaining/service.ts)", proposed: "anonymise", why: SHARED },
  "bargaining_vote.voter_id": { holds: "the signed-in customer (store/collective/bargaining-groups/[id]/proposals/[proposalId]/vote)", proposed: "anonymise", why: SHARED },
  "negotiation_thread.author_id": { holds: "the signed-in customer (store/collective/bargaining-groups/[id]/threads)", proposed: "anonymise", why: SHARED },
  "barter_proposal.proposer_id": { holds: "the signed-in customer (store/collective/demand-pools/[id]/barter)", proposed: "anonymise", why: SHARED },
  "barter_proposal.accepted_by": { holds: "the accepting customer (store/collective/demand-pools/[id]/barter/[proposalId]/accept)", proposed: "anonymise", why: SHARED },
  "buyer_network.admin_id": { holds: "the signed-in customer (store/collective/buyer-networks)", proposed: "anonymise", why: `${SHARED} The column is NOT NULL, so this needs a handover rule or a migration first.` },

  // demand-pool.
  "demand_post.creator_id": { holds: "a customer (store/collective/demand-pools), a seller (v1/seller/launches) or the hub id", proposed: "anonymise", why: SHARED },
  "demand_bounty.contributor_id": { holds: "a customer or seller; the bounty escrow is funded from this owner's wallet (services/collective-hawala.ts)", proposed: "retain", why: MONEY },
  "demand_bounty.assignee_id": { holds: "the claiming customer (demand-pool/service.ts); escrow is released to it", proposed: "retain", why: MONEY },
  "proposal_vote.voter_id": { holds: "the signed-in customer (store/collective/demand-pools/[id]/proposals/[proposalId]/vote)", proposed: "anonymise", why: SHARED },

  // food-distribution: owner ids are whichever /store actor created the row.
  "food_producer.owner_id": { holds: "the /store actor that registered it: customer, seller or driver (store/food-producers)", proposed: "anonymise", why: SHARED },
  "food_courier.owner_id": { holds: "the /store actor that registered it (store/couriers)", proposed: "anonymise", why: SHARED },
  "food_delivery_batch.owner_id": { holds: "the creating actor (store/delivery-batches via createDeliveryBatch)", proposed: "anonymise", why: SHARED },
  "food_delivery_event.actor_id": { holds: "any actor, CUSTOMER among actor_type's values (food-distribution/service.ts)", proposed: "anonymise", why: SHARED },
  // A food order's delivery has no customer column: it is tied to the person
  // only through food_order.customer_id, and carries the address the order
  // entry clears plus more. Proposed retain with the person's details cleared:
  // the courier's earnings, tip and the delivery fee reconcile against it.
  // `recipient_name` and `delivery_address` are NOT NULL, so clearing those
  // needs a placeholder value or a migration first.
  "food_delivery.order_id": {
    holds: "a food order's delivery: recipient name and phone, delivery address and coordinates, instructions, safe-place text, proof photo, signature, name and notes, and the customer's feedback (store/food-deliveries, workflows/food-distribution/steps/create-food-delivery.ts)",
    proposed: "retain",
    why: `${MONEY} The courier's earnings, tip and the delivery fee are on this row.`,
    via: "food_order",
    clear: [
      "recipient_name",
      "recipient_phone",
      "delivery_address",
      "delivery_latitude",
      "delivery_longitude",
      "delivery_instructions",
      "safe_place_description",
      "last_known_latitude",
      "last_known_longitude",
      "route_tracking",
      "proof_photo_url",
      "proof_signature_url",
      "proof_recipient_name",
      "proof_notes",
      "customer_feedback",
    ],
  },
  "food_delivery_event.delivery_id": {
    holds: "the delivery's event log; latitude and longitude are where the courier was at each status change, which at delivery is the recipient's door (food-distribution/service.ts updateDeliveryStatus)",
    proposed: "retain",
    why: "The event trail of a delivery proposed for retention; its positions locate the person, the trail does not need them.",
    via: "food_delivery",
    clear: ["latitude", "longitude"],
  },

  // governance, garden, season, harvest, volunteer.
  "garden_proposal.proposed_by_id": { holds: "the signed-in customer (store/proposals)", proposed: "anonymise", why: SHARED },
  "garden_proposal.implemented_by_id": { holds: "dormant", proposed: "anonymise", why: SHARED },
  "garden_proposal_comment.moderated_by_id": { holds: "dormant", proposed: "anonymise", why: SHARED },
  "garden_role_assignment.assigned_by_id": { holds: "dormant", proposed: "anonymise", why: SHARED },
  "garden_vote.delegated_from_id": { holds: "dormant; the vote row is registered by its voter's customer_id, not this", proposed: "anonymise", why: SHARED },
  "garden_vote_delegation.delegator_id": { holds: "dormant", proposed: "delete", why: OWN },
  "garden_vote_delegation.delegate_id": { holds: "dormant", proposed: "delete", why: OWN },
  "garden_plot.assigned_to_id": { holds: "dormant (read by GET store/gardens/[id]/plots; nothing writes it)", proposed: "anonymise", why: SHARED },
  "garden_growing_plan.created_by_id": { holds: "dormant", proposed: "anonymise", why: SHARED },
  "garden_growing_plan.approved_by_id": { holds: "dormant", proposed: "anonymise", why: SHARED },
  "garden_planting.planted_by_id": { holds: "the signed-in customer (store/seasons/[id]/plantings)", proposed: "anonymise", why: SHARED },
  "garden_harvest.harvested_by_ids": { holds: "dormant JSON array of customer ids (model comment); store/harvests writes a harvested_by_id column that does not exist", proposed: "remove-from-array", why: SHARED },
  "garden_work_party.organizer_id": { holds: "the signed-in customer (store/work-parties)", proposed: "anonymise", why: SHARED },
  "garden_work_party.co_organizer_ids": { holds: "dormant JSON array", proposed: "remove-from-array", why: SHARED },
  "volunteer_log.verified_by_id": { holds: "the verifier (workflows/volunteer/verify-hours; no route runs it today); the log is registered by its volunteer's customer_id", proposed: "anonymise", why: SHARED },

  // hawala-ledger: owner_id is a customer only where owner_type = 'CUSTOMER'.
  "hawala_ledger_account.owner_id": { holds: "a customer for owner_type CUSTOMER (USER_WALLET, hawala-ledger/service.ts); otherwise a seller or a system name", proposed: "retain", why: `${MONEY} Needs an owner_type filter the registry cannot express.` },
  "hawala_bank_account.owner_id": { holds: "a customer for owner_type CUSTOMER (store/hawala/bank-accounts); the row also holds account_holder_name and Stripe ids", proposed: "delete", why: `${OWN} Retain with account_holder_name cleared instead if a withdrawal references it. Needs an owner_type filter.` },
  "karma_event.member_id": { holds: "the customer (progression/karma-mirror.ts copies xp_event.customer_id)", proposed: "delete", why: `${OWN} Mirrors xp_event, which is delete.` },

  // knowledge-base.
  "kb_contribution.submitter_id": { holds: "the signed-in customer (store/knowledge-base/contributions)", proposed: "anonymise", why: SHARED },
  "kb_article.author_id": { holds: "the contribution's submitter (knowledge-base/service.ts)", proposed: "anonymise", why: SHARED },

  // kitchen.
  "kitchen_space.assigned_member_id": { holds: "dormant", proposed: "anonymise", why: SHARED },

  // mutual-aid.
  "mutual_aid_offer.offerer_id": { holds: "the signed-in customer (store/mutual-aid/offers)", proposed: "delete", why: OWN },
  "mutual_aid_request.requester_id": { holds: "the signed-in customer (store/mutual-aid/requests)", proposed: "delete", why: OWN },
  "mutual_aid_request.matched_helper_id": { holds: "the helping customer (mutual-aid/service.ts)", proposed: "anonymise", why: SHARED },

  // Secondary identifiers on rows the registry already retains.
  "blackout_checkout_session.blackout_user_id": { holds: "the buyer's Blackout user id (integrations/blackout/commerce/checkout/sessions)", proposed: "clear", why: SECONDARY },
  "entitlement.customer_external_id": { holds: "the buyer's Blackout mxid (blackout checkout page route)", proposed: "clear", why: SECONDARY },
  "share_box.customer_external_id": { holds: "an external customer id (order-cycle/service.ts)", proposed: "clear", why: SECONDARY },
  "share_box_subscription.customer_external_id": { holds: "an external customer id (order-cycle/service.ts)", proposed: "clear", why: SECONDARY },

  // order-dispute.
  "order_dispute_event.actor_id": { holds: "the customer, seller or admin acting (order-dispute/service.ts)", proposed: "retain", why: "The event trail of a dispute the registry retains under TAX; an export gap, not an erasure one." },
  "order_dispute_event.dispute_id": { holds: "the dispute's event trail, including the buyer's own account of the problem as `message` (order-dispute/service.ts, the opened event)", proposed: "retain", why: "The event trail of a dispute the registry retains under TAX; the buyer's words belong in their export.", via: "order_dispute" },

  // progression.
  "xp_attestation.subject_customer_id": { holds: "the attested customer (progression/service.ts)", proposed: "delete", why: `${OWN} Mirrors xp_event.` },
  "xp_attestation.attester_customer_id": { holds: "the attesting customer (progression/service.ts)", proposed: "anonymise", why: "Someone else's XP depends on it." },

  // request (Mercur): see SD-71 for the reporter email in `data`.
  "request.submitter_id": { holds: "a customer (store/product-reports, store/seller-reports), a seller (vendor/requests) or an auth identity (seller registration)", proposed: "anonymise", why: `${SHARED} The reporter's email in data needs clearing too (SD-71).` },
  "request.requester_id": { holds: "a customer (store/requests, the report routes) or a seller (vendor/requests)", proposed: "anonymise", why: SHARED },

  // vendor-hype-operations-prediction.
  "prediction_market.created_by": { holds: "the /store actor that opened it (store/vendor-hype/markets)", proposed: "anonymise", why: SHARED },
  "prediction_position.supporter_id": { holds: "the signed-in supporter (store/vendor-hype/markets/[id]/positions)", proposed: "retain", why: `${MONEY} A staked position settles against this row.` },
  "prediction_payout_entry.supporter_id": { holds: "the position's supporter (vendor-hype service)", proposed: "retain", why: MONEY },
  "user_prediction_safety.supporter_id": { holds: "the supporter's own limits (vendor-hype service)", proposed: "delete", why: OWN },
  "hype_profile.owner_id": { holds: "an id an admin types (admin/vendor-hype/profiles); an ORGANIZER profile may name a customer. Unverified", proposed: "anonymise", why: SHARED },

  // vendor-rules.
  "vendor_customer_tier.customer_ids": { holds: "customer ids in a seller's pricing tier, as a JSON array (vendor-rules/service.ts, vendor/customer-tiers)", proposed: "remove-from-array", why: "The tier is the seller's; the person's membership of it is theirs." },

  // wellness: reached through rows the registry deletes.
  "wellness_client_note.client_profile_id": { holds: "the wellness_client_profile the note is about (vendor/wellness/clients/[id]/notes)", proposed: "delete", why: VIA_PROFILE, via: "wellness_client_profile" },
  "wellness_client_note.author_member_id": { holds: "dormant (wellness/service.ts accepts it; no route passes it)", proposed: "anonymise", why: SHARED },
  "wellness_intake_response.client_profile_id": { holds: "the wellness_client_profile that answered", proposed: "delete", why: VIA_PROFILE, via: "wellness_client_profile" },
  "wellness_intake_response.class_attendee_id": { holds: "the wellness_class_attendee that answered", proposed: "delete", why: VIA_PROFILE, via: "wellness_class_attendee" },
}
