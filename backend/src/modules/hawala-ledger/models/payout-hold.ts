import { model } from "@medusajs/framework/utils"

/**
 * Payout hold (SD-40; operator answer 2026-10-06: "hold their payouts" until
 * an admin assigns the refund).
 *
 * A Mercur cart is one payment collection shared by one order per seller.
 * When part of it is refunded in a way no seller's own record accounts for
 * (a Medusa-native refund or an admin cancel against the shared collection),
 * the ledger cannot tell whose sale was refunded, and guessing would take
 * money from the wrong vendor. So nothing is posted, and every seller with an
 * order on that collection is held: no payout and no vendor-to-vendor payment
 * leaves their earnings while the hold is ACTIVE (`requestPayout`,
 * `createVendorToVendorPayment`, `getPayoutOptions`).
 *
 * Placed by the card-order reconciler (`lib/card-order-reconcile.ts`) when
 * it finds the gap; released when the gap is gone — an admin assigns the
 * refund to the sellers' orders (`POST /admin/hawala/card-refunds/:id/attribute`),
 * or the shared collection is refunded in full (which attributes itself).
 * One ACTIVE row per (seller, collection, reason), under a partial unique
 * index, so a second reconciler run never stacks holds.
 *
 * A record, not money: no balance column, nothing moves. `amount` is the
 * unattributed amount when the hold was placed, major units, for the admin
 * view. No customer data (no customer_id).
 */
// `card_dispute_open` (SD-43): a dispute is open on a card charge that paid
// for orders on the collection; held until it closes (won: nothing to post;
// lost: posted as a refund of those orders).
export const PAYOUT_HOLD_REASONS = ["unattributed_card_refund", "card_dispute_open"] as const
export type PayoutHoldReason = (typeof PAYOUT_HOLD_REASONS)[number]

export const PayoutHold = model
  .define("hawala_payout_hold", {
    id: model.id({ prefix: "phold" }).primaryKey(),
    seller_id: model.text(),
    reason: model.text(),
    payment_collection_id: model.text(),
    amount: model.bigNumber(),
    currency_code: model.text().default("usd"),
    status: model.enum(["ACTIVE", "RELEASED"]).default("ACTIVE"),
    placed_at: model.dateTime(),
    released_at: model.dateTime().nullable(),
    /** The admin actor who assigned the refund, or `system` for an automatic release. */
    released_by: model.text().nullable(),
    release_reason: model.text().nullable(),
    metadata: model.json().nullable(),
  })
  .indexes([
    {
      on: ["seller_id", "status"],
      name: "IDX_hawala_payout_hold_seller_status",
      where: "deleted_at IS NULL",
    },
    {
      on: ["payment_collection_id", "status"],
      name: "IDX_hawala_payout_hold_collection_status",
      where: "deleted_at IS NULL",
    },
    {
      on: ["seller_id", "payment_collection_id", "reason"],
      name: "UQ_hawala_payout_hold_active",
      unique: true,
      where: "deleted_at IS NULL AND status = 'ACTIVE'",
    },
  ])
