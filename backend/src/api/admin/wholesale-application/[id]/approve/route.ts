import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

/**
 * Plant Network — Wholesale application approval (Section 5).
 *
 * POST /admin/wholesale-application/:id/approve
 *
 * TODO: implement — reuse existing infrastructure, do not create a new group:
 * 1. Load the application by req.params.id.
 * 2. Create/find the MedusaJS customer account for the applicant.
 * 3. Add the customer to the EXISTING WHOLESALE tier
 *    (`modules/vendor-rules` VendorCustomerTier.customer_ids — push the id;
 *    the tier already carries discount_percent / Net-30 payment_terms_days).
 * 4. If MedusaJS price lists are used for wholesale pricing, attach the customer
 *    group to that price list.
 * 5. Send approval email (resend/smtp) with login instructions.
 * 6. Mark the application approved + stamp reviewer.
 */
export async function POST(req: MedusaRequest, _res: MedusaResponse) {
  const _applicationId = req.params.id
  throw new Error(
    "TODO: POST /admin/wholesale-application/:id/approve not implemented"
  )
}
