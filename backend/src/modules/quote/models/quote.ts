import { model } from "@medusajs/framework/utils"
import { QuoteStatus } from "../pricing"
import QuoteLine from "./quote-line"

/**
 * A priced offer from one vendor to one buyer.
 *
 * The missing hop between the demand-side cluster and checkout. `request`
 * captures an ask and `bargaining` prices a group proposal, but neither
 * produces line-item prices against a vendor's ordinary listings that a buyer
 * can accept into a cart. This does.
 *
 * `request_id` links back to the RFQ this answers, when it answers one. A
 * quote can also be unsolicited — a vendor quoting a known buyer — so it is
 * nullable rather than required, and `request` stays the single approval
 * model rather than growing a second one.
 *
 * **Prices are snapshots.** `quote_line.unit_price` is the negotiated price
 * and `list_unit_price` is what the catalogue said when the quote was built.
 * Neither is re-read at acceptance: a quote the buyer accepted is the price
 * they were shown, and a catalogue change between sending and accepting must
 * not silently reprice it. That is the whole point of `valid_until` — the
 * vendor bounds how long they are exposed to their own snapshot.
 */
const Quote = model
  .define("quote", {
    id: model.id().primaryKey(),

    /** The vendor making the offer. Every vendor read is scoped by this. */
    seller_id: model.text(),
    /** The buyer it is addressed to. */
    customer_id: model.text(),

    /** The RFQ this answers, when it answers one. */
    request_id: model.text().nullable(),

    /** Human-facing reference, unique per seller. */
    quote_number: model.text(),

    status: model.enum(Object.values(QuoteStatus)).default(QuoteStatus.DRAFT),

    currency_code: model.text().default("usd"),

    /** Sum of line subtotals at the quoted prices, minor units. */
    subtotal: model.number().default(0),
    /** The same basket at list prices, minor units. */
    list_subtotal: model.number().default(0),

    /** When it went to the buyer. Null while draft. */
    sent_at: model.dateTime().nullable(),
    /**
     * The offer's deadline. Checked against the clock at acceptance, not
     * trusted from `status` — the expiry sweep runs on a schedule and a buyer
     * accepting a second late must be refused by the date.
     */
    valid_until: model.dateTime().nullable(),

    accepted_at: model.dateTime().nullable(),
    /** The cart materialized at the quoted prices on acceptance. */
    cart_id: model.text().nullable(),
    /** Set once that cart becomes an order. */
    order_id: model.text().nullable(),

    /** Why it was declined or withdrawn, for the vendor's own record. */
    resolution_note: model.text().nullable(),

    notes: model.text().nullable(),
    metadata: model.json().nullable(),

    lines: model.hasMany(() => QuoteLine, { mappedBy: "quote" }),
  })
  .indexes([
    {
      on: ["seller_id", "quote_number"],
      name: "UQ_quote_seller_number",
      unique: true,
      where: "deleted_at IS NULL",
    },
    {
      on: ["seller_id", "status"],
      name: "IDX_quote_seller_status",
      where: "deleted_at IS NULL",
    },
    {
      on: ["customer_id", "status"],
      name: "IDX_quote_customer_status",
      where: "deleted_at IS NULL",
    },
    {
      on: ["request_id"],
      name: "IDX_quote_request",
      where: "deleted_at IS NULL",
    },
    {
      on: ["valid_until"],
      name: "IDX_quote_valid_until",
      where: "deleted_at IS NULL",
    },
  ])

export default Quote
