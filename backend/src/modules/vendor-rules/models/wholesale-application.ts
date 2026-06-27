import { model } from "@medusajs/framework/utils"

/**
 * Buyer type applying for a wholesale account.
 */
export enum WholesaleBuyerType {
  GARDEN_CENTER = "garden_center",
  LANDSCAPE_CONTRACTOR = "landscape_contractor",
  RESTORATION = "restoration",
  CSA = "csa",
  OTHER = "other",
}

/**
 * Wholesale application review status.
 */
export enum WholesaleApplicationStatus {
  PENDING = "pending",
  APPROVED = "approved",
  REJECTED = "rejected",
}

/**
 * Wholesale Account Application (Plant Network — Section 5)
 *
 * Intake record for a buyer requesting wholesale pricing. On approval the buyer
 * is added to the existing WHOLESALE VendorCustomerTier (no new pricing system).
 */
const WholesaleApplication = model
  .define("wholesale_application", {
    id: model.id().primaryKey(),

    business_name: model.text(),
    contact_name: model.text(),
    email: model.text(),
    phone: model.text(),
    state: model.text(),

    // Required if buying live plants
    nursery_license_number: model.text().nullable(),

    estimated_annual_volume_usd: model.number().default(0),

    // string[] of species the buyer is interested in
    species_interests: model.json().nullable(),

    buyer_type: model.enum(Object.values(WholesaleBuyerType)).default(WholesaleBuyerType.OTHER),

    status: model.enum(Object.values(WholesaleApplicationStatus)).default(
      WholesaleApplicationStatus.PENDING
    ),

    // Set on approval
    customer_id: model.text().nullable(),
    reviewed_by: model.text().nullable(),
    reviewed_at: model.dateTime().nullable(),
    review_notes: model.text().nullable(),

    metadata: model.json().nullable(),
  })
  .indexes([
    { on: ["email"], name: "IDX_wholesale_app_email" },
    { on: ["status"], name: "IDX_wholesale_app_status" },
  ])

export default WholesaleApplication
