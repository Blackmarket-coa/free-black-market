import { model } from "@medusajs/framework/utils"

/**
 * What Stripe says happened to one card charge after it was captured
 * (SD-43; operator answer 2026-10-06: "listen to Stripe; a chargeback counts
 * as a refund of that order").
 *
 * A refund issued in the Stripe dashboard, and a dispute, never reach
 * Medusa: `@medusajs/payment-stripe` acts on payment-intent events only. So
 * on every `charge.refunded`, `charge.refund.updated` and `charge.dispute.*`
 * event for FBM's own Stripe account, the charge is re-read from Stripe —
 * the event is only a trigger, so out-of-order or repeated delivery cannot
 * leave a stale figure — and its state is written here, one row per charge:
 *
 *   - `refunded_cents`: Stripe's `amount_refunded` (every refund, whoever
 *     issued it — a refund made through Medusa is counted here too, so the
 *     ledger takes the larger of this and Medusa's own figure, never both).
 *   - `dispute_lost_cents`: disputes closed `lost` — counted as a refund of
 *     the order(s) the charge paid for.
 *   - `dispute_open_cents`: disputes still open — the sellers on the charge's
 *     payment collection are held (`payout-hold.ts`, reason
 *     `card_dispute_open`) until it closes; nothing is posted while it is
 *     open, because a won dispute returns the money.
 *   - `dispute_fee_cents`: the fees Stripe took on the charge's disputes, net,
 *     as Stripe reports them on each dispute's balance transactions — owed by
 *     the vendor(s) whose order was disputed (operator answer 2026-10-07),
 *     win or lose, because Stripe does not return it.
 *   - `disputed_cents`: the largest amount any one chargeback on the charge
 *     covered, whatever its outcome (inquiries left out). On a charge that
 *     paid several orders (a Mercur cart) the fee is put on those orders only
 *     when this covers the whole charge; a partial chargeback says nothing
 *     about WHICH order was disputed.
 *
 * Integer cents, as Stripe reports them. A record, not money: nothing moves
 * here. No customer data.
 */
export const CardChargeState = model
  .define("hawala_card_charge_state", {
    id: model.id({ prefix: "ccs" }).primaryKey(),
    stripe_charge_id: model.text(),
    payment_intent_id: model.text().nullable(),
    payment_id: model.text(),
    payment_collection_id: model.text(),
    currency_code: model.text(),
    amount_cents: model.number(),
    refunded_cents: model.number().default(0),
    dispute_lost_cents: model.number().default(0),
    dispute_open_cents: model.number().default(0),
    dispute_fee_cents: model.number().default(0),
    disputed_cents: model.number().default(0),
    synced_at: model.dateTime(),
    metadata: model.json().nullable(),
  })
  .indexes([
    {
      on: ["stripe_charge_id"],
      name: "UQ_hawala_card_charge_state_charge",
      unique: true,
      where: "deleted_at IS NULL",
    },
    {
      on: ["payment_collection_id"],
      name: "IDX_hawala_card_charge_state_collection",
      where: "deleted_at IS NULL",
    },
  ])
