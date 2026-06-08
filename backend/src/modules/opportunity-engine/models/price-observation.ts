import { model } from "@medusajs/framework/utils"

/**
 * A single price reading for a category/product in a place at a time. The
 * Price Tracker (§5) and Economic-Intelligence trends (§15) read this series.
 */
const PriceObservation = model
  .define("price_observation", {
    id: model.id().primaryKey(),

    // Subject of the price reading.
    category: model.text().searchable(),
    product_id: model.text().nullable(),

    // Place. region is a coarse bucket ("US", a state code, or a named region).
    region: model.text().default("US"),
    state: model.text().nullable(),

    // Reading.
    unit: model.text().default("each"),
    price_cents: model.number(),
    currency_code: model.text().default("USD"),
    source: model.text().default("manual"),

    observed_at: model.dateTime(),

    metadata: model.json().nullable(),
  })
  .indexes([
    {
      on: ["category", "region", "observed_at"],
      name: "IDX_price_observation_cat_region_time",
    },
    { on: ["category"], name: "IDX_price_observation_category" },
    { on: ["region"], name: "IDX_price_observation_region" },
  ])

export default PriceObservation
