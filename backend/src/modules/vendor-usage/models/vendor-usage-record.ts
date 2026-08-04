import { model } from "@medusajs/framework/utils"

/**
 * One seller's consumption of one metered metric over one billing period.
 *
 * A running total rather than an event log. An event-per-request table would be
 * the more flexible shape, but embed traffic is the highest-volume path in the
 * system and a row per request would make the meter cost more than the thing it
 * measures. The counter is incremented in place with `quantity = quantity + ?`,
 * so concurrent requests cannot lose increments the way a read-modify-write
 * would.
 *
 * `(seller_id, metric, period_start)` is unique among live rows: that is what
 * makes the increment an idempotent upsert target, and what stops a period
 * forking into two partial counters that would each under-bill.
 */
const VendorUsageRecord = model
  .define("vendor_usage_record", {
    id: model.id().primaryKey(),

    seller_id: model.text(),
    /** A `UsageMetric` from `vendor-plan/overage.ts`. */
    metric: model.text(),

    /** UTC calendar-month bounds. Half-open: [start, end). */
    period_start: model.dateTime(),
    period_end: model.dateTime(),

    /** Units consumed in the period. Monotonic within a period. */
    quantity: model.number().default(0),

    /**
     * Set once the period has been billed, so a re-run of the close job is a
     * no-op rather than a second charge. The charge is independently idempotent
     * too; this makes the skip cheap and the state legible to an operator.
     */
    billed_at: model.dateTime().nullable(),
    /** The charge raised for this period's overage, when one was. */
    charge_id: model.text().nullable(),

    metadata: model.json().nullable(),
  })
  .indexes([
    {
      on: ["seller_id", "metric", "period_start"],
      name: "IDX_vendor_usage_record_period",
      unique: true,
      where: "deleted_at IS NULL",
    },
    {
      on: ["period_start", "billed_at"],
      name: "IDX_vendor_usage_record_billing",
      where: "deleted_at IS NULL",
    },
  ])

export default VendorUsageRecord
