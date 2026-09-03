import { model } from "@medusajs/framework/utils"
import Quote from "./quote"

/**
 * One priced line on a quote.
 *
 * `variant_id` points at a real sellable variant so acceptance can build a
 * cart from it — a quote for something that cannot be bought is a document,
 * not an offer.
 *
 * `title` is snapshotted alongside it so a quote still reads correctly after
 * the product is renamed or delisted. The variant id is what the cart needs;
 * the title is what the buyer agreed to.
 */
const QuoteLine = model
  .define("quote_line", {
    id: model.id().primaryKey(),

    quote: model.belongsTo(() => Quote, { mappedBy: "lines" }),

    variant_id: model.text(),
    /** Snapshot of the variant's title when quoted. */
    title: model.text().nullable(),

    /** Whole units. A fractional quantity is a data-entry error. */
    quantity: model.number(),

    /** The negotiated price per unit, minor units. */
    unit_price: model.number(),
    /** What the catalogue said when the quote was built, minor units. */
    list_unit_price: model.number().nullable(),

    /**
     * Days from acceptance until this line ships, as the vendor states it.
     * Null means "none stated" (in stock, ships now) and is distinct from 0.
     */
    lead_time_days: model.number().nullable(),

    /** Vendor's note on this line — substitution, batch size, conditions. */
    note: model.text().nullable(),

    metadata: model.json().nullable(),
  })
  .indexes([
    {
      on: ["variant_id"],
      name: "IDX_quote_line_variant",
      where: "deleted_at IS NULL",
    },
  ])

export default QuoteLine
