import { model } from "@medusajs/framework/utils"

/**
 * Where a counted sale came from.
 *
 * `manual` is load-bearing, not a convenience. A cottage food seller's
 * farmers-market and cash sales count toward the same state cap as their
 * online orders, so a meter fed only by platform orders understates the
 * number the seller is actually judged against — and an understated
 * compliance meter is more dangerous than no meter at all.
 */
export const SALES_ENTRY_SOURCES = [
  "medusa_order",
  "food_order",
  "manual",
] as const
export type SalesEntrySource = (typeof SALES_ENTRY_SOURCES)[number]

/**
 * Cottage Food Sales Entry — one counted line in a seller's compliance ledger.
 *
 * Append-only. A refund or cancellation appends a compensating negative entry
 * rather than mutating or deleting the original, so the ledger stays an
 * auditable history of what was counted and when — which is the form a health
 * inspector or permit renewal actually asks for.
 *
 * `(source, source_id)` is unique for platform-sourced entries so subscriber
 * retries can't double-count.
 */
const CottageFoodSalesEntry = model.define("cottage_food_sales_entry", {
  id: model.id().primaryKey(),

  seller_id: model.text(),
  profile_id: model.text().nullable(),

  source: model.enum([...SALES_ENTRY_SOURCES]).default("medusa_order"),
  /** Order id for platform sources; null for manual entries. */
  source_id: model.text().nullable(),

  /**
   * When the sale happened — not when it was recorded. Manual entries are
   * frequently backfilled after a weekend market, and they must land in the
   * period they belong to.
   */
  occurred_at: model.dateTime(),

  /** Signed: negative for reversals. */
  amount_cents: model.bigNumber().default(0),
  /** Signed, same convention. "One meal" is the seller's definition. */
  meal_count: model.number().default(0),

  /**
   * Seller-controlled exclusions. Not every transaction counts toward every
   * cap — a donation or a wholesale line may be excluded from the annual
   * gross while still being a real order.
   */
  counts_toward_annual: model.boolean().default(true),
  counts_toward_meals: model.boolean().default(true),

  /** Set on compensating entries; points at the entry being reversed. */
  reverses_entry_id: model.text().nullable(),

  note: model.text().nullable(),
  metadata: model.json().nullable(),
}).indexes([
  { on: ["seller_id"], name: "IDX_cottage_food_sales_entry_seller_id" },
  { on: ["occurred_at"], name: "IDX_cottage_food_sales_entry_occurred_at" },
  {
    on: ["seller_id", "occurred_at"],
    name: "IDX_cottage_food_sales_entry_seller_occurred",
  },
  {
    on: ["source", "source_id"],
    name: "IDX_cottage_food_sales_entry_source",
    unique: true,
    where: "source_id IS NOT NULL AND deleted_at IS NULL",
  },
])

export default CottageFoodSalesEntry
