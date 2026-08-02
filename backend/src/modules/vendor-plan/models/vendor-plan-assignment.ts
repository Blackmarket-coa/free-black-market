import { model } from "@medusajs/framework/utils"

/** Lifecycle states an assignment moves through. */
export enum VendorPlanStatus {
  TRIALING = "trialing",
  ACTIVE = "active",
  /** Payment failed; entitlements are retained during the dunning grace period. */
  PAST_DUE = "past_due",
  CANCELED = "canceled",
}

/** Who put the seller on this plan. */
export enum VendorPlanAssignedBy {
  SYSTEM = "system",
  ADMIN = "admin",
  SELF = "self",
  MIGRATION = "migration",
}

/**
 * A seller's current plan, and the state machine around it.
 *
 * Exactly one row per seller (`seller_id` is unique). The row's `id` doubles as
 * the entitlement `source_subscription_id`, and is stable for the seller's
 * lifetime — so a plan change reuses it and the existing
 * `grantBundleFromSubscription` / `revokeBySubscriptionId` idempotency applies
 * without a second identifier to keep in sync.
 */
const VendorPlanAssignment = model
  .define("vendor_plan_assignment", {
    id: model.id().primaryKey(),

    seller_id: model.text(),
    plan_code: model.text(),

    status: model
      .enum(Object.values(VendorPlanStatus))
      .default(VendorPlanStatus.ACTIVE),

    current_period_start: model.dateTime().nullable(),
    current_period_end: model.dateTime().nullable(),
    trial_ends_at: model.dateTime().nullable(),

    /** Cancel at period end rather than immediately. */
    cancel_at_period_end: model.boolean().default(false),

    /**
     * A scheduled downgrade. Downgrades never apply immediately — that would
     * strip features the seller has already paid for through period end — so
     * the target is parked here and applied by `jobs/vendor-plan-apply-pending`.
     */
    pending_plan_code: model.text().nullable(),
    pending_effective_at: model.dateTime().nullable(),

    started_at: model.dateTime().nullable(),
    activated_at: model.dateTime().nullable(),
    canceled_at: model.dateTime().nullable(),

    dunning_attempts: model.number().default(0),
    next_retry_at: model.dateTime().nullable(),

    stripe_customer_id: model.text().nullable(),
    last_payment_intent_id: model.text().nullable(),

    assigned_by: model
      .enum(Object.values(VendorPlanAssignedBy))
      .default(VendorPlanAssignedBy.SYSTEM),

    metadata: model.json().nullable(),
  })
  .indexes([
    {
      on: ["seller_id"],
      name: "IDX_vendor_plan_assignment_seller_id",
      unique: true,
    },
    {
      on: ["status", "current_period_end"],
      name: "IDX_vendor_plan_assignment_status_period",
    },
    {
      on: ["pending_effective_at"],
      name: "IDX_vendor_plan_assignment_pending",
    },
  ])

export default VendorPlanAssignment
