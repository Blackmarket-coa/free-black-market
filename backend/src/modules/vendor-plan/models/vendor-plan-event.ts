import { model } from "@medusajs/framework/utils"

export enum VendorPlanEventType {
  ASSIGNED = "assigned",
  UPGRADED = "upgraded",
  DOWNGRADED = "downgraded",
  CANCELED = "canceled",
  RENEWED = "renewed",
  PAYMENT_SUCCEEDED = "payment_succeeded",
  PAYMENT_FAILED = "payment_failed",
  RECONCILED = "reconciled",
}

/**
 * Append-only history of plan transitions — and the idempotency table.
 *
 * Both roles matter. `applyPlanTransition` inserts here FIRST, so the unique
 * index on `idempotency_key` is what makes a replayed Stripe webhook or a
 * re-fired renewal cron a no-op rather than a double charge or a duplicate
 * grant. And when a vendor disputes a downgrade, this is the only record of
 * what changed, when, and what triggered it.
 *
 * `playbook_assignment` deliberately skipped a history table in favour of the
 * audit log; billing cannot, because the audit log is not a uniqueness
 * constraint.
 */
const VendorPlanEvent = model
  .define("vendor_plan_event", {
    id: model.id().primaryKey(),

    seller_id: model.text(),
    assignment_id: model.text(),

    type: model.enum(Object.values(VendorPlanEventType)),

    from_plan_code: model.text().nullable(),
    to_plan_code: model.text().nullable(),

    /**
     * Caller-supplied dedupe key. Stripe webhooks use `evt.<id>`; the renewal
     * cron uses `<assignment_id>:<period_end ISO>`. Null for events that carry
     * no natural key and cannot be replayed.
     */
    idempotency_key: model.text().nullable(),

    payload: model.json().nullable(),
    occurred_at: model.dateTime(),
  })
  .indexes([
    {
      on: ["idempotency_key"],
      name: "IDX_vendor_plan_event_idem",
      unique: true,
    },
    { on: ["seller_id", "occurred_at"], name: "IDX_vendor_plan_event_seller" },
    { on: ["assignment_id"], name: "IDX_vendor_plan_event_assignment" },
  ])

export default VendorPlanEvent
