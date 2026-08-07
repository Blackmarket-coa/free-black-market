import { model } from "@medusajs/framework/utils"

/**
 * What kind of home food operation this is.
 *
 * The distinction matters because the limits are shaped differently:
 * shelf-stable cottage food is governed by an annual gross-sales cap, while
 * home kitchens selling cooked meals are typically governed by *meal counts*
 * per day and per week on top of an annual cap.
 */
export const OPERATION_TYPES = [
  "SHELF_STABLE", // Baked goods, jams, candy — non-potentially-hazardous
  "HOME_KITCHEN", // Cooked/hot meals prepared and sold from a home kitchen
  "BOTH",
] as const
export type OperationType = (typeof OPERATION_TYPES)[number]

/**
 * Cottage Food Profile — a seller's own declaration of the rules they operate
 * under.
 *
 * FBM ships no state-law table and makes no legal determination. Every limit,
 * permit number, and restriction here is entered by the seller, and the
 * platform's only job is to count faithfully against what they entered and
 * show them the number. Nothing on this model gates a sale: there is no
 * "compliant" boolean, because that is not a call FBM is in a position to
 * make.
 *
 * Every limit is nullable. Null means "I don't track this" and the
 * corresponding meter is simply not rendered — an unset cap must never read as
 * a cap of zero.
 */
const CottageFoodProfile = model.define("cottage_food_profile", {
  id: model.id().primaryKey(),

  // Owning seller. One profile per seller; every query is scoped to this.
  seller_id: model.text().unique(),

  operation_type: model.enum([...OPERATION_TYPES]).default("SHELF_STABLE"),

  // Where they operate, as free text — cottage food rules are frequently set at
  // the county level, so a state code alone can't express the jurisdiction.
  jurisdiction_label: model.text().nullable(), // "Riverside County, CA"
  state_code: model.text().nullable(),

  // Permit / certification. Numbers are recorded as given; FBM does not verify
  // them (the vendor-verification module handles document verification).
  permit_number: model.text().nullable(),
  permit_type_label: model.text().nullable(), // "Class A Cottage Food", "MEHKO"
  permit_issuer: model.text().nullable(),
  permit_issued_at: model.dateTime().nullable(),
  permit_expires_at: model.dateTime().nullable(),
  food_handler_cert_number: model.text().nullable(),
  food_handler_expires_at: model.dateTime().nullable(),

  // ---- Seller-declared limits. Null = not tracked. ----
  annual_sales_cap_cents: model.bigNumber().nullable(),
  /**
   * Month (1-12) the seller's permit year begins. Permit years rarely align
   * with the calendar year, so the annual rollup window starts here rather
   * than at January.
   */
  cap_period_start_month: model.number().default(1),
  daily_meal_cap: model.number().nullable(),
  weekly_meal_cap: model.number().nullable(),

  /**
   * Timezone the daily/weekly meal windows are computed in. A day boundary at
   * UTC midnight would roll a cook's counter over mid-dinner-service.
   */
  timezone: model.text().default("America/New_York"),

  // ---- Seller-declared channel rules. Display/advisory only. ----
  // These are never enforced. They drive what the storefront advertises and
  // what advisories the dashboard shows — they do not block checkout.
  allows_pickup: model.boolean().default(true),
  allows_delivery: model.boolean().default(false),
  allows_shipping: model.boolean().default(false),
  allows_out_of_state: model.boolean().default(false),
  allows_wholesale: model.boolean().default(false),

  // ---- Label content ----
  /**
   * The exact disclosure sentence the seller's jurisdiction requires on the
   * label (e.g. "Made in a home kitchen that is not inspected by the
   * Department of State Health Services"). Stored verbatim as the seller
   * typed it — FBM does not supply or correct this wording.
   */
  label_disclosure_text: model.text().nullable(),
  label_business_name: model.text().nullable(),
  label_address: model.text().nullable(),
  /**
   * Home-based sellers are putting their home address on a label. It is
   * printed for the buyer who receives the product, but is not published on
   * the storefront unless the seller explicitly opts in. Mirrors the privacy
   * intent behind `FoodProducer.hide_address`.
   */
  show_address_publicly: model.boolean().default(false),

  /** Whether the buyer-facing disclosure block renders at all. */
  public_disclosure_opt_in: model.boolean().default(true),

  metadata: model.json().nullable(),
}).indexes([
  { on: ["seller_id"], name: "IDX_cottage_food_profile_seller_id" },
  { on: ["operation_type"], name: "IDX_cottage_food_profile_operation_type" },
])

export default CottageFoodProfile
