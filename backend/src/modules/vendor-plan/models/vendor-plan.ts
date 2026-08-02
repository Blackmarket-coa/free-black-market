import { model } from "@medusajs/framework/utils"

/**
 * A billing plan a vendor can be on.
 *
 * Denormalized from `catalog.ts`, which is the source of truth — this table
 * exists so admin surfaces and reporting queries can read the ladder without
 * importing TypeScript. Seeded by `scripts/seed-vendor-plans.ts`.
 */
const VendorPlan = model
  .define("vendor_plan", {
    id: model.id().primaryKey(),

    /** Stable identifier referenced by assignments (`free`, `pro`, …). */
    code: model.text(),

    display_name: model.text(),
    description: model.text().nullable(),

    /** Minor units (cents). */
    price_amount: model.number().default(0),
    currency_code: model.text().default("usd"),
    interval: model.enum(["month", "year", "none"]).default("month"),

    /**
     * Plan-level marketplace take rate, consulted only as a fallback below the
     * per-seller override in `seller_payout_settings`. Null = no opinion.
     */
    platform_fee_percent: model.float().nullable(),

    trial_days: model.number().default(0),

    is_active: model.boolean().default(true),
    /** Self-serve selectable, as opposed to operator-assigned. */
    is_public: model.boolean().default(true),
    display_order: model.number().default(0),

    /** Denormalized copy of the catalog's feature keys. */
    feature_keys: model.json().nullable(),

    /** Stripe price handle. Stripe is not the source of truth for the plan. */
    stripe_price_id: model.text().nullable(),

    metadata: model.json().nullable(),
  })
  .indexes([
    { on: ["code"], name: "IDX_vendor_plan_code", unique: true },
    { on: ["is_active"], name: "IDX_vendor_plan_is_active" },
  ])

export default VendorPlan
