import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

/**
 * Plant Network — Wholesale account application intake (Section 5).
 *
 * The WHOLESALE customer tier ALREADY EXISTS:
 *   `modules/vendor-rules/models/vendor-customer-tier.ts`
 *   → CustomerTierType.WHOLESALE with discount_percent, waive_order_minimum,
 *     priority_fulfillment, payment_terms_days (Net-30), free_delivery_threshold,
 *     requires_application.
 *
 * What is MISSING is the public intake + approval flow that assigns an approved
 * buyer into that existing tier. This route is the intake half; approval lives at
 * `api/admin/wholesale-application/[id]/approve/route.ts`.
 */

export interface WholesaleApplicationPayload {
  business_name: string
  contact_name: string
  email: string
  phone: string
  state: string
  nursery_license_number?: string // required if buying live plants
  estimated_annual_volume_usd: number
  species_interests: string[]
  buyer_type:
    | "garden_center"
    | "landscape_contractor"
    | "restoration"
    | "csa"
    | "other"
}

/**
 * POST /store/wholesale-application
 *
 * TODO: implement
 * 1. Validate payload (mirror the validation-schema pattern in
 *    `api/validation-schemas.ts`).
 * 2. Persist the application (vendor-rules module is the natural home, next to
 *    VendorCustomerTier).
 * 3. Notify the Hub via the existing Blackout Matrix subscriber path + email
 *    (resend/smtp modules).
 * 4. Send the applicant a confirmation email.
 * 5. Return { status: "received", estimated_review_hours: 48 }.
 */
export async function POST(_req: MedusaRequest, _res: MedusaResponse) {
  throw new Error("TODO: POST /store/wholesale-application not implemented")
}
