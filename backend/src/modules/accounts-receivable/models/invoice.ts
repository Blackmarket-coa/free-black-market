import { model } from "@medusajs/framework/utils"
import { InvoiceStatus } from "../terms"

/**
 * A vendor's invoice to their own customer.
 *
 * The direction matters: this is a seller billing a buyer. `vendor-billing`'s
 * `vendor_charge` is the opposite direction (the platform billing a vendor)
 * and the two never mix.
 *
 * **Why this is a table.** Invoices previously lived as a JSON blob under
 * `seller_metadata.invoices_v1`, which made every AR question unanswerable:
 * you cannot age a blob, sum outstanding balances across buyers, or find what
 * is overdue without loading every seller's entire metadata row. Net terms
 * were stored on the buyer's tier and read by nothing, so the platform
 * promised terms and enforced none of them. A queryable table is the whole
 * fix.
 *
 * **`status` is narrower than what a reader sees.** `overdue` and
 * `partially_paid` are functions of (due date, payments, now) and are derived
 * by `presentationStatus`, never stored — storing them would create a second
 * source of truth that a missed sweep silently falsifies. An invoice is
 * overdue because the date passed, not because a cron job got round to it.
 *
 * `amount_paid` is a denormalized sum of this invoice's `invoice_payment`
 * rows, maintained by `recordPayment` inside the same call that writes the
 * payment. The payments are the ledger; this column is the index.
 */
const Invoice = model
  .define("ar_invoice", {
    id: model.id().primaryKey(),

    /** The vendor doing the billing. Every read is scoped by this. */
    seller_id: model.text(),
    /** The buyer being billed. Nullable for a manual/off-platform invoice. */
    customer_id: model.text().nullable(),

    /** The order this bills for, when it bills for one. */
    order_id: model.text().nullable(),

    /** Human-facing sequential-ish reference, unique per seller. */
    invoice_number: model.text(),

    status: model.enum(Object.values(InvoiceStatus)).default(InvoiceStatus.DRAFT),

    currency_code: model.text().default("usd"),

    /** Minor units. What the buyer owes in total. Always non-negative. */
    total: model.number().default(0),
    /** Minor units. Sum of recorded payments. Never exceeds `total`. */
    amount_paid: model.number().default(0),

    /**
     * The terms this invoice was issued under, in days, copied from the
     * buyer's tier at issue time rather than read live.
     *
     * Copied deliberately: an invoice is a statement of what was agreed when
     * it was sent. Re-deriving it later would let a tier change silently
     * rewrite the due date of an invoice already in the buyer's hands.
     */
    terms_days: model.number().default(0),
    /** Which tier granted those terms, for the audit trail. */
    tier_id: model.text().nullable(),

    /** Set when the invoice leaves draft. Null while draft. */
    issued_at: model.dateTime().nullable(),
    /** Derived from `issued_at + terms_days` at issue. Null while draft. */
    due_at: model.dateTime().nullable(),
    /** Set when payments first cover the total. */
    paid_at: model.dateTime().nullable(),

    /** The last dunning stage (days past due) a reminder was sent for. */
    last_dunning_stage: model.number().nullable(),

    memo: model.text().nullable(),
    metadata: model.json().nullable(),
  })
  .indexes([
    {
      on: ["seller_id", "invoice_number"],
      name: "UQ_ar_invoice_seller_number",
      unique: true,
      where: "deleted_at IS NULL",
    },
    {
      on: ["seller_id", "status"],
      name: "IDX_ar_invoice_seller_status",
      where: "deleted_at IS NULL",
    },
    {
      on: ["customer_id"],
      name: "IDX_ar_invoice_customer",
      where: "deleted_at IS NULL",
    },
    {
      on: ["due_at"],
      name: "IDX_ar_invoice_due_at",
      where: "deleted_at IS NULL",
    },
    {
      on: ["order_id"],
      name: "IDX_ar_invoice_order",
      where: "deleted_at IS NULL",
    },
  ])

export default Invoice
