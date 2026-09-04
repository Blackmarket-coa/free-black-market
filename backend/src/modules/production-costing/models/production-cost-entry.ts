import { model } from "@medusajs/framework/utils"

/**
 * What kind of cost this line represents. Deliberately small and generic — a
 * bakery's flour, a nursery's rooting hormone and a maker's brass stock are all
 * MATERIAL; the vertical detail belongs in `label` / `metadata`, never in a new
 * enum member.
 */
export enum CostCategory {
  /** Inputs consumed by the batch (seed, feedstock, ingredients, components). */
  MATERIAL = "material",
  /** Time spent making the batch, paid or donated. */
  LABOR = "labor",
  /** Packaging and labelling consumed per batch. */
  PACKAGING = "packaging",
  /** Cost of getting inputs *in* (delivery of feedstock, pickup mileage). */
  FREIGHT_IN = "freight_in",
  /** Apportioned facility cost — kitchen rental hours, utilities, equipment. */
  OVERHEAD = "overhead",
}

/**
 * How the input was obtained. Mirrors `ProductionSource` in the production
 * ledger and adds DONATED, which is the case mutual-aid producers actually hit:
 * the input has a real economic cost that belongs in COGS, but no cash left the
 * organisation to get it.
 */
export enum CostSource {
  PURCHASED = "purchased",
  DONATED = "donated",
  FORAGED = "foraged",
  OWN = "own",
  SWAP = "swap",
}

/**
 * Production Cost Entry — one costed line against a production batch.
 *
 * This is the COGS substrate the production ledger deliberately does not carry
 * ("no money is tracked here"). A batch's true unit cost is the sum of its
 * entries divided by realized yield, which is what a producer needs in order to
 * price sustainably rather than guess.
 *
 * The `is_cash_outlay` split is the part that matters for mutual aid: donated
 * flour and volunteer hours are real costs (they must be replaced if the
 * donation stops) but they are not cash the organisation had to find. Keeping
 * both figures separable lets one batch answer two different questions — "what
 * did this actually cost to make?" and "how much cash did we need?" — without
 * maintaining two sets of books.
 *
 * Amounts are integer cents. `quantity` x `unit_amount_cents` is a convenience
 * for entry; `amount_cents` is always the authoritative total for the line.
 */
const ProductionCostEntry = model
  .define("production_cost_entry", {
    id: model.id().primaryKey(),

    seller_id: model.text(),

    /** The production_batch this cost belongs to (production-ledger module). */
    production_batch_id: model.text(),

    category: model.enum(Object.values(CostCategory)),
    source: model.enum(Object.values(CostSource)).default(CostSource.PURCHASED),

    /** Human label for the line ("Organic rye, 25kg sack", "Milling hours"). */
    label: model.text(),

    /** Entry convenience: quantity x unit cost. Never read for totals. */
    quantity: model.number().default(1),
    unit_amount_cents: model.bigNumber().default(0),

    /** Authoritative total for this line, in integer cents. */
    amount_cents: model.bigNumber(),

    currency_code: model.text().default("usd"),

    /**
     * False for donated materials and volunteer labor: counted in COGS, but no
     * cash was spent. Defaults to true, and the service derives it from
     * `source` when the caller does not state it.
     */
    is_cash_outlay: model.boolean().default(true),

    incurred_at: model.dateTime().nullable(),

    /** Optional provenance: the order/donation/booking this cost came from. */
    reference_type: model.text().nullable(),
    reference_id: model.text().nullable(),

    notes: model.text().nullable(),
    metadata: model.json().nullable(),
  })
  .indexes([
    { on: ["production_batch_id"], name: "IDX_production_cost_entry_batch" },
    { on: ["seller_id"], name: "IDX_production_cost_entry_seller" },
    { on: ["category"], name: "IDX_production_cost_entry_category" },
  ])

export default ProductionCostEntry
