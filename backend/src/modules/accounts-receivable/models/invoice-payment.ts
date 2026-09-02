import { model } from "@medusajs/framework/utils"

/**
 * One payment recorded against one invoice.
 *
 * Append-only in practice: a correction is a second row (a negative-intent
 * `adjustment`), never an edit, so the payment history of an invoice always
 * reconstructs what actually happened and when.
 *
 * `idempotency_key` carries a partial-unique index for the same reason
 * `vendor_charge` does: a retried webhook or a double-submitted "mark paid"
 * must collide rather than credit the buyer twice. Every writer supplies one.
 */
const InvoicePayment = model
  .define("ar_invoice_payment", {
    id: model.id().primaryKey(),

    invoice_id: model.text(),
    /** Denormalized so a seller's payment history reads without a join. */
    seller_id: model.text(),

    /** Minor units. Always positive — a reversal is its own row. */
    amount: model.number(),
    currency_code: model.text().default("usd"),

    /**
     * How the money arrived. Free-form rather than an enum: a vendor taking a
     * cheque, an ACH transfer, or cash at a market stall are all real, and the
     * platform has no business constraining the list.
     */
    method: model.text().nullable(),
    /** The vendor's own reference — cheque number, transfer id. */
    reference: model.text().nullable(),

    /** When the money actually arrived, which is not when it was recorded. */
    received_at: model.dateTime(),

    /** Caller-supplied dedupe key. Unique among live rows. */
    idempotency_key: model.text(),

    note: model.text().nullable(),
    metadata: model.json().nullable(),
  })
  .indexes([
    {
      on: ["idempotency_key"],
      name: "UQ_ar_payment_idempotency",
      unique: true,
      where: "deleted_at IS NULL",
    },
    {
      on: ["invoice_id"],
      name: "IDX_ar_payment_invoice",
      where: "deleted_at IS NULL",
    },
    {
      on: ["seller_id"],
      name: "IDX_ar_payment_seller",
      where: "deleted_at IS NULL",
    },
  ])

export default InvoicePayment
