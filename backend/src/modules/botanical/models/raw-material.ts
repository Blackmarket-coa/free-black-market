import { model } from "@medusajs/framework/utils"

/** Mirrors the botanical-portal `MaterialCategory` union. */
export const MATERIAL_CATEGORIES = [
  "plant_material",
  "carrier_base",
  "additive",
  "packaging",
  "fiber",
  "fungal",
  "seed",
  "hardware",
  "other",
] as const
export type MaterialCategory = (typeof MATERIAL_CATEGORIES)[number]

/** Mirrors the botanical-portal `MaterialSource` union. */
export const MATERIAL_SOURCES = [
  "bmc_nursery",
  "own_harvest",
  "foraged",
  "external_supplier",
  "traded",
] as const
export type MaterialSource = (typeof MATERIAL_SOURCES)[number]

/**
 * Raw Material — an input a maker keeps in stock (botanical, carrier, mordant,
 * packaging, …). Per-lot traceability (lot number, source, remaining quantity,
 * COA) is stored as a JSON array of `RawMaterialLot` objects mirroring the
 * portal type.
 */
const RawMaterial = model.define("botanical_raw_material", {
  id: model.id().primaryKey(),

  maker_id: model.text(),

  name: model.text(),
  common_name: model.text(),
  botanical_name: model.text().nullable(),

  category: model.enum([...MATERIAL_CATEGORIES]).default("plant_material"),

  // The pathway this material is most used in (display hint only).
  pathway_id: model.text().nullable(),

  source_default: model.enum([...MATERIAL_SOURCES]).default("external_supplier"),

  current_stock: model.float().default(0),
  stock_unit: model.text().default("oz"),
  reorder_threshold: model.float().default(0),
  cost_per_unit_cents: model.number().default(0),

  // RawMaterialLot[] — see botanical-portal types.
  lots: model.json().nullable(),

  metadata: model.json().nullable(),
})
  .indexes([
    { on: ["maker_id"], name: "IDX_botanical_raw_material_maker_id" },
    { on: ["category"], name: "IDX_botanical_raw_material_category" },
  ])

export default RawMaterial
