import { model } from "@medusajs/framework/utils"
import { VendorChargeKind, VendorChargeStatus } from "../charges"

/**
 * One thing the platform charges a vendor for.
 *
 * Deliberately a flat charge rather than an invoice-with-lines. Every charge
 * the roadmap actually needs — a plan period, a promotion purchase, a metered
 * overage — is a single amount for a single reason, and an invoice header with
 * exactly one line each time is a join that buys nothing. Grouping several
 * charges onto one statement is a presentation concern; when a real
 * multi-line statement is needed, it groups these rows by period rather than
 * replacing them.
 *
 * `idempotency_key` carries a partial-unique index and is the reason a
 * replayed Stripe webhook or a re-fired renewal cron cannot debit a vendor
 * twice. Every writer must supply one — see `chargeIdempotencyKey`.
 */
const VendorCharge = model
  .define("vendor_charge", {
    id: model.id().primaryKey(),

    seller_id: model.text(),

    kind: model.enum(Object.values(VendorChargeKind)),
    status: model
      .enum(Object.values(VendorChargeStatus))
      .default(VendorChargeStatus.PENDING),

    /** Minor units (cents). Always positive; a refund is a status, not a sign. */
    amount: model.number(),
    currency_code: model.text().default("usd"),

    /** Vendor-facing reason this charge exists. */
    description: model.text(),

    /**
     * Caller-supplied dedupe key. Unique among live rows, so the second
     * attempt at the same logical charge collides instead of collecting twice.
     */
    idempotency_key: model.text(),

    /** The period this charge covers, for plan and usage charges. */
    period_start: model.dateTime().nullable(),
    period_end: model.dateTime().nullable(),

    /** Set once handed to Stripe. Null while pending or if never presented. */
    stripe_payment_intent_id: model.text().nullable(),
    /** Populated on failure so support can answer "why was I not charged". */
    failure_reason: model.text().nullable(),

    paid_at: model.dateTime().nullable(),

    metadata: model.json().nullable(),
  })
  .indexes([
    {
      on: ["idempotency_key"],
      name: "IDX_vendor_charge_idempotency",
      unique: true,
      where: "deleted_at IS NULL",
    },
    {
      on: ["seller_id", "status"],
      name: "IDX_vendor_charge_seller_status",
      where: "deleted_at IS NULL",
    },
    {
      on: ["stripe_payment_intent_id"],
      name: "IDX_vendor_charge_payment_intent",
      where: "deleted_at IS NULL",
    },
  ])

export default VendorCharge
