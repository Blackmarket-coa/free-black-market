import { model } from "@medusajs/framework/utils"

/**
 * PatronageAllocation
 *
 * One row per (period, seller) capturing the seller's share of the
 * quarterly patronage refund pool. Allocation = (commission_paid_by_seller_in_period
 * / total_commission_paid_in_period) × refund_pool.
 *
 * Settled by `backend/src/jobs/patronage-refund.ts` as a single atomic
 * Stellar transaction with N payment operations (one per row).
 *
 * Composite indexes:
 *   - (seller_id, period_start DESC) supports vendor patronage history
 *   - (period_key, status) supports the batch job's "find unpaid" query
 *
 * See `docs/POSTURE_A_COMPLIANCE.md` for why patronage is recorded as a
 * separate concept from commission (Subchapter T accounting cleanliness).
 */
const PatronageAllocation = model.define("hawala_patronage_allocation", {
  id: model.id().primaryKey(),

  /** MercurJS Seller.id. */
  seller_id: model.text(),

  /** Inclusive period boundaries. */
  period_start: model.dateTime(),
  period_end: model.dateTime(),

  /** Human-readable period key, e.g. "2026-Q2". Unique with seller. */
  period_key: model.text(),

  /** Sum of commission this seller paid in the period (basis). */
  gross_volume: model.float(),

  /** Refund amount allocated to this seller. */
  allocation_amount: model.float(),
  allocation_currency: model.text().default("USD"),

  /** computed | queued | paid | failed. */
  status: model.text().default("computed"),

  /** Stellar tx hash once paid (idempotency key). */
  stellar_tx_hash: model.text().nullable(),

  /** When the allocation was paid (or failed). */
  paid_at: model.dateTime().nullable(),

  /** When the allocation was computed by the quarterly job. */
  computed_at: model.dateTime(),

  /** Failure message (when status=failed). */
  error_message: model.text().nullable(),

  metadata: model.json().nullable(),
}).indexes([
  { on: ["seller_id", "period_start"], name: "IDX_patronage_seller_period" },
  { on: ["period_key", "status"], name: "IDX_patronage_period_status" },
  { on: ["status"], name: "IDX_patronage_status" },
])

export default PatronageAllocation
