import { model } from "@medusajs/framework/utils"

/**
 * Stateful record behind a Blackout-initiated checkout session (W1b).
 *
 * The signed URL token alone made `idempotency-key` decorative: a retried
 * POST minted the same *id string* but a fresh cart/order/charge. This row is
 * the real idempotency anchor — the partial unique index on
 * `(blackout_user_id, listing_id, idempotency_key)` collapses concurrent
 * retries onto one session, and `cart_id`/`order_id` recorded here let a
 * re-rendered page resume (or short-circuit) instead of double-ordering.
 * Design lifted from `vendor_plan_event.idempotency_key`.
 */

export enum BlackoutCheckoutSessionStatus {
  PENDING = "pending",
  COMPLETED = "completed",
  FAILED = "failed",
}

const BlackoutCheckoutSession = model
  .define("blackout_checkout_session", {
    id: model.id({ prefix: "bcs" }).primaryKey(),

    blackout_user_id: model.text(),
    listing_id: model.text(),
    idempotency_key: model.text().nullable(),
    mxid: model.text().nullable(),

    // Filled in as the page materializes the purchase.
    customer_id: model.text().nullable(),
    cart_id: model.text().nullable(),
    order_id: model.text().nullable(),
    subscription_id: model.text().nullable(),

    status: model
      .enum(Object.values(BlackoutCheckoutSessionStatus))
      .default(BlackoutCheckoutSessionStatus.PENDING),

    embed: model.boolean().default(false),
    embed_origin: model.text().nullable(),
    return_url: model.text().nullable(),

    /**
     * Bounded metadata echo supplied by Blackout at session creation
     * (e.g. creatorSubscriptionId, canopyPlanCode, tipId). Copied verbatim
     * onto the cart -> order metadata so the purchase.succeeded webhook
     * round-trips it.
     */
    requested_metadata: model.json().nullable(),
  })
  .indexes([
    {
      on: ["blackout_user_id", "listing_id", "idempotency_key"],
      name: "UQ_blackout_checkout_session_idem",
      unique: true,
      where: '"idempotency_key" IS NOT NULL AND "deleted_at" IS NULL',
    },
    {
      on: ["cart_id"],
      name: "IDX_blackout_checkout_session_cart_id",
    },
  ])

export default BlackoutCheckoutSession
