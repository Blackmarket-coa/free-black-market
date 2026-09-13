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
   * Default true — if we hold it about them, they can have it.
   */
  inExport?: boolean
}

const TAX = "Tax and accounting records, retained for the statutory period."
const TALLY = "Removing the row would alter a shared result other people relied on."
const LEDGER = "Financial ledger integrity; balances must reconcile."

export const CUSTOMER_DATA_REGISTRY: CustomerDataEntry[] = [
  // ---- Financial and transactional: retained, PII stripped where present ----
  { entity: "ar_invoice", module: "accounts-receivable", label: "Invoices", action: "retain", basis: TAX },
  { entity: "order_payout_breakdown", module: "payout-breakdown", label: "Order payout breakdowns", action: "retain", basis: TAX },
  { entity: "order_dispute", module: "order-dispute", label: "Order disputes and claims", action: "retain", basis: TAX },
  { entity: "order_impact", module: "impact-metrics", label: "Per-order impact records", action: "retain", basis: TAX },
  { entity: "quote", module: "quote", label: "Quotes requested", action: "retain", basis: TAX },
  { entity: "subscription", module: "subscription", label: "Subscriptions", action: "retain", basis: TAX },
  { entity: "entitlement", module: "entitlement", label: "Purchased access and entitlements", action: "retain", basis: TAX },
  { entity: "hawala_investment", module: "hawala-ledger", label: "Investments", action: "retain", basis: LEDGER },
  { entity: "hawala_investment_pool", module: "hawala-ledger", label: "Investment pool memberships", action: "retain", basis: LEDGER },
  { entity: "blackout_checkout_session", module: "marketplace-listing", label: "Checkout sessions", action: "retain", basis: TAX },
  { entity: "rental", module: "rental", label: "Rentals", action: "retain", basis: TAX },
  { entity: "standing_order", module: "vendor-rules", label: "Standing orders", action: "retain", basis: TAX },
  { entity: "batch_reservation", module: "harvest-batches", label: "Harvest batch reservations", action: "retain", basis: TAX },
  { entity: "share_box_subscription", module: "order-cycle", label: "Share box subscriptions", action: "retain", basis: TAX },
  { entity: "share_box", module: "order-cycle", label: "Share boxes received", action: "retain", basis: TAX },

  // A transaction that also carries contact and location data.
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
    ],
  },

  // ---- Shared results: the row stays, the link to the person goes ----
  { entity: "garden_vote", module: "governance", label: "Governance votes", action: "anonymise", basis: TALLY },
  { entity: "garden_proposal_comment", module: "governance", label: "Proposal comments", action: "anonymise", basis: TALLY },
  { entity: "quest_contribution", module: "collective-quest", label: "Collective quest contributions", action: "anonymise", basis: TALLY },
  { entity: "quest_reward_grant", module: "collective-quest", label: "Quest rewards granted", action: "anonymise", basis: TALLY },
  { entity: "buyer_impact", module: "impact-metrics", label: "Aggregate buyer impact", action: "anonymise", basis: TALLY },
  { entity: "embed_product_review", module: "reviews", label: "Product reviews written", action: "anonymise", basis: "A review other shoppers rely on outlives the account that wrote it." },
  { entity: "order_attribution", module: "creator-attribution", label: "Purchase attribution to a creator", action: "anonymise", basis: "A creator's earned attribution must not be revoked by someone else closing their account." },

  // ---- The person's own records: deleted ----
  { entity: "garden_membership", module: "garden", label: "Community garden memberships", action: "delete" },
  { entity: "garden_role", module: "governance", label: "Garden roles held", action: "delete" },
  { entity: "garden_role_assignment", module: "governance", label: "Garden role assignments", action: "delete" },
  { entity: "garden_harvest_claim", module: "harvest", label: "Harvest shares claimed", action: "delete" },
  { entity: "garden_time_credit", module: "volunteer", label: "Time-bank credits", action: "delete" },
  { entity: "garden_work_party_signup", module: "volunteer", label: "Work party attendance", action: "delete" },
  { entity: "volunteer_log", module: "volunteer", label: "Volunteer hours logged", action: "delete" },
  { entity: "kitchen_membership", module: "kitchen", label: "Community kitchen memberships", action: "delete" },
  { entity: "network_member", module: "buyer-network", label: "Buyer network memberships", action: "delete" },
  { entity: "bargaining_member", module: "bargaining", label: "Collective bargaining memberships", action: "delete" },
  { entity: "demand_participant", module: "demand-pool", label: "Collective buy participation", action: "delete" },
  { entity: "booking", module: "booking", label: "Bookings", action: "delete" },
  { entity: "order_channel", module: "order-channel", label: "Order channel preferences", action: "delete" },
  { entity: "shopper_wishlist", module: "wishlist", label: "Wishlists", action: "delete" },
  { entity: "device_push_token", module: "native-push", label: "Push notification tokens", action: "delete" },
  { entity: "character_sheet", module: "progression", label: "Progression character sheet", action: "delete" },
  { entity: "xp_event", module: "progression", label: "XP events", action: "delete" },
  { entity: "xp_redemption", module: "progression", label: "XP redemptions", action: "delete" },
  { entity: "wholesale_application", module: "vendor-rules", label: "Wholesale applications", action: "delete" },
  { entity: "analytics_event", module: "creator-attribution", label: "Site analytics events", action: "delete" },
  { entity: "attribution_click_event", module: "creator-attribution", label: "Referral click events", action: "delete" },

  // Health-adjacent. Deleted outright and never anonymised-and-kept: an
  // "anonymised" wellness record is still a health record about one person.
  { entity: "wellness_member", module: "wellness", label: "Wellness membership", action: "delete" },
  { entity: "wellness_client_profile", module: "wellness", label: "Wellness client profile", action: "delete" },
  { entity: "wellness_class_attendee", module: "wellness", label: "Wellness class attendance", action: "delete" },
]

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
