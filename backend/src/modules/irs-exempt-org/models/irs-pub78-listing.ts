import { model } from "@medusajs/framework/utils"

/**
 * One row per EIN from Pub 78 Data: organisations the IRS lists as eligible
 * to receive tax-deductible contributions under §170. Presence here is the
 * `pub78_eligible` lookup state; absence is *not* "not a charity" (churches
 * and group-ruling subordinates are eligible and unlisted — Pub 5891).
 * Replaced wholesale by the staging swap on each ingest.
 */
const IrsPub78Listing = model
  .define("irs_pub78_listing", {
    id: model.id().primaryKey(),
    ein: model.text(),
    name: model.text(),
    city: model.text().nullable(),
    state: model.text().nullable(),
    country: model.text().nullable(),
    /**
     * Deductibility status codes exactly as the file carries them, comma
     * separated with no space ("PC", "EO,LODGE"). Split on read.
     */
    deductibility_codes: model.text(),
  })
  .indexes([
    {
      on: ["ein"],
      name: "UQ_irs_pub78_listing_ein",
      unique: true,
      where: "deleted_at IS NULL",
    },
  ])

export default IrsPub78Listing
